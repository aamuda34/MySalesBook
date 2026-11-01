/* Sellbook application logic and startup. External scripts (Supabase SDK/config) load before this file. */

// Main application and UI logic.
'use strict';

const SUPABASE_URL = window.MY_SALES_BOOK_SUPABASE?.url;
const SUPABASE_PUBLISHABLE_KEY = window.MY_SALES_BOOK_SUPABASE?.publishableKey;
const supabaseClient = window.supabase?.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

if (!supabaseClient) {
  console.error('Sellbook: Supabase could not be initialized.');
}
const DBKEY='my-sales-book-v1';
const MAX_MONEY=9999999999.99;
function roundMoney(value){const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>MAX_MONEY)throw Error('Enter a valid monetary amount.');const rounded=Math.round((n+Number.EPSILON)*100)/100;if(Math.abs(rounded)>MAX_MONEY)throw Error('The amount is too large to save safely.');return rounded;}
function calculateSaleAmounts(quantity,unitPrice,unitCost,unitsPerSale=1){if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(unitsPerSale)||unitsPerSale<1||quantity*unitsPerSale>2147483647)throw Error('Sale quantity is invalid.');const price=roundMoney(unitPrice),cost=roundMoney(unitCost);if(price<=0||cost<0)throw Error('Enter a valid selling price and product cost.');const total=roundMoney(quantity*price);const costPerSaleUnit=roundMoney(cost*unitsPerSale);const costTotal=roundMoney(quantity*costPerSaleUnit);return {total,cost:costPerSaleUnit,costTotal,profit:roundMoney(total-costTotal)};}
const money=n=>'₦'+Number(n||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const now=()=>new Date().toISOString();
let db={products:[],sales:[],expenses:[],stockAdjustments:[],restocks:[],profile:{businessName:'',businessLogo:''}};
function normalizeDb(v){return {products:Array.isArray(v?.products)?v.products:[],sales:Array.isArray(v?.sales)?v.sales:[],expenses:Array.isArray(v?.expenses)?v.expenses:[],stockAdjustments:Array.isArray(v?.stockAdjustments)?v.stockAdjustments:[],restocks:Array.isArray(v?.restocks)?v.restocks:[],profile:v?.profile&&typeof v.profile==='object'?v.profile:{businessName:'',businessLogo:''}};}
let lowStockThreshold=Number(localStorage.getItem('my-sales-book-low-stock-v1')||5);if(!Number.isSafeInteger(lowStockThreshold)||lowStockThreshold<0)lowStockThreshold=5;

function applyTheme(){document.body.classList.remove('dark');}
function safeDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?new Date(0):d;}
function dateKey(value){const d=safeDate(value);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function validDateKey(value){if(value==null||value==='')return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
let selectedExpensePeriod='today';
function setExpensePeriod(period){
 if(!['today','week','month','year','all'].includes(period))return;
 selectedExpensePeriod=period;
 const selector=document.getElementById('expensePeriodSelect');if(selector&&selector.value!==period)selector.value=period;
 updateExpensePeriodTotal();
}
function updateExpensePeriodTotal(){
 const label=document.getElementById('expensePeriodLabel'),amount=document.getElementById('todayExpenses');
 if(!label||!amount||!Array.isArray(db.expenses))return;
 const nowDate=new Date();nowDate.setHours(0,0,0,0);
 let start=new Date(nowDate),labelText='Total expenses today';
 if(selectedExpensePeriod==='week'){const day=(nowDate.getDay()+6)%7;start.setDate(nowDate.getDate()-day);labelText='Total expenses this week';}
 else if(selectedExpensePeriod==='month'){start=new Date(nowDate.getFullYear(),nowDate.getMonth(),1);labelText='Total expenses this month';}
 else if(selectedExpensePeriod==='year'){start=new Date(nowDate.getFullYear(),0,1);labelText='Total expenses this year';}
 else if(selectedExpensePeriod==='all'){labelText='Total expenses all time';}
 const startKey=selectedExpensePeriod==='all'?'':dateKey(start),endKey=dateKey(nowDate);
 const total=db.expenses.reduce((sum,expense)=>{const key=validDateKey(expense.date);return key&&(selectedExpensePeriod==='all'||(key>=startKey&&key<=endKey))?sum+(Number(expense.amount)||0):sum;},0);
 label.textContent=labelText;amount.textContent=money(total);
}
document.getElementById('expensePeriodSelect')?.addEventListener('change',event=>setExpensePeriod(event.target.value));

let selectedSalesSummaryPeriod='today';
function updateSalesPeriodSummary(){
 const selector=document.getElementById('salesSummaryPeriod');if(selector&&selector.value!==selectedSalesSummaryPeriod)selector.value=selectedSalesSummaryPeriod;
 const now=new Date();now.setHours(0,0,0,0);let start=new Date(now);
 if(selectedSalesSummaryPeriod==='week'){start.setDate(now.getDate()-((now.getDay()+6)%7));}
 else if(selectedSalesSummaryPeriod==='month'){start=new Date(now.getFullYear(),now.getMonth(),1);}
 else if(selectedSalesSummaryPeriod==='year'){start=new Date(now.getFullYear(),0,1);}
 const startKey=selectedSalesSummaryPeriod==='all'?'':dateKey(start),endKey=dateKey(now);
 const inPeriod=x=>{const key=validDateKey(x.date);return !!key&&key<=endKey&&(selectedSalesSummaryPeriod==='all'||key>=startKey);};
 const sales=(db.sales||[]).filter(inPeriod),expenses=(db.expenses||[]).filter(inPeriod);
 const totalSales=sales.reduce((sum,x)=>sum+(Number(x.total)||0),0),gross=sales.reduce((sum,x)=>sum+(Number(x.profit)||0),0),expenseTotal=expenses.reduce((sum,x)=>sum+(Number(x.amount)||0),0);
 const totalEl=document.getElementById('salesSummaryTotal'),grossEl=document.getElementById('salesSummaryGross'),netEl=document.getElementById('salesSummaryNet');
 if(totalEl)totalEl.textContent=money(totalSales);if(grossEl)grossEl.textContent=money(gross);if(netEl)netEl.textContent=money(gross-expenseTotal);
}
document.getElementById('salesSummaryPeriod')?.addEventListener('change',event=>{selectedSalesSummaryPeriod=event.target.value;updateSalesPeriodSummary();});

function getProfile(){return db.profile||{businessName:'',businessLogo:''};}
function renderBrand(){const p=getProfile(),name=String(p.businessName||'').trim();document.getElementById('businessTitle').textContent=name||'Sellbook';document.getElementById('businessSubtitle').textContent=name?'Business records · Nigerian naira (₦)':'Simple business records · Nigerian naira (₦)';const logo=document.getElementById('headerBusinessLogo'),mark=document.getElementById('brandMark');if(p.businessLogo){logo.src=p.businessLogo;logo.style.display='block';mark.style.display='none';}else{logo.removeAttribute('src');logo.style.display='none';mark.style.display='grid';mark.textContent=(name||'Sellbook').split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'MS';}const input=document.getElementById('businessNameInput');if(input&&document.activeElement!==input)input.value=name;const preview=document.getElementById('businessLogoPreview');if(preview&&document.activeElement!==preview){if(p.businessLogo){preview.src=p.businessLogo;preview.style.display='block';}else{preview.removeAttribute('src');preview.style.display='none';}}}
let storageMode='memory';
// Keep the last confirmed local snapshot so failed writes cannot leave unsaved edits visible.
let lastSavedSnapshot=JSON.stringify(normalizeDb(db));
function load(){try{const raw=localStorage.getItem(DBKEY);if(raw)db=normalizeDb(JSON.parse(raw));else db=normalizeDb(db);lastSavedSnapshot=JSON.stringify(db);storageMode='browser';}catch(e){db=normalizeDb(db);lastSavedSnapshot=JSON.stringify(db);storageMode='memory';}}
function save(){try{db=normalizeDb(db);const serialized=JSON.stringify(db);localStorage.setItem(DBKEY,serialized);lastSavedSnapshot=serialized;storageMode='browser';return true;}catch(e){if(lastSavedSnapshot){try{db=normalizeDb(JSON.parse(lastSavedSnapshot));}catch(restoreError){console.error('Could not restore the last saved local records:',restoreError);}}storageMode=lastSavedSnapshot?'browser':'memory';render();alert('Could not save this change permanently. Your last successfully saved records have been restored. Check device storage and try again.');return false;}}

let cloudUser = null;
let cloudReady = false;
let workspaceReady = false;
let cloudBusy = false;

async function saveCloudChangesLocally(changes,options={}) {
  if(!cloudUser)throw Error('Sign in before saving business records.');
  try { enqueueChanges(changes); storageMode='cloud-offline'; render(); updateSyncStatus(); }
  catch(error) { throw Error('Could not safely save this change on the device. Free up browser storage and export a backup before trying again. '+(error.message||'')); }
  if(navigator.onLine&&options.syncNow!==false)await syncPendingChanges();
  return true;
}
async function saveCloudChangeLocally(type,payload,options={}) { return saveCloudChangesLocally([{type,payload}],options); }

function cloudMessage(text){const el=document.getElementById('accountMessage'),settings=document.getElementById('settingsAccountMessage');if(el)el.textContent=text;if(settings)settings.textContent=text;}


let localSnapshot = null;
let authTransition = false;
let pendingSync = [];
let syncingQueue = false;
let recoveryMode = window.location.hash.includes('type=recovery');
const cloudCacheKey = userId => 'my-sales-book-cloud-cache-v1:' + userId;
const cloudQueueKey = userId => 'my-sales-book-sync-queue-v1:' + userId;

function readQueue(userId=cloudUser?.id) {
  if (!userId) return [];
  try {
    const value = JSON.parse(localStorage.getItem(cloudQueueKey(userId)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
}
function writeQueue(queue, userId=cloudUser?.id) {
  if (!userId) throw Error('Sign in to keep changes attached to your account.');
  localStorage.setItem(cloudQueueKey(userId), JSON.stringify(queue));
  pendingSync = queue;
  updateSyncStatus();
}
function slimCloudCache(userId) {
  const queue=readQueue(userId);
  const queuedPhotoIds=new Set(queue.filter(item=>item.type==='product_save').map(item=>item.payload?.product?.id).filter(Boolean));
  return {
    ...db,
    products:db.products.map(product=>{
      const copy={...product};
      delete copy.offlineImage;
      if (queuedPhotoIds.has(product.id) && typeof copy.image==='string' && copy.image.startsWith('data:image/')) delete copy.image;
      return copy;
    })
  };
}
function cacheCloudData(userId=cloudUser?.id) {
  if (!userId) return false;
  try {
    localStorage.setItem(cloudCacheKey(userId), JSON.stringify(db));
    return true;
  } catch (error) {
    try {
      localStorage.setItem(cloudCacheKey(userId), JSON.stringify(slimCloudCache(userId)));
      cloudMessage('Your records are cached for offline use. Some product photos were omitted from the offline copy to fit device storage.');
      return true;
    } catch (_) {
      cloudMessage('This device could not cache all records for offline use. Export a backup and free browser storage.');
      return false;
    }
  }
}
function restoreCloudCache(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(cloudCacheKey(userId)) || 'null');
    if (value && Array.isArray(value.products) && Array.isArray(value.sales) && Array.isArray(value.expenses)) {
      db = value;
      storageMode = 'cloud-offline';
      workspaceReady = true;
      pendingSync = readQueue(userId);
      applyPendingToDb();
      render();
      updateSyncStatus();
      return true;
    }
  } catch (_) {}
  return false;
}
function updateSyncStatus() {
  const el = document.getElementById('syncStatus');
  const button = document.getElementById('syncNowBtn');
  if (!el || !button) return;
  const waiting = pendingSync.filter(item => item.status !== 'synced').length;
  const conflicts = pendingSync.filter(item => item.status === 'conflict').length;
  el.textContent = !cloudUser ? 'Sign in to sync your business records.' :
    conflicts ? conflicts + ' change(s) need attention. ' + waiting + ' change(s) remain unsynchronised.' :
    !navigator.onLine ? (waiting ? waiting + ' change(s) waiting to sync. Offline.' : 'Offline. Showing the last saved cloud records.') :
    waiting ? waiting + ' change(s) waiting to sync.' : 'All changes synchronised.';
  button.disabled = !cloudUser || !navigator.onLine || syncingQueue;
  const details = document.getElementById('syncDetails');
  if (details) {
    details.innerHTML = pendingSync.filter(item=>item.status!=='synced').slice(0,10).map(item=>{
      const payload=item.payload||{};
      const label=item.type==='product_save'?'Product: '+(payload.product?.name||'item'):
        item.type==='product_delete'?'Delete product: '+(payload.product?.name||'item'):
        item.type==='product_remove_image'?'Product photo: '+(payload.product?.name||'item'):
        item.type==='sale'?'Sale: '+(payload.sale?.name||'item'):
        item.type==='sale_import'?'Imported sale: '+(payload.sale?.name||'item'):
        item.type==='expense'?'Expense: '+(payload.expense?.name||'item'):item.type;
      const actions=item.status==='conflict'&&item.type==='product_save'
        ? '<div class="photo-actions"><select aria-label="Resolve product conflict" data-sync-choice="'+esc(item.id)+'"><option value="cloud">Use cloud version</option><option value="local">Keep this phone version</option></select><button type="button" data-resolve-sync="'+esc(item.id)+'">Apply choice</button></div><p class="muted">Your other unsynchronised products will be preserved.</p>'
        : '';
      return '<div class="item"><strong>'+esc(item.status==='conflict'?'Needs attention':item.error?'Sync failed':'Waiting to sync')+'</strong> · '+esc(label)+(item.error?'<div>'+esc(item.error)+'</div>':'')+actions+'</div>';
    }).join('');
    details.querySelectorAll('[data-resolve-sync]').forEach(button=>button.addEventListener('click',async()=>{
      const id=button.dataset.resolveSync;
      const selector=details.querySelector('[data-sync-choice="'+CSS.escape(id)+'"]');
      const choice=selector?.value;
      if(!choice)return;
      if(choice==='local'&&!confirm('Keep this phone’s product details and overwrite the cloud version? Check stock and selling price on both phones first.'))return;
      details.querySelectorAll('[data-resolve-sync]').forEach(b=>b.disabled=true);
      try { await resolveQueuedProductConflict(id,choice); }
      catch(error) { cloudMessage('Could not resolve this change: '+(error.message||String(error))); }
      finally { updateSyncStatus(); }
    }));
  }
}
function enqueueChanges(changes) {
  if (!cloudUser) throw Error('Sign in before saving business records.');
  if (!Array.isArray(changes) || !changes.length) return;
  const key=cloudQueueKey(cloudUser.id),previous=readQueue(cloudUser.id);
  const additions=changes.map(change=>{
    const payload=JSON.parse(JSON.stringify(change.payload));
    // A stable timestamp makes a product update safe to retry if the server committed
    // it but the phone lost the acknowledgement before updating its queue.
    if(change.type==='product_save'&&payload.product&&!payload.product.syncUpdatedAt)payload.product.syncUpdatedAt=now();
    return {id:crypto.randomUUID(),type:change.type,payload,createdAt:now(),status:'pending',error:''};
  });
  const next=[...previous,...additions];
  try {
    // Persist the complete queue first; it is the recovery source if the app closes mid-sync.
    localStorage.setItem(key,JSON.stringify(next));
    try { localStorage.setItem(cloudCacheKey(cloudUser.id),JSON.stringify(db)); }
    catch(cacheError) {
      localStorage.setItem(cloudCacheKey(cloudUser.id),JSON.stringify(slimCloudCache(cloudUser.id)));
      cloudMessage('Saved on this device. Some product photos may be unavailable offline because device storage is limited.');
    }
    pendingSync=next;
    updateSyncStatus();
  } catch(error) {
    try { localStorage.setItem(key,JSON.stringify(previous)); } catch(_) {}
    pendingSync=previous;
    updateSyncStatus();
    throw Error('Could not safely store this change on your device. Free up browser storage and try again. '+(error.message||''));
  }
}
function enqueueChange(type,payload){return enqueueChanges([{type,payload}]);}
function applyPendingToDb() {
  db=normalizeDb(db);
  for (const item of pendingSync) {
    if (item.status === 'synced') continue;
    const p = item.payload || {};
    if (item.type === 'product_save') {
      const product = p.product;
      if (!product) continue;
      const index = db.products.findIndex(x => x.id === product.id);
      if (index >= 0) db.products[index] = {...db.products[index], ...product};
      else db.products.push(product);
    } else if (item.type === 'product_delete') {
      db.products = db.products.filter(x => x.id !== p.product.id);
    } else if (item.type === 'product_remove_image') {
      const product = db.products.find(x => x.id === p.product.id);
      if (product) { product.image=''; product.imagePath=''; }
    } else if (item.type === 'sale') {
      if (!db.sales.some(x => x.id === p.sale.id)) {
        const product = db.products.find(x => x.id === p.sale.productId);
        if (product) product.stock = Math.max(0, product.stock - (p.sale.baseQty||p.sale.qty));
        db.sales.push(p.sale);
      }
    } else if (item.type === 'expense') {
      if (!db.expenses.some(x => x.id === p.expense.id)) db.expenses.push(p.expense);
    } else if (item.type === 'sale_import') {
      if (!db.sales.some(x => x.id === p.sale.id)) db.sales.push(p.sale);
    } else if(item.type==='stock_restock'){
      const r=p.restock;if(r){
        // Keep queued restocks visible in History after a cloud reload. The queue
        // is the durable local record until Supabase acknowledges the RPC.
        if(!db.restocks.some(x=>String(x.id)===String(r.id)))db.restocks.push(r);
        const product=db.products.find(x=>String(x.id)===String(r.productId));
        if(product){product.stock=r.newStock;product.cost=r.averageCostAfter;}
      }
    } else if(item.type==='stock_adjustment'){
      if(p.adjustment&&!db.stockAdjustments.some(x=>x.id===p.adjustment.id))db.stockAdjustments.push(p.adjustment);
    } else if(item.type==='profile_save'){
      if(p.profile)db.profile={...getProfile(),...p.profile};
    }
  }
}
async function currentProductVersion(productId) {
  const user = await requireCloudUser();
  const {data,error} = await supabaseClient.from('products').select('updated_at').eq('id',productId).eq('user_id',user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw Error('Conflict: this product no longer exists in your account.');
  return data.updated_at;
}
function propagateQueuedProductVersion(queue, fromIndex, productId, version) {
  for (let i=fromIndex+1;i<queue.length;i++) {
    const later=queue[i], payload=later.payload||{};
    if (later.type==='product_save' && payload.product?.id===productId && !payload.isNew) {
      payload.product.updatedAt=version;
      // This queued edit has not reached the server yet. Give it its own future
      // version marker so its write advances updated_at instead of reusing an
      // earlier sale/restock timestamp.
      payload.product.syncUpdatedAt=now();
    } else if (later.type==='product_delete' && payload.product?.id===productId) {
      payload.product.updatedAt=version;
    } else if (later.type==='sale' && payload.sale?.productId===productId) {
      payload.productUpdatedAt=version;
    } else if (later.type==='product_remove_image' && payload.product?.id===productId) {
      payload.product.updatedAt=version;
    }
  }
}

async function syncPendingChanges() {
  if (!cloudUser || !navigator.onLine || syncingQueue || !supabaseClient) return false;
  syncingQueue = true;
  try {
    let queue = readQueue(cloudUser.id);
    for (let queueIndex=0;queueIndex<queue.length;queueIndex++) {
      const item=queue[queueIndex];
      if (item.status === 'conflict') continue;
      try {
        const p = item.payload || {};
        if (item.type === 'product_save') {
          if (!p.isNew && p.product.updatedAt) {
            const currentVersion=await currentProductVersion(p.product.id);
            if(p.product.syncUpdatedAt&&currentVersion===p.product.syncUpdatedAt){
              // The database write already committed. Repeat the same idempotent update
              // so any unfinished photo publishing steps are retried as well.
              p.product.updatedAt=currentVersion;
            } else if (currentVersion!==p.product.updatedAt) {
              throw Error('Conflict: this product changed on another phone. Review the product and try again.');
            }
          }
          await cloudSaveProduct(p.product, p.isNew);
          const newVersion=await currentProductVersion(p.product.id);
          p.product.updatedAt=newVersion;
          propagateQueuedProductVersion(queue,queueIndex,p.product.id,newVersion);
        } else if (item.type === 'stock_restock') {
          const r=p.restock;
          const {error}=await supabaseClient.rpc('restock_product',{p_purchase_id:r.id,p_product_id:r.productId,p_purchase_quantity:r.purchaseQuantity,p_purchase_unit:r.purchaseUnit,p_units_per_purchase:r.unitsPerPurchase,p_cost_per_purchase_unit:r.costPerPurchaseUnit,p_restocked_at:r.date});
          if(error)throw error;
          // Restocking updates products.updated_at. Advance later queued changes for
          // this product so a sale made after the restock does not look stale.
          const newVersion=await currentProductVersion(r.productId);
          propagateQueuedProductVersion(queue,queueIndex,r.productId,newVersion);
        } else if (item.type === 'product_delete') {
          if (p.product.updatedAt) {
            const currentVersion=await currentProductVersion(p.product.id);
            if (currentVersion!==p.product.updatedAt) throw Error('Conflict: this product changed on another phone. Review it before deleting.');
          }
          await cloudDeleteProduct(p.product);
        } else if (item.type === 'product_remove_image') {
          if (p.product.updatedAt) {
            const currentVersion=await currentProductVersion(p.product.id);
            if (currentVersion!==p.product.updatedAt) throw Error('Conflict: this product changed on another phone. Review it before removing its photo.');
          }
          await cloudRemoveProductImage(p.product);
          const newVersion=await currentProductVersion(p.product.id);
          propagateQueuedProductVersion(queue,queueIndex,p.product.id,newVersion);
        } else if (item.type === 'sale') {
          if (!p.productUpdatedAt) throw Error('This sale was saved by an older app version and needs a fresh product check. Keep it on this phone and contact Sellbook Support before retrying.');
          const currentVersion=await currentProductVersion(p.sale.productId);
          if (currentVersion!==p.productUpdatedAt) throw Error('Conflict: this product changed on another phone. Check stock and product details before retrying this sale.');
          const {error} = await supabaseClient.rpc('record_sale_offline', {
            p_sale_id:p.sale.id,p_product_id:p.sale.productId,p_quantity:p.sale.qty,
            p_unit_price:p.sale.price,p_note:p.sale.note||null,p_sold_at:p.sale.date,
            p_units_per_sale:p.sale.unitsPerSale||1,p_sale_unit:p.sale.saleUnit||'unit',
            p_expected_updated_at:p.productUpdatedAt
          });
          if (error) throw error;
          const newVersion=await currentProductVersion(p.sale.productId);
          propagateQueuedProductVersion(queue,queueIndex,p.sale.productId,newVersion);
        } else if (item.type === 'sale_import') {
          const user = await requireCloudUser();
          const sale = p.sale;
          const {error} = await supabaseClient.from('sales').upsert({
            id:sale.id,user_id:user.id,product_id:sale.productId,product_name:sale.name,
            quantity:sale.qty,unit_price:sale.price,unit_cost:sale.cost,total:sale.total,
            gross_profit:sale.profit,note:sale.note||null,sold_at:sale.date
          }, {onConflict:'id',ignoreDuplicates:true});
          if (error) throw error;
        } else if (item.type === 'expense') {
          const user = await requireCloudUser();
          const {error} = await supabaseClient.from('expenses').upsert({
            id:p.expense.id,user_id:user.id,description:p.expense.name,
            amount:p.expense.amount,spent_at:p.expense.date
          }, {onConflict:'id',ignoreDuplicates:true});
          if (error) throw error;
        } else if(item.type==='stock_adjustment'){
          const user=await requireCloudUser(),a=p.adjustment;
          const blocked=queue.slice(0,queueIndex).some(q=>q.status==='conflict'&&q.type==='product_save'&&q.payload?.product?.id===a.productId);
          if(blocked)throw Error('Conflict: this stock adjustment is waiting for a product change to be reviewed on this device.');
          const {error}=await supabaseClient.from('stock_adjustments').upsert({id:a.id,user_id:user.id,product_id:a.productId,product_name:a.productName,previous_stock:a.previousStock,new_stock:a.newStock,quantity_change:a.quantityChange,reason:a.reason||'',adjusted_at:a.date},{onConflict:'id',ignoreDuplicates:true});
          if(error)throw error;
        } else if(item.type==='profile_save'){
          const user=await requireCloudUser(),profile=p.profile||{};
          const {error}=await supabaseClient.from('user_profiles').upsert({user_id:user.id,business_name:String(profile.businessName||'').slice(0,100),business_logo:profile.businessLogo||null,updated_at:now()},{onConflict:'user_id'});
          if(error)throw error;
        }
        item.status = 'synced';
        item.error = '';
        writeQueue(queue, cloudUser.id);
      } catch (error) {
        item.error = error.message || String(error);
        item.status = /insufficient stock|product not found|belongs to another account|duplicate key|unique constraint|conflict/i.test(item.error)
          ? 'conflict' : 'pending';
        writeQueue(queue, cloudUser.id);
        break;
      }
    }
    queue = queue.filter(item => item.status !== 'synced');
    writeQueue(queue, cloudUser.id);
    if (!queue.length) {
      // Every queued operation has already been acknowledged by Supabase. A failed
      // follow-up refresh must not make callers roll back data that is already saved.
      try { await cloudLoadAll(); }
      catch(refreshError) {
        storageMode='cloud-offline';
        cacheCloudData(cloudUser.id);
        render();
        cloudMessage('Your changes were synchronised. Sellbook could not refresh the latest cloud copy, so it is showing the saved records on this device.');
        console.warn('Cloud refresh after successful sync failed:',refreshError);
      }
    } else {
      pendingSync = queue;
      applyPendingToDb();
      storageMode = 'cloud-offline';
      render();
      cacheCloudData(cloudUser.id);
      const firstError = queue.find(item => item.error)?.error;
      cloudMessage('Some changes are still waiting to sync. Your local copies are kept.' + (firstError ? ' Problem: ' + firstError : ''));
    }
    updateSyncStatus();
    return queue.length === 0;
  } finally {
    syncingQueue = false;
    updateSyncStatus();
  }
}


function snapshotLocalRecords() {
  try {
    const raw = localStorage.getItem(DBKEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value && Array.isArray(value.products) &&
        Array.isArray(value.sales) && Array.isArray(value.expenses)) {
      return JSON.parse(JSON.stringify(value));
    }
  } catch (_) {}
  return null;
}

function restoreLocalRecords() {
  // Never carry the previous cloud account's sync indicators into the local workspace.
  pendingSync = [];
  db = localSnapshot || {products: [], sales: [], expenses: []};
  storageMode = 'browser';
  cloudReady = false;
  workspaceReady = false;
  cloudUser = null;
  render();
}

async function handleCloudAuthChange() {
  if (authTransition) return;
  authTransition = true;
  let activeUser = null;
  let coreWorkspaceLoaded = false;
  // Never leave the full-screen startup indicator spinning indefinitely on a slow connection.
  const loadingWatchdog = setTimeout(() => {
    document.body.classList.remove('auth-initializing');
    const loading = document.getElementById('authLoading');
    if (loading) loading.style.display = 'none';
    if (!coreWorkspaceLoaded && cloudUser) {
      cloudMessage('Still connecting to your cloud records. Your saved copy remains available while Sellbook retries.');
    }
  }, 10000);
  const finishStartup = () => {
    document.body.classList.remove('auth-initializing');
    const loading = document.getElementById('authLoading');
    if (loading) loading.style.display = 'none';
  };
  try {
    const {data, error} = await supabaseClient.auth.getSession();
    if (error) throw error;
    const user = data.session?.user || null;
    activeUser = user;

    if (user) {
      if (storageMode !== 'cloud') localSnapshot = snapshotLocalRecords();
      cloudUser = user;
      pendingSync = readQueue(user.id);
      // Paint this account's last saved workspace immediately, then refresh it from Supabase.
      // This keeps returning sellers out of a blank startup state on slow mobile connections.
      const hasCachedWorkspace = restoreCloudCache(user.id);
      if (hasCachedWorkspace) {
        // Reveal the cached view immediately while the cloud refresh runs in the background.
        document.getElementById('appWorkspace').classList.remove('hidden');
        document.getElementById('accountCard').classList.add('hidden');
        finishStartup();
        cloudMessage('Showing your saved records while Sellbook checks for the latest updates.');
      }
      try {
        await cloudLoadAll();
        coreWorkspaceLoaded = true;
        finishStartup();
        if (pendingSync.some(item => item.status !== 'conflict')) {
          syncPendingChanges().catch(error => {
            cloudMessage('Some changes are still waiting to sync. Your local copies are preserved: ' + (error.message || String(error)));
          });
        }
      } catch (loadError) {
        if (!restoreCloudCache(user.id)) throw loadError;
        cloudReady = false;
        storageMode = 'cloud-offline';
        coreWorkspaceLoaded = true;
        finishStartup();
        cloudMessage('Showing your last saved copy while Sellbook reconnects. Changes will be kept on this device until they can sync.');
      }
    } else {
      restoreLocalRecords();
      coreWorkspaceLoaded = true;
      finishStartup();
      cloudMessage('Sign in to access your private business records.');
    }

    // These checks are useful but must not block the business book from opening.
    refreshAccountStatus().catch(error => console.warn('Account status refresh failed:', error));
    if (cloudUser) {
      verifyAdminAccess().then(async () => {
        if (currentPage() === 'admin' && sellbookIsAdmin) await loadAdminDashboard();
      }).catch(error => console.warn('Admin access check failed:', error));
      loadUserSupport().catch(error => console.warn('Support panel refresh failed:', error));
    }
  } catch (err) {
    cloudReady = false;
    if (activeUser) {
      cloudUser = activeUser;
      const restored = restoreCloudCache(activeUser.id);
      if (restored) {
        coreWorkspaceLoaded = true;
        finishStartup();
        cloudMessage('Could not reach the cloud. Showing the last saved copy; queued changes remain on this device.');
        refreshAccountStatus().catch(error => console.warn('Account status refresh failed:', error));
      } else {
        workspaceReady = false;
        document.getElementById('appWorkspace').classList.add('hidden');
        cloudMessage('Could not reach the cloud and no saved copy exists on this device. Connect to the internet to load your account for the first time.');
        refreshAccountStatus().catch(error => console.warn('Account status refresh failed:', error));
      }
    } else {
      workspaceReady = false;
      document.getElementById('appWorkspace').classList.add('hidden');
      cloudMessage('Cloud connection failed: ' + (err.message || String(err)) + '. Sign in again when internet is available.');
      refreshAccountStatus().catch(error => console.warn('Account status refresh failed:', error));
    }
    console.error('Cloud authentication/load error:', err);
  } finally {
    clearTimeout(loadingWatchdog);
    finishStartup();
    authTransition = false;
    // Refresh Me-panel identity after the persisted auth session has been restored.
    // On a page refresh, paintPage() may run before Supabase returns the session.
    updateMePanel();
    if (currentPage() === 'me') render();
  }
}
async function loadBuybookConnection() {
  const status=document.getElementById('buybookConnectionStatus');
  const form=document.getElementById('buybookConnectionForm');
  const disconnect=document.getElementById('buybookDisconnectButton');
  const activity=document.getElementById('buybookSellerActivity');
  if(!status)return;
  const setConnectionView=(connected)=>{buybookConnectionState=connected;renderGettingStarted();
    status.textContent=connected?'Connected to Buybook':'Not connected to Buybook';
    status.classList.toggle('connected',connected);
    status.classList.toggle('not-connected',!connected);
    if(form)form.classList.toggle('hidden',connected);
    if(disconnect)disconnect.classList.toggle('hidden',!connected);
    if(activity)activity.classList.toggle('hidden',!connected);
  };
  if(!cloudUser){setConnectionView(false);status.textContent='Sign in to Sellbook to connect to Buybook.';if(activity)activity.classList.add('hidden');return;}
  status.textContent='Checking Buybook connection…';
  const {data,error}=await supabaseClient.from('marketplace_shops').select('name,description,phone,address,city,state,is_connected,is_active').eq('owner_id',cloudUser.id).maybeSingle();
  if(error){buybookConnectionState=null;setConnectionView(false);buybookConnectionState=null;renderGettingStarted();status.textContent='Could not check Buybook connection. Please try again.';console.error(error);return;}
  const connected=!!(data&&data.is_connected&&data.is_active);
  if(data){
    document.getElementById('buybookShopName').value=data.name||'';
    document.getElementById('buybookDescription').value=data.description||'';
    document.getElementById('buybookPhone').value=data.phone||'';
    document.getElementById('buybookAddress').value=data.address||'';
    document.getElementById('buybookCity').value=data.city||'';
    document.getElementById('buybookState').value=data.state||'Osun';
  }else{
    document.getElementById('buybookShopName').value=db.profile?.businessName||cloudUser.user_metadata?.business_name||cloudUser.user_metadata?.full_name||'';
  }
  setConnectionView(connected);
  if(connected) await loadBuybookActivity();
}
let buybookConnectionState=null;
let marketplaceSubscribersCache=[];
let marketplaceSelectedBuyerId=null;
let marketplaceActivityBusy=false;
function marketplaceBuyerName(id){return marketplaceSubscribersCache.find(x=>x.buyer_id===id)?.display_name||('Buyer '+String(id||'').slice(-6));}
async function loadBuybookActivity(){
 const subscribersTarget=document.getElementById('marketplaceSubscriberList');
 const reservationsTarget=document.getElementById('marketplaceReservationsList');
 if(!subscribersTarget||!reservationsTarget)return;
 if(!cloudUser||!supabaseClient){subscribersTarget.innerHTML='<div class="empty">Sign in to see your subscribers.</div>';reservationsTarget.innerHTML='<div class="empty">Sign in to view product reservations.</div>';return;}
 if(marketplaceActivityBusy)return;
 marketplaceActivityBusy=true;
 try{
  const {data:subs,error:subsError}=await supabaseClient.rpc('get_my_marketplace_subscribers');
  if(subsError)throw subsError;
  marketplaceSubscribersCache=subs||[];
  subscribersTarget.className=marketplaceSubscribersCache.length?'marketplace-subscriber-list':'empty';
  subscribersTarget.innerHTML=marketplaceSubscribersCache.length?marketplaceSubscribersCache.map(sub=>'<button type="button" class="marketplace-subscriber-button '+(marketplaceSelectedBuyerId===sub.buyer_id?'active':'')+'" data-marketplace-buyer="'+escAdmin(sub.buyer_id)+'"><span class="chat-support-avatar" aria-hidden="true">👤</span><span class="subscriber-meta"><strong>'+escAdmin(sub.display_name||marketplaceBuyerName(sub.buyer_id))+'</strong><small>Subscribed '+escAdmin(new Date(sub.created_at).toLocaleDateString())+'</small></span><span aria-hidden="true">›</span></button>').join(''):'No subscribers yet. When a buyer subscribes to your shop on Buybook, they will appear here.';
  const {data:reservations,error:reservationError}=await supabaseClient.from('marketplace_reservations').select('id,buyer_id,status,buyer_note,created_at,expires_at').eq('owner_id',cloudUser.id).order('created_at',{ascending:false}).limit(50);
  if(reservationError)throw reservationError;
  let items=[];
  if((reservations||[]).length){const {data,error}=await supabaseClient.from('marketplace_reservation_items').select('reservation_id,product_name,quantity,unit_price').in('reservation_id',reservations.map(r=>r.id));if(error)throw error;items=data||[];}
  const itemsByReservation={};for(const item of items){(itemsByReservation[item.reservation_id] ||= []).push(item);}
  reservationsTarget.className=(reservations||[]).length?'':'empty';
  reservationsTarget.innerHTML=(reservations||[]).length?reservations.map(r=>{
   const lines=itemsByReservation[r.id]||[];
   const products=lines.map(x=>escAdmin(x.product_name)+' × '+Number(x.quantity||0)+' · '+money(Number(x.unit_price||0)*Number(x.quantity||0))).join('<br>');
   const status=String(r.status||'pending').replace(/[_-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());
   return '<div class="marketplace-reservation"><div class="reservation-top"><strong>'+escAdmin(marketplaceBuyerName(r.buyer_id))+'</strong><span class="status-pill">'+escAdmin(status)+'</span></div><p>'+ (products||'Product details unavailable') +'</p>'+(r.buyer_note?'<p class="muted">Buyer note: '+escAdmin(r.buyer_note)+'</p>':'')+'<div class="muted">'+escAdmin(new Date(r.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(r.expires_at?' · Expires '+escAdmin(new Date(r.expires_at).toLocaleString([], {dateStyle:'short',timeStyle:'short'})):'')+'</div></div>';
  }).join(''):'No product reservations yet.';
  if(marketplaceSelectedBuyerId&&!marketplaceSubscribersCache.some(x=>x.buyer_id===marketplaceSelectedBuyerId)){marketplaceSelectedBuyerId=null;}
  if(marketplaceSelectedBuyerId){const selector=document.getElementById('messageConversationSelect');if(selector)selector.value=marketplaceSelectedBuyerId;}
 }catch(err){
  if(!marketplaceSubscribersCache.length)subscribersTarget.innerHTML='Could not load subscribers: '+escAdmin(err.message||String(err));
  reservationsTarget.innerHTML='Could not load reservations: '+escAdmin(err.message||String(err));
 }finally{marketplaceActivityBusy=false;}
}
document.getElementById('marketplaceSubscriberList')?.addEventListener('click',event=>{const button=event.target.closest('[data-marketplace-buyer]');if(button){marketplaceSelectedBuyerId=button.dataset.marketplaceBuyer;showPage('support');loadUserSupport();}});
document.getElementById('refreshBuybookActivity')?.addEventListener('click',async()=>{await loadBuybookConnection();await loadBuybookActivity();});
document.getElementById('buybookConnectionForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const message=document.getElementById('buybookConnectionMessage'),button=document.getElementById('buybookConnectButton');
 if(!navigator.onLine){message.textContent='Connect to the internet to set up Buybook.';return;}
 button.disabled=true;message.textContent='Connecting your shop…';
 try{const user=await requireCloudUser();const shop={owner_id:user.id,name:document.getElementById('buybookShopName').value.trim(),description:document.getElementById('buybookDescription').value.trim()||null,phone:document.getElementById('buybookPhone').value.trim()||null,address:document.getElementById('buybookAddress').value.trim(),city:document.getElementById('buybookCity').value.trim(),state:document.getElementById('buybookState').value.trim(),country:'Nigeria',is_connected:true,is_active:true};
 const {error}=await supabaseClient.from('marketplace_shops').upsert(shop,{onConflict:'owner_id'});if(error)throw error;
 const sync=await supabaseClient.rpc('sync_owner_marketplace_listings',{p_owner_id:user.id});if(sync.error)throw sync.error;
 for(const product of (db.products||[])){if(product.imagePath){try{await cloudPublishMarketplaceImage(product,user,product.offlineImage||null,product.imagePath);}catch(imageError){console.warn('Buybook image sync skipped for product:',product.id,imageError);}}}
 message.textContent='Connected successfully. Your products will appear automatically on Buybook. Only marketplace product details and shop information are shared.';await loadBuybookConnection();
 }catch(err){message.textContent='Could not connect: '+(err.message||'Please try again when online.');console.error('Buybook connection error:',err);}finally{button.disabled=false;}
});
document.getElementById('buybookDisconnectButton')?.addEventListener('click',async()=>{
 if(!cloudUser){alert('Sign in to Sellbook first.');return;}if(!confirm('Disconnect your shop from Buybook? Your Sellbook records will remain unchanged.'))return;
 const message=document.getElementById('buybookConnectionMessage');try{const user=await requireCloudUser();const {error}=await supabaseClient.from('marketplace_shops').update({is_connected:false}).eq('owner_id',user.id);if(error)throw error;const sync=await supabaseClient.rpc('sync_owner_marketplace_listings',{p_owner_id:user.id});if(sync.error)throw sync.error;message.textContent='Disconnected. Your products are no longer listed on Buybook. Sellbook records remain unchanged.';await loadBuybookConnection();}catch(err){message.textContent='Could not disconnect: '+(err.message||'Please try again.');}
});
async function cloudAction(action) {
  if (cloudBusy) {
    alert('Please wait for the current cloud operation to finish.');
    return false;
  }
  cloudBusy = true;
  try {
    await action();
    return true;
  } catch (err) {
    alert('Cloud operation failed: ' + (err.message || String(err)));
    console.error(err);
    return false;
  } finally {
    cloudBusy = false;
  }
}

async function requireCloudUser() {
  if (!supabaseClient) throw Error('Cloud connection is unavailable.');
  const {data,error}=await supabaseClient.auth.getUser();
  if(error) throw error;
  if(!data.user) throw Error('Sign in with Google before saving cloud records.');
  cloudUser=data.user;
  return data.user;
}

async function imageUrlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error('Could not cache product photo for offline use.');
  const blob = await response.blob();
  return await new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(String(reader.result||''));
    reader.onerror = ()=>reject(Error('Could not cache product photo.'));
    reader.readAsDataURL(blob);
  });
}

async function cloudLoadAll() {
  const user=await requireCloudUser();
  // Stock-before and stock-after are persisted in Supabase so history is complete on every device.
  // Keep cached values only as a compatibility fallback for older rows.
  const cachedRestockDetails=new Map((db.restocks||[]).map(item=>[String(item.id),item]));
  const [pr,sr,er,ar,rr,profileResult]=await Promise.all([
    supabaseClient.from('products').select('id,name,category,cost_price,selling_price,stock,base_unit,purchase_unit,units_per_purchase,pack_unit,units_per_pack,pack_selling_price,image_path,created_at,updated_at').eq('user_id',user.id).order('created_at'),
    supabaseClient.from('sales').select('id,product_id,product_name,quantity,unit_price,unit_cost,total,gross_profit,note,sold_at,base_quantity,sale_unit,units_per_sale').eq('user_id',user.id).order('sold_at'),
    supabaseClient.from('expenses').select('id,description,amount,spent_at').eq('user_id',user.id).order('spent_at'),
    supabaseClient.from('stock_adjustments').select('id,product_id,product_name,previous_stock,new_stock,quantity_change,reason,adjusted_at').eq('user_id',user.id).order('adjusted_at',{ascending:false}),
    supabaseClient.from('stock_purchases').select('id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,base_quantity,cost_per_purchase_unit,total_cost,average_cost_before,average_cost_after,previous_stock,new_stock,restocked_at').eq('user_id',user.id).order('restocked_at',{ascending:false}),
    supabaseClient.from('user_profiles').select('business_name,business_logo').eq('user_id',user.id).maybeSingle()
  ]);
  if(pr.error)throw pr.error;if(sr.error)throw sr.error;if(er.error)throw er.error;if(ar.error)throw ar.error;if(rr.error)throw rr.error;if(profileResult.error)throw profileResult.error;
  let fallbackProfile={business_name:'',business_logo:null};
  if(!profileResult.data){const identity=String(user.user_metadata?.business_name||user.user_metadata?.full_name||user.email?.split('@')[0]||'My').trim();fallbackProfile={business_name:(identity.endsWith('Business')?identity:identity+' Business').slice(0,100),business_logo:null};const {error}=await supabaseClient.from('user_profiles').upsert({user_id:user.id,...fallbackProfile,updated_at:now()},{onConflict:'user_id',ignoreDuplicates:true});if(error)throw error;}
  // Build the product list without waiting for one signed-photo URL per product.
  // The records can render first; product photos are resolved in the background.
  const products=(pr.data||[]).map(row=>({
    id:row.id,name:row.name,category:normalizeCategory(row.category),
    cost:Number(row.cost_price),price:Number(row.selling_price),stock:Number(row.stock),
    baseUnit:row.base_unit||'unit',purchaseUnit:row.purchase_unit||'unit',
    unitsPerPurchase:Number(row.units_per_purchase||1),packUnit:row.pack_unit||'',
    unitsPerPack:Number(row.units_per_pack||1),
    packPrice:row.pack_selling_price==null?null:Number(row.pack_selling_price),
    image:'',offlineImage:'',imagePath:row.image_path||'',
    createdAt:row.created_at,updatedAt:row.updated_at
  }));
  const sales=(sr.data||[]).map(row=>({id:row.id,productId:row.product_id,name:row.product_name,qty:Number(row.quantity),price:Number(row.unit_price),cost:Number(row.unit_cost),total:Number(row.total),profit:Number(row.gross_profit),note:row.note||'',date:row.sold_at,baseQty:Number(row.base_quantity||row.quantity),saleUnit:row.sale_unit||'unit',unitsPerSale:Number(row.units_per_sale||1)}));
  const expenses=(er.data||[]).map(row=>({id:row.id,name:row.description,amount:Number(row.amount),date:row.spent_at}));
  const stockAdjustments=(ar.data||[]).map(row=>({id:row.id,productId:row.product_id,productName:row.product_name,previousStock:Number(row.previous_stock),newStock:Number(row.new_stock),quantityChange:Number(row.quantity_change),reason:row.reason||'',date:row.adjusted_at}));
  const restocks=(rr.data||[]).map(row=>{
    const cached=cachedRestockDetails.get(String(row.id));
    return {id:row.id,productId:row.product_id,productName:row.product_name,
      purchaseQuantity:Number(row.purchase_quantity),purchaseUnit:row.purchase_unit,
      unitsPerPurchase:Number(row.units_per_purchase),baseQuantity:Number(row.base_quantity),
      costPerPurchaseUnit:Number(row.cost_per_purchase_unit),totalCost:Number(row.total_cost),
      averageCostBefore:Number(row.average_cost_before),averageCostAfter:Number(row.average_cost_after),
      previousStock:row.previous_stock??cached?.previousStock,newStock:row.new_stock??cached?.newStock,date:row.restocked_at};
  });
  const profile=profileResult.data||fallbackProfile;
  db=normalizeDb({products,sales,expenses,stockAdjustments,restocks,profile:{businessName:profile.business_name||'',businessLogo:profile.business_logo||''}});
  storageMode='cloud';
  cloudReady=true;
  workspaceReady=true;
  pendingSync=readQueue(user.id);
  applyPendingToDb();
  render();
  refreshHomeSubscriberCount();
  cacheCloudData(user.id);
  updateSyncStatus();

  // Load signed product-photo URLs after the sales workspace is already visible.
  // Guard against an account switch while the background requests are running.
  const productsWithImages=products.filter(product=>product.imagePath);
  if(productsWithImages.length){
    setTimeout(async()=>{
      if(!cloudUser||cloudUser.id!==user.id||!navigator.onLine)return;
      // Keep concurrent image requests small so a large catalogue does not
      // compete with the seller's first interactions on a mobile connection.
      const results=[];
      for(let offset=0;offset<productsWithImages.length;offset+=4){
        if(!cloudUser||cloudUser.id!==user.id)return;
        const batch=await Promise.all(productsWithImages.slice(offset,offset+4).map(async product=>{
          try{
            const {data,error}=await supabaseClient.storage.from('product-images').createSignedUrl(product.imagePath,3600);
            return !error&&data?.signedUrl?{id:product.id,image:data.signedUrl}:null;
          }catch(_){return null;}
        }));
        results.push(...batch);
      }
      if(!cloudUser||cloudUser.id!==user.id)return;
      let changed=false;
      for(const result of results){
        if(!result)continue;
        const current=db.products.find(product=>String(product.id)===String(result.id));
        if(current&&current.image!==result.image){current.image=result.image;changed=true;}
      }
      if(changed){render();cacheCloudData(user.id);}
    },0);
  }

  cloudMessage(pendingSync.length
    ? pendingSync.length + ' change(s) are waiting to sync. Your local copies are preserved.'
    : 'Cloud records loaded and synchronised.');
  // Marketplace photo repair is non-critical to the sales workspace.
  // Defer it until after the first render so it cannot delay opening Sellbook.
  setTimeout(async () => {
    if (!cloudUser || cloudUser.id !== user.id || !navigator.onLine) return;
    try {
      const {data:shop}=await supabaseClient.from('marketplace_shops').select('is_connected,is_active').eq('owner_id',user.id).maybeSingle();
      if(!shop?.is_connected||!shop?.is_active) return;
      const imageProducts=products.filter(product=>product.imagePath);
      // Fetch listing image states in batches instead of making one database
      // request per product (an N+1 request pattern).
      for(let offset=0;offset<imageProducts.length;offset+=100){
        if(!cloudUser||cloudUser.id!==user.id||!navigator.onLine)return;
        const batch=imageProducts.slice(offset,offset+100);
        const {data:listings,error}=await supabaseClient.from('marketplace_listings').select('product_id,image_url').eq('owner_id',user.id).in('product_id',batch.map(product=>product.id));
        if(error)continue;
        const listingByProduct=new Map((listings||[]).map(listing=>[String(listing.product_id),listing]));
        for(const product of batch){
          if(!cloudUser||cloudUser.id!==user.id||!navigator.onLine)return;
          const listing=listingByProduct.get(String(product.id));
          if(listing&&!listing.image_url){
            try{await cloudPublishMarketplaceImage(product,user,product.offlineImage||null,product.imagePath);}
            catch(imageError){console.warn('Background marketplace photo publishing skipped:',product.id,imageError);}
          }
        }
      }
    } catch(imageSyncError) { console.warn('Background marketplace photo sync skipped:',imageSyncError); }
  }, 1500);
}

async function cloudUploadProductImage(imageData) {
  if(!imageData||!imageData.startsWith('data:image/')) return null;
  const user=await requireCloudUser();
  const match=imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!match) throw Error('Choose a JPEG, PNG, or WebP photo.');
  const mime=match[1];
  const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
  const path=user.id+'/'+crypto.randomUUID()+'.'+ext;
  const {error}=await supabaseClient.storage.from('product-images').upload(path,new Blob([bytes],{type:mime}),{contentType:mime,upsert:false});
  if(error) throw error;
  return path;
}

async function cloudPublishMarketplaceImage(product, user, imageData, existingPath) {
  if (!product || !user) return;
  // Do not publish/copy images for a shop that is disconnected or for a
  // product that is no longer listed. This avoids orphaned public uploads.
  const {data:listing,error:listingError}=await supabaseClient.from('marketplace_listings')
    .select('product_id').eq('product_id',product.id).eq('owner_id',user.id).eq('is_active',true).maybeSingle();
  if(listingError) throw listingError;
  if(!listing) return;
  let blob = null, mime = 'image/jpeg', ext = 'jpg';
  if (imageData && imageData.startsWith('data:image/')) {
    const match=imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!match) throw Error('Choose a JPEG, PNG, or WebP photo.');
    mime=match[1]; ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
    blob=new Blob([Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))],{type:mime});
  } else if (existingPath) {
    const signed=await supabaseClient.storage.from('product-images').createSignedUrl(existingPath,300);
    if(signed.error||!signed.data?.signedUrl) throw (signed.error||Error('Could not read the existing product image.'));
    const response=await fetch(signed.data.signedUrl);
    if(!response.ok) throw Error('Could not copy the existing product image.');
    blob=await response.blob(); mime=blob.type||mime;
    ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  }
  if(!blob) return;
  const path=user.id+'/'+product.id+'-'+crypto.randomUUID()+'.'+ext;
  const {error:uploadError}=await supabaseClient.storage.from('marketplace-product-images').upload(path,blob,{contentType:mime,upsert:false});
  if(uploadError) throw uploadError;
  const {data:publicData}=supabaseClient.storage.from('marketplace-product-images').getPublicUrl(path);
  const publicUrl=publicData?.publicUrl;
  if(!publicUrl){
    await supabaseClient.storage.from('marketplace-product-images').remove([path]);
    throw Error('Could not create the marketplace image URL.');
  }
  const {error:updateError,data:updatedRows}=await supabaseClient.from('marketplace_listings')
    .update({image_url:publicUrl}).eq('product_id',product.id).eq('owner_id',user.id).select('product_id');
  if(updateError||!updatedRows?.length){
    const {error:cleanupError}=await supabaseClient.storage.from('marketplace-product-images').remove([path]);
    if(cleanupError) console.warn('Could not clean up an unpublished marketplace image:',cleanupError.message);
    if(updateError) throw updateError;
    throw Error('The product is no longer listed on Buybook. Its photo was not published.');
  }
}

