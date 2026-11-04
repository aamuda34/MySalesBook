'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
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


// Grouped sales use one transaction ID across multiple line rows; exercise the real helpers.
const saleQuantityStart = app.indexOf('function saleBaseQuantity(row){');
const saleQuantityEnd = app.indexOf('\nfunction getSalesTransactions(rows){', saleQuantityStart);
const transactionStart = saleQuantityEnd;
const transactionEnd = app.indexOf('\nfunction renderSalesHistory', transactionStart);
assert.ok(saleQuantityStart >= 0 && saleQuantityEnd > saleQuantityStart && transactionEnd > transactionStart,
  'Could not isolate production base-quantity and transaction grouping helpers.');
const saleQuantityHelper = app.slice(saleQuantityStart, saleQuantityEnd);
const transactionHelper = app.slice(transactionStart, transactionEnd);
assert.equal((app.match(/function getSalesTransactions\(rows\)/g) || []).length, 1,
  'Sales History must have one authoritative transaction grouping helper.');
const transactionContext = {
  rows: [
    {id:'line-1',transactionId:'basket-1',date:'2026-11-04T09:00:00+01:00',qty:2,unitsPerSale:12,baseQty:24,total:100,profit:30},
    {id:'line-2',transactionId:'basket-1',date:'2026-11-04T09:02:00+01:00',qty:3,unitsPerSale:1,baseQty:3,total:50,profit:10},
    {id:'line-3',transactionId:'sale-2',date:'2026-11-04T08:00:00+01:00',qty:1,unitsPerSale:1,baseQty:1,total:20,profit:5}
  ],
  operationalDate: row => row.date,
  safeDate: value => new Date(value)
};
vm.runInNewContext(
  saleQuantityHelper + '\n' + transactionHelper + '\nglobalThis.__groups=getSalesTransactions(rows);',
  transactionContext
);
const groupedSales = JSON.parse(JSON.stringify(transactionContext.__groups));
assert.equal(groupedSales.length, 2, 'Two rows from one basket must count as one transaction.');
assert.equal(groupedSales[0].id, 'basket-1');
assert.equal(groupedSales[0].total, 150);
assert.equal(groupedSales[0].profit, 40);
assert.equal(groupedSales[0].items, 27, 'Pack quantities must be converted to base units for the sales summary.');
requireText(app, 'items=periodRows.reduce((n,x)=>n+saleBaseQuantity(x),0)', 'Sales History summary counts base units, not only packs');
console.log('PASS: grouped sales count as one transaction and aggregate converted stock units.');

// Exercise the real queued product-version propagation for edits, restocks and basket sales.
const propagationStart = app.indexOf('function propagateQueuedProductVersion(queue, fromIndex, productId, version) {');
const propagationEnd = app.indexOf('\n\nasync function syncPendingChanges()', propagationStart);
assert.ok(propagationStart >= 0 && propagationEnd > propagationStart, 'Could not isolate queued product-version propagation.');
const propagationContext = {
  queue: [
    {type:'sale_batch',payload:{sales:[
      {productId:'p1',productUpdatedAt:'stale'},
      {productId:'p2',productUpdatedAt:'keep'}
    ]}},
    {type:'product_save',payload:{isNew:false,product:{id:'p1',updatedAt:'stale'}}},
    {type:'sale',payload:{sale:{productId:'p1'},productUpdatedAt:'stale'}},
    {type:'product_remove_image',payload:{product:{id:'p1',updatedAt:'stale'}}}
  ],
  now: () => 'fresh-sync-marker'
};
vm.runInNewContext(
  app.slice(propagationStart, propagationEnd) +
  '\npropagateQueuedProductVersion(queue, -1, "p1", "server-version");',
  propagationContext
);
assert.equal(propagationContext.queue[0].payload.sales[0].productUpdatedAt,'server-version');
assert.equal(propagationContext.queue[0].payload.sales[1].productUpdatedAt,'keep');
assert.equal(propagationContext.queue[1].payload.product.updatedAt,'server-version');
assert.equal(propagationContext.queue[1].payload.product.syncUpdatedAt,'fresh-sync-marker');
assert.equal(propagationContext.queue[2].payload.productUpdatedAt,'server-version');
assert.equal(propagationContext.queue[3].payload.product.updatedAt,'server-version');
const batchSyncStart = app.indexOf('async function syncPendingChanges()');
const batchSyncBranchStart = app.indexOf("} else if(item.type==='sale_batch'){", batchSyncStart);
const batchSyncBranchEnd = app.indexOf("} else if (item.type === 'sale_import') {", batchSyncBranchStart);
assert.ok(batchSyncBranchStart >= 0 && batchSyncBranchEnd > batchSyncBranchStart,
  'Could not isolate grouped-sale queue sync branch.');
