import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "marketplace-shop-fronts";
const CLASSIFIER = "https://sellbook-shopfront-check.aamuda34.workers.dev";
const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const APP_ORIGINS = new Set([
  "https://my-sales-book.vercel.app",
  "https://sellbook-backup.pages.dev",
]);

function jsonResponse(status: number, body: Record<string, unknown>, origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (origin && APP_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function keyFromEnv(jsonName: string, legacyName: string): string | null {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      if (typeof keys?.default === "string") return keys.default;
    } catch (_) {
      // Fall through to the legacy environment variable.
    }
  }
  return Deno.env.get(legacyName) || null;
}

function isValidOwnedPath(path: string, userId: string): boolean {
  if (!path || path.length > 512 || path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.length >= 2 &&
    segments[0] === userId &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const respond = (status: number, body: Record<string, unknown>) =>
    jsonResponse(status, body, origin);

  if (origin && !APP_ORIGINS.has(origin)) {
    return respond(403, { error: "origin_not_allowed" });
  }
  if (request.method === "OPTIONS") return respond(200, { ok: true });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\\s+(.+)$/i)?.[1];
  if (!token) return respond(401, { error: "authentication_required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = keyFromEnv("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = keyFromEnv("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("shopfront_config_missing", {
      url: !!supabaseUrl,
      publishableKey: !!publishableKey,
      secretKey: !!secretKey,
    });
    return respond(503, { error: "verification_service_not_configured" });
  }

  // Never trust a user ID decoded from an unverified JWT. Validate the bearer
  // token with Supabase Auth before using service-role access or consuming quota.
  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || user.is_anonymous === true) {
    return respond(401, { error: "invalid_session" });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (_) {
    return respond(400, { error: "invalid_json" });
  }

  const path = String(body?.storage_path || "").trim();
  if (!isValidOwnedPath(path, user.id)) {
    return respond(400, { error: "invalid_shop_photo_path" });
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: withinDailyLimit, error: limitError } = await admin.rpc(
    "consume_buybook_shop_front_check",
    { p_user_id: user.id },
  );
  if (limitError) {
    console.error("shopfront_daily_limit_check_failed", { message: limitError.message });
    return respond(503, {
      error: "photo_check_limit_unavailable",
      message: "Automatic photo checking is temporarily unavailable. Please try again.",
    });
  }
  if (withinDailyLimit !== true) {
    return respond(429, {
      error: "shop_photo_check_daily_limit_reached",
      message: "You have reached today’s shop-photo checking limit. Please try again tomorrow.",
    });
  }

  const { data: photo, error: photoError } = await admin.storage.from(BUCKET).download(path);
  if (photoError || !photo) {
    console.error("shopfront_storage_download_failed", {
      message: photoError?.message || "missing",
    });
    return respond(422, { error: "shop_photo_not_found" });
  }

  const photoType = String(photo.type || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(photoType) ||
      !Number.isFinite(photo.size) || photo.size <= 0 || photo.size > MAX_IMAGE_BYTES) {
    return respond(422, { error: "invalid_shop_photo_file" });
  }

  const photoBytes = new Uint8Array(await photo.arrayBuffer());
  if (!photoBytes.length || photoBytes.length > MAX_IMAGE_BYTES) {
    return respond(422, { error: "invalid_shop_photo_file" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  let checked: Response;
  try {
    checked = await fetch(CLASSIFIER, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        "Content-Type": photoType,
        "X-Shop-Photo-Path": path,
        Accept: "application/json",
      },
      body: photoBytes,
    });
  } catch (error) {
    console.error("shopfront_classifier_network_failed", {
      name: error instanceof Error ? error.name : "Error",
      message: String(error).slice(0, 240),
    });
    return respond(503, {
      error: "automatic_photo_check_unavailable",
      message: "Automatic photo checking is temporarily unavailable. Please try again.",
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await checked.text();
  let result: Record<string, unknown> | null = null;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    // The classifier must return a valid, explicit result.
  }
  if (!checked.ok || result?.success !== true ||
      !["approved", "rejected"].includes(String(result.status))) {
    console.error("shopfront_classifier_rejected", {
      status: checked.status,
      body: raw.slice(0, 400),
    });
    return respond(503, {
      error: "automatic_photo_check_unavailable",
      message: "Sellbook could not finish checking this photo. Your shop has not been connected. Please try again.",
    });
  }

  const status = String(result.status);
  const reason = status === "approved"
    ? "AI image review accepted a physical shop-front photograph."
    : "AI image review did not identify a clear physical shop-front photograph.";

  const { data: verifiedAt, error: recordError } = await admin.rpc(
    "record_buybook_shop_front_verification",
    {
      p_user_id: user.id,
      p_storage_path: path,
      p_status: status,
      p_reason: reason,
      p_model: MODEL,
    },
  );
  if (recordError) {
    console.error("shopfront_verification_record_failed", { message: recordError.message });
    return respond(503, { error: "verification_record_failed" });
  }

  return respond(200, {
    status,
    verified_at: verifiedAt || null,
    message: status === "approved"
      ? "Shop-front photo checked successfully."
      : "This photo does not clearly show the outside front of a shop. Please take a clear photo of your shop entrance.",
  });
});
