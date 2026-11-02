'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

function requireText(text, marker, label) {
  assert.ok(text.includes(marker), 'Missing safety contract: ' + label);
}

// Run the production monetary calculation functions, rather than reimplementing them in tests.
const calcStart = app.indexOf('const MAX_MONEY=');
const calcEnd = app.indexOf('const money=', calcStart);
assert.ok(calcStart >= 0 && calcEnd > calcStart, 'Could not find production sale calculation helpers');
const calcContext = {};
const calculationTests = [
  'globalThis.__results = [',
  '  calculateSaleAmounts(3, 100.10, 65, 1),',
  '  calculateSaleAmounts(3, 500, 120, 5),',
  '  calculateSaleAmounts(1, 0.10, 0.03, 1),',
  '  roundMoney(12.345)',
  '];',
  'globalThis.__rejects = [',
  '  (() => { try { calculateSaleAmounts(0, 10, 5, 1); return false; } catch (_) { return true; } })(),',
  '  (() => { try { calculateSaleAmounts(1, 0, 5, 1); return false; } catch (_) { return true; } })(),',
  '  (() => { try { calculateSaleAmounts(1, 10, 5, 0); return false; } catch (_) { return true; } })(),',
  '  (() => { try { calculateSaleAmounts(2147483647, 10, 5, 2); return false; } catch (_) { return true; } })()',
  '];'
].join('\n');
vm.runInNewContext(app.slice(calcStart, calcEnd) + calculationTests, calcContext);
assert.deepEqual(JSON.parse(JSON.stringify(calcContext.__results)), [
  {total: 300.3, cost: 65, costTotal: 195, profit: 105.3},
  {total: 1500, cost: 600, costTotal: 1800, profit: -300},
  {total: 0.1, cost: 0.03, costTotal: 0.03, profit: 0.07},
  12.35
]);
assert.deepEqual(Array.from(calcContext.__rejects), [true, true, true, true]);
console.log('PASS: production sale calculations, unit conversions, cents rounding and invalid-input rejection.');

// Exercise the real durable-queue reader/writer with an isolated localStorage implementation.
const queueStart = app.indexOf('const queueRecoveryKey =');
const queueEnd = app.indexOf('function slimCloudCache', queueStart);
assert.ok(queueStart >= 0 && queueEnd > queueStart, 'Could not find production sync queue helpers');
const values = new Map();
const mockStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};
const queueContext = {
  localStorage: mockStorage,
  cloudUser: {id: 'test-user'},
  cloudQueueKey: id => 'queue:' + id,
  pendingSync: [],
  updateSyncStatus() {},
  console
};
vm.createContext(queueContext);
vm.runInContext(
  app.slice(queueStart, queueEnd) +
  '\nglobalThis.__queueApi = {readQueue, writeQueue, queueReadErrors, queueRecoveryKey};',
  queueContext
);
const queueApi = queueContext.__queueApi;
const sampleQueue = [{id:'q1', type:'expense', payload:{expense:{id:'e1'}}, status:'pending'}];
values.set('queue:test-user', JSON.stringify(sampleQueue));
assert.equal(JSON.stringify(queueApi.readQueue('test-user')), JSON.stringify(sampleQueue));
assert.equal(queueApi.queueReadErrors.has('test-user'), false);

// Invalid JSON is preserved byte-for-byte and blocks all writes to the original queue.
const malformed = '{"pending":[broken';
values.set('queue:test-user', malformed);
assert.deepEqual(Array.from(queueApi.readQueue('test-user')), []);
assert.equal(values.get('queue:test-user'), malformed);
assert.equal(values.get('queue:test-user:recovery'), malformed);
assert.equal(queueApi.queueReadErrors.has('test-user'), true);
assert.throws(() => queueApi.writeQueue([], 'test-user'), /original data has been preserved/i);
assert.equal(values.get('queue:test-user'), malformed);

// A newer damaged source replaces a stale recovery copy, so the downloaded copy matches the source.
const newerMalformed = '[{"id":"missing-payload","type":"expense"}]';
values.set('queue:test-user:recovery', 'stale-recovery-copy');
values.set('queue:test-user', newerMalformed);
queueApi.readQueue('test-user');
assert.equal(values.get('queue:test-user:recovery'), newerMalformed);
assert.equal(values.get('queue:test-user'), newerMalformed);

// A genuinely absent queue is a normal empty state, not a recovery error.
values.delete('queue:empty-user');
assert.deepEqual(Array.from(queueApi.readQueue('empty-user')), []);
assert.equal(queueApi.queueReadErrors.has('empty-user'), false);
console.log('PASS: queue parsing, exact recovery preservation, stale-copy refresh and write protection.');

