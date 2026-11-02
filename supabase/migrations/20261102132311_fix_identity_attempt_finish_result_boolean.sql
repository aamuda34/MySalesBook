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
  if p_state is null or p_state not in ('failed','rejected','expired','verified') then
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

  return coalesce(v_existing_state = p_state, false);
end;
$function$;
revoke all on function public.finish_identity_verification_attempt(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_identity_verification_attempt(uuid, uuid, text, text, text) to service_role;