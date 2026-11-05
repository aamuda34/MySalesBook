-- Keep old shop profiles from remaining public until they complete the
-- new WhatsApp check and upload a real shop-front file.
with incomplete_shops as materialized (
  select owner_id
  from public.marketplace_shops
  where (is_connected or is_active)
    and not (
      phone ~ '^\\+234[789][0-9]{9}$'
      and whatsapp_checked_at is not null
      and nullif(btrim(shop_front_image_url), '') is not null
      and nullif(btrim(shop_front_image_path), '') is not null
      and shop_front_image_path like owner_id::text || '/%'
      and shop_front_confirmed_at is not null
    )
),
shops_disabled as (
  update public.marketplace_shops s
  set is_connected = false,
      is_active = false,
      updated_at = now()
  from incomplete_shops i
  where s.owner_id = i.owner_id
  returning s.owner_id
)
update public.marketplace_listings l
set is_active = false,
    updated_at = now()
from shops_disabled s
where l.owner_id = s.owner_id;

-- Validate after the legacy rows have been safely disabled.
alter table public.marketplace_shops
  validate constraint marketplace_shops_active_profile_requirements;
