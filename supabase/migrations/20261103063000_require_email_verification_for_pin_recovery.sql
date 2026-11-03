-- PIN recovery is a PIN change path too. Require the same fresh email
-- verification grant before deleting the old PIN; preserve the fresh sign-in
-- requirement as an additional check.
create or replace function public.reset_app_pin_after_reauth()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_email_grant boolean := false;
begin
  if v_user_id is null then
    raise exception 'Sign in again before resetting your PIN.';
  end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your sign-in session is not ready. Sign in again and retry.';
  end if;
  v_session_id := v_session_text::uuid;

  if not exists(
    select 1 from auth.sessions s
    where s.id=v_session_id
      and s.user_id=v_user_id
      and s.created_at>=now()-interval '15 minutes'
  ) then
    raise exception 'For your security, sign out and sign in again before resetting your PIN.';
  end if;

  delete from private.sellbook_security_action_grants
  where user_id=v_user_id
    and session_id=v_session_id
    and action='change_pin'
    and expires_at>now()
  returning true into v_email_grant;

  if not coalesce(v_email_grant,false) then
    raise exception 'Verify your registered email address before resetting your security PIN.';
  end if;

  delete from private.user_app_pin_sessions where user_id=v_user_id;
  delete from private.user_app_pins where user_id=v_user_id;
  return jsonb_build_object('reset',true);
end;
$function$;

revoke all on function public.reset_app_pin_after_reauth() from public, anon;
grant execute on function public.reset_app_pin_after_reauth() to authenticated;
