-- Finalize the unique identity claim and its audit attempt in one transaction.
-- If either operation fails, PostgreSQL rolls both back so the account cannot be
-- left identity-bound while the corresponding attempt remains pending.

create or replace function public.claim_and_finish_verified_identity(
  p_user_id uuid,
  p_attempt_id uuid,
  p_identity_fingerprint text,
  p_provider_reference text,
  p_consent_version text,
  p_face_match_reference text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_claim jsonb;
  v_finished boolean;
begin
  if p_user_id is null or p_attempt_id is null then
    raise exception 'A valid account and verification attempt are required.';
  end if;

  v_claim := public.claim_verified_identity(
    p_user_id,
    p_identity_fingerprint,
    'bytid',
    p_provider_reference,
    p_consent_version
  );

  if coalesce((v_claim->>'verified')::boolean, false) is not true then
    raise exception 'The verified identity claim could not be confirmed.';
  end if;

  v_finished := public.finish_identity_verification_attempt(
    p_user_id,
    p_attempt_id,
    'verified',
    p_face_match_reference,
    p_provider_reference
  );

  if coalesce(v_finished, false) is not true then
    raise exception 'The verification attempt could not be finalized.';
  end if;

  return coalesce(v_claim, '{}'::jsonb)
    || jsonb_build_object('verified', true, 'attempt_finalized', true);
end;
$function$;

revoke all on function public.claim_and_finish_verified_identity(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_and_finish_verified_identity(uuid,uuid,text,text,text,text)
  to service_role;
