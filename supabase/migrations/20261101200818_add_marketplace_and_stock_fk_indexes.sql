-- Cover foreign-key lookups used by seller inboxes, reservations and stock history.
-- All indexes are additive; no records or policies are changed.
create index if not exists marketplace_listings_owner_id_idx
  on public.marketplace_listings (owner_id);
create index if not exists marketplace_messages_buyer_id_idx
  on public.marketplace_messages (buyer_id);
create index if not exists marketplace_reservation_items_product_id_idx
  on public.marketplace_reservation_items (product_id);
create index if not exists marketplace_reservation_items_reservation_id_idx
  on public.marketplace_reservation_items (reservation_id);
create index if not exists marketplace_reservations_buyer_id_idx
  on public.marketplace_reservations (buyer_id);
create index if not exists marketplace_reservations_owner_id_idx
  on public.marketplace_reservations (owner_id);
create index if not exists stock_purchases_product_id_idx
  on public.stock_purchases (product_id);
create index if not exists stock_purchases_user_id_idx
  on public.stock_purchases (user_id);