const batchSyncBranch = app.slice(batchSyncBranchStart, batchSyncBranchEnd);
requireText(batchSyncBranch, "rpc('record_sales_batch'", 'queued baskets use the atomic multi-sale RPC');
requireText(batchSyncBranch, 'p_transaction_id:p.transactionId', 'basket retry uses a stable transaction ID');
requireText(batchSyncBranch, 'expected_updated_at:line.productUpdatedAt', 'each basket line carries its expected product version');
requireText(batchSyncBranch, 'propagateQueuedProductVersion(queue,queueIndex,productId,version)', 'successful basket sync refreshes later edits and sales');
console.log('PASS: offline basket retries propagate product versions through future queue operations.');

// Product and expense history must remain complete and consistent as records grow.
requireText(app, 'fetchAllCloudRows(()=>supabaseClient.from(\'stock_purchases\')', 'restock history uses deterministic complete pagination');
requireText(app, 'data-history-load-more', 'product history exposes older records instead of silently truncating them');
requireText(app, 'productActivityFieldLabel', 'product edit history uses readable field labels');
requireText(app, 'if(!withinPeriod(expense,bounds))continue;', 'expense category breakdown follows the selected period');
requireText(app, "toLocaleString([], {dateStyle:'medium',timeStyle:'short'})", 'recent expenses include their actual date and time');
requireText(app, "select('id,voided_at').maybeSingle()", 'expense void sync verifies the updated cloud row');
requireText(app, 'new Date(existing.voided_at).getTime()===new Date(p.voidedAt).getTime()', 'expense void retry accepts only the same already-applied operation');
console.log('PASS: complete product history, period-consistent expense totals and retry-safe voids.');

// Reservation pages independently hydrate buyer names and page all line items.
const reservationStart = app.indexOf('async function loadReservationsPage(){');
const reservationEnd = app.indexOf('\nasync function retryReservationNotification', reservationStart);
assert.ok(reservationStart >= 0 && reservationEnd > reservationStart, 'Could not isolate reservation loader.');
const reservationLoader = app.slice(reservationStart, reservationEnd);
requireText(reservationLoader, "rpc('get_my_marketplace_subscribers')", 'reservation page hydrates buyer names on direct entry');
requireText(reservationLoader, 'fetchAllCloudRows(()=>supabaseClient.from(\'marketplace_reservation_items\')', 'reservation detail items are fully paginated');
requireText(app, "||'Buybook customer'", 'reservation buyer fallback is readable and does not expose an ID fragment');
console.log('PASS: reservation entry hydrates buyer identities and loads every reservation line.');

// Grouped transaction IDs are non-unique row-grouping keys in both fresh and upgraded databases.
const operationsSql = fs.readFileSync('supabase/migrations/20261104211229_operations_history_and_batch_sales.sql', 'utf8');
const correctionSql = fs.readFileSync('supabase/migrations/20261104222039_allow_multiple_sales_per_transaction.sql', 'utf8');
requireText(operationsSql, 'create index if not exists sales_transaction_id_idx', 'new installs get a non-unique basket lookup index');
assert.ok(!/create\s+unique\s+index[^;]*transaction_id/i.test(operationsSql),
  'Grouped sales cannot use a unique transaction_id index.');
requireText(correctionSql, 'drop index if exists public.sales_transaction_id_unique_idx', 'existing installations drop the incorrect unique index');
requireText(correctionSql, 'create index if not exists sales_transaction_id_idx', 'existing installations retain a non-unique transaction lookup index');
console.log('PASS: database migration contracts allow multiple rows for each basket transaction.');


// Add Sale navigation must return to the actual page that opened it.
const returnPageStart=app.indexOf('function resolveSaleReturnPage(previousPage,fallback=\'home\'){');
const returnPageEnd=app.indexOf('\nfunction showPage(name',returnPageStart);
assert.ok(returnPageStart>=0&&returnPageEnd>returnPageStart,'Could not isolate the production Add Sale return-page helper.');
const returnPageContext={};
vm.runInNewContext(app.slice(returnPageStart,returnPageEnd)+
  '\nglobalThis.__routes=[resolveSaleReturnPage("home"),resolveSaleReturnPage("sales"),resolveSaleReturnPage("products"),resolveSaleReturnPage(null,"sales"),resolveSaleReturnPage(null,"invalid")];',
  returnPageContext);
assert.deepEqual(Array.from(returnPageContext.__routes),['home','sales','home','sales','home']);
requireText(app,'if(name===\'record-sale\'&&previous!==\'record-sale\')saleReturnPage=resolveSaleReturnPage(previous,saleReturnPage)',
  'opening Add Sale remembers its real origin');
requireText(app,"if(current==='record-sale')return resolveSaleReturnPage(previous,saleReturnPage)",
  'Add Sale arrow uses the real originating page');
const addSaleMarkup=indexHtml.slice(indexHtml.indexOf('<section id="record-sale"'),indexHtml.indexOf('<section id="sales-history"'));
requireText(addSaleMarkup,'data-app-back="home"','Add Sale has a delegated back control');
requireText(addSaleMarkup,'M15 18 9 12l6-6M9 12h11','Add Sale uses a correctly drawn left arrow');
requireText(addSaleMarkup,'aria-label="Back to previous page"','Add Sale back arrow has a useful accessible name');
requireText(app,"money(x.price)+' per '+esc(x.saleUnit)",'sale basket describes its actual selling unit');
console.log('PASS: Add Sale returns to Home or Sales correctly and the back arrow is clear.');

