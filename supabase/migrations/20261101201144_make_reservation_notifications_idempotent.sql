alter table public.app_notifications add column if not exists reservation_id uuid;
create unique index if not exists app_notifications_reservation_kind_uidx
  on public.app_notifications (reservation_id, kind)
  where reservation_id is not null and kind = 'reservation';