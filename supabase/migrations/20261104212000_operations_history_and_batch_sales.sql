
-- Backward-compatible operational history improvements for Sellbook.
-- Existing sales/expenses remain valid; all new fields are nullable or have safe defaults.

alter table public.expenses
  add column if not exists category text not null default 'Other',
  add column if not exists note text,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.expenses
  drop constraint if exists expenses_category_length_check;
alter table public.expenses
  add constraint expenses_category_length_check
  check (char_length(category) between 1 and 40);
alter table public.expenses
  drop constraint if exists expenses_note_length_check;
alter table public.expenses
  add constraint expenses_note_length_check
  check (note is null or char_length(note) <= 500);
alter table public.expenses
  drop constraint if exists expenses_void_reason_length_check;
alter table public.expenses
  add constraint expenses_void_reason_length_check
  check (void_reason is null or char_length(void_reason) <= 200);

create index if not exists expenses_user_spent_at_idx
  on public.expenses(user_id, spent_at desc);
create index if not exists expenses_user_category_idx
  on public.expenses(user_id, category);

alter table public.sales
  add column if not exists transaction_id uuid;

create unique index if not exists sales_transaction_id_unique_idx
  on public.sales(transaction_id)
  where transaction_id is not null;

-- Product edits are preserved separately from stock movements. Sales, purchases,
-- and stock adjustments remain their own source-of-truth event records.
create table if not exists public.product_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid,
  product_name text not null,
  activity_type text not null check (activity_type in ('updated')),
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_activity_user_product_created_idx
  on public.product_activity(user_id, product_id, created_at desc);

alter table public.product_activity enable row level security;
drop policy if exists product_activity_read_own on public.product_activity;
create policy product_activity_read_own
  on public.product_activity
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.product_activity from public, anon;
grant select on public.product_activity to authenticated;

create or replace function private.log_sellbook_product_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if row(
    old.name, old.category, old.cost_price, old.selling_price,
    old.image_path, old.base_unit, old.purchase_unit, old.units_per_purchase,
    old.pack_unit, old.units_per_pack, old.pack_selling_price
  ) is not distinct from row(
    new.name, new.category, new.cost_price, new.selling_price,
    new.image_path, new.base_unit, new.purchase_unit, new.units_per_purchase,
    new.pack_unit, new.units_per_pack, new.pack_selling_price
  ) then
    return new;
  end if;

  v_old := jsonb_build_object(
    'name', old.name, 'category', old.category,
    'cost_price', old.cost_price, 'selling_price', old.selling_price,
    'image_path', old.image_path, 'base_unit', old.base_unit,
    'purchase_unit', old.purchase_unit, 'units_per_purchase', old.units_per_purchase,
    'pack_unit', old.pack_unit, 'units_per_pack', old.units_per_pack,
    'pack_selling_price', old.pack_selling_price
  );
  v_new := jsonb_build_object(
    'name', new.name, 'category', new.category,
    'cost_price', new.cost_price, 'selling_price', new.selling_price,
    'image_path', new.image_path, 'base_unit', new.base_unit,
    'purchase_unit', new.purchase_unit, 'units_per_purchase', new.units_per_purchase,
    'pack_unit', new.pack_unit, 'units_per_pack', new.units_per_pack,
    'pack_selling_price', new.pack_selling_price
  );

  insert into public.product_activity(
    user_id, product_id, product_name, activity_type, old_values, new_values, created_at
  ) values (
    new.user_id, new.id, new.name, 'updated', v_old, v_new, now()
  );

  return new;
end;
$function$;

drop trigger if exists sellbook_product_update_activity on public.products;
create trigger sellbook_product_update_activity
after update of name, category, cost_price, selling_price, image_path,
  base_unit, purchase_unit, units_per_purchase, pack_unit, units_per_pack, pack_selling_price
on public.products
for each row
execute function private.log_sellbook_product_update();

revoke all on function private.log_sellbook_product_update() from public, anon, authenticated;

