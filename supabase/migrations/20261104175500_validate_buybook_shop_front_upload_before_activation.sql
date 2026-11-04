create or replace function public.validate_buybook_shop_profile_before_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_metadata jsonb;
begin
  if not (new.is_connected and new.is_active) then
    return new;
  end if;

  if new.phone !~ '^\+234[789][0-9]{9}$'
     or new.whatsapp_checked_at is null then
    raise exception 'A valid Nigerian WhatsApp number must be checked before connecting this shop.';
  end if;

  if new.shop_front_image_url is null
     or btrim(new.shop_front_image_url) = ''
     or new.shop_front_image_path is null
     or btrim(new.shop_front_image_path) = ''
     or new.shop_front_confirmed_at is null
     or new.shop_front_image_path not like new.owner_id::text || '/%' then
    raise exception 'A confirmed shop-front photo uploaded by this shop is required before connecting.';
  end if;

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

revoke all on function public.validate_buybook_shop_profile_before_activation() from public, anon, authenticated;

drop trigger if exists validate_buybook_shop_profile_before_activation on public.marketplace_shops;
create trigger validate_buybook_shop_profile_before_activation
before insert or update on public.marketplace_shops
for each row
execute function public.validate_buybook_shop_profile_before_activation();
