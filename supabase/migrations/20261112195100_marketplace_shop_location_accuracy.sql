alter table public.marketplace_shops
  add column if not exists location_accuracy_m double precision,
  add column if not exists location_captured_at timestamptz,
  add column if not exists location_confirmed_at timestamptz,
  add column if not exists location_source text;

alter table public.marketplace_shops
  drop constraint if exists marketplace_shops_location_accuracy_m_check;

alter table public.marketplace_shops
  add constraint marketplace_shops_location_accuracy_m_check
  check (
    location_accuracy_m is null
    or (location_accuracy_m > 0 and location_accuracy_m <= 10000)
  );

alter table public.marketplace_shops
  drop constraint if exists marketplace_shops_location_source_check;

alter table public.marketplace_shops
  add constraint marketplace_shops_location_source_check
  check (
    location_source is null
    or location_source in ('device-gps', 'manual-map-pin', 'legacy-saved-location')
  );

comment on column public.marketplace_shops.location_accuracy_m is
  'Device-reported GPS accuracy in metres at the time the shop pin was captured; null means unknown or manually adjusted.';

comment on column public.marketplace_shops.location_captured_at is
  'Timestamp of the latest device GPS capture used for the shop pin; null means unavailable or manually adjusted.';

comment on column public.marketplace_shops.location_confirmed_at is
  'Seller confirmation timestamp for reviewing the pin against the physical shop entrance; this is a self-confirmation, not independent verification.';

comment on column public.marketplace_shops.location_source is
  'How the saved shop coordinates were set: device-gps, manual-map-pin, or legacy-saved-location.';
