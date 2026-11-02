-- Restore a fresh five-attempt window after a 15-minute PIN lockout expires.
create or replace function public.get_app_pin_status()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_pin_exists boolean := false;
  v_failed_attempts integer := 0;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in before checking your security PIN.'; end if;
  select p.failed_attempts,p.locked_until into v_failed_attempts,v_locked_until
  from private.user_app_pins p where p.user_id=v_user_id;
  v_pin_exists:=found;

  if v_pin_exists and v_session_text is not null
     and v_session_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_session_id:=v_session_text::uuid;
    select s.expires_at into v_expires_at
    from private.user_app_pin_sessions s
    where s.user_id=v_user_id and s.session_id=v_session_id;
  end if;

  return jsonb_build_object(
    'has_pin',v_pin_exists,
    'verified',v_expires_at is not null and v_expires_at>now(),
    'expires_at',v_expires_at,
    'locked_until',case when v_locked_until>now() then v_locked_until else null end,
    'attempts_remaining',case
      when v_locked_until is not null and v_locked_until>now() then 0
      else greatest(5-coalesce(v_failed_attempts,0),0)
    end
  );
end;
$function$;
revoke all on function public.get_app_pin_status() from public, anon;
grant execute on function public.get_app_pin_status() to authenticated;

create or replace function public.verify_app_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session_text text:=auth.jwt()->>'session_id';
  v_session_id uuid;
  v_row private.user_app_pins%rowtype;
  v_attempts integer;
  v_locked_until timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in before verifying your security PIN.'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return jsonb_build_object('verified',false,'message','Enter your six-digit PIN.','attempts_remaining',5);
  end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Your sign-in session is not ready. Sign in again and retry.';
  end if;
  v_session_id:=v_session_text::uuid;
  select * into v_row from private.user_app_pins where user_id=v_user_id for update;
  if not found then return jsonb_build_object('verified',false,'requires_setup',true); end if;

  if v_row.locked_until is not null and v_row.locked_until>now() then
    return jsonb_build_object('verified',false,'locked_until',v_row.locked_until,'attempts_remaining',0,
      'message','Too many incorrect attempts. Try again after the lock expires.');
  end if;

  if v_row.locked_until is not null and v_row.locked_until<=now() then
    update private.user_app_pins
    set failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=v_user_id
    returning * into v_row;
  end if;

  if extensions.crypt(p_pin,v_row.pin_hash)=v_row.pin_hash then
    update private.user_app_pins set failed_attempts=0,locked_until=null,updated_at=now() where user_id=v_user_id;
    insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
    values(v_user_id,v_session_id,now(),now()+interval '12 hours')
    on conflict(user_id,session_id) do update
      set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
    return jsonb_build_object('verified',true,'expires_in_hours',12);
  end if;

  v_attempts:=v_row.failed_attempts+1;
  v_locked_until:=case when v_attempts>=5 then now()+interval '15 minutes' else null end;
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
revoke all on function public.verify_app_pin(text) from public, anon;
grant execute on function public.verify_app_pin(text) to authenticated;
