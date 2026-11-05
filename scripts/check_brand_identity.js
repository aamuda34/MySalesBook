#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (name) => fs.readFileSync(name, 'utf8');
const index = read('index.html');
const install = read('install.html');
const manifest = read('manifest.webmanifest');
const privacy = read('privacy.html');
const terms = read('terms.html');
const sw = read('sw.js');

const tagline = 'Made Business Simple.';
const lockup = 'Sellbook · Made Business Simple.';

assert.match(index, /<title>Sellbook — Made Business Simple\.<\/title>/, 'main app title must use the approved name and tagline');
assert.equal((index.match(/<small>Made Business Simple\.<\/small>/g) || []).length, 2, 'sign-in and PIN screens must use the same brand lockup');
assert.ok(index.includes('<p class="muted" style="margin:0">Made Business Simple.</p>'), 'About page must show the approved tagline');
assert.ok(index.includes('<div class="me-footer-note">Sellbook · Made Business Simple.</div>'), 'Me page must use the approved brand footer');
assert.ok(index.includes('<div class="me-footer-note" style="text-align:center">Sellbook · Made Business Simple.</div>'), 'About page footer must use the approved brand footer');

for (const [name, source] of [['install page', install]]) {
  assert.ok(source.includes('Sellbook — Made Business Simple.'), name + ' titles and social metadata must use the approved tagline');
  assert.ok(source.includes('<div class="brand-tag">Made Business Simple.</div>'), name + ' visible brand lockup must use the approved tagline');
  assert.ok(source.includes('Sellbook · Made Business Simple.'), name + ' footer must use the approved brand lockup');
  assert.ok(!source.includes('Your Business Records, Made Simple'), name + ' must not retain the retired tagline');
}
assert.ok(manifest.includes('Sellbook — Made Business Simple.'), 'PWA description must include the approved brand positioning');
assert.ok(privacy.includes('Sellbook · Made Business Simple.'), 'privacy page must use the current brand identity');
assert.ok(terms.includes('Sellbook · Made Business Simple.'), 'terms page must use the current brand identity');
assert.ok(!privacy.includes('My Sales Book'), 'privacy page must not expose the retired product name');
assert.ok(!terms.includes('My Sales Book'), 'terms page must not expose the retired product name');
assert.ok(sw.includes("const CACHE_NAME = 'sellbook-shell-v137';"), 'offline shell must be versioned for the branding refresh');

console.log('Sellbook brand name and tagline checks passed.');
