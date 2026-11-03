-- Extend the sensitive-account-action grant to allow fresh email OTP and
-- fresh Google OAuth reauthentication. Google-only users retain access to these
-- protections without requiring them to create a second login method.
drop function if exists public.grant_sellbook_email_action(uuid,text);

create or replace function public.grant_sellbook_email_action(
  p_target_session_id uuid,
  p_action text,
  p_previous_session_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_otp_session_text text := auth.jwt()->>'session_id';
  v_otp_session_id uuid;
  v_amr jsonb := case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end;
  v_recent_otp boolean := false;
  v_recent_oauth boolean := false;
  v_previous_pin_expiry timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in before verifying this account action.'; end if;
  if p_action is null or p_action not in ('change_pin','change_email') then raise exception 'This email verification action is not supported.'; end if;
  if p_target_session_id is null then raise exception 'Your Sellbook session could not be confirmed. Please try again.'; end if;
  if v_otp_session_text is null or v_otp_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your verification session is invalid. Please restart verification.';
  end if;
  v_otp_session_id:=v_otp_session_text::uuid;
  select
    exists(select 1 from jsonb_array_elements(v_amr) method(value) where method.value->>'method'='otp'
      and coalesce(method.value->>'timestamp','') ~ '^[0-9]{1,12}$'
      and (method.value->>'timestamp')::numeric between extract(epoch from now()-interval '5 minutes') and extract(epoch from now()+interval '30 seconds')),
    exists(select 1 from jsonb_array_elements(v_amr) method(value) where method.value->>'method'='oauth'
      and coalesce(method.value->>'timestamp','') ~ '^[0-9]{1,12}$'
      and (method.value->>'timestamp')::numeric between extract(epoch from now()-interval '5 minutes') and extract(epoch from now()+interval '30 seconds'))
  into v_recent_otp,v_recent_oauth;
  if not v_recent_otp and not v_recent_oauth then raise exception 'A fresh email code or Google sign-in is required for this action.'; end if;
  if not exists(select 1 from auth.sessions s where s.id=v_otp_session_id and s.user_id=v_user_id) then
    raise exception 'Your verification session has expired. Restart verification and retry.';
  end if;
  if not exists(select 1 from auth.sessions s where s.id=p_target_session_id and s.user_id=v_user_id) then
    raise exception 'Your active Sellbook session changed. Start verification again.';
  end if;
  if v_recent_otp and not exists(select 1 from auth.identities i where i.user_id=v_user_id and i.provider='email') then
    raise exception 'This account does not have an email sign-in identity. Reverify with Google instead.';
  end if;
  if v_recent_oauth and not exists(select 1 from auth.identities i where i.user_id=v_user_id and i.provider='google') then
    raise exception 'Only the Google identity linked to this Sellbook account can verify this action.';
  end if;
  if p_previous_session_id is not null and p_previous_session_id<>p_target_session_id
     and p_action='change_pin' and exists(select 1 from private.user_app_pins p where p.user_id=v_user_id) then
    select ps.expires_at into v_previous_pin_expiry from private.user_app_pin_sessions ps
      where ps.user_id=v_user_id and ps.session_id=p_previous_session_id and ps.expires_at>now() for update;
    if v_previous_pin_expiry is null then raise exception 'Your current PIN unlock has expired. Unlock Sellbook with your PIN and start the PIN change again.'; end if;
    delete from private.user_app_pin_sessions where user_id=v_user_id and session_id=p_previous_session_id;
    insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
      values(v_user_id,p_target_session_id,now(),least(v_previous_pin_expiry,now()+interval '12 hours'))
      on conflict(user_id,session_id) do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  end if;
  delete from private.sellbook_security_action_grants where user_id=v_user_id and expires_at<=now();
  insert into private.sellbook_security_action_grants(user_id,session_id,action,verified_at,expires_at)
    values(v_user_id,p_target_session_id,p_action,now(),now()+interval '5 minutes')
    on conflict(user_id,session_id,action) do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  return jsonb_build_object('verified',true,'method',case when v_recent_oauth then 'google' else 'email' end,'expires_in_seconds',300);
end;
$function$;
revoke all on function public.grant_sellbook_email_action(uuid,text,uuid) from public,anon;
grant execute on function public.grant_sellbook_email_action(uuid,text,uuid) to authenticated;
