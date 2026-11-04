-- WhatsApp registration cannot be reliably queried through a public number lookup.
-- Keep strict Nigerian mobile-number format validation, but do not block setup on a
-- timestamp that was never produced by an actual WhatsApp verification challenge.
-- Shop-front activation remains protected by the server-side AI verification trigger.
alter table public.marketplace_shops
  drop constraint if exists marketplace_shops_active_profile_requirements;

alter table public.marketplace_shops
  add constraint marketplace_shops_active_profile_requirements
  check (
    not (is_connected and is_active)
    or (
      phone ~ '^[+]234[789][0-9]{9}
      and nullif(btrim(shop_front_image_url), '') is not null
      and nullif(btrim(shop_front_image_path), '') is not null
      and shop_front_image_path like owner_id::text || '/%'
      and shop_front_confirmed_at is not null
    )
  ) not valid;

alter table public.marketplace_shops
  validate constraint marketplace_shops_active_profile_requirements;

      and nullif(btrim(shop_front_image_url), '') is not null
      and nullif(btrim(shop_front_image_path), '') is not null
      and shop_front_image_path like owner_id::text || '/%'
      and shop_front_confirmed_at is not null
    )
  ) not valid;

alter table public.marketplace_shops
  validate constraint marketplace_shops_active_profile_requirements;