async function cloudSaveProduct(product,isNew) {
  const user=await requireCloudUser();
  // Keep the original photo data before replacing it with a signed private-bucket URL.
  // The original data is the most reliable source for publishing the matching Buybook photo.
  const newImageData=product.image&&product.image.startsWith('data:image/')?product.image:null;
  const imagePath= newImageData ? await cloudUploadProductImage(newImageData) : (product.imagePath||null);
  const row={user_id:user.id,name:product.name,category:normalizeCategory(product.category),cost_price:product.cost,selling_price:product.price,stock:product.stock,base_unit:product.baseUnit||'unit',purchase_unit:product.purchaseUnit||'unit',units_per_purchase:product.unitsPerPurchase||1,pack_unit:product.packUnit||null,units_per_pack:product.packUnit?(product.unitsPerPack||1):null,pack_selling_price:product.packUnit&&product.packPrice?product.packPrice:null,image_path:imagePath,updated_at:product.syncUpdatedAt||now()};
  const result=isNew
    // Retrying after a timed-out response must not create a duplicate-key conflict.
    ? await supabaseClient.from('products').upsert({id:product.id,...row},{onConflict:'id'})
    : await supabaseClient.from('products').update(row).eq('id',product.id).eq('user_id',user.id);
  if(result.error) throw result.error;
  if(newImageData){
    const oldPath=product.imagePath;
    product.imagePath=imagePath;
    const {data}=await supabaseClient.storage.from('product-images').createSignedUrl(imagePath,3600);
    product.image=data?.signedUrl||'';
    if(oldPath&&oldPath!==imagePath) await supabaseClient.storage.from('product-images').remove([oldPath]);
  }
  // Publish the exact newly selected photo; otherwise copy the existing private photo.
  // A marketplace copy is separate from the private image used by Sellbook.
  if(imagePath) await cloudPublishMarketplaceImage(product,user,newImageData||product.offlineImage||null,newImageData?null:imagePath);
}

