-- Make buyer notifications for reservation decisions safe to retry.
-- NULL reservation_id values on other notification kinds remain unrestricted.
alter table public.app_notifications
  add column if not exists reservation_id uuid;

-- A normal unique index (rather than a partial index) can be inferred by PostgREST
-- upsert(onConflict: "reservation_id,kind"). PostgreSQL permits multiple NULL keys.
create unique index if not exists app_notifications_reservation_kind_uidx
  on public.app_notifications (reservation_id, kind);
