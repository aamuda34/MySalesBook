-- Server-enforced six-digit Sellbook PIN.
-- PIN hashes and verified session markers are private database records; no PIN is stored on-device.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.user_app_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists private.user_app_pin_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, session_id)
);
alter table private.user_app_pins enable row level security;
alter table private.user_app_pin_sessions enable row level security;
revoke all on private.user_app_pins, private.user_app_pin_sessions from public, anon, authenticated;

create or replace function private.is_sellbook_pin_verified()
returns boolean language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
begin
  if v_user_id is null then return false; end if;
  if not exists(select 1 from private.user_app_pins p where p.user_id=v_user_id) then return true; end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_session_id:=v_session_text::uuid;
  return exists(select 1 from private.user_app_pin_sessions s
    where s.user_id=v_user_id and s.session_id=v_session_id and s.expires_at>now());
end;
$function$;
revoke all on function private.is_sellbook_pin_verified() from public, anon;
grant execute on function private.is_sellbook_pin_verified() to authenticated;

create or replace function public.get_app_pin_status()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid(); v_row private.user_app_pins%rowtype; v_has_pin boolean; v_verified boolean;
begin
 if v_user_id is null then raise exception 'Sign in before checking your security PIN.'; end if;
 select * into v_row from private.user_app_pins where user_id=v_user_id;
 v_has_pin:=found; v_verified:=private.is_sellbook_pin_verified();
 return jsonb_build_object(
  'has_pin',v_has_pin,'verified',v_verified,
  'locked_until',case when v_has_pin then v_row.locked_until else null end,
  'attempts_remaining',case when v_has_pin then greatest(5-v_row.failed_attempts,0) else 5 end
 );
end;
$function$;

create or replace function public.set_app_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 v_user_id uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id';
 v_session_id uuid; v_inserted integer:=0;
begin
 if v_user_id is null then raise exception 'Sign in before setting your security PIN.'; end if;
 if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'Your security PIN must contain exactly six digits.'; end if;
 if p_pin in ('000000','111111','123456','654321','121212','112233','123123','999999') then raise exception 'Choose a less predictable six-digit PIN.'; end if;
 if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Your sign-in session is not ready. Sign in again and retry.';
 end if;
 v_session_id:=v_session_text::uuid;
 insert into private.user_app_pins(user_id,pin_hash,failed_attempts,locked_until,updated_at)
 values(v_user_id,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,now())
 on conflict(user_id) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your current PIN before changing it.'; end if;
  update private.user_app_pins
  set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),failed_attempts=0,locked_until=null,updated_at=now()
  where user_id=v_user_id;
 end if;
 insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
 values(v_user_id,v_session_id,now(),now()+interval '12 hours')
 on conflict(user_id,session_id) do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
 return jsonb_build_object('created',v_inserted=1,'verified',true,'expires_in_hours',12);
end;
$function$;

create or replace function public.verify_app_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 v_user_id uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id';
 v_session_id uuid; v_row private.user_app_pins%rowtype; v_attempts integer; v_locked_until timestamptz;
begin
 if v_user_id is null then raise exception 'Sign in before verifying your security PIN.'; end if;
 if p_pin is null or p_pin !~ '^[0-9]{6}$' then return jsonb_build_object('verified',false,'message','Enter your six-digit PIN.','attempts_remaining',5); end if;
 if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Your sign-in session is not ready. Sign in again and retry.'; end if;
 v_session_id:=v_session_text::uuid;
 select * into v_row from private.user_app_pins where user_id=v_user_id for update;
 if not found then return jsonb_build_object('verified',false,'requires_setup',true); end if;
 if v_row.locked_until is not null and v_row.locked_until>now() then
  return jsonb_build_object('verified',false,'locked_until',v_row.locked_until,'attempts_remaining',0,
   'message','Too many incorrect PIN attempts. Try again after the lock expires or reset your PIN by signing in again.');
 end if;
 if extensions.crypt(p_pin,v_row.pin_hash)=v_row.pin_hash then
  update private.user_app_pins set failed_attempts=0,locked_until=null,updated_at=now() where user_id=v_user_id;
  insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
  values(v_user_id,v_session_id,now(),now()+interval '12 hours')
  on conflict(user_id,session_id) do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  return jsonb_build_object('verified',true,'expires_in_hours',12);
 end if;
 v_attempts:=v_row.failed_attempts+1;
 v_locked_until:=case when v_attempts>=5 then now()+interval '15 minutes' else null end;
 update private.user_app_pins set failed_attempts=v_attempts,locked_until=v_locked_until,updated_at=now() where user_id=v_user_id;
 return jsonb_build_object('verified',false,'attempts_remaining',greatest(5-v_attempts,0),
  'locked_until',v_locked_until,
  'message',case when v_attempts>=5 then 'Too many incorrect attempts. Your PIN is locked for 15 minutes.' else 'Incorrect PIN. Please try again.' end);
end;
$function$;

