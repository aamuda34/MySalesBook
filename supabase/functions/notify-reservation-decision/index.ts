import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign-in required" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  let payload: { reservation_id?: string | number; decision?: string };
  try { payload = await req.json(); } catch { return json({ error: "Invalid request body" }, 400); }

  const reservationId = payload.reservation_id;
  const decision = payload.decision;
  if ((typeof reservationId !== "string" && typeof reservationId !== "number") ||
      !["approved", "rejected"].includes(String(decision))) {
    return json({ error: "Reservation and valid decision are required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: reservation, error: reservationError } = await admin
    .from("marketplace_reservations")
    .select("id, owner_id, buyer_id, status")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError) return json({ error: "Could not verify reservation" }, 500);
  if (!reservation || reservation.owner_id !== userData.user.id) {
    return json({ error: "Reservation not found or not owned by this seller" }, 403);
  }
  if (reservation.status !== decision) {
    return json({ error: "Reservation status does not match the requested decision" }, 409);
  }

  const title = decision === "approved" ? "Reservation approved" : "Reservation declined";
  const body = decision === "approved"
    ? "The seller has approved your reservation. Open Buybook to view the reservation details."
    : "The seller has declined your reservation. Open Buybook to view the reservation details.";

  // A unique (reservation_id, kind) key makes retries safe if the response is lost.
  // ignoreDuplicates prevents duplicate buyer notifications on repeated invocations.
  const { error: notificationError } = await admin.from("app_notifications").upsert({
    created_by: userData.user.id,
    recipient_id: reservation.buyer_id,
    reservation_id: reservation.id,
    title,
    body,
    kind: "reservation",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }, { onConflict: "reservation_id,kind", ignoreDuplicates: true });

  if (notificationError) {
    return json({ error: "Decision saved, but buyer notification could not be created" }, 500);
  }
  return json({ success: true, reservation_id: reservation.id, decision });
});