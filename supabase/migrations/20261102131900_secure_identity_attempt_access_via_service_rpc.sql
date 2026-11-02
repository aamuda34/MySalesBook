-- Keep identity attempt records private. Edge Functions access them only through
-- narrowly-scoped service-role RPCs; the private schema is not exposed via PostgREST.

create or replace function public.purge_identity_verification_attempts(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_deleted integer;
begin
  if p_before is null or p_before > now() then
    raise exception 'A valid past retention cutoff is required.';
  end if;

  delete from private.identity_verification_attempts
  where created_at < p_before;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;
revoke all on function public.purge_identity_verification_attempts(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_identity_verification_attempts(timestamptz) to service_role;


create or replace function public.attach_identity_liveness_session(
  p_user_id uuid,
  p_attempt_id uuid,
  p_liveness_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_attempt record;
begin
  if p_user_id is null or p_attempt_id is null then
    raise exception 'A valid account and attempt ID are required.';
  end if;
  if coalesce(trim(p_liveness_session_id),'') = '' or length(p_liveness_session_id) > 120 then
    raise exception 'A valid liveness session ID is required.';
  end if;

  update private.identity_verification_attempts
  set liveness_session_id = p_liveness_session_id
  where user_id = p_user_id
    and attempt_id = p_attempt_id
    and state = 'pending'
    and expires_at > now()
    and (liveness_session_id is null or liveness_session_id = p_liveness_session_id)
  returning attempt_id, expires_at into v_attempt;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.attempt_id,
    'expires_at', v_attempt.expires_at
  );
end;
$function$;
revoke all on function public.attach_identity_liveness_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.attach_identity_liveness_session(uuid, uuid, text) to service_role;


create or replace function public.get_identity_verification_attempt(
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_attempt record;
begin
  if p_user_id is null or p_attempt_id is null then
    raise exception 'A valid account and attempt ID are required.';
  end if;

  select
    a.attempt_id,
    a.provider_reference,
    a.liveness_session_id,
    a.state,
    a.expires_at,
    a.consent_version
  into v_attempt
  from private.identity_verification_attempts a
  where a.user_id = p_user_id
    and a.attempt_id = p_attempt_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.attempt_id,
    'provider_reference', v_attempt.provider_reference,
    'liveness_session_id', v_attempt.liveness_session_id,
    'state', v_attempt.state,
    'expires_at', v_attempt.expires_at,
    'consent_version', v_attempt.consent_version
  );
end;
$function$;
revoke all on function public.get_identity_verification_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_identity_verification_attempt(uuid, uuid) to service_role;


create or replace function public.finish_identity_verification_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_state text,
  p_face_match_reference text default null,
  p_provider_verification_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing_state text;
begin
  if p_user_id is null or p_attempt_id is null then
    raise exception 'A valid account and attempt ID are required.';
  end if;
  if p_state not in ('failed','rejected','expired','verified') then
    raise exception 'The requested terminal attempt state is invalid.';
  end if;
  if p_face_match_reference is not null and length(p_face_match_reference) > 180 then
    raise exception 'The face-match reference is too long.';
  end if;
  if p_provider_verification_reference is not null and length(p_provider_verification_reference) > 180 then
    raise exception 'The provider verification reference is too long.';
  end if;

  update private.identity_verification_attempts
  set state = p_state,
      liveness_session_id = null,
      face_match_reference = coalesce(p_face_match_reference, face_match_reference),
      provider_verification_reference = coalesce(p_provider_verification_reference, provider_verification_reference),
      completed_at = coalesce(completed_at, now())
  where user_id = p_user_id
    and attempt_id = p_attempt_id
    and state = 'pending';

  if found then
    return true;
  end if;

  select a.state into v_existing_state
  from private.identity_verification_attempts a
  where a.user_id = p_user_id and a.attempt_id = p_attempt_id;

  return v_existing_state = p_state;
end;
$function$;
revoke all on function public.finish_identity_verification_attempt(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_identity_verification_attempt(uuid, uuid, text, text, text) to service_role;
