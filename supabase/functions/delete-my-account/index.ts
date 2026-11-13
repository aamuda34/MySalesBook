import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKETS = [
  "product-images",
  "marketplace-product-images",
  "marketplace-shop-fronts",
  "buybook-message-attachments",
] as const;
const ALLOWED_ORIGINS = new Set([
  "https://my-sales-book.vercel.app",
  "https://sellbook-backup.pages.dev",
  "https://my-sales-book.pages.dev",
]);
const MAX_OBJECTS = 20000;
const MAX_FOLDERS = 5000;

function json(status: number, body: Record<string, unknown>, origin: string | null) {
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

function keyFromEnv(jsonName: string, legacyName: string): string | null {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string") return parsed.default;
    } catch (_) { /* legacy environment variable fallback */ }
  }
  return Deno.env.get(legacyName) || null;
}

function validRelativePath(path: string): boolean {
  return !!path && path.length <= 1024 && !path.startsWith("/") &&
    !path.includes("\\") && !path.split("/").some((part) => !part || part === "." || part === "..");
}

async function listFilesRecursively(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  root: string,
): Promise<string[]> {
  const folders = [root];
  const files = new Set<string>();
  let folderIndex = 0;
  while (folderIndex < folders.length) {
    const folder = folders[folderIndex++];
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error("Could not list stored files in " + bucket + ".");
      const entries = data || [];
      for (const entry of entries) {
        const name = String(entry?.name || "");
        if (!name || name.includes("/") || name === "." || name === "..") continue;
        const path = folder + "/" + name;
        if (entry.id) {
          if (validRelativePath(path)) files.add(path);
          if (files.size > MAX_OBJECTS) throw new Error("This account has too many stored files for a safe automatic deletion. Contact Sellbook Support.");
        } else {
          folders.push(path);
          if (folders.length > MAX_FOLDERS) throw new Error("This account has too many stored folders for a safe automatic deletion. Contact Sellbook Support.");
        }
      }
      if (entries.length < 1000) break;
      offset += entries.length;
      if (page === 99) throw new Error("A storage folder has too many entries for safe automatic deletion. Contact Sellbook Support.");
    }
  }
  return Array.from(files);
}

async function collectConversationAttachments(
  admin: ReturnType<typeof createClient>,
  userId: string,
  ownedFolderPaths: string[] = [],
): Promise<string[]> {
  const candidates = new Set<string>(ownedFolderPaths.filter(validRelativePath));
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await admin.from("marketplace_messages")
      .select("attachment_path,owner_id,buyer_id")
      .or("owner_id.eq." + userId + ",buyer_id.eq." + userId)
      .not("attachment_path", "is", null)
      .range(offset, offset + 499);
    if (error) throw new Error("Could not verify message attachments before account deletion.");
    const rows = data || [];
    for (const row of rows) {
      const path = String(row?.attachment_path || "");
      if (validRelativePath(path)) candidates.add(path);
    }
    if (rows.length < 500) break;
    offset += rows.length;
    if (page === 99) throw new Error("This account has too many message attachments for safe automatic deletion. Contact Sellbook Support.");
  }

  const safeToRemove = new Set<string>();
  const paths = Array.from(candidates);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    const { data, error } = await admin.from("marketplace_messages")
      .select("attachment_path,owner_id,buyer_id")
      .in("attachment_path", batch);
    if (error) throw new Error("Could not check whether message attachments are shared by another account.");
    const stillReferencedByOthers = new Set(
      (data || [])
        .filter((row) => row.owner_id !== userId && row.buyer_id !== userId)
        .map((row) => String(row.attachment_path)),
    );
    for (const path of batch) {
      if (!stillReferencedByOthers.has(path)) safeToRemove.add(path);
    }
  }
  return Array.from(safeToRemove);
}

async function removeObjects(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  paths: string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 1000) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 1000));
    if (error) throw new Error("Could not finish removing stored files in " + bucket + ". Retry account deletion or contact Sellbook Support.");
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const respond = (status: number, body: Record<string, unknown>) => json(status, body, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond(403, { message: "This app origin is not allowed." });
  if (request.method === "OPTIONS") return respond(200, { ok: true });
  if (request.method !== "POST") return respond(405, { message: "Method not allowed." });

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond(401, { message: "Sign in again before deleting your account." });

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = keyFromEnv("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const serviceRoleKey = keyFromEnv("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !serviceRoleKey) {
    console.error("account_delete_configuration_missing", { url: !!url, publishableKey: !!publishableKey, serviceRoleKey: !!serviceRoleKey });
    return respond(503, { message: "Account deletion is temporarily unavailable. Contact Sellbook Support." });
  }

  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (authError || !user) return respond(401, { message: "Your sign-in session has expired. Sign in again." });

  // Check the one-shot PIN authorization before removing any files. This
  // RPC is read-only; delete_my_account consumes the grant after cleanup.
  const { data: deletionAuthorized, error: authorizationError } = await userClient.rpc("assert_account_deletion_authorized");
  if (authorizationError || deletionAuthorized !== true) {
    return respond(403, { message: "Your account-deletion PIN confirmation has expired. Enter your six-digit PIN again." });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const byBucket = new Map<string, Set<string>>();
    for (const bucket of BUCKETS) byBucket.set(bucket, new Set());

    // Remove every owned file except message attachments, which need an
    // additional reference check before they can be deleted.
    for (const bucket of BUCKETS) {
      if (bucket === "buybook-message-attachments") continue;
      const files = await listFilesRecursively(admin, bucket, user.id);
      for (const path of files) byBucket.get(bucket)!.add(path);
    }

    // Include both files stored in this user's message folder and files used
    // in conversations involving this account. A shared attachment is kept
    // even when its object happens to be inside the deleting user's folder.
    const ownMessageFiles = await listFilesRecursively(admin, "buybook-message-attachments", user.id);
    const conversationAttachments = await collectConversationAttachments(admin, user.id, ownMessageFiles);
    for (const path of conversationAttachments) byBucket.get("buybook-message-attachments")!.add(path);

    for (const bucket of BUCKETS) {
      await removeObjects(admin, bucket, Array.from(byBucket.get(bucket)!));
    }

    // The user-facing PIN confirmation has already created a one-shot,
    // session-bound grant. This existing RPC consumes it before deleting auth.users.
    const { error: deleteError } = await userClient.rpc("delete_my_account");
    if (deleteError) {
      console.error("account_delete_database_failed", { userId: user.id, message: deleteError.message });
      return respond(409, { message: deleteError.message || "Your PIN confirmation expired. Re-enter your PIN and try again." });
    }

    return respond(200, { success: true });
  } catch (error) {
    console.error("account_delete_storage_cleanup_failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return respond(500, {
      success: false,
      message: error instanceof Error ? error.message : "Sellbook could not finish cleaning up stored files.",
    });
  }
});
