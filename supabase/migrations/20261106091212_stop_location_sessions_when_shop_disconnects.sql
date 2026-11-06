create or replace function public.stop_marketplace_location_sessions_when_shop_disconnects()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (old.is_connected is true and new.is_connected is distinct from true)
     or (old.is_active is true and new.is_active is distinct from true) then
    update public.marketplace_location_sessions
       set status = 'stopped',
           latitude = 0,
           longitude = 0,
           accuracy_m = null,
           heading_deg = null,
           speed_mps = null,
           stopped_at = coalesce(stopped_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     where owner_id = new.owner_id
       and status = 'active';
  end if;
  return new;
end;
$function$;

revoke all on function public.stop_marketplace_location_sessions_when_shop_disconnects()
  from public, anon, authenticated;

drop trigger if exists stop_location_sessions_on_shop_disconnect
  on public.marketplace_shops;

create trigger stop_location_sessions_on_shop_disconnect
after update of is_connected, is_active
on public.marketplace_shops
for each row
when (
  (old.is_connected is true and new.is_connected is distinct from true)
  or
  (old.is_active is true and new.is_active is distinct from true)
)
execute function public.stop_marketplace_location_sessions_when_shop_disconnects();
