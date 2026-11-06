-- Ensure temporary guest authentication records are tracked even when
-- a location start request fails before a location session row is created.
create or replace function public.track_marketplace_guest_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.is_anonymous is true then
    insert into public.marketplace_location_guest_accounts as guest_account
      (user_id, first_seen_at, last_seen_at)
    values
      (new.id, coalesce(new.created_at, now()), now())
    on conflict (user_id) do update
      set last_seen_at = greatest(guest_account.last_seen_at, excluded.last_seen_at);
  end if;
  return new;
end;
$function$;

revoke all on function public.track_marketplace_guest_auth_user() from public, anon, authenticated;

drop trigger if exists trg_track_marketplace_guest_auth_insert on auth.users;
create trigger trg_track_marketplace_guest_auth_insert
after insert on auth.users
for each row
execute function public.track_marketplace_guest_auth_user();
