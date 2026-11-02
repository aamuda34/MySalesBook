-- Immutable snapshot of each newly created product.
-- product_id intentionally has no FK to products so this record survives product deletion.
create table if not exists public.product_creation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null,
  product_name text not null,
  category text not null default 'Uncategorized',
  cost_price numeric(12,2) not null check (cost_price >= 0),
  selling_price numeric(12,2) not null check (selling_price > 0),
  initial_stock integer not null check (initial_stock >= 0),
  image_path text,
  base_unit text not null default 'unit',
  purchase_unit text not null default 'unit',
  units_per_purchase integer not null default 1 check (units_per_purchase > 0),
  pack_unit text,
  units_per_pack integer check (units_per_pack is null or units_per_pack > 0),
  pack_selling_price numeric(12,2) check (pack_selling_price is null or pack_selling_price > 0),
  added_at timestamptz not null,
  constraint product_creation_history_user_product_unique unique (user_id, product_id),
  constraint product_creation_history_name_length check (char_length(product_name) between 1 and 100)
);

create index if not exists product_creation_history_user_added_idx
  on public.product_creation_history (user_id, added_at desc, id desc);

alter table public.product_creation_history enable row level security;

drop policy if exists "Users can view their own product creation history"
  on public.product_creation_history;
create policy "Users can view their own product creation history"
  on public.product_creation_history
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.product_creation_history from anon, authenticated;
grant select on table public.product_creation_history to authenticated;

create or replace function public.capture_product_creation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or v_user_id <> new.user_id then
    raise exception 'A signed-in product owner is required to record product history.';
  end if;

  insert into public.product_creation_history (
    user_id, product_id, product_name, category, cost_price, selling_price,
    initial_stock, image_path, base_unit, purchase_unit, units_per_purchase,
    pack_unit, units_per_pack, pack_selling_price, added_at
  ) values (
    new.user_id, new.id, new.name, coalesce(new.category, 'Uncategorized'),
    new.cost_price, new.selling_price, new.stock, new.image_path,
    coalesce(new.base_unit, 'unit'), coalesce(new.purchase_unit, 'unit'),
    coalesce(new.units_per_purchase, 1), new.pack_unit, new.units_per_pack,
    new.pack_selling_price, new.created_at
  )
  on conflict (user_id, product_id) do nothing;

  return new;
end;
$function$;

revoke all on function public.capture_product_creation_history() from public, anon, authenticated;

drop trigger if exists products_capture_creation_history on public.products;
create trigger products_capture_creation_history
after insert on public.products
for each row execute function public.capture_product_creation_history();
