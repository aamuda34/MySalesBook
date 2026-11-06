-- Refresh the inactivity timestamp whenever a guest buyer uses live location.
-- This prevents the daily cleanup job from deleting an actively used anonymous
-- account based only on the date it was first created.

create or replace function public.start_marketplace_location(
  p_owner_id uuid, p_product_id uuid, p_latitude double precision,
  p_longitude double precision, p_accuracy_m double precision,
  p_heading_deg double precision, p_speed_mps double precision
)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
  v_buyer_id uuid := auth.uid();
  v_session_id uuid;
  v_existing_updated_at timestamptz;
  v_is_new boolean := false;
  v_recent_starts integer;
  v_buyer_type text := case when coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then 'guest' else 'registered' end;
begin
  if v_buyer_id is null then raise exception 'Sign in to share your location.'; end if;
  if p_owner_id is null or p_owner_id = v_buyer_id then raise exception 'Choose a different shop.'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'A valid GPS location is required.';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 100000) then
    raise exception 'The GPS accuracy value is invalid.';
  end if;

  perform public.expire_marketplace_location_sessions();

  if not exists (
    select 1 from public.marketplace_shops s
     where s.owner_id = p_owner_id and s.is_connected = true and s.is_active = true
  ) then raise exception 'This shop is not currently available on Buybook.'; end if;

  if p_product_id is not null and not exists (
    select 1 from public.marketplace_listings l
     where l.product_id = p_product_id and l.owner_id = p_owner_id and l.is_active = true
  ) then raise exception 'This product is no longer available from this shop.'; end if;

  select count(*) into v_recent_starts
    from public.marketplace_location_sessions
   where buyer_id = v_buyer_id and started_at > now() - interval '1 hour';
  if v_recent_starts >= 20 then
    raise exception 'You have started too many location sessions. Please try again later.';
  end if;

  if v_buyer_type = 'guest' then
    insert into public.marketplace_location_guest_accounts as guest_account
      (user_id, first_seen_at, last_seen_at)
    values (v_buyer_id, now(), now())
    on conflict (user_id) do update
      set last_seen_at = greatest(guest_account.last_seen_at, excluded.last_seen_at);
  end if;

  select id, updated_at into v_session_id, v_existing_updated_at
    from public.marketplace_location_sessions
   where buyer_id = v_buyer_id and owner_id = p_owner_id
     and status = 'active' and expires_at > now()
   order by started_at desc limit 1 for update;

  if v_session_id is null then
    insert into public.marketplace_location_sessions (
      owner_id, buyer_id, product_id, buyer_type, latitude, longitude,
      accuracy_m, heading_deg, speed_mps, status, started_at, updated_at, expires_at
    ) values (
      p_owner_id, v_buyer_id, p_product_id, v_buyer_type, p_latitude, p_longitude,
      p_accuracy_m, p_heading_deg, p_speed_mps, 'active', now(), now(), now() + interval '30 minutes'
    ) returning id into v_session_id;
    v_is_new := true;
  else
    update public.marketplace_location_sessions
       set product_id = p_product_id, buyer_type = v_buyer_type,
           latitude = p_latitude, longitude = p_longitude,
           accuracy_m = p_accuracy_m, heading_deg = p_heading_deg,
           speed_mps = p_speed_mps, updated_at = now()
     where id = v_session_id;
    v_is_new := v_existing_updated_at < now() - interval '90 seconds';
  end if;

  if v_is_new then
    insert into public.app_notifications (
      created_by, recipient_id, title, body, kind, created_at, expires_at
    ) values (
      v_buyer_id, p_owner_id, 'A customer started locating your shop',
      'A Buybook customer has started sharing their live location with your shop. Open Sellbook Home to see the current device-reported position while updates are fresh.',
      'buyer_locating_shop', now(), now() + interval '24 hours'
    );
  end if;
  return v_session_id;
end;
$function$;

create or replace function public.update_marketplace_location(
  p_session_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision, p_heading_deg double precision, p_speed_mps double precision
)
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
  v_buyer_id uuid := auth.uid();
  v_owner_id uuid;
  v_rows integer;
begin
  if v_buyer_id is null then raise exception 'Your location session has ended. Start it again to continue.'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'A valid GPS location is required.';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 100000) then
    raise exception 'The GPS accuracy value is invalid.';
  end if;

  select owner_id into v_owner_id
    from public.marketplace_location_sessions
   where id = p_session_id and buyer_id = v_buyer_id
     and status = 'active' and expires_at > now()
   for update;
  if v_owner_id is null then return false; end if;

  if coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    insert into public.marketplace_location_guest_accounts as guest_account
      (user_id, first_seen_at, last_seen_at)
    values (v_buyer_id, now(), now())
    on conflict (user_id) do update
      set last_seen_at = greatest(guest_account.last_seen_at, excluded.last_seen_at);
  end if;

  if not exists (
    select 1 from public.marketplace_shops s
     where s.owner_id = v_owner_id and s.is_connected = true and s.is_active = true
  ) then
    update public.marketplace_location_sessions
       set status = 'stopped', latitude = 0, longitude = 0,
           accuracy_m = null, heading_deg = null, speed_mps = null,
           stopped_at = now(), updated_at = now()
     where id = p_session_id and buyer_id = v_buyer_id and status = 'active';
    return false;
  end if;

  update public.marketplace_location_sessions
     set latitude = p_latitude, longitude = p_longitude,
         accuracy_m = p_accuracy_m, heading_deg = p_heading_deg,
         speed_mps = p_speed_mps, updated_at = now()
   where id = p_session_id and buyer_id = v_buyer_id
     and status = 'active' and expires_at > now()
     and updated_at < now() - interval '4 seconds';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

create or replace function public.stop_marketplace_location(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
  v_buyer_id uuid := auth.uid();
  v_rows integer;
begin
  if v_buyer_id is null then return false; end if;
  update public.marketplace_location_sessions
     set status = 'stopped', latitude = 0, longitude = 0,
         accuracy_m = null, heading_deg = null, speed_mps = null,
         stopped_at = now(), updated_at = now()
   where id = p_session_id and buyer_id = v_buyer_id and status = 'active';
  get diagnostics v_rows = row_count;

  if v_rows > 0 and coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    insert into public.marketplace_location_guest_accounts as guest_account
      (user_id, first_seen_at, last_seen_at)
    values (v_buyer_id, now(), now())
    on conflict (user_id) do update
      set last_seen_at = greatest(guest_account.last_seen_at, excluded.last_seen_at);
  end if;
  return v_rows > 0;
end;
$function$;

revoke all on function public.start_marketplace_location(uuid, uuid, double precision, double precision, double precision, double precision, double precision) from public;
grant execute on function public.start_marketplace_location(uuid, uuid, double precision, double precision, double precision, double precision, double precision) to authenticated;
revoke all on function public.update_marketplace_location(uuid, double precision, double precision, double precision, double precision, double precision) from public;
grant execute on function public.update_marketplace_location(uuid, double precision, double precision, double precision, double precision, double precision) to authenticated;
revoke all on function public.stop_marketplace_location(uuid) from public;
grant execute on function public.stop_marketplace_location(uuid) to authenticated;