create or replace function public.reset_app_pin_after_reauth()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id'; v_session_id uuid;
begin
 if v_user_id is null then raise exception 'Sign in again before resetting your PIN.'; end if;
 if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Your sign-in session is not ready. Sign in again and retry.'; end if;
 v_session_id:=v_session_text::uuid;
 if not exists(select 1 from auth.sessions s where s.id=v_session_id and s.user_id=v_user_id and s.created_at>=now()-interval '5 minutes') then
  raise exception 'For your security, sign out and sign in again before resetting your PIN.';
 end if;
 delete from private.user_app_pin_sessions where user_id=v_user_id;
 delete from private.user_app_pins where user_id=v_user_id;
 return jsonb_build_object('reset',true);
end;
$function$;

revoke all on function public.get_app_pin_status() from public, anon;
revoke all on function public.set_app_pin(text) from public, anon;
revoke all on function public.verify_app_pin(text) from public, anon;
revoke all on function public.reset_app_pin_after_reauth() from public, anon;
grant execute on function public.get_app_pin_status() to authenticated;
grant execute on function public.set_app_pin(text) to authenticated;
grant execute on function public.verify_app_pin(text) to authenticated;
grant execute on function public.reset_app_pin_after_reauth() to authenticated;

do $policies$
declare v_table text;
begin
 foreach v_table in array array['products','sales','expenses','user_profiles','stock_adjustments','stock_purchases','product_creation_history','user_feedback','support_messages'] loop
  execute format('drop policy if exists sellbook_pin_gate on public.%I',v_table);
  execute format('create policy sellbook_pin_gate on public.%I as restrictive for all to authenticated using (private.is_sellbook_pin_verified()) with check (private.is_sellbook_pin_verified())',v_table);
 end loop;
end;
$policies$;


-- The RLS layer cannot constrain SQL issued by SECURITY DEFINER functions,
-- so a trigger adds the same PIN gate to every private ledger write path.
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

-- Seller-only SECURITY DEFINER APIs bypass normal RLS evaluation; explicitly require PIN.
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

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid();
begin
 if v_user_id is null then raise exception 'You must sign in before deleting your account.'; end if;
 if exists(select 1 from private.user_app_pins p where p.user_id=v_user_id) and not private.is_sellbook_pin_verified() then
  raise exception 'Verify your Sellbook security PIN before deleting your account.';
 end if;
 delete from auth.users where id=v_user_id;
end;
$function$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

create or replace function public.sellbook_admin_overview()
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
 if not public.is_sellbook_admin() or not private.is_sellbook_pin_verified() then raise exception 'Administrator access and a verified Sellbook PIN are required'; end if;
 return jsonb_build_object(
  'total_users',(select count(*) from auth.users),
  'new_users_30d',(select count(*) from auth.users where created_at>=now()-interval '30 days'),
  'feedback_open',(select count(*) from public.user_feedback where status in ('new','in_review')),
  'feedback_total',(select count(*) from public.user_feedback),
  'messages_unread',(select count(*) from public.support_messages where recipient_id is null and read_at is null and sender_id<>auth.uid()),
  'notifications_total',(select count(*) from public.app_notifications)
 );
end;
$function$;

create or replace function public.sellbook_admin_platform_metrics()
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare result jsonb;
begin
 if not public.is_sellbook_admin() or not private.is_sellbook_pin_verified() then raise exception 'Administrator access and a verified Sellbook PIN are required'; end if;
 select jsonb_build_object(
  'total_products',(select count(*) from public.products),
  'total_sales',(select count(*) from public.sales),
  'sales_value',(select coalesce(sum(total),0) from public.sales),
  'visits_today',(select count(*) from public.app_page_visits where visit_date=(timezone('utc',now()))::date),
  'visits_7d',(select count(*) from public.app_page_visits where visit_date>=(timezone('utc',now()))::date-6),
  'visits_30d',(select count(*) from public.app_page_visits where visit_date>=(timezone('utc',now()))::date-29),
  'traffic_daily',coalesce((
   select jsonb_agg(jsonb_build_object('day',d.day,'visits',coalesce(v.visits,0)) order by d.day)
   from generate_series((timezone('utc',now()))::date-6,(timezone('utc',now()))::date,interval '1 day') as d(day)
   left join (select visit_date,count(*) as visits from public.app_page_visits where visit_date>=(timezone('utc',now()))::date-6 group by visit_date) v on v.visit_date=d.day::date
  ),'[]'::jsonb)
 ) into result;
 return result;
end;
$function$;

create or replace function public.sellbook_admin_users()
returns table(user_id uuid,email text,created_at timestamptz,last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if not public.is_sellbook_admin() or not private.is_sellbook_pin_verified() then raise exception 'Administrator access and a verified Sellbook PIN are required'; end if;
 return query select u.id,u.email::text,u.created_at,u.last_sign_in_at from auth.users u order by u.created_at desc limit 200;
end;
$function$;
revoke all on function public.sellbook_admin_overview() from public, anon;
revoke all on function public.sellbook_admin_platform_metrics() from public, anon;
revoke all on function public.sellbook_admin_users() from public, anon;
grant execute on function public.sellbook_admin_overview() to authenticated;
grant execute on function public.sellbook_admin_platform_metrics() to authenticated;
grant execute on function public.sellbook_admin_users() to authenticated;
