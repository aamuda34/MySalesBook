alter table public.marketplace_shops
  add column if not exists shop_front_image_url text,
  add column if not exists shop_front_image_path text,
  add column if not exists shop_front_confirmed_at timestamptz,
  add column if not exists whatsapp_checked_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketplace-shop-fronts',
  'marketplace-shop-fronts',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists marketplace_shop_fronts_insert_owner on storage.objects;
create policy marketplace_shop_fronts_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'marketplace-shop-fronts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists marketplace_shop_fronts_delete_owner on storage.objects;
create policy marketplace_shop_fronts_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'marketplace-shop-fronts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter table public.marketplace_shops
  drop constraint if exists marketplace_shops_active_profile_requirements;

alter table public.marketplace_shops
  add constraint marketplace_shops_active_profile_requirements
  check (
    not (is_connected and is_active)
    or (
      phone ~ '^\+234[789][0-9]{9}$'
      and whatsapp_checked_at is not null
      and nullif(btrim(shop_front_image_url), '') is not null
      and nullif(btrim(shop_front_image_path), '') is not null
      and shop_front_image_path like owner_id::text || '/%'
      and shop_front_confirmed_at is not null
    )
  ) not valid;
