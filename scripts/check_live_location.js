"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");

const seller = fs.readFileSync("location-sharing.js", "utf8");
const auth = fs.readFileSync("app.js", "utf8");
const disconnectMigration = fs.readFileSync(
  "supabase/migrations/20261106091212_stop_location_sessions_when_shop_disconnects.sql",
  "utf8"
);
const guestActivityMigration = fs.readFileSync(
  "supabase/migrations/20261106092540_touch_marketplace_guest_accounts_on_activity.sql",
  "utf8"
);


function check(label, condition) {
  assert.ok(condition, label);
  process.stdout.write("PASS " + label + "\n");
}

check(
  "seller location queries are restricted to the signed-in shop owner",
  seller.includes('.eq("owner_id", requestedUserId)')
);
check(
  "late location responses from a previous seller account are discarded",
  seller.includes("requestEpoch !== sellerSessionEpoch || requestedUserId !== userId")
);
check(
  "future-dated or old GPS timestamps are not treated as live",
  seller.includes("age >= -30000 && age <= 90000")
);
check(
  "stale markers are recalculated when the location refresh request fails",
  /renderRows\(\);\s*cardMessage\("Live customer locations are temporarily unavailable/s.test(seller)
);
check(
  "only fresh buyer positions are rendered as live map markers",
  seller.includes("const freshRows = validRows.filter((row) => isFreshLocationTimestamp(row.updated_at));")
);
check(
  "buyer identity is minimised in the seller location list",
  seller.includes('row.buyer_type === "guest" ? "Guest buyer" : "Buybook customer"')
);

check(
  "Turnstile tokens are requested through one fresh-token helper",
  auth.includes("async function requestSellbookAuthCaptcha(") &&
    auth.includes("window.turnstile.remove(widgetId)")
);
check(
  "email sign-up submits a CAPTCHA token",
  /auth\.signUp\([\s\S]{0,500}captchaToken/.test(auth)
);
check(
  "email/password sign-in submits a CAPTCHA token",
  /auth\.signInWithPassword\([\s\S]{0,300}captchaToken/.test(auth)
);
check(
  "confirmation resend submits a CAPTCHA token",
  /auth\.resend\([\s\S]{0,500}captchaToken/.test(auth)
);
check(
  "password recovery submits a CAPTCHA token",
  /auth\.resetPasswordForEmail\([\s\S]{0,500}captchaToken/.test(auth)
);
check(
  "account verification-code requests submit a CAPTCHA token",
  /auth\.signInWithOtp\([\s\S]{0,300}captchaToken/.test(auth)
);

check(
  "shop-disconnect trigger scrubs coordinates and stops active sessions",
  disconnectMigration.includes("status = 'stopped'") &&
    disconnectMigration.includes("latitude = 0") &&
    disconnectMigration.includes("longitude = 0")
);
check(
  "shop-disconnect trigger function cannot be called by browser roles",
  /revoke all on function public\.stop_marketplace_location_sessions_when_shop_disconnects\(\)[\s\S]{0,200}from public, anon, authenticated/i.test(disconnectMigration)
);

process.stdout.write("All live-location safety checks passed.\n");
