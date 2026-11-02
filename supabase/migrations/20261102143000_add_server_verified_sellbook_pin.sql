-- Server-enforced six-digit Sellbook PIN.
-- PIN hashes and verified session markers are private database records; no PIN is stored on-device.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.user_app_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists private.user_app_pin_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, session_id)
);
alter table private.user_app_pins enable row level security;
alter table private.user_app_pin_sessions enable row level security;
revoke all on private.user_app_pins, private.user_app_pin_sessions from public, anon, authenticated;

create or replace function private.is_sellbook_pin_verified()
returns boolean language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
begin
  if v_user_id is null then return false; end if;
  if not exists(select 1 from private.user_app_pins p where p.user_id=v_user_id) then return true; end if;
  if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_session_id:=v_session_text::uuid;
  return exists(select 1 from private.user_app_pin_sessions s
    where s.user_id=v_user_id and s.session_id=v_session_id and s.expires_at>now());
end;
$function$;
revoke all on function private.is_sellbook_pin_verified() from public, anon;
grant execute on function private.is_sellbook_pin_verified() to authenticated;

create or replace function public.get_app_pin_status()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid(); v_row private.user_app_pins%rowtype; v_has_pin boolean; v_verified boolean;
begin
 if v_user_id is null then raise exception 'Sign in before checking your security PIN.'; end if;
 select * into v_row from private.user_app_pins where user_id=v_user_id;
 v_has_pin:=found; v_verified:=private.is_sellbook_pin_verified();
 return jsonb_build_object(
  'has_pin',v_has_pin,'verified',v_verified,
  'locked_until',case when v_has_pin then v_row.locked_until else null end,
  'attempts_remaining',case when v_has_pin then greatest(5-v_row.failed_attempts,0) else 5 end
 );
end;
$function$;

create or replace function public.set_app_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 v_user_id uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id';
 v_session_id uuid; v_inserted integer:=0;
begin
 if v_user_id is null then raise exception 'Sign in before setting your security PIN.'; end if;
 if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'Your security PIN must contain exactly six digits.'; end if;
 if p_pin in ('000000','111111','123456','654321','121212','112233','123123','999999') then raise exception 'Choose a less predictable six-digit PIN.'; end if;
 if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Your sign-in session is not ready. Sign in again and retry.';
 end if;
 v_session_id:=v_session_text::uuid;
 insert into private.user_app_pins(user_id,pin_hash,failed_attempts,locked_until,updated_at)
 values(v_user_id,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),0,null,now())
 on conflict(user_id) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then
  if not private.is_sellbook_pin_verified() then raise exception 'Verify your current PIN before changing it.'; end if;
  update private.user_app_pins
  set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),failed_attempts=0,locked_until=null,updated_at=now()
  where user_id=v_user_id;
 end if;
 insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
 values(v_user_id,v_session_id,now(),now()+interval '12 hours')
 on conflict(user_id,session_id) do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
 return jsonb_build_object('created',v_inserted=1,'verified',true,'expires_in_hours',12);
end;
$function$;

create or replace function public.verify_app_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 v_user_id uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id';
 v_session_id uuid; v_row private.user_app_pins%rowtype; v_attempts integer; v_locked_until timestamptz;
