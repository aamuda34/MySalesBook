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
  'authCardTitle','accountStatus','authSignInChoices','googleSignIn','openEmailSignIn',
  'emailAuthPanel','backToAuthOptions','emailAuthForm','authEmail','authPassword',
  'authPasswordConfirm','toggleEmailAuth','resendConfirmationBtn','emailPasswordRecovery',
  'openPasswordRecovery','accountRecoveryRequestForm','recoveryEmail','recoveryEmailSubmit',
  'cancelPasswordRecovery','recoveryPasswordForm','recoveryPassword','recoveryPasswordHint','accountMessage'
]) {
  assert.ok(account.includes('id="' + id + '"'), 'Missing sign-in/recovery element: ' + id);
}

assert.ok(account.includes('src="./icons/icon.svg"'), 'Sign-in must use the existing Sellbook brand asset.');
assert.ok(account.includes('Continue with Google'), 'Google sign-in must remain available.');
assert.ok(account.includes('id="openEmailSignIn"'), 'Email sign-in must be reachable from the sign-in options.');
assert.ok(!account.includes('style="display:none!important"'), 'Email authentication must not be disabled inline.');
assert.ok(account.includes('autocomplete="email"'), 'Email field must use email autocomplete.');
assert.ok(account.includes('autocomplete="current-password"'), 'Sign-in password must use current-password autocomplete.');
assert.ok(account.includes('autocomplete="new-password"'), 'New password fields must use new-password autocomplete.');
const authPasswordInput = account.match(/<input id="authPassword"[^>]*>/)?.[0] || '';
assert.ok(authPasswordInput && !/\bminlength=/.test(authPasswordInput), 'Existing email users must not be locked out by signup-only length rules.');
const passwordPolicyStart = app.indexOf('function passwordPolicyError(password) {');
const passwordPolicyEnd = passwordPolicyStart >= 0 ? app.indexOf('\n}', passwordPolicyStart) : -1;
assert.ok(passwordPolicyStart >= 0 && passwordPolicyEnd > passwordPolicyStart, 'Password strength policy function is missing.');
const passwordPolicySource = app.slice(passwordPolicyStart, passwordPolicyEnd + 2);
const passwordPolicy = new Function(passwordPolicySource + '\nreturn passwordPolicyError;')();
assert.equal(passwordPolicy('GoodPass9!'), '', 'A password meeting the full policy must be accepted.');
assert.ok(passwordPolicy('short1!'), 'Short passwords must be rejected.');
assert.ok(passwordPolicy('lowercase9!'), 'Passwords without uppercase letters must be rejected.');
assert.ok(passwordPolicy('UPPERCASE9!'), 'Passwords without lowercase letters must be rejected.');
assert.ok(passwordPolicy('GoodPass!!'), 'Passwords without numbers must be rejected.');
assert.ok(passwordPolicy('GoodPass99'), 'Passwords without symbols must be rejected.');
assert.ok(passwordPolicy('GoodPass9 '), 'Whitespace alone must not count as a symbol.');
assert.ok(html.includes('<section id="authPage" class="auth-page"'), 'Authentication must be a standalone full-page section.');
assert.ok(account.includes('aria-live="polite"'), 'Account status messages must be accessible.');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicates, [], 'The updated HTML must not add duplicate IDs.');

assert.ok(app.includes("document.getElementById('openEmailSignIn').addEventListener('click'"), 'Email sign-in entry point is not wired.');
assert.ok(!app.includes("getElementById('resetPasswordBtn')"), 'Removed password-reset button must not leave a dead event listener.');
assert.ok(app.includes("supabaseClient.auth.signInWithPassword({email,password})") || app.includes("supabaseClient.auth.signInWithPassword({ email, password })"), 'Email/password sign-in must use Supabase Auth.');
assert.ok(app.includes('supabaseClient.auth.signUp({email,password'), 'Email account creation must use Supabase Auth.');
assert.ok(app.includes("supabaseClient.auth.resend({type:'signup'"), 'Signup confirmation email must be resendable.');
assert.ok(app.includes('function passwordPolicyError(password)'), 'New passwords must satisfy the strength policy.');
assert.ok(app.includes("setAuthScreen('new-password')"), 'Recovery callback must open its standalone password form.');
assert.ok(app.includes('if (recoveryMode) {\n        document.getElementById(\'appWorkspace\').classList.add(\'hidden\');'), 'Password recovery must run before normal PIN-gated data loading.');
assert.ok(app.includes('if (recoveryMode) {\n        hideSecurityPinGate();'), 'Password recovery callback must also win over a PIN status request already in flight.');
assert.ok(app.includes("recoveryMode = false;\n    setAuthScreen('choices');"), 'Completed password recovery must not leave a hidden form as the active auth screen.');
assert.ok(app.includes('ensureSellbookPinAccess()'), 'Email sign-in must retain the server-verified PIN gate.');
assert.ok(!app.includes('Sign in again with Google to reset your PIN.'), 'PIN recovery must offer a sign-in method-neutral instruction.');
assert.ok(!app.includes('Sign in with Google before saving cloud records.'), 'Cloud access errors must not exclude email-authenticated users.');
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
  '#accountCard:has(#emailAuthPanel:not(.hidden))>#authCardTitle',
  '#accountCard:has(#recoveryPasswordForm:not(.hidden))',
  'prefers-reduced-motion',
  '@media(max-width:380px)',
  'body.dark'
]) {
  assert.ok(signInLayer.includes(token), 'Missing professional auth design rule: ' + token);
}

const cacheVersion = Number((sw.match(/sellbook-shell-v(\d+)/) || [])[1] || 0);
assert.ok(cacheVersion >= 84, 'Service worker cache must be refreshed for the email-auth release.');

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

console.log('PASS: standalone authentication page, email/password sign-in and signup, confirmation resend, password-reset request, recovery callback/update, retained Google OAuth, enabled email/password sign-in, unique DOM IDs, accessible status messaging, responsive styles and cache refresh.');
