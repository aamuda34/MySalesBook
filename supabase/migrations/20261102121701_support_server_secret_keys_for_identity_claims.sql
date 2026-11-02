-- The claim function remains callable only by service_role at the SQL privilege layer.
-- Avoid relying on legacy JWT role claims because Supabase's newer secret API keys
-- are not themselves JWTs; the API gateway maps them to the service role.
create or replace function public.claim_verified_identity(
  p_user_id uuid,
  p_identity_fingerprint text,
  p_provider text,
  p_provider_reference text,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_existing_user uuid;
begin
  if p_user_id is null or not exists(select 1 from auth.users u where u.id=p_user_id) then
    raise exception 'The account being verified does not exist.';
  end if;
  if p_provider is distinct from 'bytid' then raise exception 'Unsupported identity verification provider.'; end if;
  if p_identity_fingerprint is null or p_identity_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'The identity fingerprint is invalid.';
  end if;
  if coalesce(trim(p_consent_version),'')='' or length(p_consent_version)>40 then
    raise exception 'A valid privacy consent version is required.';
  end if;
  if p_provider_reference is not null and length(p_provider_reference)>180 then
    raise exception 'The provider reference is too long.';
  end if;

  insert into private.verified_identity_bindings(
    user_id,identity_fingerprint,provider,provider_reference,consent_version,consented_at,verified_at
  )
  values(p_user_id,p_identity_fingerprint,p_provider,p_provider_reference,p_consent_version,now(),now())
  on conflict do nothing;

  if exists(
    select 1 from private.verified_identity_bindings b
    where b.user_id=p_user_id and b.identity_fingerprint=p_identity_fingerprint
  ) then
    return jsonb_build_object('verified',true,'already_verified',true);
  end if;

  select b.user_id into v_existing_user
  from private.verified_identity_bindings b
  where b.identity_fingerprint=p_identity_fingerprint;

  if v_existing_user is not null and v_existing_user<>p_user_id then
    raise exception 'This verified identity is already linked to another active account.';
  end if;
  raise exception 'This account already has a different verified identity. Permanently delete the account before registering a new identity.';
end;
$function$;
revoke all on function public.claim_verified_identity(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_verified_identity(uuid,text,text,text,text) to service_role;