begin
 if v_user_id is null then raise exception 'Sign in before verifying your security PIN.'; end if;
 if p_pin is null or p_pin !~ '^[0-9]{6}$' then return jsonb_build_object('verified',false,'message','Enter your six-digit PIN.','attempts_remaining',5); end if;
 if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Your sign-in session is not ready. Sign in again and retry.'; end if;
 v_session_id:=v_session_text::uuid;
 select * into v_row from private.user_app_pins where user_id=v_user_id for update;
 if not found then return jsonb_build_object('verified',false,'requires_setup',true); end if;
 if v_row.locked_until is not null and v_row.locked_until>now() then
  return jsonb_build_object('verified',false,'locked_until',v_row.locked_until,'attempts_remaining',0,
   'message','Too many incorrect PIN attempts. Try again after the lock expires or reset your PIN by signing in again.');
 end if;
 if extensions.crypt(p_pin,v_row.pin_hash)=v_row.pin_hash then
  update private.user_app_pins set failed_attempts=0,locked_until=null,updated_at=now() where user_id=v_user_id;
  insert into private.user_app_pin_sessions(user_id,session_id,verified_at,expires_at)
  values(v_user_id,v_session_id,now(),now()+interval '12 hours')
  on conflict(user_id,session_id) do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  return jsonb_build_object('verified',true,'expires_in_hours',12);
 end if;
 v_attempts:=v_row.failed_attempts+1;
 v_locked_until:=case when v_attempts>=5 then now()+interval '15 minutes' else null end;
 update private.user_app_pins set failed_attempts=v_attempts,locked_until=v_locked_until,updated_at=now() where user_id=v_user_id;
 return jsonb_build_object('verified',false,'attempts_remaining',greatest(5-v_attempts,0),
  'locked_until',v_locked_until,
  'message',case when v_attempts>=5 then 'Too many incorrect attempts. Your PIN is locked for 15 minutes.' else 'Incorrect PIN. Please try again.' end);
end;
$function$;

create or replace function public.reset_app_pin_after_reauth()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id'; v_session_id uuid;
begin
 if v_user_id is null then raise exception 'Sign in again before resetting your PIN.'; end if;
 if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Your sign-in session is not ready. Sign in again and retry.'; end if;
 v_session_id:=v_session_text::uuid;
 if not exists(select 1 from auth.sessions s where s.id=v_session_id and s.user_id=v_user_id and s.created_at>=now()-interval '5 minutes') then
  raise exception 'For your security, sign out and sign in again before resetting your PIN.';
 end if;
 delete from private.user_app_pin_sessions where user_id=v_user_id;
 delete from private.user_app_pins where user_id=v_user_id;
 return jsonb_build_object('reset',true);
end;
$function$;

revoke all on function public.get_app_pin_status() from public, anon;
revoke all on function public.set_app_pin(text) from public, anon;
revoke all on function public.verify_app_pin(text) from public, anon;
revoke all on function public.reset_app_pin_after_reauth() from public, anon;
grant execute on function public.get_app_pin_status() to authenticated;
grant execute on function public.set_app_pin(text) to authenticated;
grant execute on function public.verify_app_pin(text) to authenticated;
grant execute on function public.reset_app_pin_after_reauth() to authenticated;

do $policies$
declare v_table text;
begin
 foreach v_table in array array['products','sales','expenses','user_profiles','stock_adjustments','stock_purchases','product_creation_history','user_feedback','app_notifications','support_messages'] loop
  execute format('drop policy if exists sellbook_pin_gate on public.%I',v_table);
  execute format('create policy sellbook_pin_gate on public.%I as restrictive for all to authenticated using (private.is_sellbook_pin_verified()) with check (private.is_sellbook_pin_verified())',v_table);
 end loop;
end;
$policies$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid();
begin
 if v_user_id is null then raise exception 'You must sign in before deleting your account.'; end if;
 if exists(select 1 from private.user_app_pins p where p.user_id=v_user_id) and not private.is_sellbook_pin_verified() then
  raise exception 'Verify your Sellbook security PIN before deleting your account.';
 end if;
 delete from auth.users where id=v_user_id;
end;
$function$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

create or replace function public.sellbook_admin_overview()
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
 if not public.is_sellbook_admin() or not private.is_sellbook_pin_verified() then raise exception 'Administrator access and a verified Sellbook PIN are required'; end if;
 return jsonb_build_object(
  'total_users',(select count(*) from auth.users),
  'new_users_30d',(select count(*) from auth.users where created_at>=now()-interval '30 days'),
  'feedback_open',(select count(*) from public.user_feedback where status in ('new','in_review')),
  'feedback_total',(select count(*) from public.user_feedback),
  'messages_unread',(select count(*) from public.support_messages where recipient_id is null and read_at is null and sender_id<>auth.uid()),
  'notifications_total',(select count(*) from public.app_notifications)
 );
