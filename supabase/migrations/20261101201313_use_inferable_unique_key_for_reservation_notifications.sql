-- Replace the partial index with a normal unique index so PostgREST can infer
-- the onConflict target (reservation_id,kind) for idempotent upserts.
drop index if exists public.app_notifications_reservation_kind_uidx;
create unique index app_notifications_reservation_kind_uidx
  on public.app_notifications (reservation_id, kind);
