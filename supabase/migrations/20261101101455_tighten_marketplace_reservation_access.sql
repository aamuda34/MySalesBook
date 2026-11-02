
-- Restrict reservation decisions to the shop owner. Buyers may create
-- reservations, but must not approve/reject them or reassign participants.
drop policy if exists marketplace_reservations_participant_update on public.marketplace_reservations;
create policy marketplace_reservations_owner_update
on public.marketplace_reservations
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

-- Direct inserts must enforce the same subscription and active-shop rules
-- as the reservation RPC, so callers cannot bypass the intended workflow.
drop policy if exists marketplace_reservations_buyer_insert on public.marketplace_reservations;
create policy marketplace_reservations_buyer_insert
on public.marketplace_reservations
for insert
to authenticated
with check (
  buyer_id = (select auth.uid())
  and owner_id <> (select auth.uid())
  and exists (
    select 1
    from public.marketplace_store_subscriptions ss
    join public.marketplace_shops s on s.owner_id = ss.owner_id
    where ss.owner_id = marketplace_reservations.owner_id
      and ss.buyer_id = (select auth.uid())
      and s.is_connected = true
      and s.is_active = true
  )
);

-- Reservation items must refer to an active listing owned by the shop
-- attached to the buyer's reservation.
drop policy if exists marketplace_reservation_items_buyer_insert on public.marketplace_reservation_items;
create policy marketplace_reservation_items_buyer_insert
on public.marketplace_reservation_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.marketplace_reservations r
    join public.marketplace_listings l
      on l.product_id = marketplace_reservation_items.product_id
     and l.owner_id = r.owner_id
     and l.is_active = true
    where r.id = marketplace_reservation_items.reservation_id
      and r.buyer_id = (select auth.uid())
  )
);

-- This is a trigger-only function. Prevent direct RPC invocation by client roles.
revoke execute on function public.notify_marketplace_reservation_owner() from public, anon, authenticated;
