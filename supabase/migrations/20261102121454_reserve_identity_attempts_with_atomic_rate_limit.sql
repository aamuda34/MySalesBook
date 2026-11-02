-- Persist consent metadata and reserve attempts atomically before starting a paid liveness check.
alter table private.identity_verification_attempts
  alter column liveness_session_id drop not null,
  add column if not exists consent_version text not null default 'sellbook-identity-consent-v1'
    check (char_length(trim(consent_version)) between 1 and 40),
  add column if not exists consented_at timestamptz not null default now();

create index if not exists identity_attempts_user_created_idx
on private.identity_verification_attempts(user_id,created_at desc);

create or replace function public.begin_identity_verification_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_provider_reference text,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  if p_user_id is null or p_attempt_id is null then
    raise exception 'A valid account and attempt ID are required.';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_user_id) then
    raise exception 'The account being verified does not exist.';
  end if;
  if coalesce(trim(p_provider_reference),'')='' or length(p_provider_reference)>100 then
    raise exception 'A valid provider reference is required.';
  end if;
  if coalesce(trim(p_consent_version),'')='' or length(p_consent_version)>40 then
    raise exception 'A valid identity privacy consent is required.';
  end if;

  -- Serialise starts per account to stop concurrent requests creating billable sessions.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));

  if exists(
    select 1 from private.verified_identity_bindings b where b.user_id=p_user_id
  ) then
    raise exception 'This account already has a verified identity.';
  end if;

  update private.identity_verification_attempts
  set state='expired',completed_at=coalesce(completed_at,now())
  where user_id=p_user_id and state='pending' and expires_at<=now();

  if exists(
    select 1 from private.identity_verification_attempts a
    where a.user_id=p_user_id and a.state='pending' and a.expires_at>now()
  ) then
    raise exception 'A verification attempt is already in progress.';
  end if;

  select count(*) into v_count
  from private.identity_verification_attempts a
  where a.user_id=p_user_id and a.created_at>=now()-interval '24 hours';
  if v_count>=3 then
    raise exception 'Daily identity verification attempt limit reached.';
  end if;

  insert into private.identity_verification_attempts(
    attempt_id,user_id,provider_reference,state,expires_at,consent_version,consented_at
  ) values(
    p_attempt_id,p_user_id,p_provider_reference,'pending',now()+interval '30 minutes',p_consent_version,now()
  );

  return jsonb_build_object(
    'attempt_id',p_attempt_id,
    'expires_at',now()+interval '30 minutes',
    'attempts_remaining_today',greatest(3-v_count-1,0)
  );
end;
$function$;
revoke all on function public.begin_identity_verification_attempt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_identity_verification_attempt(uuid,uuid,text,text) to service_role;
