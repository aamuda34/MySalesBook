-- Return the current verified PIN session expiry and reject weak six-digit PINs.
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
  select p.failed_attempts,p.locked_until
    into v_failed_attempts,v_locked_until
  from private.user_app_pins p
  where p.user_id=v_user_id;
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
    'locked_until',v_locked_until,
    'attempts_remaining',case when v_pin_exists then greatest(5-coalesce(v_failed_attempts,0),0) else 5 end
  );
end;
$function$;
revoke all on function public.get_app_pin_status() from public, anon;
grant execute on function public.get_app_pin_status() to authenticated;

create or replace function public.set_app_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session_text text:=auth.jwt()->>'session_id';
  v_session_id uuid;
  v_inserted integer:=0;
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
  v_session_id:=v_session_text::uuid;

  insert into private.user_app_pins(user_id,pin_hash,failed_attempts,locked_until,updated_at)
  values(v_user_id,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,now())
  on conflict(user_id) do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted=0 then
    if not private.is_sellbook_pin_verified() then
      raise exception 'Verify your current PIN before changing it.';
    end if;
    update private.user_app_pins
    set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),
        failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=v_user_id;
    -- A changed PIN revokes every prior device/session unlock; only the session
    -- performing the change is re-authorized below.
    delete from private.user_app_pin_sessions where user_id=v_user_id;
  end if;

  insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
  values(v_user_id,v_session_id,now(),now()+interval '12 hours')
  on conflict(user_id,session_id) do update
    set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  return jsonb_build_object('created',v_inserted=1,'verified',true,'expires_in_hours',12);
end;
$function$;
revoke all on function public.set_app_pin(text) from public, anon;
grant execute on function public.set_app_pin(text) to authenticated;
