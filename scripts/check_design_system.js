'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('styles.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

const marker = 'Sellbook design system: consistent typography, readable labels and spacing.';
const start = css.indexOf(marker);
assert.ok(start >= 0, 'The shared Sellbook design-system layer is missing.');
const nextLayer = css.indexOf('SELLBOOK APP-WIDE SCREEN LAYOUT', start);
const layer = css.slice(start, nextLayer > start ? nextLayer : undefined);

const required = [
  ['system font stack', '--sb-font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'],
  ['12px minimum supporting text token', '--sb-text-xs:12px'],
  ['13px secondary text token', '--sb-text-sm:13px'],
  ['14px base text token', '--sb-text-base:14px'],
  ['21px page-title token', '--sb-title:21px'],
  ['body line-height token', '--sb-line-body:1.45'],
  ['heading line-height token', '--sb-line-heading:1.25'],
  ['body font and line height', 'body{font-size:var(--sb-text-base);line-height:var(--sb-line-body)}'],
  ['consistent page titles', '.page-title{font-size:var(--sb-title)'],
  ['consistent secondary text', '.page-intro,.muted,.empty,.help-text,.hint,.subtext,.secondary-text{font-size:var(--sb-text-sm)'],
  ['consistent card padding and spacing', '.card{padding:16px;margin-bottom:12px;border-radius:14px}'],
  ['readable key dashboard figures', '.stat strong{font-size:21px;line-height:1.2}'],
  ['44px minimum standard form controls', 'input,select,textarea{font-family:inherit;line-height:1.35;min-height:44px}'],
  ['44px minimum primary and form action targets', 'button.primary,button.danger,form button:not([aria-label]){min-height:44px}'],
  ['small-phone layout adjustment', '@media(max-width:420px)'],
  ['tablet and desktop spacing adjustment', '@media(min-width:600px)'],
  ['business profile typography', '.business-profile-content .business-details-row>strong{font-size:14px;line-height:1.4}'],
  ['Messenger heading consistency', '#messenger .messenger-main-heading .page-title'],
  ['chart labels made more legible', '.chart-label,.chart-value{font-size:11px;line-height:1.25}']
];
for (const [label, token] of required) {
  assert.ok(layer.includes(token), 'Missing design-system rule: ' + label);
}

const cacheVersion = Number((sw.match(/const CACHE_NAME = 'sellbook-shell-v(\d+)';/) || [])[1] || 0);
assert.ok(cacheVersion >= 79, 'Offline shell cache must be refreshed for the new stylesheet.');

const designRules = layer.replace(/\/\*[\s\S]*?\*\//g, '');
let braces = 0;
let parens = 0;
let quote = null;
let escaped = false;
for (const char of designRules) {
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
  assert.ok(braces >= 0, 'Design-system CSS contains an unmatched closing brace.');
  assert.ok(parens >= 0, 'Design-system CSS contains an unmatched closing parenthesis.');
}
assert.equal(quote, null, 'Design-system CSS contains an unterminated string.');
assert.equal(braces, 0, 'Design-system CSS braces must be balanced.');
assert.equal(parens, 0, 'Design-system CSS parentheses must be balanced.');

assert.ok(!/\b(?:color|background|background-color)\s*:/.test(designRules),
  'Typography/spacing layer must not change the Sellbook colour palette.');
console.log('PASS: shared typography scale, page hierarchy, card/field spacing, mobile breakpoints, tap targets, dark/light palette preservation and CSS balance.');
