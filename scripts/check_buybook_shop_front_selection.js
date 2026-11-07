'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const helperStart = app.indexOf('function shouldHydrateBuybookShopFrontFromProfile(');
assert.ok(helperStart >= 0, 'Production shop-front hydration guard is missing.');
const helperEnd = app.indexOf('\n}', helperStart) + 2;
assert.ok(helperEnd > helperStart, 'Could not isolate production shop-front hydration guard.');
const helper = app.slice(helperStart, helperEnd);

function evaluate({versionAtStart, fileAtStart, currentVersion, currentFile}) {
  const context = {
    buybookShopFrontImageFile: currentFile ? {name: 'selected.jpg'} : null,
    buybookShopFrontSelectionVersion: currentVersion
  };
  vm.createContext(context);
  vm.runInContext(helper, context);
  return vm.runInContext(
    'shouldHydrateBuybookShopFrontFromProfile(' +
      versionAtStart + ',' + (fileAtStart ? 'true' : 'false') + ')',
    context
  );
}

// A refresh that starts after the photo is selected must not clear the selection.
assert.equal(evaluate({
  versionAtStart: 1, fileAtStart: true, currentVersion: 1, currentFile: true
}), false);

// A refresh already in flight when the user selects a photo must not clear it.
assert.equal(evaluate({
  versionAtStart: 0, fileAtStart: false, currentVersion: 1, currentFile: true
}), false);

// A refresh may hydrate a saved photo only when the user has made no selection.
assert.equal(evaluate({
  versionAtStart: 0, fileAtStart: false, currentVersion: 0, currentFile: false
}), true);

// Removing a photo while a refresh is in flight must not be undone by that refresh.
assert.equal(evaluate({
  versionAtStart: 0, fileAtStart: false, currentVersion: 1, currentFile: false
}), false);

const loadStart = app.indexOf('async function loadBuybookConnection(options={}){');
const loadEnd = app.indexOf('\n}\n\nlet buybookConnectionState=', loadStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'Could not isolate production Buybook connection loader.');
const loader = app.slice(loadStart, loadEnd);
assert.ok(loader.includes('const shopFrontFileAtRequestStart=buybookShopFrontImageFile;'),
  'The profile refresh must snapshot a pending file at request start.');
assert.equal(
  (loader.match(/shouldHydrateBuybookShopFrontFromProfile\(/g) || []).length,
  2,
  'Both existing-profile and no-profile branches must use the same race-safe guard.'
);
assert.ok(!loader.includes('buybookShopFrontImageFile=null;'),
  'A profile refresh must never clear the pending photo file.');

console.log('PASS: Buybook shop-front selection survives refreshes started before or after selection, and removal is preserved.');
