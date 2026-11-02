-- Store only a server-keyed identity fingerprint, never a raw NIN or face image.
-- ON DELETE CASCADE means permanent account deletion releases the identity for re-registration.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table if not exists private.verified_identity_bindings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  identity_fingerprint text not null unique
    check (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('bytid')),
  provider_reference text,
  consent_version text not null check (char_length(trim(consent_version)) between 1 and 40),
  consented_at timestamptz not null default now(),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (provider_reference is null or char_length(provider_reference)<=180)
);
alter table private.verified_identity_bindings enable row level security;
revoke all on private.verified_identity_bindings from public, anon, authenticated, service_role;

create or replace function public.get_identity_verification_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_user_id uuid:=auth.uid();
        v_verified_at timestamptz;
        v_provider text;
begin
  if v_user_id is null then raise exception 'Sign in to check identity verification.'; end if;
  select b.verified_at,b.provider into v_verified_at,v_provider
  from private.verified_identity_bindings b
  where b.user_id=v_user_id;
  return jsonb_build_object(
    'verified',v_verified_at is not null,
    'verified_at',v_verified_at,
    'provider',v_provider
  );
end;
$function$;
revoke all on function public.get_identity_verification_status() from public, anon;
grant execute on function public.get_identity_verification_status() to authenticated;

-- Called only by a trusted server-side verification function after the provider confirms
-- liveness + a registry face match. The caller supplies a keyed HMAC fingerprint, never
-- the raw NIN. The database unique constraint serializes duplicate identity claims.
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
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Identity claims must be submitted by the trusted verification service.';
  end if;
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