// Production sync orchestration: the RPC must make the version/idempotency decision atomically.
// A client-side timestamp pre-check would falsely conflict after a committed sale with lost ACK.
const syncStart = app.indexOf('async function syncPendingChanges()');
const saleStart = app.indexOf("} else if (item.type === 'sale') {", syncStart);
const saleEnd = app.indexOf("} else if (item.type === 'sale_import') {", saleStart);
assert.ok(saleStart >= 0 && saleEnd > saleStart, 'Could not isolate production offline-sale sync branch');
const saleBranch = app.slice(saleStart, saleEnd);
requireText(saleBranch, "await supabaseClient.rpc('record_sale_offline'", 'offline sale uses the atomic database RPC');
requireText(saleBranch, 'p_sale_id:p.sale.id', 'offline sale retry has a stable sale ID');
requireText(saleBranch, 'p_expected_updated_at:p.productUpdatedAt', 'offline sale checks the captured product version on the server');
assert.ok(saleBranch.indexOf("record_sale_offline") < saleBranch.indexOf('const newVersion=await currentProductVersion'),
  'Sale post-sync version refresh must happen after the idempotent RPC');
assert.ok(!saleBranch.includes('const currentVersion=await currentProductVersion'),
  'Sale sync must not pre-reject a retry based on a client-side version read');

const queueReaderStart = app.indexOf('function readQueue(userId=cloudUser?.id)');
const queueReaderEnd = app.indexOf('function downloadQueueRecovery', queueReaderStart);
const reader = app.slice(queueReaderStart, queueReaderEnd);
requireText(reader, 'queueReadErrors.set(userId,error)', 'queue corruption is surfaced');
requireText(reader, 'localStorage.setItem(backupKey,raw)', 'the exact invalid queue bytes are copied to recovery storage');
requireText(reader, 'localStorage.getItem(backupKey)!==raw', 'a stale recovery copy is replaced by the current damaged queue');
const writeStart = app.indexOf('function writeQueue(queue, userId=cloudUser?.id)');
const writeEnd = app.indexOf('function slimCloudCache', writeStart);
const writer = app.slice(writeStart, writeEnd);
requireText(writer, 'if(queueReadErrors.has(userId))throw Error', 'queue writes are blocked after a read/parse failure');
requireText(app, 'queueRecoveryRequired ? ', 'sync status warns when recovery is required');
requireText(app, 'id="downloadSyncRecovery"', 'a recovery download action is rendered');
requireText(app, 'Unsupported queued change type', 'unknown queue operations are never silently marked synced');
requireText(app, 'if(currentProduct&&p.product.updatedAt&&currentProduct.updated_at!==p.product.updatedAt)', 'product deletion retries tolerate an already-completed delete but detect a real conflict');
requireText(app, 'currentProduct.image_path===null&&p.product.imagePath', 'image removal retries do not delete a newer cloud image');
requireText(app, 'p_purchase_id:r.id', 'restock retry uses a stable purchase ID');
console.log('PASS: sync queue recovery, unsupported-operation handling and retry-safe delete/image/restock flows.');

// Database migration contracts underpin the browser retry handling.
const saleSql = fs.readFileSync('supabase/migrations/20261101172121_atomic_sale_version_check.sql', 'utf8');
requireText(saleSql, 'pg_advisory_xact_lock(hashtextextended(p_sale_id::text,0))', 'offline sales serialize retries by stable sale ID');
requireText(saleSql, 'if v_existing_user_id<>v_user_id then raise exception', 'a sale ID cannot be reused by another account');
requireText(saleSql, 'where id=p_product_id and user_id=v_user_id\n for update', 'sales lock and verify the owner product row');
requireText(saleSql, 'if v_product.updated_at is distinct from p_expected_updated_at', 'sales enforce server-side stale-version detection');
requireText(saleSql, 'grant execute on function public.record_sale_offline', 'offline sales RPC is explicitly granted to authenticated users');

const restockSql = fs.readFileSync('supabase/migrations/20261101174947_restock_stock_history_and_bounds.sql', 'utf8');
requireText(restockSql, 'p_purchase_quantity::bigint * p_units_per_purchase::bigint', 'restock multiplication is overflow-safe');
requireText(restockSql, 'where id=p_product_id and user_id=v_user_id for update', 'restock locks and verifies the owner product row');
requireText(restockSql, 'where id=p_purchase_id and user_id=v_user_id', 'restock retries check the stable purchase ID');
requireText(restockSql, 'previous_stock,new_stock,restocked_at', 'restock history records stock before and after');
requireText(restockSql, 'from public, anon', 'restock RPC is not executable by public or anonymous clients');

const shellVersion=Number((sw.match(/const CACHE_NAME = 'sellbook-shell-v(\d+)';/)||[])[1]||0);
assert.ok(shellVersion>=78,'Service worker cache must be bumped for the current hardened app shell.');
console.log('PASS: sale/restock database transaction contracts and offline-shell cache version.');
