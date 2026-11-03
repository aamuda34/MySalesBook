'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

const accountStart = html.indexOf('<section class="card auth-card" id="accountCard"');
const accountEnd = html.indexOf('</section>', accountStart);
assert.ok(accountStart >= 0 && accountEnd > accountStart, 'Branded account card is missing.');
const account = html.slice(accountStart, accountEnd);

for (const id of [
  'authCardTitle','accountStatus','googleSignIn','openPasswordRecovery',
  'accountRecoveryRequestForm','recoveryEmail','recoveryEmailSubmit',
  'cancelPasswordRecovery','recoveryPasswordForm','recoveryPassword',
  'recoveryPasswordHint','accountMessage'
]) {
  assert.ok(account.includes('id="' + id + '"'), 'Missing sign-in/recovery element: ' + id);
}

assert.ok(account.includes('src="./icons/icon.svg"'), 'Sign-in must use the existing Sellbook brand asset.');
assert.ok(account.includes('Continue with Google'), 'Google sign-in must remain available.');
assert.ok(account.includes('display:none!important'), 'Email/password sign-in must remain disabled in this release.');
assert.ok(account.includes('autocomplete="new-password"'), 'New password field must use new-password autocomplete.');
assert.ok(account.includes('aria-live="polite"'), 'Account status messages must be accessible.');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicates, [], 'The updated HTML must not add duplicate IDs.');

assert.ok(app.includes("openPasswordRecoveryButton?.addEventListener('click'"), 'Forgot-password entry point is not wired.');
assert.ok(app.includes("accountRecoveryRequestForm?.addEventListener('submit'"), 'Recovery request form is not wired.');
assert.ok(app.includes("supabaseClient.auth.resetPasswordForEmail(email"), 'The existing Supabase recovery endpoint must be used.');
assert.ok(app.includes("supabaseClient.auth.updateUser({ password })"), 'The secure password-update flow must remain intact.');
assert.ok(app.includes("event === 'PASSWORD_RECOVERY'"), 'Supabase recovery callback handling must remain intact.');
assert.ok(app.includes("supabaseClient.auth.signInWithOAuth({"), 'Existing Google OAuth must remain intact.');
assert.ok(app.includes("classList.add('hidden')"), 'Recovery form state must be hidden until explicitly opened.');

const signInLayer = css.slice(css.lastIndexOf('/* Professional sign-in and account-recovery experience.'));
for (const token of [
  '.auth-brand-lockup',
  '#accountCard .auth-google-button',
  '#accountCard .auth-recovery-request',
  '#accountCard .auth-new-password-form',
  '#accountCard:has(#recoveryPasswordForm:not(.hidden))',
  'prefers-reduced-motion',
  '@media(max-width:380px)',
  'body.dark'
]) {
  assert.ok(signInLayer.includes(token), 'Missing professional auth design rule: ' + token);
}

const cacheVersion = Number((sw.match(/sellbook-shell-v(\d+)/) || [])[1] || 0);
assert.ok(cacheVersion >= 83, 'Service worker cache must be refreshed for the auth redesign.');

let braces = 0, parens = 0, quote = null, escaped = false;
const rules = signInLayer.replace(/\/\*[\s\S]*?\*\//g, '');
for (const char of rules) {
  if (quote) {
    if (escaped) escaped = false;
    else if (char.charCodeAt(0) === 92) escaped = true;
    else if (char === quote) quote = null;
    continue;
  }
  if (char === '"' || char === "'") { quote = char; continue; }
  if (char === '{') braces++;
  else if (char === '}') braces--;
  else if (char === '(') parens++;
  else if (char === ')') parens--;
  assert.ok(braces >= 0 && parens >= 0, 'Auth stylesheet contains an unmatched closing delimiter.');
}
assert.equal(quote, null, 'Auth stylesheet contains an unterminated string.');
assert.equal(braces, 0, 'Auth stylesheet braces must be balanced.');
assert.equal(parens, 0, 'Auth stylesheet parentheses must be balanced.');

console.log('PASS: branded sign-in, reachable password-reset request, recovery callback/update, retained Google OAuth, disabled email sign-in, unique DOM IDs, accessible status messaging, responsive styles and cache refresh.');
