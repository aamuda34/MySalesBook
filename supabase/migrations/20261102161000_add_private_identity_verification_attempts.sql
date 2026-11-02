-- Short-lived, server-only Bytid liveness session tracking.
-- Raw NIN values, selfies, face images and face embeddings are never stored here.
create table if not exists private.identity_verification_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_reference text not null unique
    check (char_length(provider_reference) between 1 and 100),
  liveness_session_id text not null unique
    check (char_length(liveness_session_id) between 1 and 120),
  state text not null default 'pending'
    check (state in ('pending','verified','rejected','expired','failed')),
  face_match_reference text unique,
  provider_verification_reference text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (provider_verification_reference is null or char_length(provider_verification_reference)<=180)
);
alter table private.identity_verification_attempts enable row level security;
revoke all on private.identity_verification_attempts from public, anon, authenticated;
grant select, insert, update, delete on private.identity_verification_attempts to service_role;

create unique index if not exists identity_attempts_one_pending_per_user
on private.identity_verification_attempts(user_id)
where state='pending';

create index if not exists identity_attempts_expiry_idx
on private.identity_verification_attempts(expires_at)
where state='pending';

comment on table private.identity_verification_attempts is
'Private short-lived liveness attempt metadata. Contains no raw NIN, selfie, face image, or face embedding. Cleans up after expiry/completion.';