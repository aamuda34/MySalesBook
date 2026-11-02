# Sellbook identity verification

This Edge Function is intentionally fail-closed. It must not be enabled in the sign-in or account-creation flow until its provider configuration and live behaviour have been verified.

## Required configuration

Set these as Supabase Edge Function secrets; never commit them or paste them into chat.

- `BYTID_API_KEY`: start with a Bytid sandbox key. Use a live key only after the owner has approved paid verification.
- `SELLBOOK_IDENTITY_HMAC_SECRET`: a stable random secret of at least 32 bytes. Keep it backed up securely. Do not rotate it casually: the keyed identity fingerprints depend on it.
- `SELLBOOK_PUBLIC_URL`: the exact Sellbook production origin, for example `https://my-sales-book.vercel.app`.
- `SUPABASE_URL`: the project's URL (normally injected by Supabase).
- `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_ANON_KEY`: the function uses this to validate the signed-in user.
- `SUPABASE_SECRET_KEYS` with a `default` secret key, or the legacy `SUPABASE_SERVICE_ROLE_KEY`: server-only access for the narrowly granted RPCs.
- `SELLBOOK_IDENTITY_LIVE_ENABLED`: leave unset or `false` during sandbox testing. Set to `true` only after live access, billing limits, consent and rollback have been approved.

## Mandatory Bytid setting

Enable **Duplicate face detection** in the Bytid dashboard under Settings before the identity gate is activated. Bytid documents this as an optional service. It compares a passed liveness face with earlier verified faces; live checks can incur a separate charge.

The function accepts only `duplicate_check.status` values `clear` or `returning`. It rejects `other_id` and `flagged`, and returns a temporary-unavailable response when the duplicate result is absent or inconclusive. This prevents a missing/disabled duplicate-face service from silently weakening the one-person/one-account rule.

The database also stores a keyed NIN fingerprint with a unique constraint. It stores no raw NIN, selfie, face image or face embedding. Deleting the account cascades its identity binding, allowing the same person to register again after deleting the prior account.

## Required release checks

1. Test liveness and NIN face-match using a sandbox key.
2. Confirm that a new face returns `clear`.
3. Confirm that the same face with the same NIN returns `returning` and that the database rejects linking it to a different active account.
4. Confirm that the same face with a different NIN returns `other_id` and is blocked.
5. Confirm that a face already identified as a different person returns `flagged` and is blocked.
6. Confirm that a missing duplicate-check result fails closed.
7. Verify account deletion removes the unique identity binding.
8. Only then enable the live provider key and live flag, after the owner has approved the charges.

Do not use a live key for test runs. Do not activate the frontend gate while this function is undeployed or its required secrets/settings are missing.
