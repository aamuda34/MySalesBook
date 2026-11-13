'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20261113012000_harden_marketplace_shop_location_read_access.sql',
  'utf8'
);

assert.equal(
  (app.match(/rpc\('get_my_marketplace_shop'\)/g) || []).length,
  2,
  'Sellbook reads private shop settings only through the owner-scoped RPC.'
);
assert.ok(
  !/\.from\(['"]marketplace_shops['"]\)\s*\.select\(/.test(app),
  'Sellbook must not directly SELECT private marketplace shop columns.'
);
assert.ok(
  /\.from\(['"]marketplace_shops['"]\)\.upsert\(/.test(app),
  'Seller shop setup must continue to save the seller-owned shop record.'
);
assert.ok(
  migration.includes('REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER') &&
  migration.includes('ON ALL TABLES IN SCHEMA public'),
  'Browser roles must not retain table-wide destructive/DDL-adjacent privileges.'
);
assert.ok(
  migration.includes('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin') &&
  migration.includes('ALTER DEFAULT PRIVILEGES FOR ROLE postgres'),
  'Least-privilege table defaults must cover both project table-owner roles.'
);
assert.ok(
  migration.includes('REVOKE SELECT ON TABLE public.marketplace_shops FROM anon, authenticated'),
  'Direct browser SELECT on the private shop table must be removed.'
);
assert.ok(
  migration.includes('GRANT SELECT (') &&
  migration.includes('shop_front_image_url') &&
  migration.includes('is_connected') &&
  migration.includes('is_active'),
  'Only the intended catalogue-safe columns may remain directly readable.'
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

console.log('PASS: marketplace location privacy, narrow public shop fields, owner-only shop settings and browser-role privilege hardening.');
