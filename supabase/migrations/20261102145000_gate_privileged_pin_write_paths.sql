-- Expose only the current session's PIN unlock expiry to the signed-in UI.
create or replace function public.get_app_pin_status()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_pin_exists boolean := false;
  v_failed_attempts integer := 0;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in before checking your security PIN.'; end if;
  select p.failed_attempts,p.locked_until
    into v_failed_attempts,v_locked_until
  from private.user_app_pins p
  where p.user_id=v_user_id;
  v_pin_exists:=found;

  if v_pin_exists and v_session_text is not null
     and v_session_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} This prevents older clients
-- and SECURITY DEFINER RPCs from operating on private seller data before PIN setup.
create or replace function private.is_sellbook_pin_verified()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
begin
  if v_user_id is null then return false; end if;
  if not exists (
    select 1 from private.user_app_pins p where p.user_id = v_user_id
  ) then
    return false;
  end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_session_id := v_session_text::uuid;
  return exists (
    select 1 from private.user_app_pin_sessions s
    where s.user_id = v_user_id
      and s.session_id = v_session_id
      and s.expires_at > now()
  );
end;
$function$;
revoke all on function private.is_sellbook_pin_verified() from public, anon;
grant execute on function private.is_sellbook_pin_verified() to authenticated;

-- Add a write-time PIN guard for SECURITY DEFINER ledger RPCs and seller-only RPCs.
create or replace function private.enforce_sellbook_pin_before_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.is_sellbook_pin_verified() then
    raise exception 'Verify your Sellbook security PIN before changing business records.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.enforce_sellbook_pin_before_write() from public, anon, authenticated;

do $triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'products','sales','expenses','user_profiles','stock_adjustments',
    'stock_purchases','product_creation_history','user_feedback','support_messages'
  ] loop
    execute format('drop trigger if exists sellbook_pin_write_guard on public.%I',v_table);
    execute format(
      'create trigger sellbook_pin_write_guard before insert or update or delete on public.%I for each row execute function private.enforce_sellbook_pin_before_write()',
      v_table
    );
  end loop;
end;
$triggers$;

create or replace function public.get_my_marketplace_subscribers()
returns table(owner_id uuid,buyer_id uuid,display_name text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your Sellbook security PIN first'; end if;
  return query
    select ss.owner_id,ss.buyer_id,
      coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(trim(u.raw_user_meta_data->>'name'),''),'Buyer '||right(ss.buyer_id::text,6)),
      ss.created_at
    from public.marketplace_store_subscriptions ss
    join auth.users u on u.id=ss.buyer_id
    where ss.owner_id=auth.uid();
end;
$function$;
revoke all on function public.get_my_marketplace_subscribers() from public, anon;
grant execute on function public.get_my_marketplace_subscribers() to authenticated;