async function resolveQueuedProductConflict(queueItem,choice) {
  if(!cloudUser||!navigator.onLine) throw Error('Connect to the internet before resolving this conflict.');
  const queue=readQueue(cloudUser.id), index=queue.findIndex(x=>x.id===queueItem);
  if(index<0) throw Error('This queued change is no longer available.');
  const item=queue[index], p=item.payload||{}, queuedProduct=p.product;
  if(item.type!=='product_save'||!queuedProduct) throw Error('This conflict needs a different recovery method. Your records are unchanged.');
  const resolvedId=queuedProduct.id;
  if(choice==='cloud') {
    // Snapshot local products before refreshing cloud data. Keep every other unsynchronised
    // product on this device; resolving one conflict must never erase unrelated products.
    const localProducts=(db.products||[]).map(x=>({...x}));
    // Remove queued edits for this same product: choosing cloud means none of those edits
    // should subsequently overwrite the cloud copy.
    const remaining=queue.filter(x=>!(x.type==='product_save'&&x.payload?.product?.id===resolvedId));
    writeQueue(remaining,cloudUser.id);
    await cloudLoadAll();
    const cloudIds=new Set(db.products.map(x=>x.id));
    const queuedProductIds=new Set(readQueue(cloudUser.id).filter(x=>x.type==='product_save').map(x=>x.payload?.product?.id));
    const preserve=localProducts.filter(x=>x.id!==resolvedId&&!cloudIds.has(x.id)&&!queuedProductIds.has(x.id));
    if(preserve.length) {
      db.products.push(...preserve);
      const latestQueue=readQueue(cloudUser.id);
      for(const localProduct of preserve) latestQueue.push({id:crypto.randomUUID(),type:'product_save',payload:{product:{...localProduct},isNew:true},createdAt:now(),status:'pending',error:'Preserved from this device after resolving another product conflict. Review if the cloud reports a duplicate name.'});
      writeQueue(latestQueue,cloudUser.id);
      applyPendingToDb();
      render();
      cacheCloudData(cloudUser.id);
      updateSyncStatus();
      cloudMessage('Used the cloud version for this product. Other recently added products were preserved and queued for sync.');
    } else {
      cloudMessage('Used the cloud version for this product. Other queued products remain on this device.');
    }
    return;
  }
  if(choice!=='local') throw Error('Unknown conflict choice.');
  const user=await requireCloudUser();
  // Use the newest copy currently on this phone, not an older queued snapshot.
  const phoneProduct=(db.products||[]).find(x=>x.id===resolvedId)||queuedProduct;
  const product={...phoneProduct};
  const {data:existing,error:findError}=await supabaseClient.from('products')
    .select('id,name,category,cost_price,selling_price,stock,image_path,updated_at')
    .eq('user_id',user.id).ilike('name',String(product.name||'').trim()).limit(2);
  if(findError) throw findError;
  let targetId=resolvedId, isNew=!!p.isNew;
  if(isNew) {
    if(!existing||existing.length!==1) throw Error('Cannot safely keep this version: no single matching cloud product was found. Rename or review the product first.');
    targetId=existing[0].id;
    product.id=targetId;
    isNew=false;
  } else {
    const match=(existing||[]).find(x=>x.id===resolvedId);
    if(!match) throw Error('This product no longer exists in the cloud. Keep the cloud records and review before recreating it.');
  }
  const {data:latest,error:latestError}=await supabaseClient.from('products').select('updated_at').eq('id',targetId).eq('user_id',user.id).single();
  if(latestError) throw latestError;
  product.updatedAt=latest.updated_at;
  // Collapse multiple queued edits for this product into one newest phone version. This
  // prevents an older queued snapshot from causing another conflict or undoing the latest edit.
  const updatedItem={...item,payload:{...p,product,isNew},status:'pending',error:''};
  const nextQueue=queue.filter((x,i)=>i===index||!(x.type==='product_save'&&x.payload?.product?.id===resolvedId));
  const updatedIndex=nextQueue.findIndex(x=>x.id===item.id);
  nextQueue[updatedIndex]=updatedItem;
  for(let i=0;i<nextQueue.length;i++){
    if(i===updatedIndex) continue;
    const later=nextQueue[i], lp=later.payload||{};
    if(lp.product?.id===targetId && later.type==='product_save' && !lp.isNew) lp.product.updatedAt=latest.updated_at;
    if(later.type==='sale'&&lp.sale?.productId===targetId) lp.productUpdatedAt=latest.updated_at;
  }
  writeQueue(nextQueue,cloudUser.id);
  await syncPendingChanges();
}

async function cloudRemoveProductImage(product) {
  const user=await requireCloudUser();
  const oldPath=product.imagePath||null;
  const {error}=await supabaseClient.from('products').update({image_path:null,updated_at:now()}).eq('id',product.id).eq('user_id',user.id);
  if(error) throw error;
  if(oldPath){
    const {error:storageError}=await supabaseClient.storage.from('product-images').remove([oldPath]);
    if(storageError) console.warn('Old image cleanup failed:',storageError.message);
  }
  product.image='';
  product.offlineImage='';
  product.imagePath='';
}

async function cloudDeleteProduct(product) {
  const user=await requireCloudUser();
  const {error}=await supabaseClient.from('products').delete().eq('id',product.id).eq('user_id',user.id);
  if(error) throw error;
  if(product.imagePath){
    const {error:storageError}=await supabaseClient.storage.from('product-images').remove([product.imagePath]);
    if(storageError) console.warn('Old image cleanup failed:',storageError.message);
  }
}

async function cloudRecordSale(product,quantity,unitPrice,note,unitsPerSale=1,saleUnit='unit') {
  await requireCloudUser();
  const {error}=await supabaseClient.rpc('record_sale',{p_product_id:product.id,p_quantity:quantity,p_unit_price:unitPrice,p_note:note||null,p_units_per_sale:unitsPerSale,p_sale_unit:saleUnit});
  if(error) throw error;
  await cloudLoadAll();
}

async function cloudAddExpense(name,amount,date) {
  const user=await requireCloudUser();
  const {error}=await supabaseClient.from('expenses').insert({user_id:user.id,description:name,amount,spent_at:date});
  if(error) throw error;
  await cloudLoadAll();
}


function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalizeCategory(value){const category=String(value??'').trim();return category||'Uncategorized';}
const SELLBOOK_CATEGORIES=["Food & Groceries","Drinks & Beverages","Fruits & Vegetables","Health & Beauty","Household Items","Clothing & Fashion","Electronics & Accessories","Building Materials","Stationery & School Supplies","Other"];
function categoryValues(value){return String(value||'').split('|').map(x=>x.trim()).filter(Boolean);}
function getSelectedCategories(prefix){const selector=prefix==='editProduct'?'[data-edit-product-category]':'[data-product-category]';return [...document.querySelectorAll(selector+':checked')].map(x=>x.value).slice(0,3);}
function syncCategoryPicker(prefix,value){const edit=prefix==='editProduct';const selector=edit?'[data-edit-product-category]':'[data-product-category]';const count=document.getElementById(edit?'editProductCategoryCount':'productCategoryCount');const hidden=document.getElementById(edit?'editProductCategory':'pcategory');let values=categoryValues(value);values=values.filter(x=>SELLBOOK_CATEGORIES.includes(x)).slice(0,3);if(!values.length&&value&& !SELLBOOK_CATEGORIES.includes(String(value).trim()))values=['Other'];document.querySelectorAll(selector).forEach(x=>{x.checked=values.includes(x.value);x.disabled=false;});if(hidden)hidden.value=values.join(' | ');if(count)count.textContent=values.length+' of 3 selected';updateCategoryPickerLimits(prefix);}
function updateCategoryPickerLimits(prefix){const edit=prefix==='editProduct';const selector=edit?'[data-edit-product-category]':'[data-product-category]';const selected=[...document.querySelectorAll(selector+':checked')].length;document.querySelectorAll(selector).forEach(x=>{x.disabled=!x.checked&&selected>=3;});const hidden=document.getElementById(edit?'editProductCategory':'pcategory');if(hidden)hidden.value=getSelectedCategories(prefix).join(' | ');const count=document.getElementById(edit?'editProductCategoryCount':'productCategoryCount');if(count)count.textContent=selected+' of 3 selected';}
document.querySelectorAll('[data-product-category]').forEach(x=>x.addEventListener('change',()=>updateCategoryPickerLimits('product')));
document.querySelectorAll('[data-edit-product-category]').forEach(x=>x.addEventListener('change',()=>updateCategoryPickerLimits('editProduct')));

