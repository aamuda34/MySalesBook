-- Allow sellers to use their preferred WhatsApp contact number.
-- No OTP is sent and the app does not claim that the number is registered on WhatsApp.
-- Preserve automatic, owner-scoped shop-front verification before activation.

create or replace function public.validate_buybook_shop_profile_before_activation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_metadata jsonb;
  v_verified_at timestamptz;
begin
  if not (new.is_connected and new.is_active) then
    return new;
  end if;

  if new.phone is null
     or char_length(btrim(new.phone)) < 3
     or char_length(btrim(new.phone)) > 40 then
    raise exception 'Enter the WhatsApp contact number customers should use for your shop.';
  end if;

  if new.shop_front_image_url is null
     or btrim(new.shop_front_image_url) = ''
     or new.shop_front_image_path is null
     or btrim(new.shop_front_image_path) = ''
     or new.shop_front_image_path not like new.owner_id::text || '/%' then
    raise exception 'Upload a clear shop-front photo and let Sellbook check it automatically before connecting.';
  end if;

  select v.verified_at
    into v_verified_at
  from private.buybook_shop_front_verifications as v
  where v.user_id = new.owner_id
    and v.storage_path = new.shop_front_image_path
    and v.status = 'approved'
    and v.verified_at is not null
  limit 1;

  if v_verified_at is null then
    raise exception 'This photo has not passed Sellbook automatic shop-front checking. Choose another photo and try again.';
  end if;

  new.shop_front_confirmed_at := v_verified_at;

  if position(
    '/storage/v1/object/public/marketplace-shop-fronts/' || new.shop_front_image_path
    in new.shop_front_image_url
  ) = 0 then
    raise exception 'The shop-front image URL does not match the uploaded shop-front file.';
  end if;

  select o.metadata
    into v_metadata
  from storage.objects as o
  where o.bucket_id = 'marketplace-shop-fronts'
    and o.name = new.shop_front_image_path
    and o.owner_id = new.owner_id::text
    and o.is_delete_marker = false
    and o.archived_at is null
  limit 1;

  if v_metadata is null then
    raise exception 'The shop-front photo must be uploaded to Buybook storage before the shop can be connected.';
  end if;

  if coalesce(v_metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'The shop-front file must be a JPG, PNG or WebP image.';
  end if;

  if coalesce((v_metadata->>'size')::bigint, 0) <= 0
     or (v_metadata->>'size')::bigint > 5242880 then
    raise exception 'The shop-front image must be between 1 byte and 5 MB.';
  end if;

  return new;
end;
$function$;

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
