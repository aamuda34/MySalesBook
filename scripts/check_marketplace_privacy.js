'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const locationSharing = fs.readFileSync('location-sharing.js', 'utf8');
const abuseLimits = fs.readFileSync(
  'supabase/migrations/20261113014000_marketplace_abuse_limits.sql',
  'utf8'
);
const identityHardening = fs.readFileSync(
  'supabase/migrations/20261113015000_document_marketplace_user_gate_and_require_admin_pin.sql',
  'utf8'
);
const migration = fs.readFileSync(
  'supabase/migrations/20261113012000_harden_marketplace_shop_location_read_access.sql',
  'utf8'
);
const lockdown = fs.readFileSync(
  'supabase/migrations/20261113013000_restrict_marketplace_shop_sensitive_column_reads.sql',
  'utf8'
);
const auditHardening = fs.readFileSync(
  'supabase/migrations/20261113090000_bind_shop_photo_approval_to_storage_object_and_fix_reservation_read_state.sql',
  'utf8'
);

assert.equal(
  (app.match(/rpc\('get_my_marketplace_shop'\)/g) || []).length,
  3,
  'Sellbook reads private shop settings only through the owner-scoped RPC.'
);
assert.ok(
  !/\.from\(['"]marketplace_shops['"]\)\s*\.select\(/.test(app),
  'Sellbook must not directly SELECT private marketplace shop columns.'
);
assert.ok(
  app.includes("const {data:existingShop,error:existingShopError}=await supabaseClient.rpc('get_my_marketplace_shop')") &&
  app.includes(".from('marketplace_shops').update(shop).eq('owner_id',user.id)") &&
  app.includes(".from('marketplace_shops').insert(shop)") &&
  !/\.from\(['"]marketplace_shops['"]\)\.upsert\(/.test(app),
  'Seller shop setup must use the owner-scoped read RPC plus separate INSERT/UPDATE operations; ON CONFLICT upsert requires a broad SELECT grant and breaks private-column lockdown.'
);
assert.ok(
  !/\.from\(['"]marketplace_shops['"]\)\s*\.select\(/.test(locationSharing),
  'Live-location seller setup must not directly SELECT private shop columns.'
);
assert.ok(
  /client\.rpc\(["']get_my_marketplace_shop["']\)/.test(locationSharing),
  'Live-location seller setup must use the owner-scoped shop RPC.'
);
assert.ok(
  migration.includes('REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER') &&
  migration.includes('ON ALL TABLES IN SCHEMA public'),
  'Browser roles must not retain table-wide destructive/DDL-adjacent privileges.'
);
assert.ok(
  migration.includes('ALTER DEFAULT PRIVILEGES FOR ROLE postgres') &&
  !migration.includes('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin'),
  'Least-privilege table defaults must cover both project table-owner roles.'
);
assert.ok(
  lockdown.includes('REVOKE SELECT ON TABLE public.marketplace_shops FROM anon, authenticated'),
  'The staged final lockdown must remove direct browser SELECT on the private shop table.'
);
assert.ok(
  lockdown.includes('GRANT SELECT (') &&
  lockdown.includes('shop_front_image_url') &&
  lockdown.includes('is_connected') &&
  lockdown.includes('is_active'),
  'Only the intended catalogue-safe columns may remain directly readable after client rollout.'
);
assert.ok(
  migration.includes('WITH (security_invoker = true, security_barrier = true)') &&
  migration.includes('public.marketplace_shops_public'),
  'Public catalogue reads must use a narrow RLS-aware view.'
);
assert.ok(
  migration.includes('CREATE OR REPLACE FUNCTION public.get_my_marketplace_shop()') &&
  migration.includes('WHERE s.owner_id = v_user_id') &&
  migration.includes('GRANT EXECUTE ON FUNCTION public.get_my_marketplace_shop() TO authenticated'),
  'Seller-only shop settings must be read through an owner-scoped RPC.'
);
assert.ok(
  migration.includes('CREATE OR REPLACE FUNCTION public.get_marketplace_shop_route_target(p_owner_id uuid)') &&
  migration.includes('v_request_count > 40') &&
  migration.includes('GRANT EXECUTE ON FUNCTION public.get_marketplace_shop_route_target(uuid) TO authenticated'),
  'Exact shop pins must require an authenticated Buybook session and a per-user route-target limit.'
);
assert.ok(
  migration.includes('REFERENCES auth.users(id) ON DELETE CASCADE') &&
  migration.includes('ENABLE ROW LEVEL SECURITY') &&
  migration.includes('REVOKE ALL ON TABLE private.marketplace_route_target_limits'),
  'Route-target rate-limit state must remain private and be deleted with its user.'
);
assert.ok(
  migration.includes("ALTER FUNCTION public.create_marketplace_reservation_v2(uuid, integer, text, uuid)\n  SET search_path = '';"),
  'Reservation RPC must use an empty search path.'
);

assert.ok(
  /if\s*\(buybookShopFrontImageFile\)\s*\{[\s\S]*?functions\.invoke\(['"]verify-buybook-shop-front['"]/.test(app),
  'Only a newly uploaded shop-front photo should trigger another AI verification request.'
);
assert.ok(
  app.includes("else if(!previousShopFrontPath||shopFrontPath!==previousShopFrontPath)"),
  'A saved shop-front photo may be reused only when it is the same previously approved path.'
);
console.log('PASS: marketplace location privacy, narrow public shop fields, owner-only shop settings and browser-role privilege hardening.');

assert.ok(
  abuseLimits.includes("SECURITY DEFINER") &&
  abuseLimits.includes("marketplace-reservation-buyer:") &&
  abuseLimits.includes("marketplace-reservation-shop:") &&
  abuseLimits.includes("v_buyer_pending >= 5") &&
  abuseLimits.includes("v_shop_pending >= 3"),
  'Reservations must be serialized and capped at five pending per buyer and three per shop.'
);
assert.ok(
  abuseLimits.includes("marketplace_messages_insert_rate_limit") &&
  abuseLimits.includes("marketplace_store_subscriptions_insert_rate_limit") &&
  abuseLimits.includes("v_limit := 30") &&
  abuseLimits.includes("v_limit := 20"),
  'Message sending and shop follows must have database-enforced hourly rate limits.'
);
assert.ok(
  abuseLimits.includes("private.marketplace_action_rate_limits") &&
  abuseLimits.includes("ENABLE ROW LEVEL SECURITY") &&
  abuseLimits.includes("REVOKE ALL ON TABLE private.marketplace_action_rate_limits"),
  'Rate-limit counters must remain private and not be readable or editable by clients.'
);
assert.ok(
  identityHardening.includes("CREATE OR REPLACE FUNCTION public.is_marketplace_registered_user()") &&
  identityHardening.includes("coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'"),
  'The guest-versus-registered-user gate must be committed explicitly in migrations.'
);
assert.ok(
  identityHardening.includes("FROM private.sellbook_admins AS a") &&
  identityHardening.includes("FROM private.user_app_pins AS p") &&
  identityHardening.includes("RETURN false"),
  'Administrator accounts without a registered PIN must fail the privileged PIN gate.'
);

assert.ok(
  auditHardening.includes('storage_object_id') &&
  auditHardening.includes('v_current_object_id IS DISTINCT FROM v_verified_object_id'),
  'An approved shop-front must remain bound to the same Storage object.'
);
assert.ok(
  auditHardening.includes('consume_buybook_shop_front_check') &&
  auditHardening.includes('v_attempt_count <= 8'),
  'Shop-front AI verification must have a server-enforced daily per-user limit.'
);
assert.ok(
  auditHardening.includes('DELETE FROM public.app_notifications') &&
  !auditHardening.includes('ON CONFLICT (reservation_id, kind) DO UPDATE'),
  'Replacing a reservation notification must create a fresh unread event.'
);


const shopFrontVerification = fs.readFileSync(
  "supabase/functions/verify-buybook-shop-front/index.ts",
  "utf8"
);
assert.ok(
  shopFrontVerification.includes("await userClient.auth.getUser(token)"),
  "Seller shop-front verification must validate the caller with Supabase Auth before using service-role access."
);
assert.ok(
  shopFrontVerification.includes('keyFromEnv("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY")'),
  "Shop-front verification must use a publishable key to validate the signed-in session."
);
assert.ok(
  shopFrontVerification.includes("user.is_anonymous === true") &&
  !shopFrontVerification.includes("function subject("),
  "Shop-front verification must reject anonymous and unverified-token identities rather than trusting a decoded JWT subject."
);
assert.ok(
  shopFrontVerification.includes("segments.every((segment) => segment.length > 0 && segment !== \".\" && segment !== \"..\")") &&
  shopFrontVerification.includes('path.includes("\\\\")'),
  "Shop-front verification must reject empty, traversal and backslash path segments."
);
console.log("Shop-front verification authentication and storage-path checks passed.");
