'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

const start = app.indexOf('function updateBusinessDetailsPage(){');
const end = app.indexOf('function updateMePanel(){', start);
assert.ok(start >= 0 && end > start, 'Could not isolate the production business profile renderer.');
const renderer = app.slice(start, end);
assert.ok(!renderer.includes('businessTitle'), 'Business profile must never reuse the header greeting.');

function makeElement(initialText = '') {
  const classes = new Set();
  return {
    textContent: initialText,
    src: '',
    removedSrc: false,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    removeAttribute(name) { if (name === 'src') { this.src = ''; this.removedSrc = true; } },
    querySelector(selector) { return selector === 'svg' ? this.svg : null; }
  };
}

function run(profile, user) {
  const elements = {
    businessDetailsBusinessName: makeElement(),
    businessDetailsRegistered: makeElement(),
    businessDetailsEmail: makeElement(),
    businessDetailsStatus: makeElement(),
    businessDetailsLogo: makeElement(),
    businessDetailsAvatar: makeElement()
  };
  elements.businessDetailsAvatar.svg = makeElement();
  const context = {
    getProfile: () => profile,
    cloudUser: user,
    document: { getElementById: id => elements[id] || null }
  };
  vm.createContext(context);
  vm.runInContext(renderer + '\nglobalThis.__render = updateBusinessDetailsPage;', context);
  context.__render();
  return elements;
}

const signedIn = run(
  {businessName: 'Africane Stores', businessLogo: 'data:image/png;base64,AA=='},
  {email: 'seller@example.com', created_at: '2026-10-19T12:00:00.000Z'}
);
assert.equal(signedIn.businessDetailsBusinessName.textContent, 'Africane Stores');
assert.equal(signedIn.businessDetailsEmail.textContent, 'seller@example.com');
assert.ok(signedIn.businessDetailsRegistered.textContent.includes('2026'));
assert.equal(signedIn.businessDetailsStatus.textContent, 'Registered account');
assert.equal(signedIn.businessDetailsLogo.src, 'data:image/png;base64,AA==');
assert.equal(signedIn.businessDetailsLogo.classList.contains('hidden'), false);
assert.equal(signedIn.businessDetailsAvatar.svg.classList.contains('hidden'), true);

const noBusinessName = run(
  {businessName: '   ', businessLogo: ''},
  {email: 'seller@example.com'}
);
assert.equal(noBusinessName.businessDetailsBusinessName.textContent, 'Not set');
assert.equal(noBusinessName.businessDetailsLogo.classList.contains('hidden'), true);
assert.equal(noBusinessName.businessDetailsAvatar.svg.classList.contains('hidden'), false);
assert.equal(noBusinessName.businessDetailsStatus.textContent, 'Registered account');

const deviceProfile = run(
  {businessName: '', businessLogo: ''},
  null
);
assert.equal(deviceProfile.businessDetailsBusinessName.textContent, 'Not set');
assert.equal(deviceProfile.businessDetailsEmail.textContent, 'Not signed in');
assert.equal(deviceProfile.businessDetailsRegistered.textContent, 'Not available for this device');
assert.equal(deviceProfile.businessDetailsStatus.textContent, 'Device profile');

assert.ok(html.includes('id="businessDetailsAvatar"'), 'Business profile avatar container is missing.');
assert.ok(html.includes('id="businessDetailsLogo"'), 'Business profile logo image is missing.');
assert.ok(css.includes('grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)'), 'Business profile rows must use a responsive two-column layout.');
assert.ok(css.includes('overflow-wrap:anywhere'), 'Long account values must wrap instead of clipping.');
console.log('PASS: correct business name source, empty-name fallback, account details, logo/avatar switching and responsive text wrapping.');
