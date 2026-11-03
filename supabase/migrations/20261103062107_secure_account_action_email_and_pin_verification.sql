-- Require a fresh email OTP for sensitive account changes and a fresh six-digit
-- Sellbook PIN confirmation for account deletion. Grants are private, one-use,
-- short-lived, and bound to the original signed-in auth session.

create table if not exists private.sellbook_security_action_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  action text not null check (action in ('change_pin','change_email','delete_account')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, session_id, action)
);

alter table private.sellbook_security_action_grants enable row level security;
revoke all on table private.sellbook_security_action_grants from public, anon, authenticated;

create or replace function public.grant_sellbook_email_action(
  p_target_session_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_otp_session_text text := auth.jwt()->>'session_id';
  v_otp_session_id uuid;
  v_amr jsonb := case
    when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr'
    else '[]'::jsonb
  end;
  v_has_recent_otp boolean := false;
begin
  if v_user_id is null then
    raise exception 'Sign in before verifying this account action.';
  end if;
  if p_action not in ('change_pin','change_email') then
    raise exception 'This email verification action is not supported.';
  end if;
  if p_target_session_id is null then
    raise exception 'Your Sellbook session could not be confirmed. Please try again.';
  end if;
  if v_otp_session_text is null or v_otp_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your email verification session is invalid. Please request a new code.';
  end if;
  v_otp_session_id := v_otp_session_text::uuid;

  select exists (
    select 1
    from jsonb_array_elements(v_amr) as method(value)
    where method.value->>'method' = 'otp'
      and coalesce(method.value->>'timestamp','') ~ '^[0-9]{1,12}$'
      and (method.value->>'timestamp')::numeric
          between extract(epoch from now() - interval '5 minutes')
              and extract(epoch from now() + interval '30 seconds')
  ) into v_has_recent_otp;

  if not v_has_recent_otp then
    raise exception 'A fresh email verification code is required for this action.';
  end if;

  if not exists (
    select 1 from auth.sessions s
    where s.id = v_otp_session_id and s.user_id = v_user_id
  ) then
    raise exception 'Your email verification session has expired. Request a new code.';
  end if;

  if not exists (
    select 1 from auth.sessions s
    where s.id = p_target_session_id and s.user_id = v_user_id
  ) then
    raise exception 'Your active Sellbook session changed. Start the verification again.';
  end if;

  delete from private.sellbook_security_action_grants
  where user_id = v_user_id and expires_at <= now();

  insert into private.sellbook_security_action_grants(user_id, session_id, action, verified_at, expires_at)
  values (v_user_id, p_target_session_id, p_action, now(), now() + interval '5 minutes')
  on conflict (user_id, session_id, action) do update
    set verified_at = excluded.verified_at,
        expires_at = excluded.expires_at;

  return jsonb_build_object('verified', true, 'expires_in_seconds', 300);
end;
$function$;

revoke all on function public.grant_sellbook_email_action(uuid,text) from public, anon;
grant execute on function public.grant_sellbook_email_action(uuid,text) to authenticated;

create or replace function public.consume_sellbook_email_action(p_action text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_consumed boolean := false;
begin
  if v_user_id is null then raise exception 'Sign in before changing your account email.'; end if;
  if p_action <> 'change_email' then raise exception 'This email verification action is not supported.'; end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your Sellbook session is invalid. Sign in again.';
  end if;
  v_session_id := v_session_text::uuid;

  delete from private.sellbook_security_action_grants
  where user_id = v_user_id
    and session_id = v_session_id
    and action = p_action
    and expires_at > now()
  returning true into v_consumed;

  if not coalesce(v_consumed,false) then
    raise exception 'Verify your current email address before requesting an email change.';
  end if;

  return jsonb_build_object('verified',true);
end;
$function$;

revoke all on function public.consume_sellbook_email_action(text) from public, anon;
grant execute on function public.consume_sellbook_email_action(text) to authenticated;

create or replace function public.set_app_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_inserted integer := 0;
  v_email_grant boolean := false;
begin
  if v_user_id is null then raise exception 'Sign in before setting your security PIN.'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'Your security PIN must contain exactly six digits.';
  end if;
  if p_pin=repeat(substr(p_pin,1,1),6)
     or p_pin in (
       '000000','111111','222222','333333','444444','555555','666666','777777','888888','999999',
       '012345','123456','234567','345678','456789','987654','876543','765432','654321','543210',
       '121212','212121','112233','123123','321321','112211','010101','101010','000111','111000',
       '123321','654456','147258','258369'
     ) then
    raise exception 'Choose a less predictable six-digit PIN.';
  end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your sign-in session is not ready. Sign in again and retry.';
  end if;
  v_session_id := v_session_text::uuid;

  insert into private.user_app_pins(user_id,pin_hash,failed_attempts,locked_until,updated_at)
  values(v_user_id,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,now())
  on conflict(user_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    if not private.is_sellbook_pin_verified() then
      raise exception 'Verify your current PIN before changing it.';
    end if;

    delete from private.sellbook_security_action_grants
    where user_id = v_user_id
      and session_id = v_session_id
      and action = 'change_pin'
      and expires_at > now()
    returning true into v_email_grant;

    if not coalesce(v_email_grant,false) then
      raise exception 'Verify your registered email address before changing your security PIN.';
    end if;

    update private.user_app_pins
    set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),
        failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=v_user_id;

    -- A changed PIN revokes every previous device/session unlock.
    delete from private.user_app_pin_sessions where user_id=v_user_id;
  end if;

  insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
  values(v_user_id,v_session_id,now(),now()+interval '12 hours')
  on conflict(user_id,session_id) do update
    set verified_at=excluded.verified_at,expires_at=excluded.expires_at;

  return jsonb_build_object('created',v_inserted=1,'verified',true,'expires_in_hours',12);
end;
$function$;

create or replace function public.verify_app_pin_for_account_deletion(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_row private.user_app_pins%rowtype;
  v_attempts integer;
  v_locked_until timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in before confirming your security PIN.'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return jsonb_build_object('verified',false,'message','Enter your six-digit PIN.','attempts_remaining',5);
  end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your sign-in session is not ready. Sign in again and retry.';
  end if;
  v_session_id := v_session_text::uuid;

  select * into v_row
  from private.user_app_pins
  where user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('verified',false,'requires_setup',true,'message','Create a six-digit security PIN before deleting your account.');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('verified',false,'locked_until',v_row.locked_until,'attempts_remaining',0,
      'message','Too many incorrect attempts. Try again after the PIN lock expires.');
  end if;

  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update private.user_app_pins
    set failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=v_user_id
    returning * into v_row;
  end if;

  if extensions.crypt(p_pin,v_row.pin_hash)=v_row.pin_hash then
    update private.user_app_pins
    set failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=v_user_id;

    insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
    values(v_user_id,v_session_id,now(),now()+interval '12 hours')
    on conflict(user_id,session_id) do update
      set verified_at=excluded.verified_at,expires_at=excluded.expires_at;

    delete from private.sellbook_security_action_grants
    where user_id=v_user_id and expires_at<=now();

    insert into private.sellbook_security_action_grants(user_id,session_id,action,verified_at,expires_at)
    values(v_user_id,v_session_id,'delete_account',now(),now()+interval '5 minutes')
    on conflict(user_id,session_id,action) do update
      set verified_at=excluded.verified_at,expires_at=excluded.expires_at;

    return jsonb_build_object('verified',true,'expires_in_seconds',300);
  end if;

  v_attempts := v_row.failed_attempts + 1;
  v_locked_until := case when v_attempts >= 5 then now()+interval '15 minutes' else null end;

  update private.user_app_pins
  set failed_attempts=v_attempts,locked_until=v_locked_until,updated_at=now()
  where user_id=v_user_id;

  return jsonb_build_object(
    'verified',false,
    'attempts_remaining',greatest(5-v_attempts,0),
    'locked_until',v_locked_until,
    'message',case when v_attempts>=5 then 'Too many incorrect attempts. Your PIN is locked for 15 minutes.' else 'Incorrect PIN. Please try again.' end
  );
end;
$function$;

revoke all on function public.verify_app_pin_for_account_deletion(text) from public, anon;
grant execute on function public.verify_app_pin_for_account_deletion(text) to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_delete_authorized boolean := false;
begin
  if v_user_id is null then raise exception 'You must sign in before deleting your account.'; end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your sign-in session is invalid. Sign in again before deleting your account.';
  end if;
  v_session_id := v_session_text::uuid;

  if not exists (select 1 from private.user_app_pins p where p.user_id=v_user_id) then
    raise exception 'Create a six-digit Sellbook security PIN before deleting your account.';
  end if;
  if not private.is_sellbook_pin_verified() then
    raise exception 'Verify your Sellbook security PIN before deleting your account.';
  end if;

  delete from private.sellbook_security_action_grants
  where user_id=v_user_id
    and session_id=v_session_id
    and action='delete_account'
    and expires_at>now()
  returning true into v_delete_authorized;

  if not coalesce(v_delete_authorized,false) then
    raise exception 'Enter and confirm your six-digit Sellbook PIN immediately before account deletion.';
  end if;

  delete from auth.users where id=v_user_id;
end;
$function$;
