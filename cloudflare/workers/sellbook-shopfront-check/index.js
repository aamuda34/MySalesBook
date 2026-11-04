const SUPABASE_URL = "https://ueyqrbyqicfpvnznnyxj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KSpcT5R68rHAyCdvEpdT9g_CTrtP-s9";
const BUCKET = "marketplace-shop-fronts";
const APP_ORIGIN = "https://my-sales-book.vercel.app";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
}

function isImageSignature(bytes, type) {
  if (type === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === "image/webp") return bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json(200, { ok: true });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

    const origin = request.headers.get("Origin");
    if (origin && origin !== APP_ORIGIN) return json(403, { error: "origin_not_allowed" });

    const authorization = request.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+/i.test(authorization)) return json(401, { error: "authentication_required" });

    let userResponse;
    try {
      userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
    } catch (_) {
      return json(503, { error: "account_verification_unavailable" });
    }
    if (!userResponse.ok) return json(401, { error: "invalid_session" });
    const user = await userResponse.json().catch(() => null);
    if (!user?.id) return json(401, { error: "invalid_session" });

    let body;
    try { body = await request.json(); } catch (_) { return json(400, { error: "invalid_json" }); }
    const path = String(body?.storage_path || "");
    if (!path || path.length > 512 || path.startsWith("/") || path.includes("..") ||
        path.includes("\\") || path.split("/").length < 2 || path.split("/")[0] !== user.id) {
      return json(403, { error: "invalid_shop_photo_path" });
    }

    const safePath = path.split("/").map(encodeURIComponent).join("/");
    const imageUrl = SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + safePath;
    let photo;
    try {
      photo = await fetch(imageUrl, { headers: { Accept: "image/jpeg,image/png,image/webp" }, redirect: "error" });
    } catch (_) {
      return json(422, { error: "shop_photo_unavailable" });
    }
    if (!photo.ok) return json(422, { error: "shop_photo_unavailable" });

    const contentType = (photo.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    const contentLength = Number(photo.headers.get("Content-Length") || 0);
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType) ||
        (contentLength && contentLength > MAX_IMAGE_BYTES)) {
      return json(422, { error: "unsupported_shop_photo" });
    }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !isImageSignature(bytes, contentType)) {
      return json(422, { error: "invalid_shop_photo_file" });
    }

    try {
      const model = await env.AI.run("@cf/moondream/moondream3.1-9B-A2B", {
        task: "query",
        image: imageUrl,
        reasoning: false,
        max_tokens: 48,
        temperature: 0,
        question: "Classify this image for a local business marketplace. A PASS is allowed only when the main subject is clearly a real photograph of the OUTSIDE FRONT / storefront / entrance of a physical shop, kiosk, stall or market shop, with enough of the physical shop structure visible to recognise it. Nigerian informal shops and market stalls count. REJECT product close-ups, individual goods, indoor shelves or stock, logos, posters, screenshots, drawings, generated illustrations, selfies, people, houses without visible business frontage, streets without a visible shop, and anything unclear. Be strict. Reply with exactly one word: PASS or REJECT."
      });
      const answer = String(model?.answer || "").trim().toUpperCase();
      const accepted = answer === "PASS";
      return json(200, {
        success: true,
        status: accepted ? "approved" : "rejected",
        message: accepted
          ? "Your shop-front photo passed the automatic check."
          : "This photo does not clearly show the outside front of a shop. Please take a clearer photo of your shop entrance.",
        decision: accepted ? "PASS" : "REJECT"
      });
    } catch (error) {
      return json(503, { error: "photo_check_unavailable", message: "Automatic photo checking is temporarily unavailable. Please try again." });
    }
  }
};