'use strict';

const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: ' + message);
}

const html = read('index.html');
const app = read('app.js');
const css = read('styles.css');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const privacy = read('privacy.html');
const terms = read('terms.html');

function sectionTag(id) {
  const tags = html.match(/<section\b[^>]*>/gi) || [];
  return tags.find(tag => {
    const tagId = (tag.match(/\bid=["']([^"']+)["']/i) || [])[1];
    return tagId === id;
  }) || '';
}

function functionBody(name) {
  const start = app.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const next = app.indexOf('\nfunction ', start + 10);
  const asyncNext = app.indexOf('\nasync function ', start + 10);
  const ends = [next, asyncNext].filter(index => index > start);
  return app.slice(start, ends.length ? Math.min(...ends) : start + 5000);
}

// Structural navigation and markup integrity.
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicateIds.length === 0, 'HTML element IDs are unique');

const pageIds = new Set((html.match(/<section\b[^>]*>/gi) || [])
  .filter(tag => /\bclass=["'][^"']*\bpage\b/i.test(tag))
  .map(tag => (tag.match(/\bid=["']([^"']+)["']/i) || [])[1])
  .filter(Boolean));
const openTargets = [...new Set([...html.matchAll(/data-open-page=["']([^"']+)["']/g)].map(match => match[1]))];
const backTargets = [...new Set([...html.matchAll(/data-app-back=["']([^"']+)["']/g)].map(match => match[1]))];
assert(openTargets.every(target => pageIds.has(target)), 'Every data-open-page destination exists');
assert(backTargets.every(target => pageIds.has(target)), 'Every data-app-back destination exists');

// First-use flow and direct actions.
const homeStart = html.indexOf('<section id="home"');
const gettingStarted = html.indexOf('id="gettingStartedCard"');
const salesBoard = html.indexOf('class="home-sales-board"', homeStart);
assert(homeStart >= 0 && gettingStarted > homeStart && gettingStarted < salesBoard,
  'Getting Started appears before dashboard metrics');
assert(html.includes('getting-started-step" data-open-entry="product"') &&
       html.includes('getting-started-step" data-open-entry="sale"') &&
       html.includes('getting-started-step" data-open-entry="expense"'),
  'Getting Started opens the three primary task forms');
assert(html.includes('data-open-entry="sale"') &&
       html.includes('data-open-entry="product"') &&
       html.includes('data-open-entry="expense"') &&
       app.includes("entryKey={products:'product',sales:'sale',expenses:'expense'}") &&
       app.includes("querySelectorAll('[data-open-entry]')"),
  'Home quick actions open full-page task forms');
assert(html.includes('Net profit today') &&
       html.includes('Total net profit') &&
       html.includes('Net profit for selected period'),
  'Profit labels identify their reporting periods');

// Optional Buybook features stay out of the beginner dashboard until connected.
assert(/home-marketplace-section[^>]*hidden/.test(html) &&
       /home-board-metric-right[^>]*hidden/.test(html),
  'Buybook dashboard section and reservation metric start hidden');
assert(app.includes('marketplaceSection.hidden=loading||!connected') &&
       app.includes('reservationsMetric.hidden=loading||!connected') &&
       app.includes('approachingMetric.hidden=loading||!connected'),
  'Buybook dashboard content appears only after a confirmed connection');
assert(!html.includes('subscribers-home-card') &&
       html.includes('Shop subscribers'),
  'Home focuses on Reservations while shop subscribers remain accessible from Me');
assert(app.includes('meReservations.hidden=loading||!connected') &&
       app.includes('meSubscribers.hidden=loading||!connected'),
  'Me shows Buybook customer tools only after the shop is connected');

// Beginner explanations for money and stock terminology.
assert(html.includes('Cost price is what you paid for one item') &&
       html.includes('Selling price is what your customer pays'),
  'Product form explains cost price and selling price');
assert(html.includes('How many purchase units did you buy?') &&
       html.includes('How many individual items are in one purchase unit?') &&
       html.includes('one carton contains 12 bottles'),
  'Restock form explains package quantities with a concrete example');
assert(html.includes('Opening stock is entered as the total number of individual bottles'),
  'Pack setup explains that opening stock uses individual units');

// Legal documents are a single source across signup, in-app display and offline use.
assert(app.includes("fetch('./privacy.html'") &&
       app.includes("fetch('./terms.html'") &&
       app.includes("querySelector('main')") &&
       app.includes("name==='settings-legal'"),
  'In-app Privacy Notice and Terms load from the standalone source documents');
assert(privacy.includes('6 November 2026') &&
       terms.includes('5 November 2026') &&
       app.includes("privacy_policy_version!=='2026-11-06'") &&
       app.includes("terms_version!=='2026-11-05'"),
  'Displayed legal documents match the versions recorded at signup');
assert(!html.includes('Effective 23 October 2026') &&
       sw.includes("'./privacy.html'") &&
       sw.includes("'./terms.html'"),
  'Stale in-app policy text is removed and current policies are cached offline');

// Backup restore and PIN-lock requirements.
assert(html.includes('Sellbook supports two restore modes') &&
       html.includes('When signed in:') &&
       html.includes('Device-only mode:'),
  'Backup instructions explain cloud restore and device-only restore');
assert(app.includes("upsert(batch,{onConflict:'id',ignoreDuplicates:true}") &&
       app.includes('restoreSellbookBackupToCloud'),
  'Cloud restore is additive and ignores existing record IDs');

const startLock = functionBody('startSecurityPinBackgroundLock');
const resumeLock = functionBody('resumeSecurityPinAfterBackground');
const lockAfterBackground = functionBody('lockSellbookAfterBackground');
assert(startLock.includes('saveSecurityPinAwayAt(userId)') &&
       startLock.includes("showSecurityPinGate('verify'"),
  'PIN gate covers the workspace as soon as the app is backgrounded');
assert(resumeLock.indexOf('securityPinReloadExemptionAvailable') >= 0 &&
       resumeLock.indexOf('securityPinReloadExemptionAvailable') < resumeLock.indexOf('lockSellbookAfterBackground'),
  'Confirmed manual refresh is exempt before the background lock is committed');
assert(lockAfterBackground.includes('persistSecurityPinLock') &&
       lockAfterBackground.includes('because you left the app') &&
       !app.includes('SECURITY_PIN_BACKGROUND_LOCK_MS') &&
       !app.includes('one minute away'),
  'Returning after leaving Sellbook requires the PIN immediately');

// PWA contract.
assert(manifest.name === 'Sellbook' &&
       manifest.display === 'standalone' &&
       manifest.icons.some(icon => icon.sizes === '192x192') &&
       manifest.icons.some(icon => icon.sizes === '512x512'),
  'PWA manifest retains Sellbook identity and required app icons');
assert(/const CACHE_NAME = 'sellbook-shell-v166'/.test(sw),
  'Service-worker shell version is bumped for the product stock status release');
assert(css.includes('.home-sales-board-bottom.one-metric'),
  'Home metrics layout remains balanced when Buybook is disconnected');


 
// Product stock labels: zero stock is different from low stock, and archived
// products keep their archived label instead of being shown as available.
assert(app.includes('stockValue=Number(p.stock)') &&
       app.includes('stockCount===0') &&
       app.includes('out-of-stock-badge') &&
       app.includes('low-stock-badge') &&
       app.includes("isProductArchived(p)"),
  'Product list distinguishes out-of-stock, low-stock and archived products');
assert(css.includes('.out-of-stock-badge{') &&
       css.includes('body.dark .out-of-stock-badge{'),
  'Out-of-stock status badge has readable light- and dark-mode styling');

if (process.exitCode) process.exit(process.exitCode);
console.log('All pre-APK audit checks passed.');
