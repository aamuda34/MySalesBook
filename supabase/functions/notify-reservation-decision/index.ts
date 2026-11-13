import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://my-sales-book.vercel.app",
  "https://sellbook-backup.pages.dev",
]);

function response(body: Record<string, unknown>, status: number, origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function getKey(jsonName: string, legacyName: string): string | null {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      if (typeof keys?.default === "string") return keys.default;
    } catch (_) { /* use the legacy key below */ }
  }
  return Deno.env.get(legacyName) || null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const out = (status: number, body: Record<string, unknown>) => response(body, status, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return out(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: {
      "Vary": "Origin",
      "Access-Control-Allow-Origin": origin || "https://my-sales-book.vercel.app",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
  if (req.method !== "POST") return out(405, { error: "method_not_allowed" });

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return out(401, { error: "authentication_required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = getKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return out(503, { error: "notification_service_not_configured" });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return out(401, { error: "invalid_session" });

  let payload: { reservation_id?: string | number; decision?: string };
  try { payload = await req.json(); } catch (_) { return out(400, { error: "invalid_json" }); }
  const reservationId = payload.reservation_id;
  const decision = String(payload.decision || "");
  if ((typeof reservationId !== "string" && typeof reservationId !== "number") ||
      !["approved", "rejected"].includes(decision)) {
    return out(400, { error: "reservation_and_valid_decision_required" });
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: reservation, error: reservationError } = await admin
    .from("marketplace_reservations")
    .select("id,owner_id,status")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) return out(503, { error: "reservation_status_unavailable" });
  if (!reservation || reservation.owner_id !== userData.user.id) {
    return out(403, { error: "reservation_not_owned_by_seller" });
  }
  if (reservation.status !== decision) {
    return out(409, { error: "reservation_status_does_not_match_decision" });
  }

  // The database status-change trigger creates the buyer's notification in the
  // same transaction as the decision. Writing a second row here can collide
  // with the seller's original "reservation" notification and misreport success.
  return out(200, {
    success: true,
    reservation_id: reservation.id,
    decision,
    notification_source: "reservation_status_trigger",
  });
});
