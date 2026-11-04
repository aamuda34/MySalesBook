create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.buybook_shop_front_verifications (
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  status text not null check (status in ('approved', 'rejected')),
  reason text,
  model text not null default '@cf/moondream/moondream3.1-9B-A2B',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, storage_path),
  check (
    (status = 'approved' and verified_at is not null)
    or (status = 'rejected' and verified_at is null)
  )
);

alter table private.buybook_shop_front_verifications enable row level security;
revoke all on table private.buybook_shop_front_verifications from public, anon, authenticated;
grant select, insert, update, delete on table private.buybook_shop_front_verifications to service_role;

alter table public.marketplace_shops
  drop constraint if exists marketplace_shops_active_profile_requirements;

alter table public.marketplace_shops
  add constraint marketplace_shops_active_profile_requirements
  check (
    not (is_connected and is_active)
    or (
      phone ~ '^\\+234[789][0-9]{9}$'
      and nullif(btrim(shop_front_image_url), '') is not null
      and nullif(btrim(shop_front_image_path), '') is not null
      and shop_front_image_path like owner_id::text || '/%'
      and shop_front_confirmed_at is not null
    )
  );

create or replace function public.validate_buybook_shop_profile_before_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_metadata jsonb;
  v_verified_at timestamptz;
begin
  if not (new.is_connected and new.is_active) then
    return new;
  end if;

  if new.phone !~ '^\\+234[789][0-9]{9}$' then
    raise exception 'A valid Nigerian WhatsApp number must be checked before connecting this shop.';
  end if;

  if new.shop_front_image_url is null
     or btrim(new.shop_front_image_url) = ''
     or new.shop_front_image_path is null
     or btrim(new.shop_front_image_path) = ''
     or new.shop_front_image_path not like new.owner_id::text || '/%' then
    raise exception 'A confirmed shop-front photo uploaded by this shop is required before connecting.';
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

comment on table private.buybook_shop_front_verifications is
  'Private, server-written records of automatic shop-front image checks. Never exposed to client roles.';
comment on function public.validate_buybook_shop_profile_before_activation() is
  'Requires a valid Nigerian phone format and a matching server-approved AI shop-front image before marketplace activation. WhatsApp registration itself is not asserted.';