// Reservation expiry is consistent at, before and after the exact expiry instant.
const statusStart=app.indexOf('function reservationStatusBucket(reservation,nowTime=Date.now()){');
const statusEnd=app.indexOf('\nfunction renderReservationsFiltered',statusStart);
assert.ok(statusStart>=0&&statusEnd>statusStart,'Could not isolate the production Reservation status helper.');
const statusContext={};
vm.runInNewContext(app.slice(statusStart,statusEnd)+
  '\nglobalThis.__buckets=['+
  'reservationStatusBucket({status:"pending"},1000),'+
  'reservationStatusBucket({status:"pending",expires_at:"1970-01-01T00:00:02.000Z"},1000),'+
  'reservationStatusBucket({status:"pending",expires_at:"1970-01-01T00:00:01.000Z"},1000),'+
  'reservationStatusBucket({status:"pending",expires_at:"1969-12-31T23:59:59.000Z"},1000),'+
  'reservationStatusBucket({status:"approved",expires_at:"1969-12-31T23:59:59.000Z"},1000),'+
  'reservationStatusBucket({status:"expired"},1000)];',
  statusContext);
assert.deepEqual(Array.from(statusContext.__buckets),['pending','pending','expired','expired','approved','expired']);
const decisionStart=app.indexOf('async function updateReservationDecision');
const decisionEnd=app.indexOf('\nfunction showReservationDetails',decisionStart);
const decisionSource=app.slice(decisionStart,decisionEnd);
requireText(decisionSource,'reservationStatusBucket(reservation)!==\'pending\'','stale expired reservation actions are blocked');
requireText(decisionSource,".or('expires_at.is.null,expires_at.gt.'+decisionTime)",'the Reservation update is protected against expiry races on the server');
requireText(app,".or('expires_at.is.null,expires_at.gt.'+new Date().toISOString())",'Home pending count excludes expired reservations');
requireText(app,'const items=Array.isArray(r.items)?r.items:[]','Reservation details safely render without a populated item list');
console.log('PASS: Reservation expiry, pending counts and approve/reject updates use one expiry boundary.');

// Reservation and subscriber detail arrows consume their nested history entry.
const backStart=app.indexOf('(function installUnifiedBackArrows(){');
const backEnd=app.indexOf('\nfunction refreshStockHistoryBadges',backStart);
const backSource=app.slice(backStart,backEnd);
requireText(backSource,'history.state?.mySalesBookSubview===subview','nested detail back detects the active detail history entry');
requireText(backSource,'history.back();','nested detail back consumes the detail entry');
requireText(backSource,'mySalesBookSubview:undefined','directly restored detail views clear their nested state on fallback');
console.log('PASS: Reservation and Subscriber detail back arrows keep browser history in sync.');

 
// Add Sale controls are locked as one transaction while the save is in flight.
const submitHandlerStart=app.indexOf("document.getElementById('saleForm').addEventListener('submit',async event=>");
const submitHandlerEnd=app.indexOf("\ndocument.getElementById('expenseForm')",submitHandlerStart);
assert.ok(submitHandlerStart>=0&&submitHandlerEnd>submitHandlerStart,'Could not isolate Add Sale submit handler.');
const submitHandler=app.slice(submitHandlerStart,submitHandlerEnd);
requireText(submitHandler,'formControls=[...event.currentTarget.querySelectorAll(\'input,select,textarea,button\')]', 'all Add Sale fields and basket controls are locked during save');
requireText(submitHandler,'formDisabledState=formControls.map(control=>control.disabled)','pre-existing disabled states are retained');
requireText(submitHandler,'formControls.forEach((control,index)=>{control.disabled=formDisabledState[index];})','all Add Sale controls are restored after success or failure');
assert.ok(submitHandler.indexOf('formControls.forEach(control=>{control.disabled=true;})')<submitHandler.indexOf('try{'),
  'Add Sale controls must be locked before any asynchronous write starts.');
console.log('PASS: Add Sale basket cannot be edited while its transaction is saving.');

// Sales History returns to Sales, and Add Sale labels its arrow for the real origin.
const salesHistoryMarkup=indexHtml.slice(indexHtml.indexOf('<section id="sales-history"'),indexHtml.indexOf('<section id="sale-details"'));
requireText(salesHistoryMarkup,'data-app-back="sales"','Sales History fallback returns to the Sales overview');
requireText(salesHistoryMarkup,'aria-label="Back to Sales"','Sales History back arrow is clearly labelled');
requireText(app,"const label=destination==='sales'?'Back to Sales':'Back to Home'","Add Sale back arrow names its actual destination");
console.log('PASS: Sales and Add Sale back arrows have clear contextual destinations.');
