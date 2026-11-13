'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const required = [
  'index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest',
  'supabase-config.js', 'privacy.html', 'terms.html'
];
for (const path of required) {
  assert.ok(fs.existsSync(path), 'Required public release file is missing: ' + path);
  assert.ok(fs.statSync(path).size > 0, 'Required public release file is empty: ' + path);
}

const clientFiles = required
  .filter(path => !['privacy.html', 'terms.html'].includes(path))
  .map(read)
  .join('\n');

assert.doesNotMatch(
  clientFiles,
  /SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]+|service_role|postgres(?:ql)?:\/\//i,
  'A server-side secret or direct database connection string must never be shipped to the browser.'
);

const config = read('supabase-config.js');
const url = config.match(/url\s*:\s*['"]([^'"]+)['"]/i)?.[1] || '';
const key = config.match(/(?:publishableKey|anonKey)\s*:\s*['"]([^'"]+)['"]/i)?.[1] || '';
assert.ok(/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url), 'The browser must use the HTTPS Supabase project URL.');
assert.ok(key.startsWith('sb_publishable_') || key.startsWith('eyJ'), 'The browser must use a Supabase publishable/legacy anon key, never a secret key.');

const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.display, 'standalone', 'The PWA must retain its standalone display mode.');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.some(icon => icon.sizes === '192x192'), 'The PWA must declare its 192px install icon.');
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'), 'The PWA must declare its 512px install icon.');

const app = read('app.js');
const index = read('index.html');
assert.doesNotMatch(app, /recordSellbookVisit|rpc\(['"]record_sellbook_visit['"]/, 'The browser must not call the revoked public traffic RPC.');
assert.ok(index.includes('Historical visits recorded before public visit tracking was paused.'), 'Admin traffic must be labelled as historical while collection is disabled.');
assert.ok(index.includes('New visitor tracking is currently paused.'), 'Admin traffic must disclose that new visits are not being collected.');

const sw = read('sw.js');
assert.match(sw, /sellbook-shell-v\d+/i, 'The service worker cache must be versioned.');
for (const path of ['/rest/', '/auth/', '/storage/', '/functions/']) {
  assert.ok(sw.includes(path), 'The service worker must bypass Supabase requests for ' + path);
}
assert.match(sw, /supabase\.co/, 'The service worker must identify Supabase API traffic.');

const privacy = read('privacy.html');
const terms = read('terms.html');
for (const section of [
  'Information Sellbook handles', 'Why information is used', 'Where information is stored',
  'How long information is kept', 'Your privacy choices and rights',
  'automated image-classification', 'Cloudflare Workers AI', 'Nigeria Data Protection Commission'
]) {
  assert.ok(privacy.toLowerCase().includes(section.toLowerCase()), 'Privacy notice is missing required disclosure: ' + section);
}
for (const section of [
  'What Sellbook provides', 'Accounts and security', 'Your business records and backups',
  'Buybook listings, images and messages', 'Acceptable use', 'Account closure'
]) {
  assert.ok(terms.toLowerCase().includes(section.toLowerCase()), 'Terms are missing required section: ' + section);
}
assert.ok(privacy.includes('./terms.html') && terms.includes('./privacy.html'), 'The legal pages must link to one another.');

const deletionFunction = read('supabase/functions/delete-my-account/index.ts');
const deletionMigration = read('supabase/migrations/20261113110000_assert_account_deletion_authorized.sql');
assert.ok(app.includes("supabaseClient.functions.invoke('delete-my-account'"), 'Permanent account deletion must use server-side storage cleanup.');
for (const bucket of ['product-images', 'marketplace-product-images', 'marketplace-shop-fronts', 'buybook-message-attachments']) {
  assert.ok(deletionFunction.includes('"'+bucket+'"'), 'Account deletion must clean the '+bucket+' storage bucket.');
}
assert.ok(deletionFunction.includes('marketplace_messages') && deletionFunction.includes('attachment_path'), 'Account deletion must include message attachments.');
assert.ok(deletionFunction.includes('auth.getUser(token)') && deletionFunction.includes('rpc("delete_my_account")'), 'Server cleanup must validate the caller and preserve the PIN-gated database deletion RPC.');
assert.ok(deletionFunction.includes('rpc("assert_account_deletion_authorized")'), 'Server cleanup must verify the one-shot PIN authorization before deleting any stored files.');
assert.ok(
  deletionFunction.includes('if (bucket === "buybook-message-attachments") continue;') &&
  deletionFunction.includes('const ownMessageFiles = await listFilesRecursively(admin, "buybook-message-attachments", user.id);') &&
  deletionFunction.includes('collectConversationAttachments(admin, user.id, ownMessageFiles)'),
  'Message attachments in the deleting user folder must also pass the shared-reference check before removal.'
);
assert.ok(deletionMigration.includes('SECURITY DEFINER') && deletionMigration.includes('private.sellbook_security_action_grants') && deletionMigration.includes('GRANT EXECUTE ON FUNCTION public.assert_account_deletion_authorized() TO authenticated'), 'The account-deletion preflight RPC must check the current user and session without exposing private security state.');
const vercelConfig = JSON.parse(read('vercel.json'));
const globalHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)')?.headers || [];
const csp = globalHeaders.find((entry) => entry.key.toLowerCase() === 'content-security-policy')?.value || '';
assert.ok(csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"), 'Sellbook must ship a restrictive Content Security Policy.');
assert.ok(csp.includes("'unsafe-hashes'") && csp.includes("'sha256-qNoBcctpV+aevdy3eIADEw9KWfkwR94KbYVkayEeMR8='"), 'Sellbook CSP must hash-allow only the existing inline click handlers rather than enabling unsafe inline scripts.');
assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'Sellbook must not enable unrestricted inline JavaScript.');
const checklist = read('docs/public-launch-checklist.md');
assert.ok(checklist.includes("operator's legal identity"), 'The release checklist must keep the known legal-operator blocker visible.');
assert.ok(checklist.includes('With two accounts'), 'The release checklist must require cross-account isolation testing.');

console.log('Public release asset, client-secret, PWA, legal-disclosure and launch-gate checks passed.');
