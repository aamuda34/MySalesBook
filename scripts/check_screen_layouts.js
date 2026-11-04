'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

const marker = 'SELLBOOK APP-WIDE SCREEN LAYOUT';
const start = css.indexOf(marker);
assert.ok(start >= 0, 'The screen-by-screen layout layer is missing.');
const authLayerStart = css.indexOf('/* Professional sign-in and account-recovery experience.', start);
const layer = css.slice(start, authLayerStart > start ? authLayerStart : undefined);
const pageIds = [...html.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*class="[^"]*\bpage\b[^"]*"/g)]
  .map(match => match[1]);
const expectedPages = [
  'home','quick-guide','subscribers','reservations','products','product-details','sales',
  'sales-history','sale-details','expenses','me','notifications','more',
  'messenger','support','feedback','admin','reports','low-stock','stock',
  'stock-history','stock-history-detail','settings','about-sellbook',
  'business-details','settings-business','settings-sync','settings-preferences',
  'settings-buybook','settings-account','settings-legal'
];
for (const id of expectedPages) {
  assert.ok(pageIds.includes(id), 'Expected app screen is missing from index.html: ' + id);
}
assert.equal(new Set(pageIds).size, pageIds.length, 'Every app page must have a unique section id.');

const expectedSelectors = [
  '#home .home-sales-board',
  '#quick-guide .quick-guide-list',
  '#products .product-list-filters',
  '#product-details .product-details-photo',
  '#sales .today-sales-summary',
  '#sales-history .sales-history-filters',
  '#expenses .expense-period-card',
  '#reports .stats',
  '#stock .card',
  '#low-stock .card',
  '#stock-history .stock-history-tabs',
  '#subscribers #subscribersPageList',
  '#reservations #reservationsPageList',
  '#notifications .notification-category-pills',
  '#me.me-page',
  '#settings .settings-menu-list',
  '#settings-business .business-logo-editor',
  '#settings-sync .settings-group',
  '#settings-preferences .markup-options',
  '#settings-buybook .buybook-connection-bar',
  '#settings-account .settings-group',
  '#settings-legal .legal-tabs',
  '#business-details .business-profile-content',
  '#about-sellbook .card',
  '#messenger .messenger-list-card',
  '#support .support-page-heading',
  '#feedback #userFeedbackForm',
  '#more .menu-grid',
  '#admin .admin-panel-nav',
  '.products-page-header',
  '#sale-details .sale-details-content',
  '#stock-history-detail'
];
for (const selector of expectedSelectors) {
  assert.ok(layer.includes(selector), 'Missing screen layout rule: ' + selector);
}

const requiredLayoutRules = [
  ['mobile-first page width', '#appWorkspace>main{'],
  ['shared standalone page headers', '.products-page-header,'],
  ['consistent 40px back targets', 'width:40px;'],
  ['comfortable mobile card spacing', 'border-radius:16px;'],
  ['horizontal scroll for history tabs', 'overflow-x:auto;'],
  ['small-device breakpoint', '@media(max-width:380px)'],
  ['larger-device breakpoint', '@media(min-width:600px)'],
  ['dark-mode surface preservation', 'body.dark #appWorkspace .page .card']
];
for (const [label, token] of requiredLayoutRules) {
  assert.ok(layer.includes(token), 'Missing responsive layout safeguard: ' + label);
}

const cacheVersion = Number((sw.match(/const CACHE_NAME = 'sellbook-shell-v(\d+)';/) || [])[1] || 0);
assert.ok(cacheVersion >= 80, 'Offline shell cache must be refreshed for the complete layout release.');

const rules = layer.replace(/\/\*[\s\S]*?\*\//g, '');
let braces = 0;
let parens = 0;
let quote = null;
let escaped = false;
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
  assert.ok(braces >= 0, 'Layout CSS has an unmatched closing brace.');
  assert.ok(parens >= 0, 'Layout CSS has an unmatched closing parenthesis.');
}
assert.equal(quote, null, 'Layout CSS has an unterminated string.');
assert.equal(braces, 0, 'Layout CSS braces must be balanced.');
assert.equal(parens, 0, 'Layout CSS parentheses must be balanced.');

// This design pass intentionally leaves application behavior and theme tokens alone.
assert.ok(css.includes('--green:#14532d'), 'Sellbook green design token must remain unchanged.');
assert.ok(css.includes('--page:#f3f6f3'), 'Sellbook page background token must remain unchanged.');
assert.ok(css.includes('body.dark{'), 'Existing dark appearance support must remain present.');
assert.ok(!layer.includes('display:none!important'), 'Layout layer must not hide app controls or pages.');

const spacingLayer = css.slice(css.lastIndexOf('/* Final spacing and scroll-safety refinement'));
assert.ok(spacingLayer.includes('#me.me-page{'), 'Me page spacing refinements are missing.');
assert.ok(spacingLayer.includes('#me .me-footer-note{'), 'Me footer readability rules are missing.');
assert.ok(spacingLayer.includes('padding:0 0 calc(32px + env(safe-area-inset-bottom, 0px))'), 'Me page must reserve room above bottom navigation.');
assert.ok(spacingLayer.includes('#appWorkspace>main>.page{'), 'Shared pages must reserve scroll space.');
const finalClearance = css.slice(css.lastIndexOf('/* Ensure the final account action'));
assert.ok(finalClearance.includes('padding-bottom:calc(96px + env(safe-area-inset-bottom, 0px))'), 'Every page must reserve enough room above fixed bottom navigation.');
assert.ok(finalClearance.includes('#me #googleSignOut{'), 'Me page sign-out control must remain reachable.');
assert.ok(finalClearance.includes('padding-bottom:calc(104px + env(safe-area-inset-bottom, 0px))'), 'Me page must reserve extra space for its final account action.');
console.log('PASS: all ' + pageIds.length + ' app screens are present, screen-specific layouts are covered, responsive breakpoints are present, Sellbook themes are preserved and layout CSS is balanced.');
