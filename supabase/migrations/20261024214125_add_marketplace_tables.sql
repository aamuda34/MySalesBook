create table if not exists public.marketplace_shops (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 name text not null default '', description text not null default '', phone text not null default '',
 address text not null default '', city text not null default '', state text not null default 'Osun',
 country text not null default 'Nigeria', latitude double precision, longitude double precision,
 is_connected boolean not null default false, is_active boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.marketplace_listings (
 product_id uuid primary key references public.products(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 shop_name text not null default '', name text not null, description text not null default '',
 category text not null default 'Uncategorized', price numeric not null check(price > 0),
 currency text not null default 'NGN', unit text not null default 'unit',
 stock_status text not null default 'available' check(stock_status in ('available','low_stock','out_of_stock')),
 image_url text, is_active boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.marketplace_reservations (
 id uuid primary key default gen_random_uuid(), buyer_id uuid not null references auth.users(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','ready','collected','cancelled','declined','expired')),
 buyer_note text not null default '', expires_at timestamptz not null default(now()+interval '24 hours'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.marketplace_reservation_items (
 id uuid primary key default gen_random_uuid(), reservation_id uuid not null references public.marketplace_reservations(id) on delete cascade,
 product_id uuid not null references public.products(id), product_name text not null,
 unit_price numeric not null check(unit_price > 0), quantity integer not null check(quantity > 0),
 created_at timestamptz not null default now()
);
alter table public.marketplace_shops enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_reservations enable row level security;
alter table public.marketplace_reservation_items enable row level security;
create policy marketplace_shops_public_active_read on public.marketplace_shops for select to anon, authenticated using (is_connected and is_active);
create policy marketplace_shops_owner_read on public.marketplace_shops for select to authenticated using (owner_id=(select auth.uid()));
create policy marketplace_shops_owner_insert on public.marketplace_shops for insert to authenticated with check (owner_id=(select auth.uid()));
create policy marketplace_shops_owner_update on public.marketplace_shops for update to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy marketplace_listings_public_active_read on public.marketplace_listings for select to anon, authenticated using (is_active);
create policy marketplace_listings_owner_read on public.marketplace_listings for select to authenticated using (owner_id=(select auth.uid()));
create policy marketplace_reservations_participant_read on public.marketplace_reservations for select to authenticated using (buyer_id=(select auth.uid()) or owner_id=(select auth.uid()));
create policy marketplace_reservations_buyer_insert on public.marketplace_reservations for insert to authenticated with check (buyer_id=(select auth.uid()));
create policy marketplace_reservations_participant_update on public.marketplace_reservations for update to authenticated using (buyer_id=(select auth.uid()) or owner_id=(select auth.uid())) with check (buyer_id=(select auth.uid()) or owner_id=(select auth.uid()));
create policy marketplace_reservation_items_participant_read on public.marketplace_reservation_items for select to authenticated using (exists(select 1 from public.marketplace_reservations r where r.id=reservation_id and (r.buyer_id=(select auth.uid()) or r.owner_id=(select auth.uid()))));
create policy marketplace_reservation_items_buyer_insert on public.marketplace_reservation_items for insert to authenticated with check (exists(select 1 from public.marketplace_reservations r where r.id=reservation_id and r.buyer_id=(select auth.uid())));
grant select on public.marketplace_shops, public.marketplace_listings to anon, authenticated;
grant insert, update on public.marketplace_shops to authenticated;
grant select, insert, update on public.marketplace_reservations to authenticated;
grant select, insert on public.marketplace_reservation_items to authenticated;