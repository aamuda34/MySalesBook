import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BYTID_BASE = "https://api.bytid.com/v1";
const CONSENT_VERSION = "sellbook-identity-consent-v1";
const APP_ORIGIN = Deno.env.get("SELLBOOK_PUBLIC_URL") || "https://my-sales-book.vercel.app";

function json(status: number, body: Record<string, unknown>) {
  let allowedOrigin = "https://my-sales-book.vercel.app";
  try {
    allowedOrigin = new URL(APP_ORIGIN).origin;
  } catch (_) {
    // Keep the production origin as the safe fallback if an invalid URL is configured.
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function getSecretKey(): string | null {
  const jsonKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (jsonKeys) {
    try {
      const keys = JSON.parse(jsonKeys);
      if (typeof keys?.default === "string") return keys.default;
    } catch (_) {
      // Fall back to the legacy injected variable below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

function getPublishableKey(): string | null {
  const jsonKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (jsonKeys) {
    try {
      const keys = JSON.parse(jsonKeys);
      if (typeof keys?.default === "string") return keys.default;
    } catch (_) {
      // Fall back to the legacy injected variable below.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || null;
}

async function bytidRequest(path: string, apiKey: string, method: "GET" | "POST", body?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(BYTID_BASE + path, {
      method,
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Request-Id": crypto.randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      const code = String(payload?.error?.code || "provider_error");
      const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
      const err = new Error(code);
      (err as Error & { providerDetails?: unknown }).providerDetails = details;
      throw err;
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function hmacFingerprint(nin: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("sellbook:nin:v1:" + nin),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getClient(request: Request, key: string) {
  const authorization = request.headers.get("Authorization") || "";
  return createClient(Deno.env.get("SUPABASE_URL")!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return json(200, { ok: true });
  }
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getPublishableKey();
  if (!supabaseUrl || !publishableKey) {
    return json(503, { error: "supabase_function_configuration_missing" });
  }

  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return json(401, { error: "authentication_required" });

  const supabaseUser = getClient(request, publishableKey);
  const { data: userResult, error: userError } = await supabaseUser.auth.getUser(bearer);
  const user = userResult?.user;
  if (userError || !user) return json(401, { error: "invalid_session" });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (_) {
    return json(400, { error: "invalid_json" });
  }

  const action = body.action;
  if (action === "status") {
    const apiKey = Deno.env.get("BYTID_API_KEY");
    const hmacSecret = Deno.env.get("SELLBOOK_IDENTITY_HMAC_SECRET");
    const secretKey = getSecretKey();
    const environment = Deno.env.get("SELLBOOK_IDENTITY_ENVIRONMENT") || "production";
    const liveConfigured = !!apiKey && apiKey.startsWith("uvk_live_") &&
      !!hmacSecret && hmacSecret.length >= 32 && !!secretKey &&
      environment === "production" &&
      Deno.env.get("SELLBOOK_IDENTITY_LIVE_ENABLED") === "true";
    const { data, error } = await supabaseUser.rpc("get_identity_verification_status");
    if (error) return json(503, { error: "identity_status_unavailable" });
    // Sandbox keys must never activate identity enforcement against production users.
    return json(200, { data, configured: liveConfigured, environment: liveConfigured ? "live" : "not_configured" });
  }

  const apiKey = Deno.env.get("BYTID_API_KEY");
  const hmacSecret = Deno.env.get("SELLBOOK_IDENTITY_HMAC_SECRET");
  const secretKey = getSecretKey();
  // No provider call can happen until both the provider key and HMAC secret
  // are configured. A live key also requires an explicit owner-side live switch.
  if (!apiKey || !hmacSecret || hmacSecret.length < 32 || !secretKey) {
    return json(503, {
      error: "identity_verification_not_configured",
      message: "Sellbook identity verification is not enabled yet.",
    });
  }

  const isLiveKey = apiKey.startsWith("uvk_live_");
  const isSandboxKey = apiKey.startsWith("uvk_test_");
  const identityEnvironment = Deno.env.get("SELLBOOK_IDENTITY_ENVIRONMENT") || "production";

  if (!isLiveKey && !isSandboxKey) {
    return json(503, { error: "invalid_provider_environment" });
  }
  // Sandbox responses can be simulated and must never verify real production
  // accounts. Sandbox keys are accepted only by an explicitly labelled staging
  // deployment with a separate opt-in.
  if (
    isSandboxKey &&
    (
      identityEnvironment !== "staging" ||
      Deno.env.get("SELLBOOK_IDENTITY_SANDBOX_ENABLED") !== "true"
    )
  ) {
    return json(503, {
      error: "sandbox_identity_checks_disabled",
      message: "Sandbox identity checks are available only in an explicitly enabled staging environment.",
    });
  }
  if (
    isLiveKey &&
    (
      identityEnvironment !== "production" ||
      Deno.env.get("SELLBOOK_IDENTITY_LIVE_ENABLED") !== "true"
    )
  ) {
    return json(503, {
      error: "live_identity_checks_disabled",
      message: "Paid live identity checks have not been enabled for the production environment.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body.consent_accepted !== true || body.consent_version !== CONSENT_VERSION) {
    return json(400, {
      error: "explicit_consent_required",
      message: "Review and accept the Sellbook identity-verification privacy notice before continuing.",
    });
  }

  const { data: currentIdentity, error: identityStatusError } =
    await supabaseUser.rpc("get_identity_verification_status");
  if (identityStatusError) return json(503, { error: "identity_status_unavailable" });
  if (currentIdentity?.verified === true) {
    return json(409, {
      error: "identity_already_verified",
      message: "This account already has a verified identity.",
    });
  }

  if (action === "start") {
    const redirectUrl = new URL("/", APP_ORIGIN);
    redirectUrl.searchParams.set("identity_verification", "return");

    // Retain only a short verification audit window; old provider session IDs
    // and references are removed after 30 days.
    const { error: purgeError } = await supabaseAdmin.rpc("purge_identity_verification_attempts", {
      p_before: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (purgeError) return json(503, { error: "identity_retention_cleanup_unavailable" });

    const attemptId = crypto.randomUUID();
    const reference = "sellbook-" + user.id + "-" + attemptId;

    // The database reserves an attempt under an account-scoped advisory lock.
    // This prevents parallel start requests from generating multiple billable sessions.
    const { data: reservedAttempt, error: reserveError } = await supabaseAdmin.rpc(
      "begin_identity_verification_attempt",
      {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_provider_reference: reference,
        p_consent_version: CONSENT_VERSION,
      },
    );

    if (reserveError || !reservedAttempt?.attempt_id) {
      const message = reserveError?.message || "could_not_reserve_attempt";
      if (message.includes("Daily identity verification attempt limit")) {
        return json(429, { error: "daily_attempt_limit_reached" });
      }
      if (message.includes("already in progress")) {
        return json(409, { error: "verification_already_in_progress" });
      }
      if (message.includes("already has a verified identity")) {
        return json(409, { error: "identity_already_verified" });
      }
      return json(503, { error: "could_not_reserve_verification_attempt" });
    }

    let liveness: Record<string, unknown>;
    try {
      liveness = await bytidRequest("/liveness/sessions", apiKey, "POST", {
        reference,
        redirect_url: redirectUrl.toString(),
      });
    } catch (error) {
      await supabaseAdmin.rpc("finish_identity_verification_attempt", {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_state: "failed",
      });
      const code = (error as Error).message || "provider_error";
      return json(502, { error: "liveness_session_failed", provider_code: code });
    }

    const livenessId = String(liveness.id || "");
    const livenessUrl = String(liveness.url || "");
    let livenessUrlIsSecure = false;
    try {
      livenessUrlIsSecure = new URL(livenessUrl).protocol === "https:";
    } catch (_) {
      livenessUrlIsSecure = false;
    }
    if (!livenessId || !livenessUrlIsSecure) {
      await supabaseAdmin.rpc("finish_identity_verification_attempt", {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_state: "failed",
      });
      return json(502, { error: "invalid_liveness_response" });
    }

    const { data: attempt, error: updateError } = await supabaseAdmin.rpc(
      "attach_identity_liveness_session",
      {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_liveness_session_id: livenessId,
      },
    );

    if (updateError || !attempt) {
      return json(503, { error: "could_not_store_verification_session" });
    }

    return json(200, {
      data: {
        attempt_id: attempt.attempt_id,
        verification_url: livenessUrl,
        expires_at: attempt.expires_at,
        environment: isLiveKey ? "live" : "sandbox",
        attempts_remaining_today: reservedAttempt.attempts_remaining_today,
      },
    });
  }

  if (action === "verify") {
    const attemptId = String(body.attempt_id || "");
    const nin = String(body.nin || "").replace(/\s+/g, "");
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const dob = String(body.date_of_birth || "").trim();

    if (!/^[0-9]{11}$/.test(nin)) return json(400, { error: "invalid_nin" });
    if (firstName.length < 1 || firstName.length > 80 || lastName.length < 1 || lastName.length > 80) {
      return json(400, { error: "valid_first_and_last_name_required" });
    }
    const parsedDob = new Date(dob + "T00:00:00.000Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dob) ||
      Number.isNaN(parsedDob.getTime()) ||
      parsedDob.toISOString().slice(0, 10) !== dob ||
      parsedDob.getTime() >= Date.now()
    ) {
      return json(400, { error: "valid_date_of_birth_required" });
    }
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return json(400, { error: "invalid_attempt_id" });

    const { data: attempt, error: attemptError } = await supabaseAdmin.rpc(
      "get_identity_verification_attempt",
      { p_user_id: user.id, p_attempt_id: attemptId },
    );

    if (attemptError || !attempt) return json(404, { error: "verification_attempt_not_found" });
    if (attempt.state !== "pending" || !attempt.liveness_session_id) {
      return json(409, { error: "verification_attempt_not_pending" });
    }
    if (attempt.consent_version !== CONSENT_VERSION) {
      return json(400, { error: "identity_consent_version_mismatch" });
    }
    if (new Date(attempt.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin.rpc("finish_identity_verification_attempt", {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_state: "expired",
      });
      return json(410, { error: "verification_attempt_expired" });
    }

    let liveness: Record<string, unknown>;
    try {
      liveness = await bytidRequest(
        "/liveness/sessions/" + encodeURIComponent(attempt.liveness_session_id),
        apiKey,
        "GET",
      );
    } catch (error) {
      return json(502, {
        error: "could_not_confirm_liveness",
        provider_code: (error as Error).message || "provider_error",
      });
    }

    if (liveness.status !== "passed" || liveness.usable_for_face_match !== true) {
      if (liveness.status === "failed" || liveness.status === "expired") {
        await supabaseAdmin.rpc("finish_identity_verification_attempt", {
          p_user_id: user.id,
          p_attempt_id: attemptId,
          p_state: "rejected",
        });
      }
      return json(409, {
        error: "liveness_not_passed",
        message: "Complete the live camera check successfully before continuing.",
        status: liveness.status || "pending",
      });
    }

    const faceMatchReference = attempt.provider_reference + "-face-match";
    let verification: Record<string, unknown>;
    try {
      verification = await bytidRequest("/identity/nin/face-match", apiKey, "POST", {
        id_number: nin,
        first_name: firstName,
        last_name: lastName,
        dob,
        liveness_session_id: attempt.liveness_session_id,
        reference: faceMatchReference,
      });
    } catch (error) {
      const providerCode = (error as Error).message || "provider_error";
      if (providerCode === "duplicate_reference") {
        // A timeout may happen after Bytid has completed the check. Reuse the
        // same idempotency reference and recover its original result rather
        // than making a new billable face-match request.
        try {
          const recovered = await bytidRequest(
            "/verifications?reference=" + encodeURIComponent(faceMatchReference),
            apiKey,
            "GET",
          );
          const items = Array.isArray(recovered?.items) ? recovered.items : [];
          const original = items.find((item: Record<string, unknown>) => item.reference === faceMatchReference);
          if (original) verification = original;
          else return json(503, { error: "identity_result_recovery_pending" });
        } catch (_) {
          return json(503, { error: "identity_result_recovery_pending" });
        }
      } else {
        return json(502, {
          error: "identity_face_match_failed",
          provider_code: providerCode,
        });
      }
    }

    const matches = verification.field_matches as Record<string, unknown> | undefined;
    const faceMatch = verification.face_match as Record<string, unknown> | undefined;
    const duplicateCheck = verification.duplicate_check as Record<string, unknown> | undefined;
    const duplicateFaceStatus = typeof duplicateCheck?.status === "string"
      ? duplicateCheck.status
      : null;
    const duplicateFaceClear = duplicateFaceStatus === "clear" || duplicateFaceStatus === "returning";
    const duplicateFaceConflict = duplicateFaceStatus === "other_id" || duplicateFaceStatus === "flagged";
    const verified =
      verification.type === "nin" &&
      verification.service === "nin_face_match" &&
      verification.status === "verified" &&
      faceMatch?.status === "matched" &&
      faceMatch?.liveness === "passed" &&
      matches?.first_name === true &&
      matches?.last_name === true &&
      matches?.date_of_birth === true &&
      duplicateFaceClear;

    if (!verified) {
      await supabaseAdmin.rpc("finish_identity_verification_attempt", {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_state: "rejected",
        p_face_match_reference: faceMatchReference,
        p_provider_verification_reference: String(verification.id || "").slice(0, 180) || null,
      });

      // Bytid's duplicate-face service is mandatory for the one-person/one-account
      // policy. A missing result must fail closed rather than silently bypass checks.
      if (duplicateFaceConflict) {
        return json(409, {
          error: "identity_face_already_linked",
          message: "This live face is already associated with another identity. Contact Sellbook support for a manual review.",
        });
      }
      if (!duplicateFaceClear) {
        return json(503, {
          error: "duplicate_face_check_unavailable",
          message: "Sellbook could not confirm that this face is unique. Identity verification is temporarily unavailable; please try again later.",
        });
      }

      // Never return names, ID numbers, registry data, match scores or photos to the client.
      return json(422, {
        error: "identity_not_verified",
        message: "The identity details or live face check did not match. Review the details and try again.",
      });
    }

    const fingerprint = await hmacFingerprint(nin, hmacSecret);
    const providerReference = String(verification.id || "").slice(0, 180) || null;
    const { data: claimResult, error: claimError } = await supabaseAdmin.rpc(
      "claim_and_finish_verified_identity",
      {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_identity_fingerprint: fingerprint,
        p_provider_reference: providerReference,
        p_consent_version: CONSENT_VERSION,
        p_face_match_reference: faceMatchReference,
      },
    );

    if (
      claimError ||
      claimResult?.verified !== true ||
      claimResult?.attempt_finalized !== true
    ) {
      // This fallback is idempotent. If the atomic transaction committed but
      // its response was lost, the attempt is already verified and this RPC
      // cannot downgrade it to rejected. If the transaction rolled back, it
      // releases the pending attempt so the user can start again.
      await supabaseAdmin.rpc("finish_identity_verification_attempt", {
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_state: "rejected",
        p_face_match_reference: faceMatchReference,
        p_provider_verification_reference: providerReference,
      });
      const duplicate = (claimError?.message || "").includes("already linked to another active account");
      return json(duplicate ? 409 : 503, {
        error: duplicate ? "identity_already_linked" : "identity_claim_failed",
        message: duplicate
          ? "This verified identity is already linked to another active account."
          : "Sellbook could not securely finalize identity verification. Please retry or contact support.",
      });
    }

    return json(200, {
      data: {
        verified: true,
        verified_at: new Date().toISOString(),
        one_active_account_per_verified_identity: true,
      },
    });
  }

  return json(400, { error: "unknown_action" });
});
