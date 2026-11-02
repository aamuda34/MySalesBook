-- Rollout compatibility safeguard:
-- The server PIN schema has been applied, but the PWA production deployment is
-- temporarily blocked by the Vercel free-tier deployment limit. The currently
-- served UI predates the PIN gate, so allow users without an enrolled PIN to
-- continue using the existing app until the PIN-enabled PWA is deployed.
-- Accounts that have enrolled a PIN still require a valid per-session unlock.
-- Reapply the strict false-on-missing-PIN helper after the v68+ PWA is live.

create or replace function private.is_sellbook_pin_verified()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
begin
  if v_user_id is null then return false; end if;

  -- Compatibility only for accounts which have not yet enrolled a PIN.
  if not exists (
    select 1 from private.user_app_pins p where p.user_id = v_user_id
  ) then
    return true;
  end if;

  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_session_id := v_session_text::uuid;
  return exists (
    select 1 from private.user_app_pin_sessions s
    where s.user_id = v_user_id
      and s.session_id = v_session_id
      and s.expires_at > now()
  );
end;
$function$;
revoke all on function private.is_sellbook_pin_verified() from public, anon;
grant execute on function private.is_sellbook_pin_verified() to authenticated;
