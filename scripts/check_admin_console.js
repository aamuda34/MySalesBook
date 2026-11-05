const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

const adminStart = html.indexOf('<section id="admin"');
assert.notEqual(adminStart, -1, 'Admin console must exist');
const adminEnd = html.indexOf('</section>', adminStart);
assert.notEqual(adminEnd, -1, 'Admin console section must close');
const adminHtml = html.slice(adminStart, adminEnd);

const expectedPanels = ['overview', 'traffic', 'users', 'feedback', 'support', 'notifications'];
for (const panel of expectedPanels) {
  assert.match(adminHtml, new RegExp('data-admin-panel="' + panel + '"'), 'Missing admin tab: ' + panel);
  assert.match(adminHtml, new RegExp('data-admin-panel-content="' + panel + '"'), 'Missing admin panel: ' + panel);
}
const requiredIds = [
  'adminAccountEmail', 'adminDashboardStatus', 'adminLastUpdated',
  'adminUsersSearch', 'adminUsersFilter', 'adminUsersSummary', 'adminUsersList',
  'adminUserDetailsView', 'adminUserDetailsContent', 'adminUserDetailsBack',
  'adminFeedbackSearch', 'adminFeedbackFilter', 'adminFeedbackSummary', 'adminFeedbackList',
  'adminChatSearch', 'adminChatFilter', 'adminChatSummary', 'adminChatUserList',
  'adminNotificationForm', 'adminNotificationsList', 'refreshAdminNotifications'
];
for (const id of requiredIds) {
  assert.match(adminHtml, new RegExp('id="' + id + '"'), 'Missing admin control: ' + id);
}

for (const panel of expectedPanels) {
  assert.ok(app.includes("name==='") && app.includes("'"+panel+"'"), 'Admin navigation should recognize ' + panel);
}
assert.match(app, /supabaseClient\.rpc\('is_sellbook_admin'\)/, 'Admin access must be checked on the server');
assert.match(app, /adminRequestIsCurrent\(requestedUserId,requestEpoch\)/, 'Admin requests must be bound to the current account and permission epoch');
assert.match(app, /supabaseClient\.rpc\('sellbook_admin_users'\)/, 'User directory must use the protected admin RPC');
assert.match(app, /adminUsersCache=\(data\|\|\[\]\)\.filter/, 'User cache should populate before support-message reads');
assert.match(app, /function renderAdminUsersList\(/, 'User search and filters must render from cached results');
assert.match(app, /function renderAdminFeedbackList\(/, 'Feedback filters must render from cached results');
assert.match(app, /function renderAdminChatUsers\(/, 'Support conversation filters must render from cached results');
assert.match(app, /if\(audience==='all'&&!confirm\(/, 'Broadcast notifications must require confirmation');
assert.match(css, /\.admin-console-page/, 'Admin console styles must be scoped to the admin page');
assert.match(css, /\.admin-list-tools/, 'Admin search and filter controls must be styled');
console.log('Admin console checks passed.');
