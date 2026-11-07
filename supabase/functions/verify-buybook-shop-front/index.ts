import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "marketplace-shop-fronts";
const CLASSIFIER_URL = "https://sellbook-shopfront-check.aamuda34.workers.dev";
const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const APP_ORIGINS = new Set([
  "https://my-sales-book.vercel.app",
  "https://sellbook-backup.pages.dev",
]);
const MAX_BYTES = 5 * 1024 * 1024;

function json(status: number, body: Record<string, unknown>, origin: string | null) {
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

function getPublishableKey(): string | null {
  const jsonKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (jsonKeys) {
    try {
      const keys = JSON.parse(jsonKeys);
      if (typeof keys?.default === "string") return keys.default;
    } catch (_) { /* legacy key fallback */ }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || null;
}

function getSecretKey(): string | null {
  const jsonKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (jsonKeys) {
    try {
      const keys = JSON.parse(jsonKeys);
      if (typeof keys?.default === "string") return keys.default;
    } catch (_) { /* legacy key fallback */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const respond = (status: number, body: Record<string, unknown>) => json(status, body, origin);
  if (origin && !APP_ORIGINS.has(origin)) return respond(403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return respond(200, { ok: true });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return respond(401, { error: "authentication_required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getPublishableKey();
  const secretKey = getSecretKey();
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return respond(503, { error: "verification_service_not_configured" });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(bearer);
  const user = userData?.user;
  if (userError || !user) return respond(401, { error: "invalid_session" });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch (_) { return respond(400, { error: "invalid_json" }); }
  const storagePath = String(body.storage_path || "").trim();
  if (
    !storagePath ||
    storagePath.length > 512 ||
    storagePath.startsWith("/") ||
    storagePath.includes("..") ||
    storagePath.includes("\\") ||
    storagePath.split("/").length < 2 ||
    storagePath.split("/")[0] !== user.id
  ) {
    return respond(400, { error: "invalid_shop_photo_path" });
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Confirm the exact object exists in this seller's own storage folder before AI review.
  const { data: photo, error: photoError } = await admin.storage.from(BUCKET).download(storagePath);
  if (photoError || !photo) return respond(422, { error: "shop_photo_not_found" });
  const photoType = String(photo.type || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(photoType) || photo.size <= 0 || photo.size > MAX_BYTES) {
    return respond(422, { error: "invalid_shop_photo_file" });
  }

  const publicUrlResult = admin.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicUrlResult?.data?.publicUrl;
  if (!publicUrl) return respond(503, { error: "shop_photo_url_unavailable" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  let classifierResponse: Response;
  try {
    classifierResponse = await fetch(CLASSIFIER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ storage_path: storagePath }),
    });
  } catch (_) {
    return respond(503, { error: "automatic_photo_check_unavailable", message: "Automatic photo checking is temporarily unavailable. Please try again." });
  } finally {
    clearTimeout(timeout);
  }

  const classification = await classifierResponse.json().catch(() => null);
  if (!classifierResponse.ok || classification?.success !== true ||
      !["approved", "rejected"].includes(String(classification.status))) {
    return respond(503, {
      error: "automatic_photo_check_unavailable",
      message: "Sellbook could not finish checking this photo. Your shop has not been connected. Please try again.",
    });
  }

  const status = String(classification.status);
  const reason = status === "approved"
    ? "AI image review accepted a physical shop-front photograph."
    : "AI image review did not identify a clear physical shop-front photograph.";
  const { data: verifiedAt, error: recordError } = await admin.rpc(
    "record_buybook_shop_front_verification",
    {
      p_user_id: user.id,
      p_storage_path: storagePath,
      p_status: status,
      p_reason: reason,
      p_model: MODEL,
    },
  );

  if (recordError) return respond(503, { error: "verification_record_failed" });

  return respond(200, {
    status,
    verified_at: verifiedAt || null,
    message: status === "approved"
      ? "Shop-front photo checked successfully."
      : "This photo does not clearly show the outside front of a shop. Please take a clear photo of your shop entrance.",
  });
});
