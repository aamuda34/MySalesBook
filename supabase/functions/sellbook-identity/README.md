# Sellbook identity verification

This Edge Function is intentionally fail-closed. It must not be enabled in the sign-in or account-creation flow until its provider configuration and live behaviour have been verified.

## Required configuration

Set these as Supabase Edge Function secrets; never commit them or paste them into chat.

- `BYTID_API_KEY`: use a sandbox key only in a separate staging Supabase project. Production must use a live key only after the owner has approved paid verification.
- `SELLBOOK_IDENTITY_HMAC_SECRET`: a stable random secret of at least 32 bytes. Keep it backed up securely. Do not rotate it casually: the keyed identity fingerprints depend on it.
- `SELLBOOK_PUBLIC_URL`: the exact origin for the environment where this function runs.
- `SUPABASE_URL`: the project's URL (normally injected by Supabase).
- `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_ANON_KEY`: the function uses this to validate the signed-in user.
- `SUPABASE_SECRET_KEYS` with a `default` secret key, or the legacy `SUPABASE_SERVICE_ROLE_KEY`: server-only access for narrowly granted RPCs.
- `SELLBOOK_IDENTITY_ENVIRONMENT`: explicitly set to `staging` in a separate staging project; production defaults to `production`.
- `SELLBOOK_IDENTITY_SANDBOX_ENABLED`: set to `true` only in the isolated staging project when running sandbox tests. Sandbox keys are rejected in production even if this flag is accidentally set.
- `SELLBOOK_IDENTITY_LIVE_ENABLED`: leave unset or `false` until the owner approves live testing costs, provider settings and rollback. Production live keys are accepted only when the environment is `production` and this flag is `true`.

**Never use a sandbox key or sandbox verification result to verify a production Sellbook account.** The function rejects sandbox keys unless it is running in an explicitly enabled staging environment. Keep staging credentials and its Supabase database separate from production.

## Mandatory Bytid setting

Enable **Duplicate face detection** in the Bytid dashboard under Settings before the identity gate is activated. Bytid documents this as an optional service. It compares a passed liveness face with earlier verified faces; live checks can incur a separate charge.

The function accepts only `duplicate_check.status` values `clear` or `returning`. It rejects `other_id` and `flagged`, and returns a temporary-unavailable response when the duplicate result is absent or inconclusive. This prevents a missing/disabled duplicate-face service from silently weakening the one-person/one-account rule.

The database stores a keyed NIN fingerprint with a unique constraint. It stores no raw NIN, selfie, face image or face embedding. Deleting the account cascades its identity binding, allowing the same person to register again after deleting the prior account.

## Required release checks

1. Deploy and configure the function in a separate staging Supabase project.
2. Use only a Bytid sandbox key in staging and set `SELLBOOK_IDENTITY_ENVIRONMENT=staging` and `SELLBOOK_IDENTITY_SANDBOX_ENABLED=true`.
3. Confirm a sandbox key is rejected when the function is configured for production.
4. Confirm a new face returns `clear`.
5. Confirm the same face with the same NIN returns `returning` and that the database does not create a second binding for another active account.
6. Confirm the same face with a different NIN returns `other_id` and is blocked.
7. Confirm a face flagged as belonging to another person is blocked.
8. Confirm a missing duplicate-check result fails closed.
9. Verify that an account deletion removes the unique identity binding and that the same person can subsequently register.
10. Only after all tests pass, configure a live key and enable `SELLBOOK_IDENTITY_LIVE_ENABLED=true` in production, with the owner's explicit approval of all provider charges.

Do not activate the frontend identity gate while this function is undeployed, required secrets/settings are missing, or staging tests have not passed. Do not use live credentials for tests.
