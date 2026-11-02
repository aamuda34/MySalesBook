alter table public.products
  add column if not exists base_unit text not null default 'unit',
  add column if not exists purchase_unit text not null default 'unit',
  add column if not exists units_per_purchase integer not null default 1,
  add column if not exists pack_unit text,
  add column if not exists units_per_pack integer,
  add column if not exists pack_selling_price numeric;

alter table public.products
  add constraint products_units_per_purchase_positive
    check (units_per_purchase > 0) not valid,
  add constraint products_units_per_pack_positive
    check (units_per_pack is null or units_per_pack > 0) not valid,
  add constraint products_pack_selling_price_positive
    check (pack_selling_price is null or pack_selling_price > 0) not valid;

alter table public.sales
  add column if not exists base_quantity integer,
  add column if not exists sale_unit text,
  add column if not exists units_per_sale integer;

alter table public.sales
  add constraint sales_base_quantity_positive
    check (base_quantity is null or base_quantity > 0) not valid,
  add constraint sales_units_per_sale_positive
    check (units_per_sale is null or units_per_sale > 0) not valid;

create table if not exists public.stock_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  purchase_quantity integer not null check (purchase_quantity > 0),
  purchase_unit text not null,
  units_per_purchase integer not null check (units_per_purchase > 0),
  base_quantity integer not null check (base_quantity > 0),
  cost_per_purchase_unit numeric(12,2) not null check (cost_per_purchase_unit >= 0),
  total_cost numeric(12,2) not null check (total_cost >= 0),
  base_unit_cost numeric(12,4) not null check (base_unit_cost >= 0),
  average_cost_before numeric(12,4) not null check (average_cost_before >= 0),
  average_cost_after numeric(12,4) not null check (average_cost_after >= 0),
  restocked_at timestamptz not null default now()
);

alter table public.stock_purchases enable row level security;
drop policy if exists "Users can view their own stock purchases" on public.stock_purchases;
create policy "Users can view their own stock purchases"
  on public.stock_purchases for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own stock purchases" on public.stock_purchases;
create policy "Users can insert their own stock purchases"
  on public.stock_purchases for insert to authenticated
  with check ((select auth.uid()) = user_id);
grant select, insert on public.stock_purchases to authenticated;