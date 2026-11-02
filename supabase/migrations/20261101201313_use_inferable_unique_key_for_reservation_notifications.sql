drop index if exists public.app_notifications_reservation_kind_uidx;
create unique index app_notifications_reservation_kind_uidx
  on public.app_notifications (reservation_id, kind);