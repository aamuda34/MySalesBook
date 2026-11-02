grant select, insert, update, delete on table public.marketplace_listings to authenticated;

drop policy if exists marketplace_listings_owner_insert on public.marketplace_listings;
create policy marketplace_listings_owner_insert on public.marketplace_listings for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists marketplace_listings_owner_delete on public.marketplace_listings;
create policy marketplace_listings_owner_delete on public.marketplace_listings for delete to authenticated using (owner_id = (select auth.uid()));