end;
$function$;

create or replace function public.sellbook_admin_platform_metrics()
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare result jsonb;
begin
 if not public.is_sellbook_admin() or not private.is_sellbook_pin_verified() then raise exception 'Administrator access and a verified Sellbook PIN are required'; end if;
 select jsonb_build_object(
  'total_products',(select count(*) from public.products),
  'total_sales',(select count(*) from public.sales),
  'sales_value',(select coalesce(sum(total),0) from public.sales),
  'visits_today',(select count(*) from public.app_page_visits where visit_date=(timezone('utc',now()))::date),
  'visits_7d',(select count(*) from public.app_page_visits where visit_date>=(timezone('utc',now()))::date-6),
  'visits_30d',(select count(*) from public.app_page_visits where visit_date>=(timezone('utc',now()))::date-29),
  'traffic_daily',coalesce((
   select jsonb_agg(jsonb_build_object('day',d.day,'visits',coalesce(v.visits,0)) order by d.day)
   from generate_series((timezone('utc',now()))::date-6,(timezone('utc',now()))::date,interval '1 day') as d(day)
   left join (select visit_date,count(*) as visits from public.app_page_visits where visit_date>=(timezone('utc',now()))::date-6 group by visit_date) v on v.visit_date=d.day::date
  ),'[]'::jsonb)
 ) into result;
 return result;
end;
$function$;

create or replace function public.sellbook_admin_users()
returns table(user_id uuid,email text,created_at timestamptz,last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
begin
 if not public.is_sellbook_admin() or not private.is_sellbook_pin_verified() then raise exception 'Administrator access and a verified Sellbook PIN are required'; end if;
 return query select u.id,u.email::text,u.created_at,u.last_sign_in_at from auth.users u order by u.created_at desc limit 200;
end;
$function$;
revoke all on function public.sellbook_admin_overview() from public, anon;
revoke all on function public.sellbook_admin_platform_metrics() from public, anon;
revoke all on function public.sellbook_admin_users() from public, anon;
grant execute on function public.sellbook_admin_overview() to authenticated;
grant execute on function public.sellbook_admin_platform_metrics() to authenticated;
grant execute on function public.sellbook_admin_users() to authenticated;

-- Rollback-only verification: first-use setup, wrong PIN, correct PIN and server-side session gate.
select set_config('request.jwt.claim.sub','ecbc30bb-d632-4fc2-8d35-61f6db1da4bc',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','ecbc30bb-d632-4fc2-8d35-61f6db1da4bc','session_id','11111111-1111-4111-8111-111111111111')::text,true);
do $test$
declare v_status jsonb; v_result jsonb;
begin
 v_status:=public.get_app_pin_status();
 if v_status->>'has_pin'<>'false' or v_status->>'verified'<>'true' then raise exception 'First-time PIN setup status failed'; end if;
 v_result:=public.set_app_pin('481729');
 if v_result->>'verified'<>'true' then raise exception 'PIN setup failed'; end if;
 v_status:=public.get_app_pin_status();
 if v_status->>'has_pin'<>'true' or v_status->>'verified'<>'true' then raise exception 'PIN session was not verified after setup'; end if;
 v_result:=public.verify_app_pin('000000');
 if v_result->>'verified'<>'false' then raise exception 'Incorrect PIN was accepted'; end if;
 v_result:=public.verify_app_pin('481729');
 if v_result->>'verified'<>'true' then raise exception 'Correct PIN was rejected'; end if;
 if not private.is_sellbook_pin_verified() then raise exception 'PIN RLS helper did not recognize the verified session'; end if;
end;
$test$;
rollback;