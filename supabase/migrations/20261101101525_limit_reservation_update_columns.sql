-- The seller UI only changes status and updated_at. Do not allow clients
-- to rewrite buyer/owner identity, reservation dates, or other fields.
revoke update on table public.marketplace_reservations from public, anon, authenticated;
grant update (status, updated_at) on table public.marketplace_reservations to authenticated;