-- Multi-product sale groups are committed atomically. Each line still remains a
-- normal sales row, preserving compatibility with existing sales reporting.
create or replace function public.record_sales_batch(
  p_transaction_id uuid,
  p_sales jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing_user_id uuid;
  v_existing_count integer := 0;
  v_line jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_sale_id uuid;
  v_quantity integer;
  v_units_per_sale integer;
  v_base_quantity bigint;
  v_used_quantity bigint;
  v_sale_unit text;
  v_note text;
  v_expected_updated_at timestamptz;
  v_unit_price numeric(12,2);
  v_unit_cost numeric(12,2);
  v_total numeric(12,2);
  v_profit numeric(12,2);
  v_consumption jsonb := '{}'::jsonb;
  v_product_ids uuid[];
  v_count integer := 0;
  v_total_sales numeric(12,2) := 0;
  v_total_profit numeric(12,2) := 0;
  v_entry record;
begin
  if v_user_id is null then
    raise exception 'You must sign in to record a sale.';
  end if;
  if not private.is_sellbook_pin_verified() then
    raise exception 'Verify your Sellbook security PIN before recording or synchronising sales.';
  end if;
  if p_transaction_id is null then
    raise exception 'A unique sale reference is required.';
  end if;
  if jsonb_typeof(p_sales) is distinct from 'array'
     or jsonb_array_length(p_sales) < 1
     or jsonb_array_length(p_sales) > 40 then
    raise exception 'A sale must contain between 1 and 40 product lines.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_transaction_id::text, 0));

  select s.user_id into v_existing_user_id
  from public.sales s
  where s.transaction_id = p_transaction_id
  limit 1;

  if found then
    if v_existing_user_id <> v_user_id then
      raise exception 'This sale reference belongs to another account.';
    end if;
    select count(*), coalesce(sum(s.total),0), coalesce(sum(s.gross_profit),0)
      into v_existing_count, v_total_sales, v_total_profit
    from public.sales s
    where s.transaction_id = p_transaction_id and s.user_id = v_user_id;
    return jsonb_build_object(
      'transaction_id', p_transaction_id,
      'line_count', v_existing_count,
      'total', v_total_sales,
      'gross_profit', v_total_profit,
      'replayed', true
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sales) as x(value)
    group by x.value->>'id'
    having count(*) > 1 or x.value->>'id' is null
  ) then
    raise exception 'Every sale line must have a different unique ID.';
  end if;

  select array_agg(distinct (x.value->>'product_id')::uuid order by (x.value->>'product_id')::uuid)
    into v_product_ids
  from jsonb_array_elements(p_sales) as x(value);

  if coalesce(cardinality(v_product_ids),0) = 0 then
    raise exception 'Choose at least one product.';
  end if;

  -- Lock products in a deterministic order to reduce deadlocks when two devices
  -- submit baskets containing overlapping products.
  perform p.id
  from public.products p
  where p.id = any(v_product_ids) and p.user_id = v_user_id
  order by p.id
  for update;

  select count(*) into v_count
  from public.products p
  where p.id = any(v_product_ids) and p.user_id = v_user_id;

  if v_count <> cardinality(v_product_ids) then
    raise exception 'One or more products are no longer available in your account.';
  end if;

  v_count := 0;

  for v_line in select value from jsonb_array_elements(p_sales)
  loop
    v_sale_id := nullif(v_line->>'id','')::uuid;
    v_product_id := nullif(v_line->>'product_id','')::uuid;
    v_quantity := nullif(v_line->>'quantity','')::integer;
    v_units_per_sale := coalesce(nullif(v_line->>'units_per_sale','')::integer,1);
    v_sale_unit := nullif(trim(v_line->>'sale_unit'),'');
    v_note := nullif(trim(v_line->>'note'),'');
    v_expected_updated_at := nullif(v_line->>'expected_updated_at','')::timestamptz;
    v_unit_price := nullif(v_line->>'unit_price','')::numeric;

    if v_sale_id is null or v_product_id is null then
      raise exception 'A sale line is missing its unique ID or product.';
    end if;
    if exists(select 1 from public.sales s where s.id = v_sale_id) then
      raise exception 'A sale line ID already exists. Refresh the records before trying again.';
    end if;
    if v_quantity is null or v_quantity < 1 then
      raise exception 'Sale quantity must be at least one.';
    end if;
    if v_units_per_sale is null or v_units_per_sale < 1 then
      raise exception 'Sale unit conversion must be a positive whole number.';
    end if;
    if v_sale_unit is null or char_length(v_sale_unit) > 30 then
      raise exception 'Choose a valid selling unit.';
    end if;
    if v_unit_price is null or v_unit_price <= 0 or v_unit_price > 9999999999.99 then
      raise exception 'Enter a valid selling price.';
    end if;
    if v_note is not null and char_length(v_note) > 150 then
      raise exception 'The sale note is too long.';
    end if;
    if v_expected_updated_at is null then
      raise exception 'Refresh the product before recording this sale.';
    end if;

    select * into v_product
    from public.products p
    where p.id = v_product_id and p.user_id = v_user_id;

    if not found then
      raise exception 'Product not found in your account.';
    end if;
    if v_product.updated_at is distinct from v_expected_updated_at then
      raise exception 'Conflict: a product changed on another phone. Refresh stock and try the sale again.';
    end if;
    if v_units_per_sale > 1
       and (coalesce(v_product.pack_unit,'') <> v_sale_unit
         or coalesce(v_product.units_per_pack,0) <> v_units_per_sale) then
      raise exception 'Pack settings changed. Refresh the app and try again.';
    end if;
    if v_units_per_sale = 1 and v_sale_unit not in (coalesce(v_product.base_unit,'unit'),'unit') then
      raise exception 'Selling unit changed. Refresh the app and try again.';
    end if;

    v_base_quantity := v_quantity::bigint * v_units_per_sale::bigint;
    if v_base_quantity > 2147483647 then
      raise exception 'Sale quantity is too large.';
    end if;

    v_used_quantity := coalesce((v_consumption->>v_product_id::text)::bigint,0);
    if v_used_quantity + v_base_quantity > v_product.stock then
      raise exception 'Insufficient stock for %.', v_product.name;
    end if;
    v_consumption := jsonb_set(
      v_consumption,
      array[v_product_id::text],
      to_jsonb(v_used_quantity + v_base_quantity),
      true
    );

    v_unit_cost := round(v_product.cost_price * v_units_per_sale,2);
    v_total := round(v_quantity * v_unit_price,2);
    v_profit := round(v_total - (v_quantity * v_unit_cost),2);

    insert into public.sales(
      id, user_id, product_id, product_name, quantity, unit_price, unit_cost,
      total, gross_profit, note, sold_at, base_quantity, sale_unit, units_per_sale,
      transaction_id
    ) values (
      v_sale_id, v_user_id, v_product.id, v_product.name, v_quantity, v_unit_price,
      v_unit_cost, v_total, v_profit, v_note,
      coalesce(nullif(v_line->>'sold_at','')::timestamptz,now()),
      v_base_quantity::integer, v_sale_unit, v_units_per_sale, p_transaction_id
    );

    v_total_sales := v_total_sales + v_total;
    v_total_profit := v_total_profit + v_profit;
    v_count := v_count + 1;
  end loop;

  for v_entry in select key, value from jsonb_each_text(v_consumption)
  loop
    update public.products
    set stock = stock - v_entry.value::integer,
        updated_at = now()
    where id = v_entry.key::uuid and user_id = v_user_id;
  end loop;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'line_count', v_count,
    'total', v_total_sales,
    'gross_profit', v_total_profit,
    'replayed', false
  );
end;
$function$;

revoke all on function public.record_sales_batch(uuid,jsonb) from public, anon;
grant execute on function public.record_sales_batch(uuid,jsonb) to authenticated;
