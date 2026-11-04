-- Remove the unsupported WhatsApp-registration requirement.
-- The seller may use their preferred WhatsApp contact number.
-- This migration follows allow_preferred_whatsapp_contact, which also updates the
-- activation trigger. Keep the shop-front AI verification safeguards intact.

alter table public.marketplace_shops
  drop constraint if exists marketplace_shops_active_profile_requirements;

alter table public.marketplace_shops
  add constraint marketplace_shops_active_profile_requirements
  check (
    not (is_connected and is_active)
    or (
      nullif(btrim(phone), '') is not null
      and char_length(btrim(phone)) between 3 and 40
      and nullif(btrim(shop_front_image_url), '') is not null
      and nullif(btrim(shop_front_image_path), '') is not null
      and shop_front_image_path like owner_id::text || '/%'
      and shop_front_confirmed_at is not null
    )
  ) not valid;

alter table public.marketplace_shops
  validate constraint marketplace_shops_active_profile_requirements;