function showLegalSection(section){const privacy=section!=='terms';const privacyPanel=document.getElementById('legalPrivacyContent'),termsPanel=document.getElementById('legalTermsContent'),privacyTab=document.getElementById('legalPrivacyTab'),termsTab=document.getElementById('legalTermsTab');if(!privacyPanel||!termsPanel||!privacyTab||!termsTab)return;privacyPanel.classList.toggle('hidden',!privacy);termsPanel.classList.toggle('hidden',privacy);privacyTab.classList.toggle('active',privacy);termsTab.classList.toggle('active',!privacy);privacyTab.setAttribute('aria-selected',String(privacy));termsTab.setAttribute('aria-selected',String(!privacy));}
const VALID_PAGES=new Set(['home','about-sellbook','stock-history','stock-history-detail','sales-history','sale-details','subscribers','reservations','products','product-details','low-stock','sales','more','expenses','reports','stock','settings','business-details','settings-business','settings-sync','settings-preferences','settings-account','settings-legal','settings-buybook','support','messenger','feedback','admin','me','notifications']);
function currentPage(){return [...document.querySelectorAll('.page')].find(x=>!x.classList.contains('hidden'))?.id||'home';}
async function renderDailySalesSummary(){const target=document.getElementById('dailySalesSummary');if(!target)return;const rows=new Map();const now=new Date();for(let i=0;i<7;i++){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');rows.set(key,{label:i===0?'Today':i===1?'Yesterday':d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}),total:0,count:0});}for(const sale of (db.sales||[])){const raw=sale.sold_at||sale.created_at;if(!raw)continue;const d=new Date(raw);if(Number.isNaN(d.getTime()))continue;const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');const row=rows.get(key);if(row){row.total+=Number(sale.total)||0;row.count++;}}target.innerHTML=[...rows.values()].map(r=>'<div class="daily-sales-row"><span>'+escAdmin(r.label)+' · '+r.count+' sale'+(r.count===1?'':'s')+'</span><strong>'+escAdmin(new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(r.total))+'</strong></div>').join('');}
function refreshHomeWeeklySales(){const el=document.getElementById('weeklySalesHome');if(!el)return;const now=new Date();const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6);let total=0;for(const sale of (db.sales||[])){const raw=sale.sold_at||sale.created_at;if(!raw)continue;const d=new Date(raw);if(!Number.isNaN(d.getTime())&&d>=start&&d<=now)total+=Number(sale.total)||0;}el.textContent=money(total);}
let marketplaceReservationsCache=[];let marketplaceSelectedReservationId=null;
async function loadReservationsPage(){
 const target=document.getElementById('reservationsPageList');if(!target)return;
 document.getElementById('reservationsListView')?.classList.remove('hidden');document.getElementById('reservationDetailsView')?.classList.add('hidden');
 target.innerHTML='<div class="empty">Loading reservations…</div>';
 if(!cloudUser||!supabaseClient){target.innerHTML='<div class="empty">Please sign in to view reservations.</div>';return;}
 try{
  const {data,error}=await supabaseClient.from('marketplace_reservations').select('id,buyer_id,status,buyer_note,created_at,expires_at').eq('owner_id',cloudUser.id).order('created_at',{ascending:false}).limit(100);
  if(error)throw error;marketplaceReservationsCache=data||[];
  if(!marketplaceReservationsCache.length){target.innerHTML='<div class="empty">No reservations yet. Customer reservations from Buybook will appear here.</div>';return;}
  const result=await supabaseClient.from('marketplace_reservation_items').select('reservation_id,product_name,quantity,unit_price').in('reservation_id',marketplaceReservationsCache.map(r=>r.id));
  if(result.error)throw result.error;const byId={};for(const item of(result.data||[]))(byId[item.reservation_id] ||= []).push(item);
  marketplaceReservationsCache.forEach(r=>r.items=byId[r.id]||[]);
  target.innerHTML=marketplaceReservationsCache.map(r=>{const products=r.items.map(x=>escAdmin(x.product_name)+' × '+Number(x.quantity||0)).join(', ');const status=String(r.status||'pending').replace(/[_-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());return '<button type="button" class="messenger-picker-row reservation-page-row" data-reservation-id="'+escAdmin(r.id)+'" style="width:100%;text-align:left"><span class="chat-support-avatar" aria-hidden="true">▣</span><span class="subscriber-meta"><strong>'+escAdmin(marketplaceBuyerName(r.buyer_id))+'</strong><small>'+escAdmin(products||'Product details unavailable')+'</small><small>'+escAdmin(new Date(r.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+' · '+escAdmin(status)+'</small></span><span aria-hidden="true">›</span></button>';}).join('');
  target.querySelectorAll('[data-reservation-id]').forEach(b=>b.addEventListener('click',()=>showReservationDetails(b.dataset.reservationId)));
 }catch(err){target.innerHTML='<div class="empty">Could not load reservations: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
async function updateReservationDecision(id,decision,button){
 if(!cloudUser||!supabaseClient)return;
 if(!['approved','rejected'].includes(decision))return;
 const reservation=marketplaceReservationsCache.find(item=>String(item.id)===String(id));
 if(!reservation||String(reservation.status||'pending').toLowerCase()!=='pending')return;
 const label=decision==='approved'?'Approve this reservation?':'Reject this reservation?';
 if(!confirm(label+' The buyer will be able to see the updated status in Buybook.'))return;
 const original=button?.textContent;if(button){button.disabled=true;button.textContent='Saving…';}
 try{
  const {data,error}=await supabaseClient.from('marketplace_reservations').update({status:decision,updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',cloudUser.id).eq('status','pending').select('id,status').maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('This reservation has already been updated. Refresh the page to see its latest status.');
  reservation.status=decision;
  let notificationFailed=false;
  try{
   const {error:notificationError}=await supabaseClient.functions.invoke('notify-reservation-decision',{body:{reservation_id:id,decision}});
   if(notificationError)throw notificationError;
  }catch(notificationError){
   notificationFailed=true;
   console.error('Sellbook: reservation decision saved, but buyer notification failed.',notificationError);
  }
  await loadReservationsPage();
  showReservationDetails(id,{history:false});
  const message=(decision==='approved'?'Reservation approved.':'Reservation rejected.')+(notificationFailed?' Buyer notification could not be sent; please try again later.':' Buyer notification sent.');
  if(typeof showToast==='function')showToast(message);
  else alert(message);
 }catch(err){alert('Could not update reservation: '+(err.message||'Please try again.'));if(button){button.disabled=false;button.textContent=original||'Try again';}}
}
function showReservationDetails(id,options={}){
 const r=marketplaceReservationsCache.find(x=>String(x.id)===String(id));if(!r)return;marketplaceSelectedReservationId=r.id;
 if(options.history!==false&&!(history.state?.mySalesBookPage==='reservations'&&history.state?.mySalesBookSubview==='reservation-details'))history.pushState({...history.state,mySalesBookPage:'reservations',mySalesBookSubview:'reservation-details'},'','#reservations');
 document.getElementById('reservationsListView')?.classList.add('hidden');document.getElementById('reservationDetailsView')?.classList.remove('hidden');
 const status=String(r.status||'pending').replace(/[_-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());
 const products=r.items.map(x=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><span>'+escAdmin(x.product_name)+' × '+Number(x.quantity||0)+'</span><strong>'+escAdmin(money(Number(x.unit_price||0)*Number(x.quantity||0)))+'</strong></div>').join('');
 const total=r.items.reduce((sum,x)=>sum+Number(x.unit_price||0)*Number(x.quantity||0),0);
 const pendingReservation=String(r.status||'pending').toLowerCase()==='pending';
 document.getElementById('reservationDetailsContent').innerHTML='<div style="display:flex;align-items:center;gap:12px;padding:14px 0"><span class="chat-support-avatar" aria-hidden="true">👤</span><div><h3 style="margin:0 0 5px">'+escAdmin(marketplaceBuyerName(r.buyer_id))+'</h3><p class="muted" style="margin:0">Customer on Buybook</p></div></div><div style="padding:12px 0;border-top:1px solid var(--border)"><small class="muted">Reserved on</small><p style="margin:5px 0;font-weight:700">'+escAdmin(new Date(r.created_at).toLocaleString([], {dateStyle:'full',timeStyle:'short'}))+'</p><small class="muted">Status</small><p style="margin:5px 0 12px;font-weight:700">'+escAdmin(status)+'</p>'+(pendingReservation?'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 20px"><button type="button" class="primary" data-reservation-decision="approved" style="width:100%">Approve reservation</button><button type="button" class="secondary" data-reservation-decision="rejected" style="width:100%">Reject reservation</button></div>':'')+'<h3>Products</h3>'+(products||'<p class="muted">Product details unavailable.</p>')+'<div style="display:flex;justify-content:space-between;padding:14px 0;font-weight:700"><span>Total</span><span>'+escAdmin(money(total))+'</span></div>'+(r.buyer_note?'<div style="border-top:1px solid var(--border);padding-top:12px"><small class="muted">Customer note</small><p>'+escAdmin(r.buyer_note)+'</p></div>':'')+(r.expires_at?'<p class="muted">Expires '+escAdmin(new Date(r.expires_at).toLocaleString())+'</p>':'')+'</div>';
 document.getElementById('reservationDetailsContent').querySelectorAll('[data-reservation-decision]').forEach(button=>button.addEventListener('click',()=>updateReservationDecision(r.id,button.dataset.reservationDecision,button)));
}
document.getElementById('reservationDetailsBack')?.addEventListener('click',()=>{if(history.state?.mySalesBookPage==='reservations'&&history.state?.mySalesBookSubview==='reservation-details'){history.back();return;}document.getElementById('reservationDetailsView')?.classList.add('hidden');document.getElementById('reservationsListView')?.classList.remove('hidden');});
document.getElementById('reservationMessageButton')?.addEventListener('click',async()=>{const r=marketplaceReservationsCache.find(x=>String(x.id)===String(marketplaceSelectedReservationId));if(!r?.buyer_id)return;showPage('messenger');await loadMessengerConversations();await openMessengerConversation(r.buyer_id);});
async function loadSubscribersPage(){
 const target=document.getElementById('subscribersPageList');if(!target)return;
 document.getElementById('subscribersListView')?.classList.remove('hidden');document.getElementById('subscriberDetailsView')?.classList.add('hidden');
 target.innerHTML='<div class="empty">Loading subscribers…</div>';
 if(!cloudUser||!supabaseClient){target.innerHTML='<div class="empty">Please sign in to view subscribers.</div>';return;}
 try{const {data,error}=await supabaseClient.rpc('get_my_marketplace_subscribers');if(error)throw error;marketplaceSubscribersCache=data||[];
 if(!marketplaceSubscribersCache.length){target.innerHTML='<div class="empty">No subscribers yet. Buyers who subscribe to your shop on Buybook will appear here.</div>';return;}
 target.innerHTML=marketplaceSubscribersCache.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).map(s=>'<button type="button" class="messenger-picker-row subscriber-page-row" data-subscriber-id="'+escAdmin(s.buyer_id)+'" style="width:100%;text-align:left"><span class="chat-support-avatar" aria-hidden="true">👤</span><span class="subscriber-meta"><strong>'+escAdmin(s.display_name||marketplaceBuyerName(s.buyer_id))+'</strong><small>Subscribed '+escAdmin(s.created_at?new Date(s.created_at).toLocaleDateString():'date unavailable')+'</small></span><span aria-hidden="true">›</span></button>').join('');
 target.querySelectorAll('[data-subscriber-id]').forEach(b=>b.addEventListener('click',()=>showSubscriberDetails(b.dataset.subscriberId)));
 }catch(err){target.innerHTML='<div class="empty">Could not load subscribers: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
function showSubscriberDetails(id,options={}){
 const s=marketplaceSubscribersCache.find(x=>String(x.buyer_id)===String(id));if(!s)return;
 marketplaceSelectedBuyerId=s.buyer_id;
 if(options.history!==false&&!(history.state?.mySalesBookPage==='subscribers'&&history.state?.mySalesBookSubview==='subscriber-details'))history.pushState({...history.state,mySalesBookPage:'subscribers',mySalesBookSubview:'subscriber-details'},'','#subscribers');
 document.getElementById('subscribersListView')?.classList.add('hidden');document.getElementById('subscriberDetailsView')?.classList.remove('hidden');
 const name=s.display_name||marketplaceBuyerName(s.buyer_id),date=s.created_at?new Date(s.created_at).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'}):'Date unavailable';
 document.getElementById('subscriberDetailsContent').innerHTML='<div style="display:flex;align-items:center;gap:12px;padding:14px 0"><span class="chat-support-avatar" aria-hidden="true">👤</span><div><h3 style="margin:0 0 5px">'+escAdmin(name)+'</h3><p class="muted" style="margin:0">Buybook subscriber</p></div></div><div style="padding:12px 0;border-top:1px solid var(--border)"><small class="muted">Subscribed on</small><p style="margin:5px 0 0;font-weight:700">'+escAdmin(date)+'</p></div>';
}
document.getElementById('subscriberDetailsBack')?.addEventListener('click',()=>{if(history.state?.mySalesBookPage==='subscribers'&&history.state?.mySalesBookSubview==='subscriber-details'){history.back();return;}document.getElementById('subscriberDetailsView')?.classList.add('hidden');document.getElementById('subscribersListView')?.classList.remove('hidden');});
document.getElementById('subscriberMessageButton')?.addEventListener('click',async()=>{const id=marketplaceSelectedBuyerId;if(!id)return;showPage('messenger');await loadMessengerConversations();await openMessengerConversation(id);});
async function refreshHomeSubscriberCount(){const el=document.getElementById('subscriberCountHome');if(!el)return;if(!cloudUser||!supabaseClient){el.textContent='—';return;}try{const {data,error}=await supabaseClient.rpc('get_my_marketplace_subscribers');if(error)throw error;el.textContent=String((data||[]).length);}catch(_){el.textContent='—';}}
function paintPage(name,scroll){if(!VALID_PAGES.has(name))name='home';if(name==='business-details')updateBusinessDetailsPage();document.body.classList.toggle('notifications-page-open',name==='notifications');document.body.classList.toggle('subscribers-page-open',name==='subscribers');document.body.classList.toggle('reservations-page-open',name==='reservations');document.body.classList.toggle('settings-main-page-open',name==='settings');document.body.classList.toggle('settings-detail-page-open',['settings-business','settings-sync','settings-preferences','settings-account','settings-buybook'].includes(name));document.body.classList.toggle('business-profile-page-open',name==='business-details');document.body.classList.toggle('legal-page-open',name==='settings-legal');document.body.classList.toggle('about-sellbook-page-open',name==='about-sellbook');document.body.classList.toggle('reports-page-open',name==='reports');document.body.classList.toggle('stock-page-open',name==='stock');document.body.classList.toggle('stock-history-page-open',name==='stock-history');document.body.classList.toggle('stock-history-detail-page-open',name==='stock-history-detail');document.body.classList.toggle('product-page-open',name==='products');document.body.classList.toggle('low-stock-page-open',name==='low-stock');document.body.classList.toggle('product-details-page-open',name==='product-details');document.body.classList.toggle('sales-page-open',name==='sales');document.body.classList.toggle('sales-history-page-open',name==='sales-history');document.body.classList.toggle('sale-details-page-open',name==='sale-details');document.body.classList.toggle('expenses-page-open',name==='expenses');document.querySelectorAll('.page').forEach(x=>x.classList.toggle('hidden',x.id!==name));document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===name||(x.dataset.page==='messages'&&name==='support')||(x.dataset.page==='me'&&['me','more','reports','stock','low-stock','settings','business-details','settings-business','settings-sync','settings-preferences','settings-account','settings-legal'].includes(name))));sessionStorage.setItem('my-sales-book-current-page',name);render();renderDailySalesSummary();refreshHomeWeeklySales();const homeProductCount=document.getElementById('productCountHome'),homeProductSellingValue=document.getElementById('productSellingValueHome');if(homeProductCount)homeProductCount.textContent=String((db.products||[]).length);if(homeProductSellingValue){const total=(db.products||[]).reduce((sum,p)=>sum+Math.max(0,Number(p.stock)||0)*Math.max(0,Number(p.price??p.selling_price)||0),0);homeProductSellingValue.textContent=money(total);}if(name==='home')refreshHomeSubscriberCount();const fab=document.getElementById('quickSaleFab');const fabPages={home:{label:'Record a sale',title:'Record a sale'},sales:{label:'Record a sale',title:'Record a sale'},products:{label:'Add a product',title:'Add a product'},expenses:{label:'Add an expense',title:'Add an expense'}};const fabAction=fabPages[name];if(fab){fab.style.display='none';fab.hidden=true;fab.setAttribute('aria-hidden','true');if(fabAction&&name!=='home'&&!sellbookIsAdmin){fab.hidden=false;fab.style.display='flex';fab.setAttribute('aria-hidden','false');fab.setAttribute('aria-label',fabAction.label);fab.title=fabAction.title;fab.dataset.action=name;}}if(name==='support'&&cloudUser){loadUserSupport();}if(name==='feedback'&&cloudUser){loadUserSupport();}if(name==='notifications'&&cloudUser){localStorage.setItem('sellbook-notifications-seen-'+cloudUser.id,new Date().toISOString());updateUnreadBadges();}if(name==='settings-buybook'&&cloudUser){loadBuybookConnection();loadBuybookActivity();}if(name==='reservations')loadReservationsPage();if(name==='me')updateMePanel();if(scroll)window.scrollTo({top:0,behavior:'auto'});}
// Keep all page back arrows consistent. Use the actual previous app page when it
// matches the intended parent; otherwise replace the current history entry with
// the safe parent so Back cannot reopen the page the user just left.
(function installUnifiedBackArrows(){
  const parentPages={
    'product-details':'products','sale-details':'sales-history',
    'sales-history':'home','products':'home','sales':'home','expenses':'home',
    'subscribers':'home','reservations':'home','low-stock':'products',
    'stock':'me','stock-history':'stock','stock-history-detail':'stock-history',
    'reports':'me','settings':'me','settings-business':'settings',
    'settings-sync':'settings','settings-preferences':'settings',
    'settings-account':'settings','settings-buybook':'settings',
    'settings-legal':'me','about-sellbook':'me','business-details':'me',
    'notifications':'home','support':'home','feedback':'support'
  };
  function intendedParent(button,current){
    const previous=history.state&&history.state.mySalesBookPage===current?history.state.mySalesBookPreviousPage:null;
    if(previous&&previous!==current&&VALID_PAGES.has(previous))return previous;
    if(button.dataset.appBack)return button.dataset.appBack;
    if(button.dataset.openPage)return button.dataset.openPage;
    const inline=button.getAttribute('onclick')||'';
    const match=inline.match(/showPage\(['"]([^'"]+)['"]\)/);
    return match&&VALID_PAGES.has(match[1])?match[1]:(parentPages[current]||'home');
  }
  document.addEventListener('click',function(event){
    const button=event.target.closest('.products-back-button,.settings-back-button,.business-profile-back,.reports-back-button,.notifications-back-button,.support-back-button,.stock-back-button,.stock-history-back-button,.stock-history-detail-back-button,.settings-main-back-button,.about-sellbook-back-button,[data-app-back]');
    if(!button)return;
    const current=currentPage();
    if(button.id==='subscriberDetailsBack'||button.id==='reservationDetailsBack'){
      event.preventDefault();event.stopImmediatePropagation();
      const isSubscriber=button.id==='subscriberDetailsBack';
      document.getElementById(isSubscriber?'subscriberDetailsView':'reservationDetailsView')?.classList.add('hidden');
      document.getElementById(isSubscriber?'subscribersListView':'reservationsListView')?.classList.remove('hidden');
      return;
    }
    event.preventDefault();event.stopImmediatePropagation();
    const fallback=intendedParent(button,current);
    if(!VALID_PAGES.has(fallback)||fallback===current)return;
    const state=history.state||{};
    if(state.mySalesBookPage===current&&state.mySalesBookPreviousPage===fallback){
      history.back();
    }else{
      showPage(fallback,{replaceHistory:true});
    }
  },true);
})();
function refreshStockHistoryBadges(){
 const tabs=document.getElementById('stockHistoryTabs');if(!tabs)return;
 const adjustments=Array.isArray(db.stockAdjustments)?db.stockAdjustments:[];
 const restocks=Array.isArray(db.restocks)?db.restocks:[];
 tabs.querySelectorAll('[data-stock-history-tab]').forEach(button=>{
  const count=button.querySelector('[data-history-count]');if(count)count.textContent=String(button.dataset.stockHistoryTab==='adjustments'?adjustments.length:restocks.length);
 });
}
async function refreshStockHistoryFromCloud(){
 const renderAll=()=>{renderStockAdjustments();renderRestockHistory();refreshStockHistoryBadges();};
 if(!cloudUser||!navigator.onLine||storageMode==='local'){renderAll();return;}
 const uid=cloudUser.id;
 try{
  const result=await supabaseClient.from('stock_purchases')
   .select('id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,base_quantity,cost_per_purchase_unit,total_cost,average_cost_before,average_cost_after,previous_stock,new_stock,restocked_at')
   .eq('user_id',uid).order('restocked_at',{ascending:false}).limit(500);
  if(result.error)throw result.error;
  if(!cloudUser||cloudUser.id!==uid)return;
  const merged=new Map();
  const add=(row)=>{
   if(!row||row.id==null)return;
   const key=String(row.id),existing=merged.get(key);
   merged.set(key,{...(existing||{}),...row});
  };
  // Keep the current account's cached rows while the server response is reconciled.
  // This prevents an empty/partial response from erasing history on the device.
  for(const row of Array.isArray(db.restocks)?db.restocks:[])add(row);
  for(const row of result.data||[]){
   const old=merged.get(String(row.id))||{};
   add({id:row.id,productId:row.product_id,productName:row.product_name,
    purchaseQuantity:Number(row.purchase_quantity),purchaseUnit:row.purchase_unit,
    unitsPerPurchase:Number(row.units_per_purchase),baseQuantity:Number(row.base_quantity),
    costPerPurchaseUnit:Number(row.cost_per_purchase_unit),totalCost:Number(row.total_cost),
    averageCostBefore:Number(row.average_cost_before),averageCostAfter:Number(row.average_cost_after),
    previousStock:row.previous_stock??old.previousStock,newStock:row.new_stock??old.newStock,date:row.restocked_at});
  }
  for(const item of readQueue(uid)){
   const row=item.payload?.restock;
   if(item.type==='stock_restock'&&item.status!=='synced'&&row)add(row);
  }
  db.restocks=[...merged.values()].sort((a,b)=>safeDate(b.date)-safeDate(a.date));
  renderAll();
  cacheCloudData(uid);
 }catch(error){
  console.warn('Restock history refresh failed:',error);
  cloudMessage('Restock history could not be refreshed. Showing the saved history on this phone.');
  renderAll();
 }
}

let messengerReturnPage='home';function showPage(name,options={}){if(!VALID_PAGES.has(name))return;const previous=currentPage();if(name==='messenger'&&previous!=='messenger')messengerReturnPage=previous;document.body.classList.toggle('user-support-open',name==='support'&&!sellbookIsAdmin);document.body.classList.toggle('messenger-open',name==='messenger');if(name!=='messenger')document.body.classList.remove('messenger-conversation-open');if(name==='messenger'&&cloudUser)loadMessengerConversations();if(name==='stock-history'){renderStockAdjustments();refreshStockHistoryBadges();void refreshStockHistoryFromCloud();}if(!options.fromHistory&&previous!==name){const previousForHistory=options.replaceHistory?(history.state&&history.state.mySalesBookPreviousPage):previous;const state={mySalesBookPage:name,mySalesBookPreviousPage:previousForHistory,mySalesBookReturnPage:name==='messenger'?messengerReturnPage:undefined};if(options.replaceHistory)history.replaceState(state,'','#'+name);else history.pushState(state,'','#'+name);}paintPage(name,options.scroll!==false);}
function restorePageFromLocation(){const hash=location.hash.slice(1),saved=sessionStorage.getItem('my-sales-book-current-page'),name=VALID_PAGES.has(hash)?hash:(VALID_PAGES.has(saved)?saved:'home');document.body.classList.toggle('user-support-open',name==='support'&&!sellbookIsAdmin);document.body.classList.toggle('messenger-open',name==='messenger');paintPage(name,false);}
// Keep Android/browser Back inside the app. Page changes have their own
// history entries; the duplicate root entry prevents the app from closing
// when the user reaches the first page, including while offline.
(function installBackNavigationGuard(){
  const pageFromUrl=state=>VALID_PAGES.has(state?.mySalesBookPage)?state.mySalesBookPage:(VALID_PAGES.has(location.hash.slice(1))?location.hash.slice(1):(VALID_PAGES.has(sessionStorage.getItem('my-sales-book-current-page'))?sessionStorage.getItem('my-sales-book-current-page'):'home'));
  if(!history.state?.mySalesBookRootGuard){
    history.replaceState({mySalesBookRootGuard:true,mySalesBookPage:pageFromUrl()},'',location.href);
    history.pushState({mySalesBookRoot:true,mySalesBookPage:pageFromUrl()},'',location.href);
  }
  window.addEventListener('popstate',event=>{
    // Nested Buybook detail views are history entries too: Back returns to the
    // corresponding list before leaving the Subscribers or Reservations page.
    const current=currentPage();
    if(current==='subscribers'&&!document.getElementById('subscriberDetailsView')?.classList.contains('hidden')&&event.state?.mySalesBookPage==='subscribers'&&event.state?.mySalesBookSubview!=='subscriber-details'){
      document.getElementById('subscriberDetailsView')?.classList.add('hidden');document.getElementById('subscribersListView')?.classList.remove('hidden');return;
    }
    if(current==='reservations'&&!document.getElementById('reservationDetailsView')?.classList.contains('hidden')&&event.state?.mySalesBookPage==='reservations'&&event.state?.mySalesBookSubview!=='reservation-details'){
      document.getElementById('reservationDetailsView')?.classList.add('hidden');document.getElementById('reservationsListView')?.classList.remove('hidden');return;
    }
    // Android/browser Back should close the open Messenger chat first,
    // returning to the conversation list instead of leaving the panel stuck.
    if(document.body.classList.contains('messenger-open')&&document.body.classList.contains('messenger-conversation-open')){
      // A conversation gets its own history entry. Back consumes that entry,
      // leaving the existing Messenger-list entry available for the next Back.
      document.body.classList.remove('messenger-conversation-open');
      messengerSelectedConversation=null;
      const input=document.getElementById('messengerBody');
      const send=document.querySelector('#messengerComposer button[type="submit"]');
      if(input)input.disabled=true;
      if(send)send.disabled=true;
      return;
    }
    let name=pageFromUrl(event.state);
    // Some Android installed-PWA shells restore the same #messenger entry on Back.
    // If Back reaches the list but the URL still says Messenger, explicitly return to the panel that opened it.
    if(name==='messenger'&&document.body.classList.contains('messenger-open')){
      const returnPage=(event.state&&VALID_PAGES.has(event.state.mySalesBookReturnPage))?event.state.mySalesBookReturnPage:messengerReturnPage;
      name=VALID_PAGES.has(returnPage)&&returnPage!=='messenger'?returnPage:'home';
      document.body.classList.remove('messenger-conversation-open');
      history.replaceState({mySalesBookPage:name},'', '#'+name);
    }
    document.body.classList.toggle('user-support-open',name==='support'&&!sellbookIsAdmin);
    document.body.classList.toggle('messenger-open',name==='messenger');
    if(name!=='messenger')document.body.classList.remove('messenger-conversation-open');
    paintPage(name,false);
    if(event.state?.mySalesBookRootGuard){
      history.pushState({mySalesBookRoot:true,mySalesBookPage:name},'',location.href);
    }
  });
})();
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{showPage(b.dataset.page);if(b.dataset.page==='messenger')loadMessengerConversations();}));
document.querySelectorAll('[data-open-page]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.openPage==='admin'&&!sellbookIsAdmin)return cloudMessage('Administrator access is required.');showPage(b.dataset.openPage);if(b.dataset.openPage==='admin')loadAdminDashboard();if(b.dataset.openPage==='support'){messageListOpen=true;document.getElementById('conversationListView')?.classList.remove('hidden');document.getElementById('supportConversationView')?.classList.add('hidden');loadConversationList();}if(b.dataset.openPage==='notifications')loadUserNotifications();if(b.dataset.openPage==='subscribers')loadSubscribersPage();}));
document.querySelectorAll('[data-notification-category]').forEach(b=>b.addEventListener('click',()=>{userNotificationCategory=b.dataset.notificationCategory||'all';document.querySelectorAll('[data-notification-category]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',active?'true':'false');});renderUserNotifications();}));
document.querySelectorAll('[data-open-support-direct]').forEach(b=>b.addEventListener('click',async()=>{showPage('support');messageListOpen=false;document.getElementById('conversationListView')?.classList.add('hidden');document.getElementById('supportConversationView')?.classList.remove('hidden');const selector=document.getElementById('messageConversationSelect');if(selector)selector.value='support';await loadUserSupport();}));
function openEntryForm(type){const ids={sale:'saleFormCard',product:'productFormCard',expense:'expenseFormCard'};const fieldIds={sale:'saleProduct',product:'pname',expense:'ename'};const card=document.getElementById(ids[type]);if(!card)return;if(type==='product'&&typeof syncDefaultMarkupUI==='function')syncDefaultMarkupUI();document.querySelectorAll('.entry-form-overlay').forEach(x=>x.classList.remove('entry-form-overlay'));document.body.classList.add('entry-form-open');card.classList.remove('hidden');card.classList.add('entry-form-overlay');setTimeout(()=>document.getElementById(fieldIds[type])?.focus({preventScroll:true}),80);}function closeEntryForm(type){const ids={sale:'saleFormCard',product:'productFormCard',expense:'expenseFormCard'};const card=document.getElementById(ids[type]);if(card){card.classList.remove('entry-form-overlay');card.classList.add('hidden');}document.body.classList.remove('entry-form-open');}document.querySelectorAll('[data-close-entry]').forEach(b=>b.addEventListener('click',()=>closeEntryForm(b.dataset.closeEntry)));document.getElementById('quickSaleFab').addEventListener('click',()=>{const page=currentPage();if(page==='products'){openEntryForm('product');return;}if(page==='expenses'){openEntryForm('expense');return;}if(page==='home'||page==='sales'){if(page!=='sales')showPage('sales');openEntryForm('sale');}});
function closeProductLightbox(){document.getElementById('productImageLightbox').classList.add('hidden');document.body.style.overflow='';}
function openProductLightbox(src,caption){const box=document.getElementById('productImageLightbox');document.getElementById('largeProductImage').src=src;document.getElementById('largeProductImage').alt=caption+' photo';document.getElementById('largeProductImageCaption').textContent=caption;box.classList.remove('hidden');document.body.style.overflow='hidden';document.getElementById('closeProductImage').focus();}
document.getElementById('categorySuggestionChips').addEventListener('click',event=>{const button=event.target.closest('[data-category-suggestion]');if(button)document.getElementById('pcategory').value=button.dataset.categorySuggestion;});
document.getElementById('editCategorySuggestionChips').addEventListener('click',event=>{const button=event.target.closest('[data-category-suggestion]');if(button)document.getElementById('editProductCategory').value=button.dataset.categorySuggestion;});
document.getElementById('productList').addEventListener('click',event=>{const img=event.target.closest('img.product-photo');if(!img||!img.src)return;event.preventDefault();openProductLightbox(img.src,img.alt.replace(/ photo$/,''));});
document.getElementById('closeProductImage').addEventListener('click',closeProductLightbox);
document.getElementById('productImageLightbox').addEventListener('click',event=>{if(event.target.id==='productImageLightbox')closeProductLightbox();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProductLightbox();});

let salesAmountVisible=true;try{salesAmountVisible=localStorage.getItem('sellbook-sales-amount-visible-v1')!=='false';}catch(e){}
function setSalesAmountVisibility(){document.querySelectorAll('#todaySales, #todayNet, #productSellingValueHome').forEach(amount=>{amount.textContent=salesAmountVisible?amount.dataset.actualAmount||'₦0':'₦••••••';});const button=document.getElementById('salesVisibilityToggle');if(button){button.setAttribute('aria-label',salesAmountVisible?'Hide sales, profit and products amounts':'Show sales, profit and products amounts');button.setAttribute('title',salesAmountVisible?'Hide sales, profit and products amounts':'Show sales, profit and products amounts');button.innerHTML=salesAmountVisible?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.1 3.8M6.2 6.3C3.5 8.1 2 12 2 12s3.6 7 10 7c1.5 0 2.8-.4 4-1"></path></svg>';}}
function toggleSalesVisibility(){salesAmountVisible=!salesAmountVisible;try{localStorage.setItem('sellbook-sales-amount-visible-v1',String(salesAmountVisible));}catch(e){}setSalesAmountVisibility();}

function updateHomeProductSummary(){const products=db.products||[],count=document.getElementById('productCountHome'),label=document.querySelector('.home-products-count-label'),value=document.getElementById('productSellingValueHome');if(count)count.textContent=String(products.length);if(label)label.lastChild.textContent=products.length===1?' Product':' Products';if(value){const total=products.reduce((sum,p)=>sum+Math.max(0,Number(p.stock)||0)*Math.max(0,Number(p.price??p.selling_price)||0),0);value.dataset.actualAmount=money(total);setSalesAmountVisibility();}}

function gettingStartedDismissKey(){return 'sellbook-getting-started-dismissed-v1:'+(cloudUser?.id||'local');}
function renderGettingStarted(){
 const card=document.getElementById('gettingStartedCard');if(!card)return;
 let dismissed=false;try{dismissed=localStorage.getItem(gettingStartedDismissKey())==='1';}catch(error){}
 card.classList.toggle('hidden',dismissed);
 if(dismissed)return;
 const steps=[
  {key:'products',done:(db.products||[]).length>0},
  {key:'sales',done:(db.sales||[]).length>0},
  {key:'expenses',done:(db.expenses||[]).length>0},
  {key:'buybook',done:buybookConnectionState===true}
 ];
 for(const step of steps){
  const button=card.querySelector('[data-open-page="'+step.key+'"]')||card.querySelector('[data-open-page="settings-buybook"]');
  const marker=card.querySelector('[data-step-status="'+step.key+'"]');
  const state=document.getElementById('gettingStarted'+step.key.charAt(0).toUpperCase()+step.key.slice(1)+'State');
  if(button)button.classList.toggle('is-complete',step.done);
  if(marker)marker.textContent=step.done?'✓':String(steps.findIndex(x=>x.key===step.key)+1);
  if(state)state.textContent=step.done?'Completed ✓':(step.key==='buybook'?'Connect ›':'Start ›');
 }
}
document.getElementById('dismissGettingStarted')?.addEventListener('click',()=>{
 try{localStorage.setItem(gettingStartedDismissKey(),'1');}catch(error){}
 renderGettingStarted();
});
function render(){
 const restockSelect=document.getElementById('restockProduct');if(restockSelect){const selected=restockSelect.value;restockSelect.innerHTML=db.products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');if(db.products.some(p=>p.id===selected))restockSelect.value=selected;updateRestockPreview();}

  db=normalizeDb(db);renderBrand();updateHomeProductSummary();renderGettingStarted();
  const d=today();
  const todays=db.sales.filter(x=>dateKey(x.date)===d);
  const expensesToday=db.expenses.filter(x=>dateKey(x.date)===d).reduce((s,x)=>s+x.amount,0);
  const salesToday=todays.reduce((s,x)=>s+x.total,0);
  const grossToday=todays.reduce((s,x)=>s+x.profit,0);
  const allSales=db.sales.reduce((s,x)=>s+x.total,0);
  const allGross=db.sales.reduce((s,x)=>s+x.profit,0);
  const allExpenses=db.expenses.reduce((s,x)=>s+x.amount,0);
  const salesAmount=document.getElementById('todaySales');salesAmount.dataset.actualAmount=money(salesToday);document.querySelectorAll('#todayNet').forEach(amount=>{amount.dataset.actualAmount=money(grossToday-expensesToday);});setSalesAmountVisibility();
  updateExpensePeriodTotal();
  updateSalesPeriodSummary();
  const totalNet=money(allGross-allExpenses),totalProducts=db.products.length,totalStock=db.products.reduce((s,p)=>s+p.stock,0);
  const meNet=document.getElementById('meAllNet'),meProducts=document.getElementById('meProductCount'),meStock=document.getElementById('meStockCount');
  if(meNet)meNet.textContent=totalNet;if(meProducts)meProducts.textContent=String(totalProducts);if(meStock)meStock.textContent=String(totalStock);
  document.getElementById('dashboardGreeting').textContent='';const sellerGreeting=document.getElementById('businessTitle');if(sellerGreeting){const meta=cloudUser?.user_metadata||{};const fullName=String(meta.full_name||meta.name||meta.given_name||'').trim();const firstName=String(meta.first_name||meta.given_name||fullName.split(/\\s+/)[0]||'Seller').trim().split(/\\s+/)[0];sellerGreeting.textContent=firstName.toUpperCase();}
  const low=db.products.filter(p=>Number(p.stock)<=lowStockThreshold).sort((a,b)=>a.stock-b.stock);
  document.getElementById('lowStockPreview').innerHTML=low.length?low.slice(0,5).map(p=>'<div class="item"><div class="row"><strong>'+esc(p.name)+'</strong><span class="low-stock-badge">'+p.stock+' left</span></div></div>').join(''):'<div class="empty">No products at or below '+lowStockThreshold+' units.</div>';
  document.getElementById('lowStockList').innerHTML=low.length?low.map(p=>'<div class="item"><div class="row"><div><strong>'+esc(p.name)+'</strong><div class="muted">Current stock: '+p.stock+'</div></div><button type="button" data-adjust-from-list="'+p.id+'">Adjust</button></div></div>').join(''):'<div class="empty">No low-stock products.</div>';
  const adj=document.getElementById('adjustProduct'),prevAdj=adj.value;adj.innerHTML='<option value="">Choose a product</option>'+db.products.map(p=>'<option value="'+p.id+'">'+esc(p.name)+' ('+p.stock+' in stock)</option>').join('');if(db.products.some(p=>p.id===prevAdj))adj.value=prevAdj;
  updateAdjustmentPreview();renderStockAdjustments();renderReports();document.getElementById('homeSyncPill').textContent=pendingSync.length?pendingSync.length+' pending sync':'● Up to date';
  db.products.forEach(p=>{p.category=normalizeCategory(p.category);});
  const searchTerm=(document.getElementById('productSearch').value||'').trim().toLocaleLowerCase();
  const categoryFilter=document.getElementById('categoryFilter');
  const previousCategory=categoryFilter.value;
  const categories=[...new Set(db.products.map(p=>normalizeCategory(p.category)))].sort((a,b)=>a.localeCompare(b));
  categoryFilter.innerHTML='<option value="">All categories</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if(categories.includes(previousCategory))categoryFilter.value=previousCategory;
  const selectedCategory=categoryFilter.value;
  document.getElementById('categorySuggestions').innerHTML=categories.map(c=>`<option value="${esc(c)}"></option>`).join('');
  const categoryChips=categories.map(c=>`<button type="button" data-category-suggestion="${esc(c)}">${esc(c)}</button>`).join('');
  document.getElementById('categorySuggestionChips').innerHTML=categories.length?'<span class="suggestion-label">Your categories · tap to use</span>'+categoryChips:'';
  document.getElementById('editCategorySuggestionChips').innerHTML=categories.length?'<span class="suggestion-label">Your categories · tap to use</span>'+categoryChips:'';
  const filteredProducts=db.products.filter(p=>
    p.name.toLocaleLowerCase().includes(searchTerm)&&
    (!selectedCategory||normalizeCategory(p.category)===selectedCategory)
  );
  document.getElementById('productList').innerHTML=filteredProducts.length?filteredProducts.map(p=>{
    const displayImage=typeof p.image==='string'&&p.image.startsWith('data:image/')?p.image:(p.offlineImage||p.image);
    const photo=typeof displayImage==='string'&&(displayImage.startsWith('data:image/')||displayImage.startsWith('https://'))?`<img class="product-photo" src="${displayImage}" alt="${esc(p.name)} photo" loading="lazy" decoding="async" fetchpriority="low">`:'<div class="product-photo" aria-label="No product photo"></div>';
    const lowStock=Number(p.stock)<=Number(lowStockThreshold);
    return `<button type="button" class="item product-summary-item product-open-button" data-product-open="${p.id}" aria-label="View ${esc(p.name)}"><span class="item-product">${photo}<span class="item-product-details">
    <span class="row product-summary-top"><strong>${esc(p.name)}</strong><strong>${money(p.price)}</strong></span>
    <span class="muted">Stock: <strong>${p.stock} units</strong>${lowStock?' · Low stock':''}</span>
    </span></span></button>`;
  }).join(''):db.products.length?'<div class="empty">No products match your search or category.</div>':'<div class="empty">No products yet.</div>';

  const sel=document.getElementById('saleProduct'), previous=sel.value;
  sel.innerHTML='<option value="">Choose a product</option>'+db.products.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.stock} in stock)</option>`).join('');
  if(db.products.some(p=>p.id===previous))sel.value=previous;refreshSaleUnitOptions();
  updateSalePrice();

  const saleHTML=x=>`<div class="item"><div class="row"><strong>${esc(x.name)} × ${x.qty}</strong><strong>${money(x.total)}</strong></div><div class="muted">${safeDate(x.date).toLocaleString()} · Gross profit ${money(x.profit)}${x.note?' · '+esc(x.note):''}</div></div>`;
  const query=(document.getElementById('salesSearch').value||'').trim().toLocaleLowerCase(),from=document.getElementById('salesFrom').value,to=document.getElementById('salesTo').value;
  const filtered=[...db.sales].filter(x=>(!query||(String(x.name||'')+' '+String(x.note||'')).toLocaleLowerCase().includes(query))&&(!from||dateKey(x.date)>=from)&&(!to||dateKey(x.date)<=to)).sort((a,b)=>safeDate(b.date)-safeDate(a.date));
  document.getElementById('salesResultCount').textContent=filtered.length+' shown';
  document.getElementById('salesList').innerHTML=filtered.length?filtered.map(saleHTML).join(''):db.sales.length?'<div class="empty">No sales match these filters.</div>':'<div class="empty">No sales recorded yet.</div>';
  const recentSalesPreview=document.getElementById('recentSalesPreviewText');if(recentSalesPreview){const latest=[...db.sales].sort((a,b)=>safeDate(b.date)-safeDate(a.date))[0];recentSalesPreview.textContent=latest?`${latest.name} × ${latest.qty} · ${money(latest.total)}`:'No sales recorded yet.';}
  const historyProduct=(document.getElementById('historySalesProduct')?.value||'').trim().toLocaleLowerCase(),historyFrom=document.getElementById('historySalesFrom')?.value||'',historyTo=document.getElementById('historySalesTo')?.value||'';const historyRows=[...(db.sales||[])].filter(x=>(!historyProduct||String(x.name||x.product_name||'').toLocaleLowerCase().includes(historyProduct))&&(!historyFrom||dateKey(x.date||x.sold_at||x.created_at)>=historyFrom)&&(!historyTo||dateKey(x.date||x.sold_at||x.created_at)<=historyTo)).sort((a,b)=>safeDate(b.date||b.sold_at||b.created_at)-safeDate(a.date||a.sold_at||a.created_at));const historyTarget=document.getElementById('salesHistoryList');if(historyTarget)historyTarget.innerHTML=historyRows.length?historyRows.map(x=>'<button type="button" class="item sales-history-row" data-sale-detail="'+esc(String(x.id||''))+'" aria-label="View sale details for '+esc(String(x.name||x.product_name||'Sale'))+'"><span class="sales-history-row-main"><span class="row"><strong>'+esc(String(x.name||x.product_name||'Sale'))+' × '+(Number(x.qty)||0)+'</strong><strong>'+money(Number(x.total)||0)+'</strong></span><span class="muted">'+safeDate(x.date||x.sold_at||x.created_at).toLocaleString()+' · Gross profit '+money(Number(x.profit)||0)+(x.note?' · '+esc(x.note):'')+'</span></span><span class="sales-history-row-chevron" aria-hidden="true">›</span></button>').join(''):'<div class="empty">No sales found for these dates.</div>';if(currentPage()==='sale-details')renderSaleDetails();
  const expenseFrom=document.getElementById('historyExpensesFrom')?.value||'',expenseTo=document.getElementById('historyExpensesTo')?.value||'';const filteredExpenses=[...(db.expenses||[])].filter(x=>(!expenseFrom||dateKey(x.date)>=expenseFrom)&&(!expenseTo||dateKey(x.date)<=expenseTo)).sort((a,b)=>safeDate(b.date)-safeDate(a.date));document.getElementById('expenseList').innerHTML=filteredExpenses.length?filteredExpenses.map(x=>`<div class="item"><div class="row"><strong>${esc(x.name)}</strong><strong>${money(x.amount)}</strong></div><div class="muted">${safeDate(x.date).toLocaleString()}</div></div>`).join(''):db.expenses.length?'<div class="empty">No expenses match these dates.</div>':'<div class="empty">No expenses recorded yet.</div>';
}
let selectedSaleDetailId='';function renderSaleDetails(){const target=document.getElementById('saleDetailsContent');if(!target)return;const sale=(db.sales||[]).find(x=>String(x.id||'')===String(selectedSaleDetailId));if(!sale){target.innerHTML='<div class="empty">This sale could not be found. Return to Sales history and choose a sale.</div>';return;}const qty=Number(sale.qty)||0,price=Number(sale.price)||0,cost=Number(sale.cost)||0,total=Number(sale.total)||0,profit=Number(sale.profit)||0,baseQty=Number(sale.baseQty)||qty*(Number(sale.unitsPerSale)||1),unit=String(sale.saleUnit||'unit'),date=safeDate(sale.date||sale.sold_at||sale.created_at),note=String(sale.note||''),costTotal=Math.max(0,total-profit);target.innerHTML='<div class="sale-detail-card"><p class="sale-detail-product-name">'+esc(String(sale.name||sale.product_name||'Sale'))+'</p><p class="sale-detail-date">'+date.toLocaleString()+'</p></div><div class="sale-detail-card"><h2>Sales summary</h2><div class="sale-detail-summary-grid"><div class="sale-detail-metric"><small>Total sales</small><strong>'+money(total)+'</strong></div><div class="sale-detail-metric"><small>Cost of goods</small><strong>'+money(costTotal)+'</strong></div><div class="sale-detail-metric"><small>Gross profit</small><strong>'+money(profit)+'</strong></div><div class="sale-detail-metric"><small>Payment status</small><strong>Paid</strong></div></div></div><div class="sale-detail-card"><h2>Sale details</h2><div class="sale-detail-lines"><div class="sale-detail-line"><span>Product</span><strong>'+esc(String(sale.name||sale.product_name||'Sale'))+'</strong></div><div class="sale-detail-line"><span>Quantity sold</span><strong>'+qty+' '+esc(unit)+(Number(sale.unitsPerSale)>1?' ('+baseQty+' individual units)':'')+'</strong></div><div class="sale-detail-line"><span>Selling price per '+esc(unit)+'</span><strong>'+money(price)+'</strong></div><div class="sale-detail-line"><span>Cost per '+esc(unit)+'</span><strong>'+money(cost)+'</strong></div><div class="sale-detail-line"><span>Total sales</span><strong class="sale-detail-total">'+money(total)+'</strong></div><div class="sale-detail-line"><span>Cost of goods sold</span><strong>'+money(costTotal)+'</strong></div><div class="sale-detail-line"><span>Gross profit</span><strong>'+money(profit)+'</strong></div>'+(note?'<div class="sale-detail-line"><span>Sale note</span><strong>'+esc(note)+'</strong></div>':'')+'</div></div>'; }document.addEventListener('click',event=>{const row=event.target.closest('[data-sale-detail]');if(!row)return;selectedSaleDetailId=row.dataset.saleDetail||'';showPage('sale-details');});
document.getElementById('productSearch').addEventListener('input',render);
document.getElementById('categoryFilter').addEventListener('change',render);
['salesSearch','salesFrom','salesTo'].forEach(id=>document.getElementById(id).addEventListener('input',render));
 ['historySalesProduct','historySalesFrom','historySalesTo'].forEach(id=>document.getElementById(id).addEventListener('input',render));document.getElementById('clearHistorySalesDates').addEventListener('click',()=>{document.getElementById('historySalesProduct').value='';document.getElementById('historySalesFrom').value='';document.getElementById('historySalesTo').value='';render();});['historyExpensesFrom','historyExpensesTo'].forEach(id=>document.getElementById(id).addEventListener('input',render));document.getElementById('clearHistoryExpensesDates').addEventListener('click',()=>{document.getElementById('historyExpensesFrom').value='';document.getElementById('historyExpensesTo').value='';render();});
document.getElementById('clearSalesFilters').addEventListener('click',()=>{['salesSearch','salesFrom','salesTo'].forEach(id=>document.getElementById(id).value='');render();});
function renderBarChart(id,rows,labelFn,valueFn){const target=document.getElementById(id);if(!target)return;if(!rows.length||rows.every(r=>Number(valueFn(r))<=0)){target.innerHTML='<div class="empty">No sales in this period yet.</div>';return;}const max=Math.max(1,...rows.map(r=>Number(valueFn(r))||0));target.innerHTML='<div class="chart-bars" role="img" aria-label="Sales bar chart">'+rows.map(r=>{const v=Math.max(0,Number(valueFn(r))||0);return '<div class="chart-col" title="'+esc(labelFn(r)+': '+money(v))+'"><span class="chart-value">'+(v?esc(money(v).replace('.00','')):'')+'</span><div class="chart-bar" style="height:'+Math.max(2,v/max*100)+'%"></div><span class="chart-label">'+esc(labelFn(r))+'</span></div>';}).join('')+'</div>';}
 function salesTotalsByDate(){const totals=new Map();for(const sale of db.sales||[]){const key=validDateKey(sale.date);if(!key||key>dateKey(new Date()))continue;totals.set(key,(totals.get(key)||0)+(Number(sale.total)||0));}return totals;}
 function reportRows(){const range=document.getElementById('reportRange')?.value||'30';const allTime=range==='all';const days=allTime?0:Number(range);const start=new Date();start.setHours(0,0,0,0);if(!allTime)start.setDate(start.getDate()-days+1);else{const dates=[...(db.sales||[]),...(db.expenses||[])].map(x=>x.date).filter(Boolean).map(x=>new Date(x)).filter(d=>!Number.isNaN(d.getTime())&&d<=new Date());if(dates.length){start.setTime(Math.min(...dates.map(d=>d.getTime())));start.setHours(0,0,0,0);}else{start.setFullYear(start.getFullYear(),0,1);}}const span=Math.max(1,Math.floor((new Date().setHours(0,0,0,0)-start.getTime())/86400000)+1);const size=allTime?Math.max(1,Math.ceil(span/14)):Math.max(1,Math.ceil(days/14));const dailyTotals=salesTotalsByDate(),rows=[];for(let offset=0;offset<span;offset+=size){const d=new Date(start);d.setDate(start.getDate()+offset);let total=0;for(let i=offset;i<Math.min(span,offset+size);i++){const day=new Date(start);day.setDate(start.getDate()+i);total+=dailyTotals.get(dateKey(day))||0;}rows.push({label:d.toLocaleDateString(undefined,{month:'numeric',day:'numeric'}),sales:total});}return {start,rows};}
 function reportRowsFor7(){const dailyTotals=salesTotalsByDate(),rows=[];for(let i=6;i>=0;i--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);const key=dateKey(d);rows.push({label:d.toLocaleDateString(undefined,{weekday:'short'}),sales:dailyTotals.get(key)||0});}return rows;}
function renderReports(){const {start,rows}=reportRows(),allTime=document.getElementById('reportRange')?.value==='all',key=dateKey(start),todayKey=dateKey(new Date()),inRange=x=>{const recordKey=validDateKey(x.date);return !!recordKey&&recordKey<=todayKey&&(allTime||recordKey>=key);},sales=db.sales.filter(inRange),expenses=db.expenses.filter(inRange);const total=sales.reduce((n,x)=>n+x.total,0),gross=sales.reduce((n,x)=>n+x.profit,0),costs=expenses.reduce((n,x)=>n+x.amount,0);document.getElementById('reportSales').textContent=money(total);document.getElementById('reportGross').textContent=money(gross);document.getElementById('reportExpenses').textContent=money(costs);document.getElementById('reportNet').textContent=money(gross-costs);renderBarChart('salesTrendChart',reportRowsFor7(),x=>x.label,x=>x.sales);renderBarChart('reportSalesChart',rows,x=>x.label,x=>x.sales);const sums=new Map();sales.forEach(x=>sums.set(x.name,(sums.get(x.name)||0)+x.qty));const top=[...sums.entries()].map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty).slice(0,5),max=top[0]?.qty||1;document.getElementById('topProductsChart').innerHTML=top.length?top.map(x=>'<div class="progress-row"><strong>'+esc(x.name)+'</strong><div class="progress-track"><div class="progress-fill" style="width:'+(x.qty/max*100)+'%"></div></div><span class="muted">'+x.qty+' sold</span></div>').join(''):'<div class="empty">No product sales in this period.</div>';}
document.getElementById('reportRange').addEventListener('change',renderReports);
function renderRestockHistory(){
 const target=document.getElementById('restockHistoryList');
 if(!target)return;
 const productById=new Map((db.products||[]).map(p=>[String(p.id),p]));
 const unique=new Map();
 for(const row of Array.isArray(db.restocks)?db.restocks:[]){
  if(!row||row.id==null)continue;
  const key=String(row.id);
  const previous=unique.get(key);
  if(!previous||safeDate(row.date)>safeDate(previous.date))unique.set(key,{...previous,...row});
 }
 const rows=[...unique.values()].sort((a,b)=>safeDate(b.date)-safeDate(a.date)).slice(0,200);
 if(!rows.length){target.innerHTML='<div class="empty">No restocks recorded yet.</div>';return;}
 target.innerHTML=rows.map(r=>{
  const product=productById.get(String(r.productId));
  const name=String(r.productName||product?.name||'Product');
  const quantity=Number(r.baseQuantity)||Number(r.purchaseQuantity)*Number(r.unitsPerPurchase)||0;
  const purchaseQty=Number(r.purchaseQuantity)||0;
  const unit=String(r.purchaseUnit||'unit');
  const cost=Number(r.totalCost)||purchaseQty*(Number(r.costPerPurchaseUnit)||0);
  const date=safeDate(r.date);
  return '<button type="button" class="stock-history-row" data-stock-history-id="'+esc(String(r.id))+'" data-stock-history-kind="restock"><span class="row"><strong>'+esc(name)+'</strong><strong>+'+quantity.toLocaleString('en-NG')+' units</strong></span><span class="muted">'+(date.getTime()?date.toLocaleString():'Date unavailable')+' · '+purchaseQty.toLocaleString('en-NG')+' '+esc(unit)+' · '+money(cost)+'</span></button>';
 }).join('');
}
function renderStockHistoryDetail(kind,id){const row=(kind==='restock'?(db.restocks||[]):(db.stockAdjustments||[])).find(x=>x.id===id);const target=document.getElementById('stockHistoryDetailContent');if(!target||!row)return;const fields=kind==='restock'?[['Type','Restock'],['Product',row.productName||db.products.find(p=>p.id===row.productId)?.name||'Product'],['Date and time',safeDate(row.date).toLocaleString()],['Purchase quantity',(row.purchaseQuantity||0)+' '+(row.purchaseUnit||'unit')],['Units per purchase',row.unitsPerPurchase||1],['Total units added',row.baseQuantity||((row.purchaseQuantity||0)*(row.unitsPerPurchase||1))],['Cost per purchase unit',money(Number(row.costPerPurchaseUnit)||0)],['Total purchase cost',money(Number(row.totalCost)||((row.purchaseQuantity||0)*(Number(row.costPerPurchaseUnit)||0)))],['Stock after restock',row.newStock??'—'],['Average cost per unit',money(Number(row.averageCostAfter)||0)]]:[['Type','Stock adjustment'],['Product',row.productName||'Product'],['Date and time',safeDate(row.date).toLocaleString()],['Previous stock',String(row.previousStock??'—')+' units'],['New stock',String(row.newStock??'—')+' units'],['Change',((Number(row.quantityChange)>0?'+':'')+String(row.quantityChange??0))+' units'],['Reason',row.reason||'Not specified']];target.innerHTML=fields.map(([label,value])=>'<div class="stock-history-detail-field"><span>'+esc(label)+'</span><strong>'+esc(String(value))+'</strong></div>').join('');}
document.getElementById('stock-history').addEventListener('click',e=>{const b=e.target.closest('[data-stock-history-id]');if(!b)return;renderStockHistoryDetail(b.dataset.stockHistoryKind,b.dataset.stockHistoryId);showPage('stock-history-detail');});

function updateAdjustmentPreview(){const p=db.products.find(x=>x.id===document.getElementById('adjustProduct').value),v=document.getElementById('adjustNewStock').value;document.getElementById('adjustCurrentStock').textContent=p?String(p.stock):'—';const d=p&&v!==''?Number(v)-Number(p.stock):null;document.getElementById('adjustStockChange').textContent=d===null?'—':(d>0?'+':'')+d+' units';}
document.getElementById('adjustProduct').addEventListener('change',()=>{const p=db.products.find(x=>x.id===document.getElementById('adjustProduct').value);document.getElementById('adjustNewStock').value=p?p.stock:'';updateAdjustmentPreview();});
document.getElementById('adjustNewStock').addEventListener('input',updateAdjustmentPreview);
document.getElementById('lowStockList').addEventListener('click',e=>{const b=e.target.closest('[data-adjust-from-list]');if(!b)return;showPage('stock');document.getElementById('adjustProduct').value=b.dataset.adjustFromList;const p=db.products.find(x=>x.id===b.dataset.adjustFromList);document.getElementById('adjustNewStock').value=p?p.stock:'';updateAdjustmentPreview();});
function renderStockAdjustments(){const target=document.getElementById('stockAdjustmentList');if(!target)return;const rows=[...(db.stockAdjustments||[])].sort((a,b)=>safeDate(b.date)-safeDate(a.date)).slice(0,100);target.innerHTML=rows.length?rows.map(a=>'<button type="button" class="stock-history-row" data-stock-history-id="'+esc(a.id)+'" data-stock-history-kind="adjustment"><span class="row"><strong>'+esc(a.productName)+'</strong><strong>'+(a.quantityChange>0?'+':'')+a.quantityChange+' units</strong></span><span class="muted">'+safeDate(a.date).toLocaleString()+' · '+a.previousStock+' → '+a.newStock+' units'+(a.reason?' · '+esc(a.reason):'')+'</span></button>').join(''):'<div class="empty">No stock adjustments recorded yet.</div>';renderRestockHistory();}
function updateRestockPreview(){
 const p=db.products.find(x=>x.id===document.getElementById('restockProduct').value);
 const qty=Number(document.getElementById('restockPurchaseQty').value),units=Number(document.getElementById('restockUnitsPerPurchase').value),cost=Number(document.getElementById('restockCostPerPurchase').value);
 const out=document.getElementById('restockPreview');
 if(!p||!Number.isSafeInteger(qty)||qty<1||!Number.isSafeInteger(units)||units<1||!Number.isFinite(cost)||cost<0||qty>Math.floor(2000000000/units)){out.textContent='Choose a product and enter valid purchase details within the stock limit.';return;}
 const baseQty=qty*units,total=qty*cost,newStock=p.stock+baseQty;if(!Number.isSafeInteger(newStock)||newStock>2000000000||!Number.isFinite(total)||total>MAX_MONEY){out.textContent='This purchase exceeds the safe stock or cost limit.';return;}const baseCost=total/baseQty,avg=p.stock>0?((p.stock*p.cost+baseQty*baseCost)/newStock):baseCost;
 out.textContent='Adds '+baseQty+' units · Total purchase cost '+money(total)+' · New stock '+newStock+' · New average cost '+money(avg)+' per smallest unit.';
}
['restockProduct','restockPurchaseQty','restockPurchaseUnit','restockUnitsPerPurchase','restockCostPerPurchase'].forEach(id=>document.getElementById(id).addEventListener('input',updateRestockPreview));
let restockSubmitting=false;
document.getElementById('restockForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if(restockSubmitting)return;
 restockSubmitting=true;
 const submitButton=e.submitter||e.currentTarget.querySelector('button[type="submit"]');
 if(submitButton)submitButton.disabled=true;
 try {
 const p=db.products.find(x=>x.id===document.getElementById('restockProduct').value);
 const purchaseQuantity=Number(document.getElementById('restockPurchaseQty').value),purchaseUnit=document.getElementById('restockPurchaseUnit').value.trim(),unitsPerPurchase=Number(document.getElementById('restockUnitsPerPurchase').value),costPerPurchaseUnit=Number(document.getElementById('restockCostPerPurchase').value);
 if(!p)return alert('Choose a product.');
 if(!Number.isSafeInteger(purchaseQuantity)||purchaseQuantity<1||!purchaseUnit||purchaseUnit.length>30||!Number.isSafeInteger(unitsPerPurchase)||unitsPerPurchase<1||!Number.isFinite(costPerPurchaseUnit)||costPerPurchaseUnit<0)return alert('Check the purchase quantity, unit, units per purchase, and cost.');
 if(purchaseQuantity>Math.floor(2000000000/unitsPerPurchase))return alert('This purchase quantity is too large.');
 const baseQuantity=purchaseQuantity*unitsPerPurchase;
 let totalCost;try{totalCost=roundMoney(purchaseQuantity*costPerPurchaseUnit);}catch(error){return alert(error.message||'Purchase cost is too large.');}
 const newStock=p.stock+baseQuantity;
 if(!Number.isSafeInteger(baseQuantity)||!Number.isSafeInteger(newStock)||newStock>2000000000||!Number.isFinite(totalCost))return alert('This purchase quantity is too large.');
 const baseCost=Math.round((totalCost/baseQuantity+Number.EPSILON)*10000)/10000,averageCostAfter=p.stock>0?Math.round((((p.stock*p.cost+baseQuantity*baseCost)/newStock)+Number.EPSILON)*10000)/10000:baseCost;
 if(!confirm('Record purchase of '+purchaseQuantity+' '+purchaseUnit+' for '+money(totalCost)+'? This adds '+baseQuantity+' units and updates average cost.'))return;
 const restock={id:crypto.randomUUID(),productId:p.id,productName:p.name,purchaseQuantity,purchaseUnit,unitsPerPurchase,costPerPurchaseUnit,date:now(),previousStock:p.stock,newStock,baseQuantity,totalCost:Math.round(purchaseQuantity*costPerPurchaseUnit*100)/100,averageCostAfter};db.restocks.push(restock);
 const oldStock=p.stock,oldCost=p.cost;
 p.stock=newStock;p.cost=Math.round(averageCostAfter*10000)/10000;
 try{
  if(cloudUser){
   enqueueChange('stock_restock',{restock});
   pendingSync=readQueue(cloudUser.id);
   let synced=false;
   if(navigator.onLine) synced=await syncPendingChanges();
   if(!synced){
    pendingSync=readQueue(cloudUser.id);
    storageMode='cloud-offline';
    cacheCloudData(cloudUser.id);
    render();
    renderStockAdjustments();
    refreshStockHistoryBadges();
    cloudMessage(navigator.onLine
     ? 'Restock saved on this phone but is still waiting to sync. Check Sync & Data for the reason.'
     : 'Restock saved on this phone. It will sync when you reconnect.');
   } else {
    renderStockAdjustments();
    refreshStockHistoryBadges();
   }
  }else{
   if(!save()){p.stock=oldStock;p.cost=oldCost;db.restocks=db.restocks.filter(x=>x.id!==restock.id);return;}
   render();
   renderStockAdjustments();
   refreshStockHistoryBadges();
  }
  e.target.reset();document.getElementById('restockPurchaseQty').value=1;document.getElementById('restockUnitsPerPurchase').value=1;document.getElementById('restockPurchaseUnit').value='unit';updateRestockPreview();
  alert(cloudUser&&pendingSync.some(item=>item.type==='stock_restock'&&item.payload?.restock?.id===restock.id)
   ? 'Restock saved on this phone. Cloud synchronization is still pending.'
   : 'Restock recorded and saved.');
 }catch(err){p.stock=oldStock;p.cost=oldCost;db.restocks=db.restocks.filter(item=>item.id!==restock.id);render();alert('Restock could not be saved: '+(err.message||String(err)));}
 } finally {restockSubmitting=false;if(submitButton)submitButton.disabled=false;}
});
document.getElementById('stockAdjustmentForm').addEventListener('submit',async e=>{e.preventDefault();const p=db.products.find(x=>x.id===document.getElementById('adjustProduct').value),next=Number(document.getElementById('adjustNewStock').value),reason=document.getElementById('adjustReason').value.trim();if(!p)return alert('Choose a product first.');if(!Number.isSafeInteger(next)||next<0||next>2000000000)return alert('Enter a whole-number stock quantity between 0 and 2,000,000,000.');if(next===p.stock)return alert('The new stock quantity is the same as the current quantity.');if(!confirm('Change '+p.name+' stock from '+p.stock+' to '+next+' units?'))return;const old=p.stock,oldVersion=p.updatedAt,a={id:crypto.randomUUID(),productId:p.id,productName:p.name,previousStock:old,newStock:next,quantityChange:next-old,reason,date:now()};p.stock=next;if(cloudUser){try{db.stockAdjustments.push(a);await saveCloudChangesLocally([{type:'product_save',payload:{product:{...p},isNew:false}},{type:'stock_adjustment',payload:{adjustment:a}}]);}catch(err){p.stock=old;p.updatedAt=oldVersion;db.stockAdjustments=db.stockAdjustments.filter(x=>x.id!==a.id);render();return alert(err.message||String(err));}}else{db.stockAdjustments.push(a);if(!save()){p.stock=old;db.stockAdjustments.pop();return;}render();}document.getElementById('adjustReason').value='';alert('Stock adjustment saved.');});

function updateSalePrice(){
 const p=db.products.find(x=>x.id===document.getElementById('saleProduct').value);
 document.getElementById('salePrice').value=p?p.price:'';
 document.getElementById('saleStock').textContent=p?'Available stock: '+p.stock+' units':'';
}
document.getElementById('saleProduct').addEventListener('change',updateSalePrice);

let pendingProductImage='';
let imageTargetId=null;

function clearPendingPhoto(){
 pendingProductImage='';
 document.getElementById('productPreview').src='';
 document.getElementById('productPreview').classList.add('hidden');
 document.getElementById('removePendingPhoto').classList.add('hidden');
 document.getElementById('photoStatus').textContent='You can save a product without a photo.';
}

function processProductImage(file){
 return new Promise((resolve,reject)=>{
  if(!file||!file.type.startsWith('image/'))return reject(Error('Please select an image.'));
  if(file.size>10*1024*1024)return reject(Error('This photo is over 10 MB. Choose a smaller photo.'));
  const reader=new FileReader();
  reader.onerror=()=>reject(Error('Could not read that photo.'));
  reader.onload=()=>{
   const img=new Image();
   img.onerror=()=>reject(Error('Could not open that image. Try another photo.'));
   img.onload=()=>{
    const max=600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx)return reject(Error('Your browser could not process the photo.'));
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    try{resolve(canvas.toDataURL('image/jpeg',0.68));}
    catch(err){reject(Error('Could not compress the photo.'));}
   };
   img.src=reader.result;
  };
  reader.readAsDataURL(file);
 });
}

document.getElementById('takeProductPhoto').addEventListener('click',()=>{
 document.getElementById('productCamera').click();
});
document.getElementById('chooseProductPhoto').addEventListener('click',()=>{
 document.getElementById('productGallery').click();
});

async function handleImageSelection(event){
 const input=event.currentTarget,file=input.files&&input.files[0];
 if(!file){input.value='';return;}
 try{
  const image=await processProductImage(file);
  if(imageTargetId){
   const p=db.products.find(x=>x.id===imageTargetId);
   if(!p)return;
   if(cloudUser){
    const updated={...p,image};
    try { await saveCloudChangeLocally('product_save',{product:updated,isNew:false}); alert('Product photo saved on this device and queued for sync.'); }
    catch(err){ alert(err.message || String(err)); }
   }else{
    const oldImage=p.image,oldPath=p.imagePath;
    p.image=image;
    if(save()){render();alert('Product photo updated.');}
    else{p.image=oldImage;p.imagePath=oldPath;}
   }
   imageTargetId=null;
  }else{
   pendingProductImage=image;
   const preview=document.getElementById('productPreview');
   preview.src=image;
   preview.classList.remove('hidden');
   document.getElementById('removePendingPhoto').classList.remove('hidden');
   document.getElementById('photoStatus').textContent='Photo selected and compressed. It will be saved with the product.';
  }
 }catch(err){
  alert(err.message||'Could not use that photo.');
  imageTargetId=null;
 }finally{
  input.value='';
 }
}

document.getElementById('productCamera').addEventListener('change',handleImageSelection);
document.getElementById('productGallery').addEventListener('change',handleImageSelection);
document.getElementById('removePendingPhoto').addEventListener('click',clearPendingPhoto);

const DEFAULT_MARKUP_KEY='my-sales-book-default-markup-v1';
let defaultMarkup=Number(localStorage.getItem(DEFAULT_MARKUP_KEY)||30);if(![10,20,30,40,50].includes(defaultMarkup))defaultMarkup=30;
let selectedMarkup=defaultMarkup;
function syncDefaultMarkupUI(){const stored=Number(localStorage.getItem(DEFAULT_MARKUP_KEY)||30);defaultMarkup=[10,20,30,40,50].includes(stored)?stored:30;selectedMarkup=defaultMarkup;document.querySelectorAll('[data-markup]').forEach(x=>{const yes=Number(x.dataset.markup)===defaultMarkup;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});}
function updateSuggestedPrice(){const c=document.getElementById('pcost'),p=document.getElementById('pprice'),pp=document.getElementById('ppackprice'),o=document.getElementById('priceSuggestion');if(c.value.trim()===''||!Number.isFinite(Number(c.value))||Number(c.value)<0){o.textContent='Enter a cost price to calculate a suggested price.';return;}const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(n);if(productSellingType==='pack'){const count=Number(document.getElementById('punitsperpack').value);if(!Number.isSafeInteger(count)||count<1){o.textContent='Enter how many individual units are in each pack.';return;}const packCost=Number(c.value),packPrice=Math.round((packCost*(1+selectedMarkup/100)+Number.EPSILON)*100)/100,unitCost=Math.round((packCost/count+Number.EPSILON)*100)/100,unitPrice=Math.round((packPrice/count+Number.EPSILON)*100)/100;pp.value=packPrice.toFixed(2);p.value=unitPrice.toFixed(2);document.getElementById('pcostPerUnit').textContent=money(unitCost)+' per '+(document.getElementById('pbaseunitPack').value.trim()||'unit');o.textContent='Suggested selling price for one full pack: '+money(packPrice);return;}const cost=Number(c.value),price=Math.round((cost*(1+selectedMarkup/100)+Number.EPSILON)*100)/100;p.value=price.toFixed(2);o.textContent='Suggested unit price: '+money(price)+' · Gross profit per unit: '+money(price-cost);}
document.querySelectorAll('[data-markup]').forEach(b=>b.addEventListener('click',()=>{selectedMarkup=Number(b.dataset.markup);document.querySelectorAll('[data-markup]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});updateSuggestedPrice();}));
document.getElementById('pcost').addEventListener('input',updateSuggestedPrice);
document.getElementById('punitsperpack').addEventListener('input',updateSuggestedPrice);
document.getElementById('ppackprice').addEventListener('input',()=>{if(productSellingType!=='pack')return;const count=Number(document.getElementById('punitsperpack').value),packPrice=Number(document.getElementById('ppackprice').value);if(Number.isSafeInteger(count)&&count>0&&Number.isFinite(packPrice)&&packPrice>0){document.getElementById('pprice').value=(Math.round((packPrice/count+Number.EPSILON)*100)/100).toFixed(2);const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(n);document.getElementById('priceSuggestion').textContent='Your chosen selling prices — per pack: '+money(packPrice)+' · per '+(document.getElementById('pbaseunitPack').value.trim()||'unit')+': '+money(Number(document.getElementById('pprice').value));}});
let productSellingType='unit';
function setProductSellingType(type){
 productSellingType=type;
 const pack=type==='pack';
 document.getElementById('productTypeUnit').classList.toggle('selected',!pack);
 document.getElementById('productTypeUnit').setAttribute('aria-pressed',String(!pack));
 document.getElementById('productTypePack').classList.toggle('selected',pack);
 document.getElementById('productTypePack').setAttribute('aria-pressed',String(pack));
 document.getElementById('unitProductPanel').classList.toggle('hidden',pack);
 document.getElementById('packProductPanel').classList.toggle('hidden',!pack);
 document.getElementById('pbaseunit').disabled=pack;
 document.getElementById('pbaseunitPack').disabled=!pack;
 document.getElementById('ppackunit').disabled=!pack;
 document.getElementById('punitsperpack').disabled=!pack;
 document.getElementById('ppackprice').disabled=!pack;
 document.getElementById('productTypeHelp').textContent=pack?'Enter what you pay for one pack and how many units it contains. Sell complete packs or individual units.':'Enter the cost and opening stock in individual units.';
 document.getElementById('pcostLabel').textContent=pack?'Purchase cost per pack (₦)':'Cost price per unit (₦)';
 document.getElementById('pstockLabel').textContent=pack?'Opening stock (number of packs purchased)':'Opening stock (individual units)';
 document.getElementById('ppriceLabel').textContent=pack?'Selling price per individual unit (₦)':'Selling price per unit (₦)';
 document.getElementById('pcost').placeholder=pack?'Enter cost for one pack':'Enter cost for one unit';
 document.getElementById('pstock').placeholder=pack?'e.g. 5 packs':'e.g. 24 units';
 updateSuggestedPrice();
 document.getElementById('ppackunit').required=pack;
 document.getElementById('ppackprice').required=pack;
}
document.getElementById('productTypeUnit').addEventListener('click',()=>setProductSellingType('unit'));
document.getElementById('productTypePack').addEventListener('click',()=>setProductSellingType('pack'));
document.getElementById('productForm').addEventListener('reset',()=>setProductSellingType('unit'));
document.getElementById('productForm').addEventListener('reset',()=>setTimeout(()=>syncCategoryPicker('product',''),0));
document.getElementById('productForm').addEventListener('reset',()=>{selectedMarkup=defaultMarkup;document.querySelectorAll('[data-markup]').forEach(x=>{const yes=Number(x.dataset.markup)===defaultMarkup;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});document.getElementById('priceSuggestion').textContent='Enter a cost price to calculate a suggested price.';});
document.getElementById('productForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const name=document.getElementById('pname').value.trim(),enteredCost=Number(document.getElementById('pcost').value),price=Number(document.getElementById('pprice').value),enteredStock=Number(document.getElementById('pstock').value);
 const unitsPerPackInput=productSellingType==='pack'?Number(document.getElementById('punitsperpack').value):1;
 const cost=productSellingType==='pack'?enteredCost/unitsPerPackInput:enteredCost;
 const stock=productSellingType==='pack'?enteredStock*unitsPerPackInput:enteredStock;
 if(!name||name.length>100||!Number.isFinite(enteredCost)||enteredCost<0||enteredCost>MAX_MONEY||!Number.isFinite(cost)||cost<0||cost>MAX_MONEY||!Number.isFinite(price)||price<=0||price>MAX_MONEY||!Number.isSafeInteger(enteredStock)||enteredStock<0||!Number.isSafeInteger(stock)||stock<0||stock>2000000000)return alert('Check the product name, prices and stock quantity.');
 if(db.products.some(p=>p.name.toLowerCase()===name.toLowerCase()))return alert('A product with this name already exists.');
 const category=normalizeCategory(getSelectedCategories('product').join(' | '));
 if(!getSelectedCategories('product').length)return alert('Choose at least one product category. You can select up to three.');
 const baseUnit=((productSellingType==='pack'?document.getElementById('pbaseunitPack').value:document.getElementById('pbaseunit').value).trim()||'unit');
 const packUnit=productSellingType==='pack'?document.getElementById('ppackunit').value.trim():'';
 const unitsPerPack=productSellingType==='pack'?Number(document.getElementById('punitsperpack').value):1;
 const packPriceRaw=productSellingType==='pack'?document.getElementById('ppackprice').value.trim():'';
 const packPrice=packPriceRaw===''?null:Number(packPriceRaw);
 if(productSellingType==='pack'&&(!packUnit||!Number.isSafeInteger(unitsPerPack)||unitsPerPack<1||!Number.isFinite(packPrice)||packPrice<=0||packPrice>MAX_MONEY))return alert('Enter a pack name, the number of individual units in each pack, and a valid pack selling price.');
 const product={id:crypto.randomUUID(),name,category,cost,price,stock,baseUnit,packUnit,unitsPerPack,packPrice,image:pendingProductImage,createdAt:now()};
 if(cloudUser){
   try { await saveCloudChangeLocally('product_save',{product,isNew:true}); }
   catch(err){ return alert(err.message || String(err)); }
 }else{
   db.products.push(product);
   if(!save())return;
   render();
 }
 e.target.reset();clearPendingPhoto();alert('Product saved.');
});


let editPendingProductImage = '';
let editRemoveProductImage = false;

function updateEditProductPhotoPreview(product) {
  const preview=document.getElementById('editProductPhotoPreview');
  const status=document.getElementById('editProductPhotoStatus');
  const image=editPendingProductImage || (!editRemoveProductImage ? (product?.offlineImage || product?.image) : '');
  if(image){preview.src=image;preview.classList.remove('hidden');}
  else{preview.removeAttribute('src');preview.classList.add('hidden');}
  status.textContent=editPendingProductImage?'New photo selected. It will be saved with the product.':editRemoveProductImage?'The product photo will be removed when you save.':product?.image?'Current photo will be kept unless you replace or remove it.':'No product photo selected.';
  document.getElementById('editRemoveProductPhoto').disabled=!image && !product?.image;
}

let selectedEditMarkup=defaultMarkup;
function updateEditSuggestedPrice(updatePrice=true){
 const c=document.getElementById('editProductCost'),p=document.getElementById('editProductPrice'),o=document.getElementById('editPriceSuggestion');
 const cost=Number(c.value);
 if(c.value.trim()===''||!Number.isFinite(cost)||cost<0){o.textContent='Enter a cost price to calculate a suggested price.';return;}
 const price=Math.round((cost*(1+selectedEditMarkup/100)+Number.EPSILON)*100)/100;
 if(updatePrice)p.value=price.toFixed(2);
 const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(n);
 o.textContent='Suggested price: '+money(price)+' · Gross profit: '+money(price-cost);
}
document.querySelectorAll('[data-edit-markup]').forEach(b=>b.addEventListener('click',()=>{
 selectedEditMarkup=Number(b.dataset.editMarkup);
 document.querySelectorAll('[data-edit-markup]').forEach(x=>{const yes=x===b;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});
 updateEditSuggestedPrice(true);
}));
document.getElementById('editProductCost').addEventListener('input',()=>updateEditSuggestedPrice(true));
document.getElementById('editProductForm').addEventListener('reset',()=>{
 selectedEditMarkup=defaultMarkup;
 document.querySelectorAll('[data-edit-markup]').forEach(x=>{const yes=Number(x.dataset.editMarkup)===defaultMarkup;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});
 const out=document.getElementById('editPriceSuggestion');if(out)out.textContent='Choose a markup to calculate a suggested selling price.';
});
function openProductEditor(product) {
  syncDefaultMarkupUI();
  document.getElementById('editProductId').value=product.id;
  document.getElementById('editProductName').value=product.name;
  syncCategoryPicker('editProduct',product.category);
  document.getElementById('editProductCost').value=product.cost;
  document.getElementById('editProductPrice').value=product.price;
  const editMarkup=defaultMarkup;
  document.querySelectorAll('[data-edit-markup]').forEach(b=>{const yes=Number(b.dataset.editMarkup)===editMarkup;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));});
  updateEditSuggestedPrice(true);
  document.getElementById('editProductStock').value=product.stock;
  editPendingProductImage='';
  editRemoveProductImage=false;
  updateEditProductPhotoPreview(product);
  document.getElementById('editProductDialog').showModal();
}

function closeProductEditor() {
  document.getElementById('editProductDialog').close();
  editPendingProductImage='';
  editRemoveProductImage=false;
  document.getElementById('editProductForm').reset();
  document.getElementById('editProductCamera').value='';
  document.getElementById('editProductGallery').value='';
}

document.getElementById('deleteEditedProduct').addEventListener('click',async()=>{
  const id=document.getElementById('editProductId').value;
  const product=db.products.find(x=>x.id===id);
  if(!product)return alert('This product could not be found.');
  if(db.sales.some(sale=>sale.productId===id))return alert('This product has sales history and cannot be deleted. You can edit its details instead.');
  if(!confirm('Delete '+product.name+'? This cannot be undone.'))return;
  const button=document.getElementById('deleteEditedProduct');
  button.disabled=true;
  try{
    if(cloudUser){
      const oldProducts=db.products;
      db.products=db.products.filter(x=>x.id!==id);
      try{await saveCloudChangeLocally('product_delete',{product});}
      catch(err){db.products=oldProducts;render();throw err;}
    }else{
      const oldProducts=db.products;
      db.products=db.products.filter(x=>x.id!==id);
      if(!save()){db.products=oldProducts;render();throw new Error('Could not save this change. Please try again.');}
      render();
    }
    closeProductEditor();
    alert('Product deleted.');
  }catch(err){alert(err.message||String(err));}
  finally{button.disabled=false;}
});
document.getElementById('cancelEditProduct').addEventListener('click',closeProductEditor);
document.getElementById('editProductDialog').addEventListener('click',event=>{
  if(event.target===event.currentTarget)closeProductEditor();
});
document.getElementById('editTakeProductPhoto').addEventListener('click',()=>document.getElementById('editProductCamera').click());
document.getElementById('editChooseProductPhoto').addEventListener('click',()=>document.getElementById('editProductGallery').click());
async function handleEditProductImageSelection(event){
  const input=event.currentTarget,file=input.files&&input.files[0];
  if(!file){input.value='';return;}
  try{
    editPendingProductImage=await processProductImage(file);
    editRemoveProductImage=false;
    const product=db.products.find(x=>x.id===document.getElementById('editProductId').value);
    updateEditProductPhotoPreview(product);
  }catch(err){alert(err.message||'Could not use that photo.');}
  finally{input.value='';}
}
document.getElementById('editProductCamera').addEventListener('change',handleEditProductImageSelection);
document.getElementById('editProductGallery').addEventListener('change',handleEditProductImageSelection);
document.getElementById('editRemoveProductPhoto').addEventListener('click',()=>{
  const product=db.products.find(x=>x.id===document.getElementById('editProductId').value);
  if(!product)return;
  editPendingProductImage='';
  editRemoveProductImage=true;
  updateEditProductPhotoPreview(product);
});

document.getElementById('editProductForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const id=document.getElementById('editProductId').value;
  const product=db.products.find(x=>x.id===id);
  if(!product)return alert('This product could not be found. Close the form and try again.');
  const name=document.getElementById('editProductName').value.trim();
  const category=normalizeCategory(getSelectedCategories('editProduct').join(' | '));
  if(!getSelectedCategories('editProduct').length)return alert('Choose at least one product category. You can select up to three.');
  const cost=Number(document.getElementById('editProductCost').value);
  const price=Number(document.getElementById('editProductPrice').value);
  const stock=Number(document.getElementById('editProductStock').value);
  if(!name||name.length>100||!Number.isFinite(cost)||cost<0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(stock)||stock<0||stock>2000000000||cost>MAX_MONEY||price>MAX_MONEY){
    return alert('Enter a product name, a cost price of zero or more, a selling price above zero, and a whole-number stock quantity of zero or more.');
  }
  if(db.products.some(x=>x.id!==id&&x.name.trim().toLowerCase()===name.toLowerCase()))return alert('Another product already has this name.');
  const updated={...product,name,category,cost,price,stock};
  if(editPendingProductImage)updated.image=editPendingProductImage;
  else if(editRemoveProductImage){updated.image='';updated.imagePath='';}
  const stockChanged=updated.stock!==product.stock;
  const adjustment=stockChanged?{id:crypto.randomUUID(),productId:product.id,productName:updated.name,previousStock:product.stock,newStock:updated.stock,quantityChange:updated.stock-product.stock,reason:'Stock quantity changed while editing product',date:now()}:null;

  document.getElementById('saveEditProduct').disabled=true;
  try{
    let saved=false;
    if(cloudUser){
      try {
        const cloudUpdated = editRemoveProductImage ? {...updated,imagePath:product.imagePath,image:product.image} : updated;
        const queuedChanges=[{type:'product_save',payload:{product:cloudUpdated,isNew:false}}];
        if(editRemoveProductImage&&product.imagePath)queuedChanges.push({type:'product_remove_image',payload:{product:{...product}}});
        if(adjustment)queuedChanges.push({type:'stock_adjustment',payload:{adjustment}});
        // Persist the product change, optional photo removal, and stock history as one
        // recoverable queue batch. A crash cannot leave the stock changed without its log.
        await saveCloudChangesLocally(queuedChanges);
        const savedProduct=db.products.find(x=>x.id===id);
        if(savedProduct){
          Object.assign(savedProduct,updated);
          if(editRemoveProductImage){delete savedProduct.image;delete savedProduct.offlineImage;delete savedProduct.imagePath;}
        }
        applyPendingToDb();
        cacheCloudData(cloudUser.id);
        render();
        updateSyncStatus();
        saved=true;
      } catch(err) { alert(err.message || String(err)); }
    }else{
      const old={...product};
      Object.assign(product,updated);
      if(editRemoveProductImage){delete product.image;delete product.imagePath;}
      if(adjustment)db.stockAdjustments.push(adjustment);
      if(save()){render();saved=true;}
      else{
        if(adjustment)db.stockAdjustments=db.stockAdjustments.filter(x=>x.id!==adjustment.id);
        for(const key of Object.keys(product))delete product[key];
        Object.assign(product,old);
      }
    }
    if(saved){closeProductEditor();alert(stockChanged?'Product updated and stock adjustment recorded.':'Product details updated successfully.');}
  }finally{
    document.getElementById('saveEditProduct').disabled=false;
  }
});


function renderProductDetails(p){
 const target=document.getElementById('productDetailsContent');if(!target||!p)return;
 const rawImage=typeof p.image==='string'&&p.image.startsWith('data:image/')?p.image:(p.offlineImage||p.image||'');
 const image=typeof rawImage==='string'&&(rawImage.startsWith('data:image/')||rawImage.startsWith('https://'))?'<img class="product-details-photo" src="'+rawImage.replace(/"/g,'&quot;')+'" alt="'+esc(p.name)+'">':'<div class="product-details-photo" style="height:220px;display:grid;place-items:center;color:#647269">No product photo</div>';
 const added=p.createdAt||p.created_at||p.dateAdded||p.addedAt||p.updatedAt||p.updated_at;
 const addedText=added?safeDate(added).toLocaleDateString():'Not available';
 const cost=Number(p.cost??p.costPrice??p.cost_price??0),price=Number(p.price??p.sellingPrice??p.selling_price??0),stock=Number(p.stock||0);
 const field=(label,value)=>'<div class="product-details-field"><small>'+label+'</small><strong>'+value+'</strong></div>';
 target.innerHTML='<div class="card">'+image+'<div class="product-details-title-row"><h2 class="product-details-name">'+esc(p.name)+'</h2><button type="button" class="product-details-edit-icon" data-details-edit="'+String(p.id).replace(/"/g,'&quot;')+'" aria-label="Edit product" title="Edit product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button></div><p class="muted">'+esc(p.category||'Uncategorised')+'</p><div class="product-details-grid">'+field('Date added',esc(addedText))+field('Category',esc(p.category||'Not set'))+field('Cost price',money(cost))+field('Selling price',money(price))+field('Profit per unit',money(price-cost))+field('Current stock',esc(String(stock))+' units')+(p.baseUnit?field('Stock unit',esc(p.baseUnit)):'')+(p.purchaseUnit?field('Purchase unit',esc(p.purchaseUnit)):'')+'</div></div>';
 const edit=target.querySelector('[data-details-edit]');edit.addEventListener('click',()=>{showPage('products');const trigger=document.createElement('button');trigger.type='button';trigger.dataset.edit=String(p.id);trigger.hidden=true;document.getElementById('productList').appendChild(trigger);trigger.click();trigger.remove();});
}
document.getElementById('productList').addEventListener('click',async e=>{
 const openButton=e.target.closest('[data-product-open]');
 if(openButton){const p=db.products.find(x=>String(x.id)===String(openButton.dataset.productOpen));if(!p)return;renderProductDetails(p);showPage('product-details');return;}
 const button=e.target.closest('button');
 if(!button)return;
 const id=button.dataset.edit||button.dataset.delete||button.dataset.imageCamera||button.dataset.imageGallery||button.dataset.imageRemove;
 if(!id)return;
 const p=db.products.find(x=>x.id===id);if(!p)return;
 if(button.dataset.imageCamera||button.dataset.imageGallery){
  imageTargetId=id;
  document.getElementById(button.dataset.imageCamera?'productCamera':'productGallery').click();
  return;
 }
 if(button.dataset.imageRemove){
  if(!confirm('Remove the photo for '+p.name+'?'))return;
  if(cloudUser){
    try {
      const old = {...p};
      p.image=''; p.offlineImage=''; p.imagePath='';
      await saveCloudChangeLocally('product_remove_image',{product:old});
    } catch(err){ alert(err.message || String(err)); }
  }else{
    const oldImage=p.image,oldPath=p.imagePath;
    delete p.image;delete p.imagePath;
    if(save())render();else{p.image=oldImage;p.imagePath=oldPath;}
  }
  return;
 }
 if(button.dataset.edit){
  openProductEditor(p);
 }else if(button.dataset.delete){
  if(db.sales.some(s=>s.productId===id))return alert('This product has sales history. Edit it instead of deleting it.');
  if(confirm('Delete '+p.name+'?')){
    if(cloudUser){
      const oldProducts=db.products;
      db.products=db.products.filter(x=>x.id!==id);
      try { await saveCloudChangeLocally('product_delete',{product:p}); }
      catch(err){ db.products=oldProducts; render(); alert(err.message || String(err)); }
    }else{
      db.products=db.products.filter(x=>x.id!==id);if(save())render();
    }
  }
 }
});

function refreshSaleUnitOptions(){
 const p=db.products.find(x=>x.id===document.getElementById('saleProduct').value),sel=document.getElementById('saleUnit');
 if(!sel)return;
 const previous=sel.value;sel.innerHTML='<option value="base">Individual '+esc(p?.baseUnit||'unit')+'</option>';
 if(p?.packUnit&&Number(p.unitsPerPack)>1&&Number(p.packPrice)>0)sel.insertAdjacentHTML('beforeend','<option value="pack">Full '+esc(p.packUnit)+'</option>');
 if(previous==='pack'&&p?.packUnit)sel.value='pack';
 const isPack=sel.value==='pack';document.getElementById('salePriceLabel').textContent=isPack?'Selling price per full pack (₦)':'Selling price per individual unit (₦)';document.getElementById('salePrice').value=p?(isPack?Number(p.packPrice):Number(p.price)).toFixed(2):'';
 document.getElementById('saleStock').textContent=p?'Available: '+p.stock+' '+(p.baseUnit||'units')+(p.packUnit?' · '+Math.floor(p.stock/Math.max(1,p.unitsPerPack))+' '+p.packUnit+' possible':''):'';
}
document.getElementById('saleProduct').addEventListener('change',refreshSaleUnitOptions);
document.getElementById('saleUnit').addEventListener('change',refreshSaleUnitOptions);
let saleSubmitting=false;
document.getElementById('saleForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if(saleSubmitting)return;
 saleSubmitting=true;
 const submitButton=e.submitter||e.currentTarget.querySelector('button[type="submit"]');
 if(submitButton)submitButton.disabled=true;
 try {
 const p=db.products.find(x=>x.id===document.getElementById('saleProduct').value);
 const qty=Number(document.getElementById('saleQty').value),price=Number(document.getElementById('salePrice').value),note=document.getElementById('saleNote').value.trim(),saleAsPack=document.getElementById('saleUnit').value==='pack',unitsPerSale=saleAsPack?Number(p?.unitsPerPack||1):1,baseQty=qty*unitsPerSale,saleUnit=saleAsPack?p?.packUnit:(p?.baseUnit||'unit');
 if(!p)return alert('Choose a product.');
 if(!Number.isSafeInteger(qty)||qty<1||!Number.isSafeInteger(baseQty)||baseQty>2000000000||baseQty>p.stock)return alert('Quantity must be a whole number and cannot exceed available stock.');
 if(!Number.isFinite(price)||price<=0||price>MAX_MONEY)return alert('Enter a valid selling price.');
 if(note.length>150)return alert('Sale note must be 150 characters or fewer.');
 const amounts=calculateSaleAmounts(qty,price,p.cost,unitsPerSale),total=amounts.total;
 if(!confirm('Record this paid sale for '+money(total)+'?'))return;
 if(cloudUser){
   const saleCost=amounts.cost,profit=amounts.profit;
   const sale={id:crypto.randomUUID(),productId:p.id,name:p.name,qty,price,cost:saleCost,total,profit,note,date:now(),baseQty,saleUnit,unitsPerSale};
   const productUpdatedAt=p.updatedAt;
   p.stock-=baseQty;
   db.sales.push(sale);
   try { await saveCloudChangeLocally('sale',{sale,productUpdatedAt}); }
   catch(err){ p.stock+=baseQty; db.sales=db.sales.filter(x=>x.id!==sale.id); render(); return alert(err.message || String(err)); }
 }else{
   const saleCost=amounts.cost,profit=amounts.profit;
   p.stock-=baseQty;
   db.sales.push({id:crypto.randomUUID(),productId:p.id,name:p.name,qty,price,cost:saleCost,total,profit,note,date:now(),baseQty,saleUnit,unitsPerSale});
   if(!save())return;
   render();
 }
 e.target.reset();document.getElementById('saleQty').value=1;alert('Sale recorded and stock updated.');
 } finally {saleSubmitting=false;if(submitButton)submitButton.disabled=false;}
});

document.getElementById('expenseForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const name=document.getElementById('ename').value.trim(),amount=Number(document.getElementById('eamount').value);
 if(!name||!Number.isFinite(amount)||amount<=0)return alert('Enter a description and valid amount.');
 const rounded=roundMoney(amount);
 if(cloudUser){
   const expense={id:crypto.randomUUID(),name,amount:rounded,date:now()};
   db.expenses.push(expense);
   try { await saveCloudChangeLocally('expense',{expense}); }
   catch(err){ db.expenses=db.expenses.filter(x=>x.id!==expense.id); render(); return alert(err.message || String(err)); }
 }else{
   db.expenses.push({id:crypto.randomUUID(),name,amount:rounded,date:now()});
   if(!save())return;
   render();
 }
 e.target.reset();alert('Expense saved.');
});

const BACKUP_STATUS_KEY='my-sales-book-last-backup-v1';
function updateBackupStatus(){
 const el=document.getElementById('backupStatus');if(!el)return;
 try{
  const stamp=localStorage.getItem(BACKUP_STATUS_KEY);
  el.textContent=stamp?'Last backup created: '+new Date(stamp).toLocaleString():'No backup created on this device yet.';
 }catch(_){el.textContent='Backup history is unavailable on this device.';}
}
document.getElementById('exportBtn').addEventListener('click',()=>{
 try{
  const backup={app:'Sellbook',version:2,exportedAt:now(),accountId:cloudUser?.id||null,data:normalizeDb(db)};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='sellbook-backup-'+today()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  localStorage.setItem(BACKUP_STATUS_KEY,backup.exportedAt);
  updateBackupStatus();
  cloudMessage('Backup file created. Keep a copy somewhere safe.');
 }catch(error){cloudMessage('Could not create backup: '+(error.message||String(error)));}
});
updateBackupStatus();
document.getElementById('importFile').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  const parsed=JSON.parse(await file.text()),d=parsed.data;
  if(!d||!Array.isArray(d.products)||!Array.isArray(d.sales)||!Array.isArray(d.expenses))throw Error('Invalid backup format.');
  if(cloudUser)throw Error('Backup restore is currently available only in local mode. Sign out of your cloud account before restoring a local backup. This prevents a local restore from being mistaken for a cloud restore.');
  if(!confirm('Replace all current records with this backup?'))return;
  db=normalizeDb(d);if(save()){render();alert('Backup restored.');}
 }catch(err){alert('Could not restore backup: '+err.message);}
 finally{e.target.value='';}
});
async function refreshAccountStatus(){
  const status = document.getElementById('accountStatus');
  const signIn = document.getElementById('googleSignIn');
  const signOut = document.getElementById('googleSignOut');

  if (!supabaseClient) {
    status.textContent = 'Cloud connection unavailable. Check your internet connection and configuration.';
    signIn.disabled = true;
    return;
  }

  let data;
  let error;
  try {
    ({ data, error } = await supabaseClient.auth.getSession());
  } catch (sessionError) {
    status.textContent = 'Could not check sign-in status. Check your connection and try again.';
    document.getElementById('accountMessage').textContent = 'Sellbook could not verify your Google sign-in. Your saved records have not been changed.';
    document.getElementById('appWorkspace').classList.add('hidden');
    console.warn('Supabase session check failed:', sessionError);
    return;
  }
  if (error) {
    status.textContent = 'Could not check sign-in status. Check your connection and try again.';
    document.getElementById('accountMessage').textContent = 'Sellbook could not verify your Google sign-in. Your saved records have not been changed.';
    document.getElementById('appWorkspace').classList.add('hidden');
    console.warn('Supabase session check returned an error:', error);
    return;
  }

  const user = data.session?.user;
  status.textContent = user
    ? 'Signed in as ' + (user.email || 'Google account') + '.'
    : (!navigator.onLine
      ? 'Internet is required for Google sign-in. Connect and try again.'
      : 'Sign in with Google to access your private business records.');
  signIn.classList.toggle('hidden', !!user);
  signOut.classList.toggle('hidden', !user);
  document.getElementById('emailAuthPanel').classList.toggle('hidden', !!user);
  document.getElementById('accountManagePanel').classList.toggle('hidden', !user);
  document.getElementById('accountCard').classList.toggle('hidden',!!user&&workspaceReady&&!recoveryMode);
  document.getElementById('settingsAccountStatus').textContent=user?'Signed in as '+(user.email||'Google account')+'.':'Not signed in.';
  document.getElementById('settingsAccountMessage').textContent=document.getElementById('accountMessage').textContent||'';
  if (recoveryMode) {
    document.getElementById('recoveryPasswordForm').classList.remove('hidden');
    document.getElementById('emailAuthPanel').classList.add('hidden');
    document.getElementById('accountManagePanel').classList.add('hidden');
    document.getElementById('appWorkspace').classList.add('hidden');
  } else {
    document.getElementById('recoveryPasswordForm').classList.add('hidden');
  }
  const importButton = document.getElementById('importLocalRecordsBtn');
  const hasLocal = !!(localSnapshot && (localSnapshot.products.length || localSnapshot.sales.length || localSnapshot.expenses.length));
  const importOwner = localStorage.getItem('my-sales-book-legacy-import-owner-v1');
  const alreadyImported = user && (localStorage.getItem('my-sales-book-imported-v1:' + user.id) === 'yes' || (importOwner && importOwner !== user.id));
  importButton.classList.toggle('hidden', !user || !hasLocal || alreadyImported);
  document.getElementById('appWorkspace').classList.toggle('hidden', !user || !workspaceReady);
  // The current page controls the floating + button; do not force it visible here.
  document.getElementById('accountCard').classList.toggle('hidden',!!user&&workspaceReady&&!recoveryMode);
  if(user&&workspaceReady){document.getElementById('settingsAccountStatus').textContent='Signed in as '+(user.email||'Google account')+'.';document.getElementById('settingsAccountMessage').textContent=document.getElementById('accountMessage').textContent||'';}
}

let googleSignInInProgress = false;
document.getElementById('googleSignIn').addEventListener('click', async () => {
  const button = document.getElementById('googleSignIn');
  const message = document.getElementById('accountMessage');
  if (googleSignInInProgress) return;

  if (!navigator.onLine) {
    message.textContent = 'Internet is required for Google sign-in. Connect to the internet and try again.';
    return;
  }
  if (!supabaseClient) {
    message.textContent = 'Cloud connection unavailable. Check your internet connection and try again.';
    return;
  }

  googleSignInInProgress = true;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Connecting to Google…';
  message.textContent = 'Opening secure Google sign-in. Please wait…';

  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URLSearchParams(window.location.search).get('native') === '1'
          ? 'sellbook://auth'
          : window.location.origin + window.location.pathname + window.location.search,
        queryParams: { prompt: 'select_account' }
      }
    });
    if (error) throw error;
    // Supabase redirects the browser to Google. Keep the button locked during navigation
    // so repeated taps cannot start overlapping OAuth requests.
  } catch (error) {
    console.error('Google sign-in could not be started:', error);
    message.textContent = 'Google sign-in could not be started. Check your connection and try again.';
    googleSignInInProgress = false;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'Continue with Google';
  }
});

let emailAuthMode = 'signin';
document.getElementById('toggleEmailAuth').addEventListener('click', () => {
  emailAuthMode = emailAuthMode === 'signin' ? 'signup' : 'signin';
  document.getElementById('emailAuthSubmit').textContent = emailAuthMode === 'signup' ? 'Create account' : 'Sign in with email';
  document.getElementById('toggleEmailAuth').textContent = emailAuthMode === 'signup' ? 'I already have an account' : 'Create account';
  document.getElementById('authPassword').autocomplete = emailAuthMode === 'signup' ? 'new-password' : 'current-password';
  cloudMessage(emailAuthMode === 'signup' ? 'Create a new account with your email and a password of at least 8 characters.' : 'Sign in to access your private business records.');
});
document.getElementById('emailAuthForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabaseClient) return cloudMessage('Account service is unavailable. Check your internet connection.');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const submit = document.getElementById('emailAuthSubmit');
  if (!navigator.onLine) return cloudMessage('Internet is required for first sign-in or account creation. Connect and try again.');
  submit.disabled = true;
  try {
    cloudMessage(emailAuthMode === 'signup' ? 'Creating your account...' : 'Signing in...');
    const result = emailAuthMode === 'signup'
      ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (emailAuthMode === 'signup' && !result.data.session) {
      cloudMessage('Account created. Check your email for the verification link, then return here and sign in.');
    } else {
      cloudMessage(emailAuthMode === 'signup' ? 'Account created. Loading your private business records...' : 'Signed in. Loading your private business records...');
      await handleCloudAuthChange();
    }
  } catch (error) {
    cloudMessage('Account action failed: ' + (error.message || String(error)));
  } finally {
    submit.disabled = false;
  }
});
document.getElementById('resetPasswordBtn').addEventListener('click', async () => {
  if (!supabaseClient) return cloudMessage('Account service is unavailable.');
  const email = document.getElementById('authEmail').value.trim();
  if (!email) return cloudMessage('Enter your registered email address first.');
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
    if (error) throw error;
    cloudMessage('If that email is registered, a password-reset link has been sent. Check your inbox and spam folder.');
  } catch (error) {
    cloudMessage('Could not request a password reset: ' + (error.message || String(error)));
  }
});
document.getElementById('recoveryPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('recoveryPassword').value;
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    recoveryMode = false;
    document.getElementById('recoveryPasswordForm').classList.add('hidden');
    document.getElementById('recoveryPasswordForm').reset();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    cloudMessage('Password updated. You can continue using your account.');
    await handleCloudAuthChange();
  } catch (error) {
    cloudMessage('Could not update password: ' + (error.message || String(error)));
  }
});
document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  const first = prompt('Deleting your account permanently deletes your cloud products, sales, expenses and product photos. This cannot be undone. Type DELETE to continue.');
  if (first !== 'DELETE') return;
  if (!confirm('Final confirmation: permanently delete this account and all its cloud business records?')) return;
  try {
    if (!navigator.onLine) throw Error('Connect to the internet before deleting your account.');
    const user = await requireCloudUser();
    const pendingBeforeDelete = readQueue(user.id).filter(item => item.status !== 'synced');
    if (pendingBeforeDelete.length && !confirm('There are ' + pendingBeforeDelete.length + ' unsynchronised change(s). Deleting the account will also remove this account\'s local cache and pending queue. Continue?')) return;
    const {data:files,error:listError} = await supabaseClient.storage.from('product-images').list(user.id,{limit:1000});
    if (listError) throw listError;
    const paths = (files||[]).filter(file=>file.name && !file.id?.endsWith('/')).map(file=>user.id+'/'+file.name);
    if (paths.length) {
      const {error:removeError} = await supabaseClient.storage.from('product-images').remove(paths);
      if (removeError) throw removeError;
    }
    const { error } = await supabaseClient.rpc('delete_my_account');
    if (error) throw error;
    localStorage.removeItem(cloudCacheKey(user.id));
    localStorage.removeItem(cloudQueueKey(user.id));
    localStorage.removeItem('my-sales-book-imported-v1:' + user.id);
    await supabaseClient.auth.signOut({ scope: 'local' });
    cloudUser = null;
    cloudReady = false;
    workspaceReady = false;
    document.getElementById('appWorkspace').classList.add('hidden');
    await refreshAccountStatus();
    cloudMessage('Account and cloud business records were deleted. Any separate local-device backup was not deleted.');
  } catch (error) {
    cloudMessage('Account deletion failed: ' + (error.message || String(error)) + '. Your records have not been intentionally cleared by this app.');
  }
});

document.getElementById('businessProfileForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!cloudUser)return cloudMessage('Sign in to save your business profile.');
  const name=document.getElementById('businessNameInput').value.trim();if(!name)return alert('Enter your business name.');
  const logoPending=document.getElementById('businessProfileForm').dataset.logoPending==='yes';
  const profile={businessName:name.slice(0,100),businessLogo:logoPending?(pendingBusinessLogo||''):getProfile().businessLogo||''};
  try{enqueueChange('profile_save',{profile});db.profile=profile;cacheCloudData(cloudUser.id);render();updateSyncStatus();if(navigator.onLine)await syncPendingChanges();document.getElementById('businessProfileForm').dataset.logoPending='';document.getElementById('businessLogoInput').value='';pendingBusinessLogo='';cloudMessage('Business profile saved.');}
  catch(err){cloudMessage('Could not save business profile: '+(err.message||String(err)));}
});
let pendingBusinessLogo='';
const businessLogoInput=document.getElementById('businessLogoInput');const businessLogoAvatar=document.getElementById('businessLogoAvatar');const openBusinessLogoPicker=()=>businessLogoInput.click();document.getElementById('editBusinessLogoButton').addEventListener('click',openBusinessLogoPicker);businessLogoAvatar.addEventListener('click',e=>{if(!e.target.closest('button'))openBusinessLogoPicker();});businessLogoAvatar.addEventListener('keydown',e=>{if(e.target===businessLogoAvatar&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openBusinessLogoPicker();}});businessLogoInput.addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{const data=await processProductImage(file);if(data.length>150000)throw Error('Logo image is too large. Choose a smaller image.');pendingBusinessLogo=data;document.getElementById('businessLogoPreview').src=data;document.getElementById('businessLogoPreview').style.display='block';document.getElementById('businessLogoHint').textContent='Logo selected. Save your business profile to apply it.';document.getElementById('businessProfileForm').dataset.logoPending='yes';
  let b=document.querySelector('[id="removeBusinessLogo"]');if(!b){b=document.createElement('button');b.type='button';b.id='removeBusinessLogo';b.textContent='Remove logo';b.style.marginTop='8px';document.getElementById('businessProfileForm').appendChild(b);b.addEventListener('click',()=>{pendingBusinessLogo='';document.getElementById('businessLogoPreview').removeAttribute('src');document.getElementById('businessLogoPreview').style.display='none';document.getElementById('businessLogoHint').textContent='Logo will be removed when you save.';document.getElementById('businessProfileForm').dataset.logoPending='yes';});}
  }catch(err){alert(err.message||String(err));e.target.value='';}
});
document.querySelectorAll('[data-default-markup]').forEach(b=>b.addEventListener('click',()=>{
 defaultMarkup=Number(b.dataset.defaultMarkup);
 document.querySelectorAll('[data-default-markup]').forEach(x=>{const yes=x===b;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});
 localStorage.setItem(DEFAULT_MARKUP_KEY,String(defaultMarkup));
 document.querySelectorAll('[data-markup]').forEach(x=>{const yes=Number(x.dataset.markup)===defaultMarkup;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});
 selectedMarkup=defaultMarkup;
 document.querySelectorAll('[data-edit-markup]').forEach(x=>{const yes=Number(x.dataset.editMarkup)===defaultMarkup;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});
 selectedEditMarkup=defaultMarkup;
}));
document.querySelectorAll('[data-default-markup]').forEach(x=>{const yes=Number(x.dataset.defaultMarkup)===defaultMarkup;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});

document.getElementById('lowStockThreshold').value=lowStockThreshold;
document.getElementById('savePreferencesBtn').addEventListener('click',()=>{const n=Number(document.getElementById('lowStockThreshold').value);if(!Number.isSafeInteger(n)||n<0||n>100000)return alert('Enter a whole-number threshold from 0 to 100000.');lowStockThreshold=n;localStorage.setItem('my-sales-book-low-stock-v1',String(n));render();alert('Preferences saved on this device.');});
document.getElementById('changeEmailForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabaseClient) return cloudMessage('Account service is unavailable.');
  const email = document.getElementById('newAccountEmail').value.trim();
  try {
    const { error } = await supabaseClient.auth.updateUser({ email });
    if (error) throw error;
    cloudMessage('Email change requested. Follow the verification instructions sent by Supabase before using the new address.');
    document.getElementById('changeEmailForm').reset();
  } catch (error) {
    cloudMessage('Could not request an email change: ' + (error.message || String(error)));
  }
});

document.getElementById('importLocalRecordsBtn').addEventListener('click', async () => {
  if (!cloudUser || !localSnapshot) return;
  const local = JSON.parse(JSON.stringify(localSnapshot));
  const total = local.products.length + local.sales.length + local.expenses.length;
  if (!total) return cloudMessage('There are no existing device records to import.');
  if (!confirm('Import ' + local.products.length + ' product(s), ' + local.sales.length + ' sale(s), and ' + local.expenses.length + ' expense(s) from this device into your signed-in account? Existing cloud records will not be intentionally replaced. Keep this phone until the sync finishes.')) return;
  const button = document.getElementById('importLocalRecordsBtn');
  button.disabled = true;
  try {
    const user = await requireCloudUser();
    const importOwner = localStorage.getItem('my-sales-book-legacy-import-owner-v1');
    if (importOwner && importOwner !== user.id) throw Error('These older device records were already assigned to a different account. Export them and do not import them into another account.');
    const [productsResult,salesResult,expensesResult] = await Promise.all([
      supabaseClient.from('products').select('id,name,category').eq('user_id',user.id),
      supabaseClient.from('sales').select('id').eq('user_id',user.id),
      supabaseClient.from('expenses').select('id').eq('user_id',user.id)
    ]);
    if (productsResult.error) throw productsResult.error;
    if (salesResult.error) throw salesResult.error;
    if (expensesResult.error) throw expensesResult.error;
    const productIds = new Set((productsResult.data||[]).map(x=>x.id));
    const productNameIds = new Map((productsResult.data||[]).map(x=>[String(x.name||'').trim().toLowerCase(),x.id]));
    const productIdMap = new Map();
    const saleIds = new Set((salesResult.data||[]).map(x=>x.id));
    const expenseIds = new Set((expensesResult.data||[]).map(x=>x.id));
    let added = 0;
    for (const original of local.products) {
      const existingId = productIds.has(original.id) ? original.id : productNameIds.get(String(original.name||'').trim().toLowerCase());
      if (existingId) {
        productIdMap.set(original.id,existingId);
        continue;
      }
      const product = {...original};
      productIdMap.set(product.id,product.id);
      productIds.add(product.id);
      productNameIds.set(String(product.name||'').trim().toLowerCase(),product.id);
      enqueueChange('product_save',{product,isNew:true});
      db.products.push(product);
      added++;
    }
    for (const original of local.sales) {
      if (saleIds.has(original.id)) continue;
      // Keep historical sales importable even when their original product is no longer in this account.
      // The sale snapshot retains its product name, price and cost without linking to an unrelated product.
      const sale = {...original,productId:productIdMap.get(original.productId)||null};
      enqueueChange('sale_import',{sale});
      if (!db.sales.some(x=>x.id===sale.id)) db.sales.push(sale);
      added++;
    }
    for (const original of local.expenses) {
      if (expenseIds.has(original.id)) continue;
      const expense = {...original};
      enqueueChange('expense',{expense});
      if (!db.expenses.some(x=>x.id===expense.id)) db.expenses.push(expense);
      added++;
    }
    pendingSync = readQueue(user.id);
    applyPendingToDb();
    cacheCloudData(user.id);
    render();
    localStorage.setItem('my-sales-book-imported-v1:' + user.id,'yes');
    localStorage.setItem('my-sales-book-legacy-import-owner-v1',user.id);
    button.classList.add('hidden');
    cloudMessage('Queued ' + added + ' record(s) for safe import. Keep this phone available until Sync now reports all changes synchronised.');
    updateSyncStatus();
    if (navigator.onLine) await syncPendingChanges();
  } catch (error) {
    cloudMessage('Import could not be completed: ' + (error.message || String(error)) + '. Your original device records have not been intentionally deleted.');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('syncNowBtn').addEventListener('click', async () => {
  if (!cloudUser) return;
  if (!navigator.onLine) return cloudMessage('You are offline. Changes are kept on this device and will sync when internet returns.');
  cloudMessage('Synchronising changes...');
  try {
    const ok = await syncPendingChanges();
    if (ok) cloudMessage('All changes synchronised.');
  } catch (error) {
    cloudMessage('Sync failed. Your pending changes remain on this device: ' + (error.message || String(error)));
  }
});
window.addEventListener('online', () => {
  updateSyncStatus();
  if (cloudUser) syncPendingChanges().catch(error => cloudMessage('Automatic sync failed. Pending changes are kept: ' + (error.message || String(error))));
});
// Android browsers may suspend timers while Sellbook is in the background.
// Retry the durable queue as soon as the seller returns to the app.
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&cloudUser&&navigator.onLine&&readQueue(cloudUser.id).some(item=>item.status==='pending')){
    syncPendingChanges().catch(error=>cloudMessage('Sync will retry automatically. Your saved changes remain on this device: '+(error.message||String(error))));
  }
});
window.addEventListener('pageshow',()=>{
  if(cloudUser&&navigator.onLine&&readQueue(cloudUser.id).some(item=>item.status==='pending')){
    syncPendingChanges().catch(error=>cloudMessage('Sync will retry automatically. Your saved changes remain on this device: '+(error.message||String(error))));
  }
});
window.addEventListener('offline', updateSyncStatus);
setInterval(() => {
  if (cloudUser && navigator.onLine && readQueue(cloudUser.id).some(item=>item.status==='pending')) {
    syncPendingChanges().catch(error=>cloudMessage('Automatic sync retry failed. Pending changes remain on this device: ' + (error.message || String(error))));
  }
}, 60000);

document.getElementById('googleSignOut').addEventListener('click', async () => {
  const message = document.getElementById('accountMessage');
  if (!supabaseClient) return;
  const queued = cloudUser ? readQueue(cloudUser.id).filter(item => item.status !== 'synced') : [];
  if (queued.length && !confirm('You have ' + queued.length + ' unsynchronised change(s). They will remain on this device and cannot be restored to a new phone until they sync. Sign out anyway?')) return;

  const { error } = await supabaseClient.auth.signOut({scope:'local'});
  if (error) {
    message.textContent = 'Could not sign out: ' + error.message;
    return;
  }

  message.textContent = 'You have signed out. Your business workspace is now locked on this device.';
  await refreshAccountStatus();
});


let sellbookIsAdmin=false;
let adminUsersCache=[];
function escAdmin(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setAdminAccess(isAdmin){
 sellbookIsAdmin=!!isAdmin;
 document.body.classList.toggle('admin-mode',sellbookIsAdmin);
 document.getElementById('adminMenuTile')?.classList.toggle('hidden',!sellbookIsAdmin);
 if(sellbookIsAdmin&&currentPage()!=='admin'&&currentPage()!=='support'&&cloudUser?.email?.toLowerCase()==='aamuda34@gmail.com')showPage('admin');
 if(!sellbookIsAdmin&&currentPage()==='admin')showPage('home');
}
function showAdminPanel(name){
 const allowed=new Set(['overview','traffic','users','feedback','support','notifications']);
 if(!allowed.has(name))name='overview';
 document.querySelectorAll('[data-admin-panel-content]').forEach(p=>p.classList.toggle('hidden',p.dataset.adminPanelContent!==name));
 document.querySelectorAll('[data-admin-panel]').forEach(b=>{const active=b.dataset.adminPanel===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');});
 sessionStorage.setItem('sellbook-admin-panel',name);
 if(name==='traffic')loadAdminTraffic();
 if(name==='users')loadAdminUsers();
 if(name==='support'){loadAdminUsers();}
 if(name==='feedback')loadAdminFeedback();
 if(name==='notifications')loadAdminNotifications();
}
document.querySelectorAll('[data-admin-panel]').forEach(b=>b.addEventListener('click',()=>showAdminPanel(b.dataset.adminPanel)));
function formatAdminNaira(value){return new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(value)||0);}
async function loadAdminTraffic(){
 const chart=document.getElementById('adminTrafficChart');if(chart)chart.textContent='Loading traffic…';
 const {data,error}=await supabaseClient.rpc('sellbook_admin_platform_metrics');
 if(error){if(chart)chart.textContent='Traffic metrics unavailable: '+error.message;return;}
 document.getElementById('adminVisitsToday').textContent=data.visits_today??0;
 document.getElementById('adminVisits7d').textContent=data.visits_7d??0;
 document.getElementById('adminVisits30d').textContent=data.visits_30d??0;
 const rows=data.traffic_daily||[];
 if(chart)chart.innerHTML=rows.length?'<div class="chart-bars">'+rows.map(r=>{const max=Math.max(1,...rows.map(x=>Number(x.visits)||0));const val=Number(r.visits)||0;return '<div class="chart-col"><span class="chart-value">'+val+'</span><div class="chart-bar" style="height:'+Math.max(3,val/max*100)+'%"></div><span class="chart-label">'+escAdmin(String(r.day).slice(5))+'</span></div>';}).join('')+'</div>':'<div class="empty">No visits recorded yet.</div>';
}
async function recordSellbookVisit(){
 if(!supabaseClient)return;
 try{let key=sessionStorage.getItem('sellbook-visit-key');if(!key){key='sbv-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));sessionStorage.setItem('sellbook-visit-key',key);}
 await supabaseClient.rpc('record_sellbook_visit',{p_session_key:key});}catch(e){console.warn('Visit tracking unavailable',e);}
}
async function verifyAdminAccess(){
 if(!supabaseClient||!cloudUser){setAdminAccess(false);return false;}
 try{const {data,error}=await supabaseClient.rpc('is_sellbook_admin');if(error)throw error;setAdminAccess(data===true);return data===true;}
 catch(e){setAdminAccess(false);return false;}
}
async function loadAdminDashboard(){
 if(!await verifyAdminAccess()){cloudMessage('This account is not authorised for Sellbook administration.');return;}
 const {data:overview,error}=await supabaseClient.rpc('sellbook_admin_overview');
 if(error){cloudMessage('Admin dashboard could not load: '+error.message);return;}
 document.getElementById('adminTotalUsers').textContent=overview.total_users??'—';
 document.getElementById('adminNewUsers').textContent=overview.new_users_30d??'—';
 document.getElementById('adminOpenFeedback').textContent=overview.feedback_open??'—';
 document.getElementById('adminUnreadMessages').textContent=overview.messages_unread??'—';
 const {data:metrics,error:metricsError}=await supabaseClient.rpc('sellbook_admin_platform_metrics');
 if(metricsError){document.getElementById('adminPlatformProducts').textContent='—';document.getElementById('adminPlatformSales').textContent='—';document.getElementById('adminPlatformSalesValue').textContent='Unavailable';}
 else{document.getElementById('adminPlatformProducts').textContent=metrics.total_products??0;document.getElementById('adminPlatformSales').textContent=metrics.total_sales??0;document.getElementById('adminPlatformSalesValue').textContent=formatAdminNaira(metrics.sales_value);}
 await document.querySelectorAll('[data-open-page="settings-buybook"]').forEach(el=>el.addEventListener('click',()=>loadBuybookConnection()));
recordSellbookVisit();
 showAdminPanel(sessionStorage.getItem('sellbook-admin-panel')||'overview');
}
async function loadAdminUsers(){
 const target=document.getElementById('adminUsersList');if(target)target.textContent='Loading users…';
 const list=document.getElementById('adminChatUserList');if(list&&!list.children.length)list.innerHTML='<div class="empty">Loading users…</div>';
 const {data,error}=await supabaseClient.rpc('sellbook_admin_users');
 if(error){if(target)target.textContent='Could not load users: '+error.message;if(list)list.innerHTML='<div class="empty">Could not load chats: '+escAdmin(error.message)+'</div>';return;}
 adminUsersCache=(data||[]).filter(u=>u.user_id!==cloudUser?.id&&(u.email||'').toLowerCase()!=='aamuda34@gmail.com');
 const opts='<option value="">Choose a user</option>'+adminUsersCache.map(u=>'<option value="'+escAdmin(u.user_id)+'">'+escAdmin(u.email||'No email')+'</option>').join('');
 const chatSelect=document.getElementById('adminMessageUser'),previousUser=chatSelect.value;chatSelect.innerHTML=opts;
 document.getElementById('notificationUser').innerHTML=opts;
 if(target)target.innerHTML=adminUsersCache.length?adminUsersCache.map(u=>'<div class="item"><strong>'+escAdmin(u.email||'No email')+'</strong><div class="muted">Joined '+escAdmin(u.created_at?new Date(u.created_at).toLocaleDateString():'unknown')+' · Last sign-in '+escAdmin(u.last_sign_in_at?new Date(u.last_sign_in_at).toLocaleDateString():'not available')+'</div></div>').join(''):'<div class="empty">No registered users found.</div>';
 const {data:allMessages,error:msgError}=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').order('created_at',{ascending:false}).limit(1000);
 if(msgError){if(list)list.innerHTML='<div class="empty">Could not load chat previews: '+escAdmin(msgError.message)+'</div>';return;}
 const msgs=allMessages||[];
 const rows=adminUsersCache.map(u=>{const convo=msgs.filter(m=>(m.sender_id===u.user_id)||(m.recipient_id===u.user_id));const latest=convo[0]||null;const unread=convo.filter(m=>m.sender_id===u.user_id&&!m.read_at).length;return {...u,latest,unread};}).sort((x,y)=>new Date(y.latest?.created_at||y.created_at||0)-new Date(x.latest?.created_at||x.created_at||0));
 if(list)list.innerHTML=rows.length?rows.map(u=>'<button type="button" class="admin-chat-user-row" data-chat-user="'+escAdmin(u.user_id)+'"><span class="chat-support-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><span class="admin-chat-user-meta"><strong>'+escAdmin(u.email||'Sellbook user')+'</strong><span class="muted admin-chat-preview">'+escAdmin(u.latest?.body||'No messages yet')+'</span><span class="muted">'+escAdmin(u.latest?new Date(u.latest.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'No conversation yet')+'</span></span>'+(u.unread?'<span class="admin-chat-unread" aria-label="'+u.unread+' unread messages">'+u.unread+'</span>':'')+'<span class="admin-chat-arrow" aria-hidden="true">›</span></button>').join(''):'<div class="empty">No registered users found.</div>';
 if(list)list.querySelectorAll('[data-chat-user]').forEach(btn=>btn.addEventListener('click',()=>openAdminConversation(btn.dataset.chatUser)));
 if(previousUser&&adminUsersCache.some(u=>u.user_id===previousUser))chatSelect.value=previousUser;
 await updateUnreadBadges();
}

async function loadAdminFeedback(){
 const target=document.getElementById('adminFeedbackList');target.textContent='Loading feedback…';
 const {data,error}=await supabaseClient.from('user_feedback').select('id,user_id,category,subject,message,status,admin_reply,created_at').order('created_at',{ascending:false}).limit(100);
 if(error){target.textContent='Could not load feedback: '+error.message;return;}
 target.innerHTML=(data||[]).length?data.map(f=>'<div class="item"><div class="row"><strong>'+escAdmin(f.subject)+'</strong><span class="status-pill">'+escAdmin(f.status)+'</span></div><div class="muted">'+escAdmin(f.category)+' · '+escAdmin(f.user_id)+' · '+escAdmin(new Date(f.created_at).toLocaleString())+'</div><p>'+escAdmin(f.message)+'</p><label>Status</label><select data-feedback-status="'+escAdmin(f.id)+'"><option value="new" '+(f.status==='new'?'selected':'')+'>New</option><option value="in_review" '+(f.status==='in_review'?'selected':'')+'>In review</option><option value="resolved" '+(f.status==='resolved'?'selected':'')+'>Resolved</option><option value="declined" '+(f.status==='declined'?'selected':'')+'>Declined</option></select><label>Reply to user</label><textarea data-feedback-reply="'+escAdmin(f.id)+'" rows="2" maxlength="4000" style="width:100%;padding:10px;border:1px solid #ccd6ce;border-radius:8px;font:inherit">'+escAdmin(f.admin_reply||'')+'</textarea><button type="button" data-save-feedback="'+escAdmin(f.id)+'" style="margin-top:8px">Save / send reply</button></div>').join(''):'<div class="empty">No feedback has been submitted yet.</div>';
 target.querySelectorAll('[data-save-feedback]').forEach(b=>b.addEventListener('click',async()=>{
  const id=b.dataset.saveFeedback,status=target.querySelector('[data-feedback-status="'+id+'"]').value,reply=target.querySelector('[data-feedback-reply="'+id+'"]').value.trim();
  b.disabled=true;const {error}=await supabaseClient.from('user_feedback').update({status,admin_reply:reply||null,replied_at:reply?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',id);
  b.disabled=false;if(error){alert('Could not save feedback: '+error.message);return;}await loadAdminFeedback();await loadUserSupport();
 }));
}
async function loadAdminNotifications(){
 const target=document.getElementById('adminNotificationsList');
 const {data,error}=await supabaseClient.from('app_notifications').select('id,title,body,kind,recipient_id,created_at').order('created_at',{ascending:false}).limit(20);
 if(error){target.textContent='Could not load notifications: '+error.message;return;}
 localStorage.setItem('sellbook-notifications-seen-'+cloudUser.id,new Date().toISOString());
 target.innerHTML=(data||[]).length?data.map(n=>'<div class="item"><strong>'+escAdmin(n.title)+'</strong><div class="muted">'+escAdmin(n.kind)+' · '+(n.recipient_id?'Specific user':'All users')+' · '+escAdmin(new Date(n.created_at).toLocaleString())+'</div><p>'+escAdmin(n.body)+'</p></div>').join(''):'<div class="empty">No notifications published yet.</div>';
}
function updateBusinessDetailsPage(){const name=(document.getElementById('businessTitle')?.textContent||'Sellbook').trim();const nameEls=['businessDetailsName','businessDetailsBusinessName'];nameEls.forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=name;});const email=document.getElementById('businessDetailsEmail');if(email)email.textContent=cloudUser?.email||'Not signed in';const registered=document.getElementById('businessDetailsRegistered');if(registered){const raw=cloudUser?.created_at||cloudUser?.createdAt;registered.textContent=raw&&!Number.isNaN(new Date(raw).getTime())?new Date(raw).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'}):'Not available for this device';}const status=document.getElementById('businessDetailsStatus');if(status)status.textContent=cloudUser?'Registered account':'Device profile';}
function updateMePanel(){const name=document.getElementById('businessTitle')?.textContent||'Sellbook';const b=document.getElementById('meBusinessName');if(b)b.textContent=name;}
function setUnreadBadge(id,count){const el=document.getElementById(id);if(!el)return;const n=Math.max(0,Number(count)||0);el.textContent=n>99?'99+':String(n);el.classList.toggle('hidden',n===0);}
async function updateUnreadBadges(){if(!cloudUser||!supabaseClient){setUnreadBadge('notificationBadge',0);setUnreadBadge('messageBadge',0);return;}try{const uid=cloudUser.id;const ns=localStorage.getItem('sellbook-notifications-seen-'+uid)||'1970-01-01T00:00:00.000Z';const notificationQuery=supabaseClient.from('app_notifications').select('id,created_at').or('recipient_id.is.null,recipient_id.eq.'+uid).gt('created_at',ns).limit(100);const messageQuery=sellbookIsAdmin?supabaseClient.from('support_messages').select('id',{count:'exact',head:true}).neq('sender_id',uid).or('recipient_id.is.null,recipient_id.eq.'+uid).is('read_at',null):supabaseClient.from('support_messages').select('id',{count:'exact',head:true}).eq('recipient_id',uid).is('read_at',null);const marketplaceMessageQuery=supabaseClient.from('marketplace_messages').select('id',{count:'exact',head:true}).eq('owner_id',uid).neq('sender_id',uid).is('read_at',null);const [nr,mr,mmr]=await Promise.all([notificationQuery,messageQuery,marketplaceMessageQuery]);setUnreadBadge('notificationBadge',nr.error?0:(nr.data||[]).length);setUnreadBadge('messageBadge',(mr.error?0:(mr.count??(mr.data||[]).length))+(mmr.error?0:(mmr.count??(mmr.data||[]).length)));}catch(_){/* Keep the interface quiet if the device is offline. */}}
let userNotificationsCache=[];let userNotificationCategory='all';
function renderUserNotifications(){const target=document.getElementById('userNotificationsList');if(!target)return;const rows=userNotificationCategory==='all'?userNotificationsCache:userNotificationsCache.filter(n=>String(n.kind||'').toLowerCase()===userNotificationCategory);target.innerHTML=rows.length?rows.map(n=>'<div class="item"><strong>'+escAdmin(n.title)+'</strong><div class="muted">'+escAdmin(({reservation:'Reservation',update:'Update',announcement:'Announcement',support:'Support',maintenance:'Maintenance'})[String(n.kind||'').toLowerCase()]||n.kind||'Notification')+' · '+escAdmin(new Date(n.created_at).toLocaleString())+'</div><p>'+escAdmin(n.body)+'</p></div>').join(''):'<div class="empty">'+(userNotificationCategory==='all'?'No notifications yet.':'No '+escAdmin(userNotificationCategory==='reservation'?'reservation':userNotificationCategory)+' notifications yet.')+'</div>';}
async function loadUserNotifications(){
 const target=document.getElementById('userNotificationsList');if(!target)return;
 if(!cloudUser){userNotificationsCache=[];target.textContent='Sign in to view app announcements.';return;}
 target.textContent='Loading notifications…';
 const {data,error}=await supabaseClient.from('app_notifications').select('id,title,body,kind,created_at').or('recipient_id.is.null,recipient_id.eq.'+cloudUser.id).order('created_at',{ascending:false}).limit(100);
 if(error){target.textContent='Could not load notifications: '+error.message;return;}
 userNotificationsCache=data||[];renderUserNotifications();
}

let messageListOpen=true;
function backFromMessageConversation(){messageListOpen=true;document.getElementById('conversationListView')?.classList.remove('hidden');document.getElementById('supportConversationView')?.classList.add('hidden');loadConversationList();}
async function openMessageConversation(id){marketplaceSelectedBuyerId=id==='support'?null:id;const selector=document.getElementById('messageConversationSelect');if(selector)selector.value=id;messageListOpen=false;document.getElementById('conversationListView')?.classList.add('hidden');document.getElementById('supportConversationView')?.classList.remove('hidden');await loadUserSupport();}
async function loadConversationList(){
 const target=document.getElementById('recentConversationList');if(!target)return;
 if(!cloudUser||!supabaseClient){target.innerHTML='<div class="empty">Sign in to view conversations.</div>';return;}
 target.innerHTML='<div class="empty">Loading conversations…</div>';
 const [subsRes,supportRes,marketRes]=await Promise.all([
  supabaseClient.rpc('get_my_marketplace_subscribers'),
  supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,read_at').or('sender_id.eq.'+cloudUser.id+',recipient_id.eq.'+cloudUser.id).order('created_at',{ascending:false}).limit(200),
  supabaseClient.from('marketplace_messages').select('id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',cloudUser.id).order('created_at',{ascending:false}).limit(300)
 ]);
 if(!subsRes.error)marketplaceSubscribersCache=subsRes.data||[];
 const conversations=[];
 const latestSupport=(supportRes.data||[])[0];
 if(latestSupport)conversations.push({id:'support',name:'Sellbook Support',body:latestSupport.body,time:latestSupport.created_at,unread:(supportRes.data||[]).filter(m=>m.sender_id!==cloudUser.id&&m.recipient_id===cloudUser.id&&!m.read_at).length});
 const byBuyer=new Map();
 (marketRes.data||[]).forEach(m=>{const old=byBuyer.get(m.buyer_id);if(!old||new Date(m.created_at)>new Date(old.created_at))byBuyer.set(m.buyer_id,m);});
 marketplaceSubscribersCache.forEach(sub=>{const m=byBuyer.get(sub.buyer_id);if(m)conversations.push({id:sub.buyer_id,name:sub.display_name||marketplaceBuyerName(sub.buyer_id),body:m.body,time:m.created_at,unread:(marketRes.data||[]).filter(x=>x.buyer_id===sub.buyer_id&&x.sender_id===sub.buyer_id&&!x.read_at).length});});
 conversations.sort((a,b)=>new Date(b.time)-new Date(a.time));
 target.innerHTML=conversations.length?conversations.map(c=>'<button type="button" class="conversation-list-button" data-conversation-id="'+escAdmin(c.id)+'"><span class="chat-support-avatar" aria-hidden="true">'+(c.id==='support'?'SB':'👤')+'</span><span class="conversation-preview"><strong>'+escAdmin(c.name)+'</strong><small>'+escAdmin(c.body||'No message text')+'</small></span><span><span class="conversation-time">'+escAdmin(new Date(c.time).toLocaleDateString())+'</span>'+(c.unread?'<span class="status-pill">'+c.unread+'</span>':'')+'</span></button>').join(''):'<div class="empty">No conversations yet. Your recent messages will appear here.</div>';
 target.querySelectorAll('[data-conversation-id]').forEach(b=>b.addEventListener('click',()=>openMessageConversation(b.dataset.conversationId)));
 await updateUnreadBadges();
}

async function loadUserSupport(){
 if(!cloudUser)return;
 const feedback=document.getElementById('userFeedbackList'),messages=document.getElementById('userSupportMessages'),selector=document.getElementById('messageConversationSelect');
 const [fr,mr,sr]=await Promise.all([
  supabaseClient.from('user_feedback').select('id,category,subject,message,status,admin_reply,created_at').eq('user_id',cloudUser.id).order('created_at',{ascending:false}).limit(50),
  supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+cloudUser.id+',recipient_id.eq.'+cloudUser.id).order('created_at',{ascending:true}).limit(100),
  supabaseClient.rpc('get_my_marketplace_subscribers')
 ]);
 if(feedback)feedback.innerHTML=fr.error?'Could not load feedback: '+escAdmin(fr.error.message):(fr.data||[]).length?fr.data.map(f=>'<div class="item"><div class="row"><strong>'+escAdmin(f.subject)+'</strong><span class="status-pill">'+escAdmin(f.status)+'</span></div><div class="muted">'+escAdmin(f.category)+' · '+escAdmin(new Date(f.created_at).toLocaleString())+'</div><p>'+escAdmin(f.message)+'</p>'+(f.admin_reply?'<p><strong>Sellbook reply:</strong> '+escAdmin(f.admin_reply)+'</p>':'')+'</div>').join(''):'<div class="empty">You have not sent feedback yet.</div>';
 if(!sr.error)marketplaceSubscribersCache=sr.data||[];
 if(selector){const old=selector.value||'support';selector.innerHTML='<option value="support">Sellbook Support</option>'+marketplaceSubscribersCache.map(x=>'<option value="'+escAdmin(x.buyer_id)+'">'+escAdmin(x.display_name||marketplaceBuyerName(x.buyer_id))+' · Buybook</option>').join('');selector.value=old==='support'||marketplaceSubscribersCache.some(x=>x.buyer_id===old)?old:'support';}
 const chosen=selector?selector.value:'support';
 const title=document.getElementById('supportConversationTitle'),status=document.getElementById('supportChatStatus');
 if(title)title.textContent=chosen==='support'?'Sellbook Support':marketplaceBuyerName(chosen);
 if(status)status.textContent=chosen==='support'?'Support conversation':'Buybook subscriber conversation';
 if(messages&&chosen==='support'){
  let rows=mr.data||[];
  const incoming=currentPage()==='support'?rows.filter(m=>m.sender_id!==cloudUser.id&&m.recipient_id===cloudUser.id&&!m.read_at).map(m=>m.id):[];
  if(incoming.length){const stamp=new Date().toISOString();const {error}=await supabaseClient.from('support_messages').update({delivered_at:stamp,read_at:stamp}).in('id',incoming).select('id');if(!error){const fresh=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+cloudUser.id+',recipient_id.eq.'+cloudUser.id).order('created_at',{ascending:true}).limit(100);if(!fresh.error)rows=fresh.data||rows;}}
  messages.innerHTML=mr.error?'Could not load messages: '+escAdmin(mr.error.message):rows.length?rows.map(m=>{const mine=m.sender_id===cloudUser.id,receipt=mine?(m.read_at?'Opened':m.delivered_at?'Delivered':'Sent'):'';return '<div class="chat-message '+(mine?'from-user':'from-support')+'"><strong>'+(mine?'You':'Sellbook Support')+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(new Date(m.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(receipt?' · '+receipt:'')+'</time></div>';}).join(''):'<div class="empty">No support messages yet. Send a message below to start chatting.</div>';
 }else if(messages){
  const {data,error}=await supabaseClient.from('marketplace_messages').select('id,owner_id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',cloudUser.id).eq('buyer_id',chosen).order('created_at',{ascending:true}).limit(200);
  let rows=data||[];const incoming=rows.filter(m=>m.sender_id===chosen&&!m.read_at).map(m=>m.id);
  if(incoming.length){const stamp=new Date().toISOString();const {error:readError}=await supabaseClient.from('marketplace_messages').update({read_at:stamp}).in('id',incoming).eq('owner_id',cloudUser.id);if(!readError)rows=rows.map(m=>incoming.includes(m.id)?{...m,read_at:stamp}:m);}
  messages.innerHTML=error?'<div class="empty">Could not load Buybook messages: '+escAdmin(error.message)+'</div>':rows.length?rows.map(m=>{const mine=m.sender_id===cloudUser.id;return '<div class="chat-message '+(mine?'from-user':'from-support')+'"><strong>'+escAdmin(mine?'You':marketplaceBuyerName(chosen))+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(new Date(m.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(mine&&m.read_at?' · Read':'')+'</time></div>';}).join(''):'<div class="empty">No messages from this subscriber yet. You can start the conversation below.</div>';
 }
 if(messages)messages.scrollTop=messages.scrollHeight;
 await loadUserNotifications();await updateUnreadBadges();
}
document.getElementById('userFeedbackForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!cloudUser)return document.getElementById('feedbackFormStatus').textContent='Please sign in first.';
 const status=document.getElementById('feedbackFormStatus');status.textContent='Sending…';
 const {error}=await supabaseClient.from('user_feedback').insert({user_id:cloudUser.id,category:document.getElementById('feedbackCategory').value,subject:document.getElementById('feedbackSubject').value.trim(),message:document.getElementById('feedbackMessage').value.trim()});
 if(error){status.textContent='Could not send feedback: '+error.message;return;}e.target.reset();status.textContent='Feedback sent. Thank you.';await loadUserSupport();
});
document.getElementById('supportMessageForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!cloudUser)return document.getElementById('supportMessageStatus').textContent='Please sign in first.';
 const form=e.target,body=document.getElementById('supportMessageBody'),status=document.getElementById('supportMessageStatus'),button=form.querySelector('button[type="submit"]'),message=body.value.trim(),chosen=document.getElementById('messageConversationSelect')?.value||'support';if(!message)return;
 button.disabled=true;status.textContent='Sending…';let error;
 if(chosen==='support'){({error}=await supabaseClient.from('support_messages').insert({sender_id:cloudUser.id,recipient_id:null,body:message}));}
 else{({error}=await supabaseClient.from('marketplace_messages').insert({owner_id:cloudUser.id,buyer_id:chosen,sender_id:cloudUser.id,body:message}));}
 button.disabled=false;if(error){status.textContent='Could not send message: '+error.message;return;}
 form.reset();body.style.height='auto';status.textContent='';await loadUserSupport();
});

let messengerSelectedConversation=null;
let messengerConversationCache=[];
let messengerRefreshTimer=null;
function messengerTime(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return '';const today=new Date();return d.toDateString()===today.toDateString()?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{day:'numeric',month:'short'});}
let messengerListFilter='all';
function renderMessengerConversationList(){
 const list=document.getElementById('messengerConversationList');if(!list)return;
 const term=(document.getElementById('messengerSearch')?.value||'').trim().toLowerCase();
 const rows=messengerConversationCache.filter(c=>(c.title+' '+(c.body||'')).toLowerCase().includes(term)&&(messengerListFilter==='all'||(messengerListFilter==='unread'&&c.unread>0)||(messengerListFilter==='support'&&c.id==='support')||(messengerListFilter==='buyers'&&c.id!=='support')));
 list.innerHTML=rows.length?rows.map(c=>'<button type="button" class="conversation-list-button" data-messenger-id="'+escAdmin(c.id)+'"><span class="chat-support-avatar" aria-hidden="true">'+(c.id==='support'?'SB':'👤')+'</span><span class="conversation-preview"><strong>'+escAdmin(c.title)+'</strong><small>'+(c.lastMine?'<span class="messenger-list-ticks'+(c.lastRead?' is-read':'')+'" aria-label="'+(c.lastRead?'Read':c.lastDelivered?'Delivered':'Sent')+'">'+(c.lastRead?'✓✓':c.lastDelivered?'✓✓':'✓')+'</span> ':'')+escAdmin(c.body||'No messages yet')+'</small></span><span class="conversation-time">'+escAdmin(messengerTime(c.time))+(c.unread?'<span class="status-pill">'+c.unread+'</span>':'')+'</span></button>').join(''):'<div class="empty">'+(term?'No matching conversations.':'No conversations yet. Buybook subscriber chats and Sellbook Support replies will appear here.')+'</div>';
 list.querySelectorAll('[data-messenger-id]').forEach(b=>b.addEventListener('click',()=>openMessengerConversation(b.dataset.messengerId)));
}
async function loadMessengerConversations(options={}){
 const list=document.getElementById('messengerConversationList');if(!list)return;
 if(!cloudUser||!supabaseClient){list.innerHTML='<div class="empty">Please sign in to use Messenger.</div>';return;}
 if(!options.quiet)list.innerHTML='<div class="empty">Loading chats…</div>';
 try{
  const uid=cloudUser.id;
  const [supportRes,marketRes,subsRes]=await Promise.all([
   supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+uid+',recipient_id.eq.'+uid).order('created_at',{ascending:false}).limit(100),
   supabaseClient.from('marketplace_messages').select('id,owner_id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',uid).order('created_at',{ascending:false}).limit(300),
   supabaseClient.rpc('get_my_marketplace_subscribers')
  ]);
  const conversations=[];
  if(!supportRes.error&&(supportRes.data||[]).length){const rows=supportRes.data;const m=rows[0];conversations.push({id:'support',title:'Sellbook Support',body:m.body,time:m.created_at,unread:rows.filter(x=>x.sender_id!==uid&&x.recipient_id===uid&&!x.read_at).length,lastMine:m.sender_id===uid,lastDelivered:!!m.delivered_at,lastRead:!!m.read_at});}
  const subs=subsRes.data||[],msgs=marketRes.data||[],ids=[...new Set([...subs.map(x=>x.buyer_id),...msgs.map(x=>x.buyer_id)])];
  for(const id of ids){const m=msgs.find(x=>x.buyer_id===id);const sub=subs.find(x=>x.buyer_id===id);if(!m&&!sub)continue;conversations.push({id,title:sub?.display_name||marketplaceBuyerName(id),body:m?.body||'Start a conversation',time:m?.created_at||sub?.created_at||new Date().toISOString(),unread:msgs.filter(x=>x.buyer_id===id&&x.sender_id!==uid&&!x.read_at).length,lastMine:!!m&&m.sender_id===uid,lastDelivered:false,lastRead:!!m&&!!m.read_at});}
  if(supportRes.error&&marketRes.error&&subsRes.error)throw supportRes.error;
  messengerConversationCache=conversations.sort((a,b)=>new Date(b.time)-new Date(a.time));
  renderMessengerConversationList();
  if(options.refreshSelected&&messengerSelectedConversation&&document.body.classList.contains('messenger-conversation-open'))await openMessengerConversation(messengerSelectedConversation,{quiet:true});
 }catch(err){if(!options.quiet)list.innerHTML='<div class="empty">Could not load chats: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
async function openMessengerConversation(id,options={}){
 const wasConversationOpen=document.body.classList.contains('messenger-conversation-open');
 if(!wasConversationOpen&&!options.quiet){
  history.pushState({mySalesBookPage:'messenger',mySalesBookPreviousPage:'messenger',mySalesBookMessengerChat:true},'','#messenger');
 }
 messengerSelectedConversation=id;document.body.classList.add('messenger-conversation-open');
 const input=document.getElementById('messengerBody'),send=document.querySelector('#messengerComposer button[type="submit"]');
 input.disabled=false;send.disabled=false;
 const convo=messengerConversationCache.find(c=>String(c.id)===String(id));
 document.getElementById('messengerChatTitle').textContent=id==='support'?'Sellbook Support':(convo?.title||marketplaceBuyerName(id));
 document.getElementById('messengerChatSubtitle').textContent=id==='support'?'Sellbook Support': 'Buybook subscriber';
 const target=document.getElementById('messengerTranscript');if(!options.quiet)target.innerHTML='<div class="empty">Loading messages…</div>';
 try{
  const uid=cloudUser.id;let rows=[],error=null;
  if(id==='support'){const r=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+uid+',recipient_id.eq.'+uid).order('created_at',{ascending:true}).limit(300);rows=r.data||[];error=r.error;if(!error){const incoming=rows.filter(m=>m.recipient_id===uid&&!m.delivered_at).map(m=>m.id);if(incoming.length){const stamp=now();const ack=await supabaseClient.from('support_messages').update({delivered_at:stamp}).in('id',incoming).eq('recipient_id',uid).is('delivered_at',null);if(!ack.error)rows=rows.map(m=>incoming.includes(m.id)?{...m,delivered_at:stamp}:m);}}}
  else{const r=await supabaseClient.from('marketplace_messages').select('id,owner_id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',uid).eq('buyer_id',id).order('created_at',{ascending:true}).limit(300);rows=r.data||[];error=r.error;}
  if(error)throw error;
  const wasNearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<120;
  target.innerHTML=rows.length?rows.map(m=>'<div class="chat-message '+(m.sender_id===uid?'from-user':'from-support')+'"><strong>'+(m.sender_id===uid?'You':(id==='support'?'Sellbook Support':escAdmin(convo?.title||marketplaceBuyerName(id))))+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(messengerTime(m.created_at))+(m.sender_id===uid?' · <span class="messenger-message-ticks'+(m.read_at?' is-read':'')+'">'+(m.read_at?'✓✓ Read':(id==='support'&&m.delivered_at?'✓✓ Delivered':'✓ Sent'))+'</span>':'')+'</time></div>').join(''):'<div class="empty">Say hello to start the conversation.</div>';
  if(wasNearBottom||!options.quiet)target.scrollTop=target.scrollHeight;
  const status=document.getElementById('messengerStatus');if(status)status.textContent='';
 }catch(err){if(!options.quiet)target.innerHTML='<div class="empty">Could not load messages: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
async function openMessengerSubscriberPicker(){
 const overlay=document.getElementById('messengerSubscriberPicker'),list=document.getElementById('messengerSubscriberPickerList');
 overlay?.classList.remove('hidden');list.innerHTML='<div class="empty">Loading subscribers…</div>';
 if(!cloudUser||!supabaseClient){list.innerHTML='<div class="empty">Please sign in to see subscribed buyers.</div>';return;}
 try{
  const {data,error}=await supabaseClient.rpc('get_my_marketplace_subscribers');if(error)throw error;
  marketplaceSubscribersCache=data||[];
  if(!marketplaceSubscribersCache.length){list.innerHTML='<div class="empty">No subscribed buyers yet. Buyers who subscribe to your shop on Buybook will appear here.</div>';return;}
  renderMessengerSubscriberPicker();
 }catch(err){list.innerHTML='<div class="empty">Could not load subscribers: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
function renderMessengerSubscriberPicker(){
 const list=document.getElementById('messengerSubscriberPickerList');if(!list)return;
 const term=(document.getElementById('messengerSubscriberSearch')?.value||'').trim().toLowerCase();
 const subs=marketplaceSubscribersCache.filter(s=>(s.display_name||marketplaceBuyerName(s.buyer_id)).toLowerCase().includes(term));
 list.innerHTML=subs.length?subs.map(s=>'<button type="button" class="messenger-picker-row" data-new-chat-buyer="'+escAdmin(s.buyer_id)+'"><span class="chat-support-avatar" aria-hidden="true">👤</span><span class="subscriber-meta"><strong>'+escAdmin(s.display_name||marketplaceBuyerName(s.buyer_id))+'</strong><small>Subscribed '+escAdmin(s.created_at?new Date(s.created_at).toLocaleDateString():'to your shop')+'</small></span><span aria-hidden="true">›</span></button>').join(''):'<div class="empty">No subscribers match your search.</div>';
 list.querySelectorAll('[data-new-chat-buyer]').forEach(b=>b.addEventListener('click',async()=>{const id=b.dataset.newChatBuyer;document.getElementById('messengerSubscriberPicker')?.classList.add('hidden');await loadMessengerConversations();await openMessengerConversation(id);}));
}
document.getElementById('messengerNewChat')?.addEventListener('click',openMessengerSubscriberPicker);
document.getElementById('closeMessengerSubscriberPicker')?.addEventListener('click',()=>document.getElementById('messengerSubscriberPicker')?.classList.add('hidden'));
document.getElementById('messengerSubscriberSearch')?.addEventListener('input',renderMessengerSubscriberPicker);
document.getElementById('messengerSubscriberPicker')?.addEventListener('click',e=>{if(e.target.id==='messengerSubscriberPicker')e.currentTarget.classList.add('hidden');});
document.getElementById('refreshMessenger')?.addEventListener('click',()=>loadMessengerConversations({refreshSelected:true}));
document.getElementById('messengerSearch')?.addEventListener('input',renderMessengerConversationList);
document.querySelectorAll('[data-messenger-filter]').forEach(button=>button.addEventListener('click',()=>{messengerListFilter=button.dataset.messengerFilter;document.querySelectorAll('[data-messenger-filter]').forEach(b=>b.classList.toggle('active',b===button));renderMessengerConversationList();}));
document.getElementById('messengerBackToChats')?.addEventListener('click',()=>{if(document.body.classList.contains('messenger-conversation-open')&&history.state?.mySalesBookMessengerChat){history.back();return;}document.body.classList.remove('messenger-conversation-open');messengerSelectedConversation=null;const input=document.getElementById('messengerBody');const send=document.querySelector('#messengerComposer button[type="submit"]');if(input)input.disabled=true;if(send)send.disabled=true;});
document.getElementById('messengerBody')?.addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';});
document.getElementById('messengerBody')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('messengerComposer')?.requestSubmit();}});
document.getElementById('messengerComposer')?.addEventListener('submit',async e=>{
 e.preventDefault();if(!cloudUser||!messengerSelectedConversation)return;
 const input=document.getElementById('messengerBody'),status=document.getElementById('messengerStatus'),button=e.currentTarget.querySelector('button[type="submit"]'),body=input.value.trim();if(!body)return;
 button.disabled=true;status.textContent='Sending…';
 try{let result;if(messengerSelectedConversation==='support')result=await supabaseClient.from('support_messages').insert({sender_id:cloudUser.id,recipient_id:null,body});else result=await supabaseClient.from('marketplace_messages').insert({owner_id:cloudUser.id,buyer_id:messengerSelectedConversation,sender_id:cloudUser.id,body});if(result.error)throw result.error;input.value='';input.style.height='auto';status.textContent='';await openMessengerConversation(messengerSelectedConversation);await loadMessengerConversations();}
 catch(err){status.textContent='Message not sent: '+(err.message||'Please try again.');}
 finally{button.disabled=false;}
});
if(messengerRefreshTimer)clearInterval(messengerRefreshTimer);
messengerRefreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&currentPage()==='messenger'&&cloudUser)loadMessengerConversations({quiet:true,refreshSelected:true});},6000);

document.getElementById('refreshSupportChat').addEventListener('click',()=>messageListOpen?loadConversationList():loadUserSupport());document.getElementById('refreshConversationList')?.addEventListener('click',loadConversationList);
document.getElementById('messageConversationSelect')?.addEventListener('change',()=>{marketplaceSelectedBuyerId=document.getElementById('messageConversationSelect').value==='support'?null:document.getElementById('messageConversationSelect').value;loadUserSupport();});
document.getElementById('openFeedbackPage').addEventListener('click',()=>showPage('feedback'));
document.querySelectorAll('[data-open-page="support"]').forEach(b=>b.addEventListener('click',async()=>{if(sellbookIsAdmin){showPage('admin');showAdminPanel('support');await loadAdminUsers();}else{showPage('support');loadUserSupport();}}));
const chatInput=document.getElementById('supportMessageBody');chatInput.addEventListener('input',()=>{chatInput.style.height='auto';chatInput.style.height=Math.min(chatInput.scrollHeight,140)+'px';});
function openAdminConversation(uid){
 const select=document.getElementById('adminMessageUser');select.value=uid;
 document.getElementById('adminChatUserListView').classList.add('hidden');
 document.getElementById('adminChatConversationView').classList.remove('hidden');
 document.body.classList.add('admin-conversation-open');
 loadAdminConversation();
}
function backToAdminChatList(){
 document.body.classList.remove('admin-conversation-open');
 document.getElementById('adminChatConversationView').classList.add('hidden');
 document.getElementById('adminChatUserListView').classList.remove('hidden');
 loadAdminUsers();
}
document.getElementById('backAdminChatList').addEventListener('click',backToAdminChatList);
document.getElementById('refreshAdminChatConversation').addEventListener('click',loadAdminConversation);
let adminConversationLoading=false;
async function loadAdminConversation(){
 if(adminConversationLoading)return;adminConversationLoading=true;
 const uid=document.getElementById('adminMessageUser').value,target=document.getElementById('adminSupportMessages'),input=document.getElementById('adminReplyBody'),send=document.querySelector('#adminReplyForm button[type="submit"]');
 if(!uid){target.innerHTML='<div class="empty">Choose a user to view messages.</div>';input.disabled=true;send.disabled=true;adminConversationLoading=false;return;}
 const user=adminUsersCache.find(u=>u.user_id===uid);document.getElementById('adminChatContactName').textContent=user?.email||'Sellbook user';document.getElementById('adminChatContactStatus').textContent='Online chat · messages update automatically';input.disabled=false;send.disabled=false;
 const firstLoad=!target.dataset.loaded;
 if(firstLoad)target.innerHTML='<div class="empty">Loading conversation…</div>';
 const wasNearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<100;
 let {data,error}=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+uid+',recipient_id.eq.'+uid).order('created_at',{ascending:true}).limit(200);
 if(error){target.innerHTML='<div class="empty">Could not load conversation: '+escAdmin(error.message)+'</div>';adminConversationLoading=false;return;}
 const unread=(data||[]).filter(m=>m.sender_id===uid&&!m.read_at).map(m=>m.id);
 if(unread.length){
  const now=new Date().toISOString();
  const {data:updated,error:updateError}=await supabaseClient.from('support_messages').update({delivered_at:now,read_at:now}).in('id',unread).select('id');
  if(!updateError){const fresh=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+uid+',recipient_id.eq.'+uid).order('created_at',{ascending:true}).limit(200);if(!fresh.error)data=fresh.data;else console.error('Could not refresh admin chat receipts:',fresh.error.message);await loadAdminUsers();}
 }
 const messages=data||[];
 const conversationHtml=messages.length?messages.map(m=>{const mine=m.sender_id===cloudUser.id;const receipt=mine?(m.read_at?'✓✓ Opened':m.delivered_at?'✓✓ Delivered':'✓ Sent'):'';return '<div class="admin-chat-bubble '+(mine?'from-admin':'from-user')+'">'+escAdmin(m.body)+'<span class="chat-time">'+escAdmin(new Date(m.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(receipt?' · '+receipt:'')+'</span></div>';}).join(''):'<div class="empty">No messages yet. You can send the first message below.</div>';
 if(target.innerHTML!==conversationHtml)target.innerHTML=conversationHtml;
 target.dataset.loaded='true';
 if(wasNearBottom)target.scrollTop=target.scrollHeight;
 await updateUnreadBadges();
 adminConversationLoading=false;
}
document.getElementById('adminReplyForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!sellbookIsAdmin)return;
 const uid=document.getElementById('adminMessageUser').value,input=document.getElementById('adminReplyBody'),body=input.value.trim(),status=document.getElementById('adminReplyStatus'),send=e.target.querySelector('button[type="submit"]');if(!uid){status.textContent='Choose a user first.';return;}if(!body)return;
 send.disabled=true;status.textContent='Sending…';
 const {data,error}=await supabaseClient.from('support_messages').insert({sender_id:cloudUser.id,recipient_id:uid,body}).select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').single();
 if(error){status.textContent='Could not send message: '+error.message;send.disabled=false;return;}
 input.value='';input.style.height='auto';status.textContent='Message sent.';await loadAdminConversation();await loadAdminUsers();send.disabled=false;
});
setInterval(()=>{if(cloudUser&&!document.hidden&&currentPage()==='settings-buybook'){loadBuybookActivity();}},5000);
setInterval(()=>{if(sellbookIsAdmin&&currentPage()==='admin'&&sessionStorage.getItem('sellbook-admin-panel')==='support'){if(!document.getElementById('adminChatConversationView').classList.contains('hidden')&&document.getElementById('adminMessageUser').value)loadAdminConversation();else loadAdminUsers();}},5000);
setInterval(()=>{if(!cloudUser||document.hidden)return;if(!sellbookIsAdmin&&currentPage()==='support')loadUserSupport();else updateUnreadBadges();},5000);

document.getElementById('notificationAudience').addEventListener('change',e=>document.getElementById('notificationUserWrap').classList.toggle('hidden',e.target.value!=='selected'));
document.getElementById('adminNotificationForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!sellbookIsAdmin)return;
 const audience=document.getElementById('notificationAudience').value,uid=document.getElementById('notificationUser').value,status=document.getElementById('adminNotificationStatus');
 if(audience==='selected'&&!uid){status.textContent='Choose a user.';return;}
 const payload={created_by:cloudUser.id,recipient_id:audience==='selected'?uid:null,kind:document.getElementById('notificationKind').value,title:document.getElementById('notificationTitle').value.trim(),body:document.getElementById('notificationBody').value.trim()};
 const {error}=await supabaseClient.from('app_notifications').insert(payload);
 if(error){status.textContent='Could not publish notification: '+error.message;return;}e.target.reset();document.getElementById('notificationUserWrap').classList.add('hidden');status.textContent='Notification published.';await loadAdminNotifications();
});
document.getElementById('refreshUserNotifications').addEventListener('click',loadUserNotifications);
document.getElementById('refreshFeedback').addEventListener('click',loadUserSupport);
document.getElementById('refreshAdminUsers').addEventListener('click',loadAdminUsers);
document.getElementById('refreshAdminFeedback').addEventListener('click',loadAdminFeedback);
document.getElementById('refreshAdminOverview').addEventListener('click',loadAdminDashboard);
document.getElementById('refreshAdminTraffic').addEventListener('click',loadAdminTraffic);
document.getElementById('adminSignOut').addEventListener('click',async()=>{
 if(!supabaseClient)return;
 const queued=cloudUser?readQueue(cloudUser.id).filter(item=>item.status!=='synced'):[];
 if(queued.length&&!confirm('You have '+queued.length+' unsynchronised change(s). They will remain on this device. Sign out anyway?'))return;
 const {error}=await supabaseClient.auth.signOut({scope:'local'});
 if(error){cloudMessage('Could not sign out: '+error.message);return;}
 await refreshAccountStatus();
});
recordSellbookVisit();

load();
applyTheme();
localSnapshot = snapshotLocalRecords();
render();
restorePageFromLocation();

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      document.getElementById('appWorkspace').classList.add('hidden');
      document.getElementById('recoveryPasswordForm').classList.remove('hidden');
      document.getElementById('accountManagePanel').classList.add('hidden');
      document.getElementById('emailAuthPanel').classList.add('hidden');
      cloudMessage('Choose a new password to finish recovering your account.');
    }
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      setTimeout(() => handleCloudAuthChange(), 0);
    }
  });
  handleCloudAuthChange();
} else {
  refreshAccountStatus();
}

// Offline service-worker registration.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js')
      .catch(function (error) {
        console.warn('Offline app setup could not start:', error);
      });
  });
}