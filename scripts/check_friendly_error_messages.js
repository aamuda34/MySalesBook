'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const start = app.indexOf('function friendlyToastMessage(message){');
const end = app.indexOf('\nlet pageRefreshDepth', start);
assert.ok(start >= 0 && end > start, 'Could not locate the production friendly error-message function.');

const context = {};
vm.createContext(context);
vm.runInContext(app.slice(start, end), context);
const friendlyToastMessage = context.friendlyToastMessage;

// A database/storage permission denial is not an expired sign-in session.
const permissionMessage = friendlyToastMessage('permission denied for table marketplace_message_blocks');
assert.match(permissionMessage, /permission check failed/i);
assert.doesNotMatch(permissionMessage, /sign in again/i);
assert.doesNotMatch(permissionMessage, /marketplace_message_blocks/i);

// Postgres RLS errors must also avoid telling the user to reauthenticate.
const rlsMessage = friendlyToastMessage('new row violates row-level security policy');
assert.match(rlsMessage, /permission check failed/i);
assert.doesNotMatch(rlsMessage, /sign in again/i);

// Actual JWT/session errors should still direct the user to sign in again.
const authMessage = friendlyToastMessage('invalid refresh token');
assert.match(authMessage, /sign in again/i);

console.log('PASS: permission errors and authentication errors are explained separately.');
