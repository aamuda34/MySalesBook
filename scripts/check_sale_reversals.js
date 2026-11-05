'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20261105023000_audited_sale_reversals.sql','utf8');

// Execute the production sale-status helpers and transaction aggregator with sample data.
const helperStart=app.indexOf('function isSaleReversed(');
const helperEnd=app.indexOf('function getLocalPeriodBounds(',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'Could not isolate production sale-status helpers.');
const groupStart=app.indexOf('function getSalesTransactions(rows){');
const groupEnd=app.indexOf('\nfunction renderSalesHistory()',groupStart);
assert.ok(groupStart>=0&&groupEnd>groupStart,'Could not isolate production sale grouping logic.');
const context={
  db:{sales:[]},
  safeDate:value=>{const date=new Date(value);return Number.isNaN(date.getTime())?new Date(0):date;},
  operationalDate:row=>row?.date||row?.sold_at||row?.created_at||null,
  saleBaseQuantity:row=>Number(row?.baseQty??row?.base_quantity??row?.qty??row?.quantity)||0
};
vm.createContext(context);
vm.runInContext(
  app.slice(helperStart,helperEnd)+'\n'+app.slice(groupStart,groupEnd)+
  '\nglobalThis.__api={isSaleReversed,getActiveSales,getSalesTransactions};',
  context
);
const active={id:'line-active',transactionId:'receipt-1',total:120,profit:30,qty:2,baseQty:2,date:'2026-11-04T10:00:00Z'};
const reversed={id:'line-reversed',transactionId:'receipt-1',total:30,profit:5,qty:1,baseQty:1,date:'2026-11-04T10:00:00Z',reversedAt:'2026-11-05T01:00:00Z'};
context.db.sales=[active,reversed];
assert.equal(context.__api.isSaleReversed(active),false);
assert.equal(context.__api.isSaleReversed(reversed),true);
assert.equal(context.__api.getActiveSales().length,1);
const mixed=context.__api.getSalesTransactions(context.db.sales)[0];
assert.equal(mixed.reversed,false);
assert.equal(mixed.total,120);
assert.equal(mixed.profit,30);
assert.equal(mixed.originalTotal,150);
assert.equal(mixed.items,2);
context.db.sales=[reversed];
const allReversed=context.__api.getSalesTransactions(context.db.sales)[0];
assert.equal(allReversed.reversed,true);
assert.equal(allReversed.total,0);
assert.equal(allReversed.profit,0);
assert.equal(allReversed.originalTotal,30);
const snakeCase={id:'line-snake',reversed_at:'2026-11-05T01:00:00Z'};
assert.equal(context.__api.isSaleReversed(snakeCase),true);
console.log('PASS: reversed receipts are excluded from active financial totals while original values remain available for audit.');

// Verify the server operation preserves history, checks ownership/PIN and makes stock restoration atomic.
const requiredMigration=[
  'ADD COLUMN IF NOT EXISTS reversed_at timestamptz',
  'ADD COLUMN IF NOT EXISTS reversal_reason text',
  'stock_returned boolean NOT NULL DEFAULT false',
  'auth.uid()',
  'private.is_sellbook_pin_verified()',
  'pg_advisory_xact_lock',
  'FOR UPDATE',
  'public.stock_adjustments',
  's.user_id = v_user_id',
  's.reversed_at IS NULL',
  'REVOKE ALL ON FUNCTION public.reverse_sale_transaction',
  'GRANT EXECUTE ON FUNCTION public.reverse_sale_transaction(uuid, text, boolean)',
  'TO authenticated'
];
for(const marker of requiredMigration)assert.ok(migration.includes(marker),'Missing migration safety rule: '+marker);
assert.ok(!/DELETE\s+FROM\s+public\.sales/i.test(migration),'Sale correction must never delete the original sale.');
assert.ok(migration.includes('v_product.user_id = v_user_id')||migration.includes('p.user_id = v_user_id'),'Product ownership is checked before stock is restored.');
assert.ok(migration.includes('v_new_stock > 2000000000'),'Stock return quantity is bounded.');
assert.ok(migration.includes('stock_returned = COALESCE(p_return_to_stock, false)'),'The correction records whether stock was returned.');
console.log('PASS: server-side sale reversal is account-owned, PIN-protected, auditable and atomic with optional stock return.');

// Check that every reporting path uses active sales, while history and exports retain correction status.
assert.ok(app.includes("rpc('reverse_sale_transaction'"),'Sale details must call the protected reversal RPC.');
assert.ok(app.includes("reason.length<3||reason.length>200"),'A meaningful correction reason is required.');
assert.ok(app.includes("if(!navigator.onLine)return showToast('Connect to the internet before correcting a sale.')"),'A correction cannot be queued unsafely while offline.');
assert.ok(app.includes("reversed_at,reversal_reason,stock_returned"),'Cloud refresh loads sale-correction status.');
assert.ok(app.includes("reversedAt:row.reversed_at||null,reversalReason:row.reversal_reason||'',stockReturned:!!row.stock_returned"),'Cloud refresh maps sale-correction status.');
assert.ok(app.includes('sales=getActiveSales().filter(inRange)'),'Report summaries exclude reversed sales.');
assert.ok(app.includes('for(const sale of getActiveSales())'),'Daily and profit summaries exclude reversed sales.');
assert.ok(app.includes('Original sale total (NGN)')&&app.includes('Correction reason'),'Sales CSV keeps original values and the correction audit.');
assert.ok(app.includes('reversed_at:(row.reversedAt||row.reversed_at)'),'Account backups preserve reversal timestamps.');
assert.ok(app.includes('stock_returned:!!(row.stockReturned||row.stock_returned)'),'Account backups preserve stock-return status.');
assert.ok(app.includes('data-confirm-sale-reversal')&&app.includes('data-cancel-sale-reversal'),'The details page provides explicit confirm and cancel actions.');
assert.ok(html.includes('id="saleDetailsContent"'),'The existing sale details page is used; no extra navigation destination is added.');
assert.ok(sw.includes('sellbook-shell-v136'),'The PWA cache version is refreshed for the new UI.');
console.log('PASS: dashboards, reports, history, CSV exports, backups and PWA shell handle reversed sales consistently.');