create or replace function public.sync_owner_marketplace_listings(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_shop public.marketplace_shops%rowtype; p record;
begin
  if auth.uid() is null or auth.uid()<>p_owner_id then raise exception 'Not authorized'; end if;
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your Sellbook security PIN first'; end if;
  select * into v_shop from public.marketplace_shops where owner_id=p_owner_id;
  if not found or not v_shop.is_connected or not v_shop.is_active then
    delete from public.marketplace_listings where owner_id=p_owner_id;
    return;
  end if;
  update public.marketplace_listings set shop_name=v_shop.name,updated_at=now() where owner_id=p_owner_id;
  for p in select * from public.products where user_id=p_owner_id loop
    insert into public.marketplace_listings(product_id,owner_id,shop_name,name,category,price,currency,unit,stock_status,is_active,updated_at)
    values(p.id,p_owner_id,v_shop.name,p.name,coalesce(p.category,'Uncategorized'),p.selling_price,'NGN',coalesce(p.base_unit,'unit'),
      case when p.stock<=0 then 'out_of_stock' when p.stock<=5 then 'low_stock' else 'available' end,true,now())
    on conflict(product_id) do update set
      shop_name=excluded.shop_name,name=excluded.name,category=excluded.category,price=excluded.price,
      currency=excluded.currency,unit=excluded.unit,stock_status=excluded.stock_status,is_active=true,updated_at=now();
  end loop;
end;
$function$;
revoke all on function public.sync_owner_marketplace_listings(uuid) from public, anon;
grant execute on function public.sync_owner_marketplace_listings(uuid) to authenticated;

create or replace function public.restock_product(
  p_purchase_id uuid,
  p_product_id uuid,
  p_purchase_quantity integer,
  p_purchase_unit text,
  p_units_per_purchase integer,
  p_cost_per_purchase_unit numeric,
  p_restocked_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_product public.products%rowtype;
  v_base_quantity integer;
  v_total_cost numeric(12,2);
  v_base_cost numeric(12,4);
  v_new_stock integer;
  v_new_stock_bigint bigint;
  v_base_quantity_bigint bigint;
  v_avg_before numeric(12,4);
  v_avg_after numeric(12,4);
begin
  if v_user_id is null then raise exception 'Sign in before restocking.'; end if;
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your Sellbook security PIN before restocking.'; end if;
  if p_purchase_id is null or p_product_id is null
     or p_purchase_quantity is null or p_purchase_quantity<1
     or p_units_per_purchase is null or p_units_per_purchase<1
     or p_cost_per_purchase_unit is null or p_cost_per_purchase_unit<0
     or p_cost_per_purchase_unit>9999999999.99 then
    raise exception 'Enter a valid purchase quantity and cost.';
  end if;
  if coalesce(trim(p_purchase_unit),'')='' or length(trim(p_purchase_unit))>30 then
    raise exception 'Enter a valid purchase unit.';
  end if;
  v_base_quantity_bigint:=p_purchase_quantity::bigint*p_units_per_purchase::bigint;
  if v_base_quantity_bigint<1 or v_base_quantity_bigint>2000000000 then raise exception 'Purchase quantity is too large.'; end if;
  v_base_quantity:=v_base_quantity_bigint::integer;
  v_total_cost:=round(p_purchase_quantity::numeric*p_cost_per_purchase_unit,2);
  if v_total_cost>9999999999.99 then raise exception 'Total purchase cost is too large.'; end if;
  v_base_cost:=round(v_total_cost/v_base_quantity,4);
  select * into v_product from public.products where id=p_product_id and user_id=v_user_id for update;
  if not found then raise exception 'Product not found in your account.'; end if;
  if exists(select 1 from public.stock_purchases where id=p_purchase_id and user_id=v_user_id) then
    return jsonb_build_object('duplicate',true,'stock',v_product.stock,'cost_price',v_product.cost_price);
  end if;
  v_new_stock_bigint:=v_product.stock::bigint+v_base_quantity_bigint;
  if v_new_stock_bigint>2000000000 then raise exception 'Stock quantity is too large.'; end if;
  v_new_stock:=v_new_stock_bigint::integer;
  v_avg_before:=coalesce(v_product.cost_price,0);
  if v_product.stock=0 then
    v_avg_after:=v_base_cost;
  else
    v_avg_after:=round(((v_product.stock::numeric*v_avg_before)+(v_base_quantity::numeric*v_base_cost))/v_new_stock,4);
  end if;
  update public.products set stock=v_new_stock,cost_price=v_avg_after,updated_at=now()
    where id=p_product_id and user_id=v_user_id;
  insert into public.stock_purchases(
    id,user_id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,
    base_quantity,cost_per_purchase_unit,total_cost,base_unit_cost,average_cost_before,average_cost_after,
    previous_stock,new_stock,restocked_at
  ) values(
    p_purchase_id,v_user_id,p_product_id,v_product.name,p_purchase_quantity,trim(p_purchase_unit),p_units_per_purchase,
    v_base_quantity,p_cost_per_purchase_unit,v_total_cost,v_base_cost,v_avg_before,v_avg_after,
    v_product.stock,v_new_stock,coalesce(p_restocked_at,now())
  );
  return jsonb_build_object('duplicate',false,'stock',v_new_stock,'cost_price',v_avg_after,
    'base_quantity',v_base_quantity,'previous_stock',v_product.stock,'new_stock',v_new_stock);
end;
$function$;
revoke all on function public.restock_product(uuid,uuid,integer,text,integer,numeric,timestamptz) from public, anon;
grant execute on function public.restock_product(uuid,uuid,integer,text,integer,numeric,timestamptz) to authenticated;

-- app_notifications also serves Buybook reservation notifications; don't couple it to
-- the Sellbook-only PIN session. The other ledger tables remain PIN-gated.
drop policy if exists sellbook_pin_gate on public.app_notifications;
 then
    v_session_id:=v_session_text::uuid;
    select s.expires_at into v_expires_at
    from private.user_app_pin_sessions s
    where s.user_id=v_user_id and s.session_id=v_session_id;
  end if;

  return jsonb_build_object(
    'has_pin',v_pin_exists,
    'verified',v_expires_at is not null and v_expires_at>now(),
    'expires_at',v_expires_at,
    'locked_until',v_locked_until,
    'attempts_remaining',case when v_pin_exists then greatest(5-coalesce(v_failed_attempts,0),0) else 5 end
  );
end;
$function$;
revoke all on function public.get_app_pin_status() from public, anon;
grant execute on function public.get_app_pin_status() to authenticated;

-- An account without an enrolled PIN is not verified. This prevents older clients
-- and SECURITY DEFINER RPCs from operating on private seller data before PIN setup.
create or replace function private.is_sellbook_pin_verified()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
begin
  if v_user_id is null then return false; end if;
  if not exists (
    select 1 from private.user_app_pins p where p.user_id = v_user_id
  ) then
    return false;
  end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_session_id := v_session_text::uuid;
  return exists (
    select 1 from private.user_app_pin_sessions s
    where s.user_id = v_user_id
      and s.session_id = v_session_id
      and s.expires_at > now()
  );
end;
$function$;
revoke all on function private.is_sellbook_pin_verified() from public, anon;
grant execute on function private.is_sellbook_pin_verified() to authenticated;

-- Add a write-time PIN guard for SECURITY DEFINER ledger RPCs and seller-only RPCs.
create or replace function private.enforce_sellbook_pin_before_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.is_sellbook_pin_verified() then
    raise exception 'Verify your Sellbook security PIN before changing business records.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.enforce_sellbook_pin_before_write() from public, anon, authenticated;

do $triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'products','sales','expenses','user_profiles','stock_adjustments',
    'stock_purchases','product_creation_history','user_feedback','support_messages'
  ] loop
    execute format('drop trigger if exists sellbook_pin_write_guard on public.%I',v_table);
    execute format(
      'create trigger sellbook_pin_write_guard before insert or update or delete on public.%I for each row execute function private.enforce_sellbook_pin_before_write()',
      v_table
    );
  end loop;
end;
$triggers$;

create or replace function public.get_my_marketplace_subscribers()
returns table(owner_id uuid,buyer_id uuid,display_name text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your Sellbook security PIN first'; end if;
  return query
    select ss.owner_id,ss.buyer_id,
      coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(trim(u.raw_user_meta_data->>'name'),''),'Buyer '||right(ss.buyer_id::text,6)),
      ss.created_at
    from public.marketplace_store_subscriptions ss
    join auth.users u on u.id=ss.buyer_id
    where ss.owner_id=auth.uid();
end;
$function$;
revoke all on function public.get_my_marketplace_subscribers() from public, anon;
grant execute on function public.get_my_marketplace_subscribers() to authenticated;

create or replace function public.sync_owner_marketplace_listings(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_shop public.marketplace_shops%rowtype; p record;
begin
  if auth.uid() is null or auth.uid()<>p_owner_id then raise exception 'Not authorized'; end if;
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your Sellbook security PIN first'; end if;
  select * into v_shop from public.marketplace_shops where owner_id=p_owner_id;
  if not found or not v_shop.is_connected or not v_shop.is_active then
    delete from public.marketplace_listings where owner_id=p_owner_id;
    return;
  end if;
  update public.marketplace_listings set shop_name=v_shop.name,updated_at=now() where owner_id=p_owner_id;
  for p in select * from public.products where user_id=p_owner_id loop
    insert into public.marketplace_listings(product_id,owner_id,shop_name,name,category,price,currency,unit,stock_status,is_active,updated_at)
    values(p.id,p_owner_id,v_shop.name,p.name,coalesce(p.category,'Uncategorized'),p.selling_price,'NGN',coalesce(p.base_unit,'unit'),
      case when p.stock<=0 then 'out_of_stock' when p.stock<=5 then 'low_stock' else 'available' end,true,now())
    on conflict(product_id) do update set
      shop_name=excluded.shop_name,name=excluded.name,category=excluded.category,price=excluded.price,
      currency=excluded.currency,unit=excluded.unit,stock_status=excluded.stock_status,is_active=true,updated_at=now();
  end loop;
end;
$function$;
revoke all on function public.sync_owner_marketplace_listings(uuid) from public, anon;
grant execute on function public.sync_owner_marketplace_listings(uuid) to authenticated;

create or replace function public.restock_product(
  p_purchase_id uuid,
  p_product_id uuid,
  p_purchase_quantity integer,
  p_purchase_unit text,
  p_units_per_purchase integer,
  p_cost_per_purchase_unit numeric,
  p_restocked_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_product public.products%rowtype;
  v_base_quantity integer;
  v_total_cost numeric(12,2);
  v_base_cost numeric(12,4);
  v_new_stock integer;
  v_new_stock_bigint bigint;
  v_base_quantity_bigint bigint;
  v_avg_before numeric(12,4);
  v_avg_after numeric(12,4);
begin
  if v_user_id is null then raise exception 'Sign in before restocking.'; end if;
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your Sellbook security PIN before restocking.'; end if;
  if p_purchase_id is null or p_product_id is null
     or p_purchase_quantity is null or p_purchase_quantity<1
     or p_units_per_purchase is null or p_units_per_purchase<1
     or p_cost_per_purchase_unit is null or p_cost_per_purchase_unit<0
     or p_cost_per_purchase_unit>9999999999.99 then
    raise exception 'Enter a valid purchase quantity and cost.';
  end if;
  if coalesce(trim(p_purchase_unit),'')='' or length(trim(p_purchase_unit))>30 then
    raise exception 'Enter a valid purchase unit.';
  end if;
  v_base_quantity_bigint:=p_purchase_quantity::bigint*p_units_per_purchase::bigint;
  if v_base_quantity_bigint<1 or v_base_quantity_bigint>2000000000 then raise exception 'Purchase quantity is too large.'; end if;
  v_base_quantity:=v_base_quantity_bigint::integer;
  v_total_cost:=round(p_purchase_quantity::numeric*p_cost_per_purchase_unit,2);
  if v_total_cost>9999999999.99 then raise exception 'Total purchase cost is too large.'; end if;
  v_base_cost:=round(v_total_cost/v_base_quantity,4);
  select * into v_product from public.products where id=p_product_id and user_id=v_user_id for update;
  if not found then raise exception 'Product not found in your account.'; end if;
  if exists(select 1 from public.stock_purchases where id=p_purchase_id and user_id=v_user_id) then
    return jsonb_build_object('duplicate',true,'stock',v_product.stock,'cost_price',v_product.cost_price);
  end if;
  v_new_stock_bigint:=v_product.stock::bigint+v_base_quantity_bigint;
  if v_new_stock_bigint>2000000000 then raise exception 'Stock quantity is too large.'; end if;
  v_new_stock:=v_new_stock_bigint::integer;
  v_avg_before:=coalesce(v_product.cost_price,0);
  if v_product.stock=0 then
    v_avg_after:=v_base_cost;
  else
    v_avg_after:=round(((v_product.stock::numeric*v_avg_before)+(v_base_quantity::numeric*v_base_cost))/v_new_stock,4);
  end if;
  update public.products set stock=v_new_stock,cost_price=v_avg_after,updated_at=now()
    where id=p_product_id and user_id=v_user_id;
  insert into public.stock_purchases(
    id,user_id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,
    base_quantity,cost_per_purchase_unit,total_cost,base_unit_cost,average_cost_before,average_cost_after,
    previous_stock,new_stock,restocked_at
  ) values(
    p_purchase_id,v_user_id,p_product_id,v_product.name,p_purchase_quantity,trim(p_purchase_unit),p_units_per_purchase,
    v_base_quantity,p_cost_per_purchase_unit,v_total_cost,v_base_cost,v_avg_before,v_avg_after,
    v_product.stock,v_new_stock,coalesce(p_restocked_at,now())
  );
  return jsonb_build_object('duplicate',false,'stock',v_new_stock,'cost_price',v_avg_after,
    'base_quantity',v_base_quantity,'previous_stock',v_product.stock,'new_stock',v_new_stock);
end;
$function$;
revoke all on function public.restock_product(uuid,uuid,integer,text,integer,numeric,timestamptz) from public, anon;
grant execute on function public.restock_product(uuid,uuid,integer,text,integer,numeric,timestamptz) to authenticated;

-- app_notifications also serves Buybook reservation notifications; don't couple it to
-- the Sellbook-only PIN session. The other ledger tables remain PIN-gated.
drop policy if exists sellbook_pin_gate on public.app_notifications;
