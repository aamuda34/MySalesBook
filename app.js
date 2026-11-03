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
function productCreationSnapshot(p){return {id:String(p.id),productId:String(p.id),productName:String(p.name||'Product'),category:String(p.category||'Uncategorized'),cost:Number(p.cost)||0,price:Number(p.price)||0,initialStock:Number(p.stock)||0,baseUnit:p.baseUnit||'unit',packUnit:p.packUnit||'',unitsPerPack:Number(p.unitsPerPack)||1,packPrice:p.packPrice==null?null:Number(p.packPrice),imagePath:p.imagePath||'',addedAt:p.createdAt||now()};}
let db={products:[],sales:[],expenses:[],stockAdjustments:[],restocks:[],profile:{businessName:'',businessLogo:''}};
function normalizeDb(v){return {products:Array.isArray(v?.products)?v.products:[],sales:Array.isArray(v?.sales)?v.sales:[],expenses:Array.isArray(v?.expenses)?v.expenses:[],stockAdjustments:Array.isArray(v?.stockAdjustments)?v.stockAdjustments:[],restocks:Array.isArray(v?.restocks)?v.restocks:[],productAdditions:Array.isArray(v?.productAdditions)?v.productAdditions:[],profile:v?.profile&&typeof v.profile==='object'?v.profile:{businessName:'',businessLogo:''}};}
let lowStockThreshold=Number(localStorage.getItem('my-sales-book-low-stock-v1')||5);if(!Number.isSafeInteger(lowStockThreshold)||lowStockThreshold<0)lowStockThreshold=5;

const THEME_PREFERENCE_KEY='my-sales-book-theme-v1';
const systemThemeQuery=window.matchMedia('(prefers-color-scheme: dark)');
function getThemePreference(){
 const saved=localStorage.getItem(THEME_PREFERENCE_KEY);
 return saved==='light'||saved==='dark'?saved:'system';
}
function applyTheme(){
 const preference=getThemePreference();
 const useDark=preference==='dark'||(preference==='system'&&systemThemeQuery.matches);
 document.body.classList.toggle('dark',useDark);
 const themeColor=document.querySelector('meta[name="theme-color"]');
 if(themeColor)themeColor.setAttribute('content',useDark?'#100b18':'#14532d');
 const control=document.getElementById('themePreference');
 if(control&&control.value!==preference)control.value=preference;
}
const themePreferenceControl=document.getElementById('themePreference');
if(themePreferenceControl){
 themePreferenceControl.value=getThemePreference();
 themePreferenceControl.addEventListener('change',()=>{
  const selected=['system','light','dark'].includes(themePreferenceControl.value)?themePreferenceControl.value:'system';
  localStorage.setItem(THEME_PREFERENCE_KEY,selected);
  applyTheme();
 });
}
if(systemThemeQuery.addEventListener){
 systemThemeQuery.addEventListener('change',()=>{if(getThemePreference()==='system')applyTheme();});
}else if(systemThemeQuery.addListener){
 systemThemeQuery.addListener(()=>{if(getThemePreference()==='system')applyTheme();});
}
function safeDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?new Date(0):d;}
function dateKey(value){const d=safeDate(value);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function validDateKey(value){if(value==null||value==='')return null;const raw=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const [year,month,day]=raw.split('-').map(Number);const check=new Date(year,month-1,day);return check.getFullYear()===year&&check.getMonth()===month-1&&check.getDate()===day?raw:null;}const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
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
let accountSessionEpoch = 0;
let accountEmailOtpState = null;
const SECURITY_OAUTH_PENDING_KEY='sellbook-security-action-oauth-v1';
const SECURITY_PIN_CHANGE_AFTER_GOOGLE_KEY='sellbook-pin-change-after-google-v1';
let securityOauthFinalizing=false;
let securityOauthFinalizeScheduled=false;
let accountEmailOtpBusy = false;
let accountOtpResendTimer = null;
let pendingDeleteAccountUserId = null;
function accountRequestIsCurrent(userId, epoch) {
  return !!userId && cloudUser?.id === userId && accountSessionEpoch === epoch;
}
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
let statusPopupTimer=null;
function showToast(message,type='info'){
 const popup=document.getElementById('appStatusPopup');
 const text=String(message??'').trim();
 if(!popup||!text)return;
 const kind=['success','error','info'].includes(type)?type:'info';
 popup.textContent=text;popup.dataset.type=kind;
 popup.classList.remove('visible');
 void popup.offsetWidth;
 popup.classList.add('visible');
 if(statusPopupTimer)clearTimeout(statusPopupTimer);
 statusPopupTimer=setTimeout(()=>{popup.classList.remove('visible');statusPopupTimer=null;},5000);
}


let localSnapshot = null;
let authTransition = false;
let authTransitionPending = false;
let pendingSync = [];
let syncingQueue = false;
let recoveryMode = window.location.hash.includes('type=recovery');
const cloudCacheKey = userId => 'my-sales-book-cloud-cache-v1:' + userId;
const cloudQueueKey = userId => 'my-sales-book-sync-queue-v1:' + userId;

const queueRecoveryKey = userId => cloudQueueKey(userId) + ':recovery';
const queueReadErrors = new Map();
function readQueue(userId=cloudUser?.id) {
  if (!userId) return [];
  const key=cloudQueueKey(userId);
  let raw=null;
  try {
    raw=localStorage.getItem(key);
    if(raw===null){queueReadErrors.delete(userId);return [];}
    const value=JSON.parse(raw);
    if(!Array.isArray(value)||value.some(item=>!item||typeof item!=='object'||typeof item.id!=='string'||typeof item.type!=='string'||!item.payload||typeof item.payload!=='object')){
      throw Error('The saved sync queue has an invalid structure.');
    }
    queueReadErrors.delete(userId);
    return value;
  } catch (error) {
    queueReadErrors.set(userId,error);
    // Preserve the exact bytes that failed parsing/validation before any later
    // app action can overwrite the queue. Replace a stale recovery copy so it
    // always matches the current original queue. The original key is untouched.
    try {
      const backupKey=queueRecoveryKey(userId);
      if(raw===null)raw=localStorage.getItem(key);
      if(raw!==null&&localStorage.getItem(backupKey)!==raw)localStorage.setItem(backupKey,raw);
    } catch(backupError) {
      console.error('Sellbook could not create a second copy of the damaged sync queue:',backupError);
    }
    return [];
  }
}
function downloadQueueRecovery(userId) {
  if(!userId)return;
  const raw=localStorage.getItem(queueRecoveryKey(userId))??localStorage.getItem(cloudQueueKey(userId));
  if(raw===null)return cloudMessage('The original sync queue is unavailable on this device.');
  const blob=new Blob([raw],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='sellbook-sync-recovery-'+today()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function writeQueue(queue, userId=cloudUser?.id) {
  if (!userId) throw Error('Sign in to keep changes attached to your account.');
  if(queueReadErrors.has(userId))throw Error('Sellbook could not read the existing unsynchronised queue. The original data has been preserved. Download the recovery file and contact Sellbook Support before making further cloud changes.');
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
      db = normalizeDb(value);
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
  const queueRecoveryRequired=!!cloudUser&&queueReadErrors.has(cloudUser.id);
  el.textContent = !cloudUser ? 'Sign in to sync your business records.' :
    queueRecoveryRequired ? 'The saved sync queue needs recovery. Sellbook has stopped syncing to protect your unsynchronised records.' :
    conflicts ? conflicts + ' change(s) need attention. ' + waiting + ' change(s) remain unsynchronised.' :
    !navigator.onLine ? (waiting ? waiting + ' change(s) waiting to sync. Offline.' : 'Offline. Showing the last saved cloud records.') :
    waiting ? waiting + ' change(s) waiting to sync.' : 'All changes synchronised.';
  button.disabled = !cloudUser || queueRecoveryRequired || !navigator.onLine || syncingQueue;
  const details = document.getElementById('syncDetails');
  if (details) {
    if(queueRecoveryRequired){
      details.innerHTML='<div class="item"><strong>Unsynchronised data protected</strong><p>The original sync queue was not overwritten. Download its preserved copy and contact Sellbook Support before clearing browser data or switching devices.</p><button type="button" id="downloadSyncRecovery">Download recovery file</button></div>';
      details.querySelector('#downloadSyncRecovery')?.addEventListener('click',()=>downloadQueueRecovery(cloudUser?.id));
      return;
    }
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
  if(queueReadErrors.has(cloudUser.id))throw Error('The existing unsynchronised queue could not be read. Download the recovery file and contact Sellbook Support before adding more cloud changes.');
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
      if(p.isNew&&!db.productAdditions.some(x=>String(x.productId||x.id)===String(product.id)))db.productAdditions.push(productCreationSnapshot(product));
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
async function currentProductVersion(productId,expectedUserId=cloudUser?.id) {
  const user = await requireCloudUser(expectedUserId);
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
  const syncUserId=cloudUser.id,syncEpoch=accountSessionEpoch;
  const sessionCurrent=()=>accountRequestIsCurrent(syncUserId,syncEpoch);
  syncingQueue = true;
  try {
    let queue = readQueue(syncUserId);
    for (let queueIndex=0;queueIndex<queue.length;queueIndex++) {
      if(!sessionCurrent())return false;
      const item=queue[queueIndex];
      if (item.status === 'conflict') continue;
      try {
        const p = item.payload || {};
        if (item.type === 'product_save') {
          if (!p.isNew && p.product.updatedAt) {
            const currentVersion=await currentProductVersion(p.product.id,syncUserId);
            if(p.product.syncUpdatedAt&&currentVersion===p.product.syncUpdatedAt){
              // The database write already committed. Repeat the same idempotent update
              // so any unfinished photo publishing steps are retried as well.
              p.product.updatedAt=currentVersion;
            } else if (currentVersion!==p.product.updatedAt) {
              throw Error('Conflict: this product changed on another phone. Review the product and try again.');
            }
          }
          await cloudSaveProduct(p.product, p.isNew, syncUserId);
          const newVersion=await currentProductVersion(p.product.id,syncUserId);
          p.product.updatedAt=newVersion;
          propagateQueuedProductVersion(queue,queueIndex,p.product.id,newVersion);
        } else if (item.type === 'stock_restock') {
          const r=p.restock;
          const {error}=await supabaseClient.rpc('restock_product',{p_purchase_id:r.id,p_product_id:r.productId,p_purchase_quantity:r.purchaseQuantity,p_purchase_unit:r.purchaseUnit,p_units_per_purchase:r.unitsPerPurchase,p_cost_per_purchase_unit:r.costPerPurchaseUnit,p_restocked_at:r.date});
          if(error)throw error;
          // Restocking updates products.updated_at. Advance later queued changes for
          // this product so a sale made after the restock does not look stale.
          const newVersion=await currentProductVersion(r.productId,syncUserId);
          propagateQueuedProductVersion(queue,queueIndex,r.productId,newVersion);
        } else if (item.type === 'product_delete') {
          const {data:currentProduct,error:versionError}=await supabaseClient.from('products').select('updated_at').eq('id',p.product.id).eq('user_id',syncUserId).maybeSingle();
          if(versionError)throw versionError;
          // A retry after a successful delete but a lost acknowledgement must be safe.
          // A missing row means the requested delete has already completed.
          if(currentProduct&&p.product.updatedAt&&currentProduct.updated_at!==p.product.updatedAt)throw Error('Conflict: this product changed on another phone. Review it before deleting.');
          await cloudDeleteProduct(p.product,syncUserId);
        } else if (item.type === 'product_remove_image') {
          const {data:currentProduct,error:versionError}=await supabaseClient.from('products').select('updated_at,image_path').eq('id',p.product.id).eq('user_id',syncUserId).maybeSingle();
          if(versionError)throw versionError;
          if(!currentProduct)throw Error('Conflict: this product no longer exists in your account.');
          if(p.product.updatedAt&&currentProduct.updated_at!==p.product.updatedAt){
            // The image update may have committed even though the phone did not
            // receive its acknowledgement. Do not erase a newer image from
            // another device; only finish cleanup when the cloud pointer is empty.
            if(currentProduct.image_path===null&&p.product.imagePath){
              const {error:cleanupError}=await supabaseClient.storage.from('product-images').remove([p.product.imagePath]);
              if(cleanupError)throw cleanupError;
            }else{
              throw Error('Conflict: this product changed on another phone. Review it before removing its photo.');
            }
          }else{
            await cloudRemoveProductImage(p.product,syncUserId);
          }
          const newVersion=await currentProductVersion(p.product.id,syncUserId);
          propagateQueuedProductVersion(queue,queueIndex,p.product.id,newVersion);
        } else if (item.type === 'sale') {
          if (!p.productUpdatedAt) throw Error('This sale was saved by an older app version and needs a fresh product check. Keep it on this phone and contact Sellbook Support before retrying.');
          // The database RPC performs both the version check and the stock deduction
          // under a row lock, and checks p_sale_id for an existing committed sale
          // before checking the version. This makes a retry after a lost network
          // acknowledgement safe without allowing a stale sale to overdraw stock.
          // A separate client-side version read here would incorrectly turn a
          // successfully committed sale into a conflict on the retry.
          const {error} = await supabaseClient.rpc('record_sale_offline', {
            p_sale_id:p.sale.id,p_product_id:p.sale.productId,p_quantity:p.sale.qty,
            p_unit_price:p.sale.price,p_note:p.sale.note||null,p_sold_at:p.sale.date,
            p_units_per_sale:p.sale.unitsPerSale||1,p_sale_unit:p.sale.saleUnit||'unit',
            p_expected_updated_at:p.productUpdatedAt
          });
          if (error) throw error;
          const newVersion=await currentProductVersion(p.sale.productId,syncUserId);
          propagateQueuedProductVersion(queue,queueIndex,p.sale.productId,newVersion);
        } else if (item.type === 'sale_import') {
          const user = await requireCloudUser(syncUserId);
          const sale = p.sale;
          const {error} = await supabaseClient.from('sales').upsert({
            id:sale.id,user_id:user.id,product_id:sale.productId,product_name:sale.name,
            quantity:sale.qty,unit_price:sale.price,unit_cost:sale.cost,total:sale.total,
            gross_profit:sale.profit,note:sale.note||null,sold_at:sale.date
          }, {onConflict:'id',ignoreDuplicates:true});
          if (error) throw error;
        } else if (item.type === 'expense') {
          const user = await requireCloudUser(syncUserId);
          const {error} = await supabaseClient.from('expenses').upsert({
            id:p.expense.id,user_id:user.id,description:p.expense.name,
            amount:p.expense.amount,spent_at:p.expense.date
          }, {onConflict:'id',ignoreDuplicates:true});
          if (error) throw error;
        } else if(item.type==='stock_adjustment'){
          const user=await requireCloudUser(syncUserId),a=p.adjustment;
          const blocked=queue.slice(0,queueIndex).some(q=>q.status==='conflict'&&q.type==='product_save'&&q.payload?.product?.id===a.productId);
          if(blocked)throw Error('Conflict: this stock adjustment is waiting for a product change to be reviewed on this device.');
          const {error}=await supabaseClient.from('stock_adjustments').upsert({id:a.id,user_id:user.id,product_id:a.productId,product_name:a.productName,previous_stock:a.previousStock,new_stock:a.newStock,quantity_change:a.quantityChange,reason:a.reason||'',adjusted_at:a.date},{onConflict:'id',ignoreDuplicates:true});
          if(error)throw error;
        } else if(item.type==='profile_save'){
          const user=await requireCloudUser(syncUserId),profile=p.profile||{};
          const {error}=await supabaseClient.from('user_profiles').upsert({user_id:user.id,business_name:String(profile.businessName||'').slice(0,100),business_logo:profile.businessLogo||null,updated_at:now()},{onConflict:'user_id'});
          if(error)throw error;
        } else {
          // Never mark an unrecognised future/legacy operation as synchronised.
          throw Error('Unsupported queued change type "'+String(item.type||'unknown')+'". Keep this device data and contact Sellbook Support before clearing the sync queue.');
        }
        if(!sessionCurrent())return false;
        item.status = 'synced';
        item.error = '';
        writeQueue(queue, syncUserId);
      } catch (error) {
        if(!sessionCurrent())return false;
        item.error = error.message || String(error);
        item.status = /insufficient stock|product not found|belongs to another account|duplicate key|unique constraint|conflict|unsupported queued change/i.test(item.error)
          ? 'conflict' : 'pending';
        writeQueue(queue, syncUserId);
        break;
      }
    }
    if(!sessionCurrent())return false;
    queue = queue.filter(item => item.status !== 'synced');
    writeQueue(queue, syncUserId);
    if (!queue.length) {
      // Every queued operation has already been acknowledged by Supabase. A failed
      // follow-up refresh must not make callers roll back data that is already saved.
      try {
        const refreshed=await cloudLoadAll();
        if(refreshed===false||!sessionCurrent())return false;
      }
      catch(refreshError) {
        if(!sessionCurrent())return false;
        storageMode='cloud-offline';
        cacheCloudData(syncUserId);
        render();
        cloudMessage('Your changes were synchronised. Sellbook could not refresh the latest cloud copy, so it is showing the saved records on this device.');
        console.warn('Cloud refresh after successful sync failed:',refreshError);
      }
    } else {
      pendingSync = queue;
      applyPendingToDb();
      storageMode = 'cloud-offline';
      render();
      cacheCloudData(syncUserId);
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
  // Never carry the previous cloud account's sync indicators or admin privileges
  // into the local workspace after sign-out.
  pendingSync = [];
  db = normalizeDb(localSnapshot || {products: [], sales: [], expenses: []});
  storageMode = 'browser';
  cloudReady = false;
  workspaceReady = false;
  cloudUser = null;
  clearAccountScopedUiState();
  render();
}


let securityPinGateVisible=false;
let securityPinGateMode='verify';
let securityPinExpiresAt=0;
let securityPinExpiryTimer=null;
let securityPinStatusCheckInFlight=false;

function armSecurityPinExpiry(expiresAt){
 const parsed=Date.parse(expiresAt||'');
 if(!Number.isFinite(parsed)||parsed<=Date.now()){
  lockSellbookForPin('Your security PIN session has expired. Enter your PIN again.');
  return false;
 }
 securityPinExpiresAt=parsed;
 if(securityPinExpiryTimer)clearTimeout(securityPinExpiryTimer);
 securityPinExpiryTimer=setTimeout(()=>{
  lockSellbookForPin('Your security PIN session has expired. Enter your PIN again.');
 },Math.min(Math.max(parsed-Date.now(),0),2147483647));
 return true;
}
function lockSellbookForPin(message){
 securityPinExpiresAt=0;
 if(securityPinExpiryTimer){clearTimeout(securityPinExpiryTimer);securityPinExpiryTimer=null;}
 document.getElementById('appWorkspace')?.classList.add('hidden');
 showSecurityPinGate('verify',message);
}
async function recheckSellbookPinStatus(){
 if(!cloudUser||!supabaseClient||securityPinGateVisible||securityPinStatusCheckInFlight)return;
 if(securityPinExpiresAt&&Date.now()>=securityPinExpiresAt){
  lockSellbookForPin('Your security PIN session has expired. Enter your PIN again.');
  return;
 }
 if(!navigator.onLine)return;
 securityPinStatusCheckInFlight=true;
 try{
  const {data,error}=await supabaseClient.rpc('get_app_pin_status');
  if(error)throw error;
  if(data?.has_pin!==true){
   showSecurityPinGate('setup','A security PIN is required before your business records can open.');
   return;
  }
  if(data?.verified!==true){
   lockSellbookForPin('Your security PIN session is no longer valid. Enter your PIN again.');
   return;
  }
  armSecurityPinExpiry(data.expires_at);
 }catch(error){
  // If the server cannot confirm a still-valid PIN session, do not leave
  // cached private rows visible while online. Offline use remains available
  // only until the previously-issued server expiry timer fires.
  if(navigator.onLine){
   lockSellbookForPin('Sellbook could not confirm your PIN session. Reconnect and verify your PIN again.');
   document.getElementById('securityPinMessage').textContent=error.message||'PIN verification service is unavailable.';
  }
 }finally{
  securityPinStatusCheckInFlight=false;
 }
}
window.setInterval(recheckSellbookPinStatus,60000);
window.addEventListener('focus',()=>recheckSellbookPinStatus());
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden)recheckSellbookPinStatus();
});
function showSecurityPinGate(mode='verify',message=''){
 securityPinGateVisible=true;
 securityPinGateMode=mode;
 if(mode!=='change'){
  if(securityPinExpiryTimer){clearTimeout(securityPinExpiryTimer);securityPinExpiryTimer=null;}
  securityPinExpiresAt=0;
 }
 document.getElementById('securityPinCancel')?.classList.toggle('hidden',mode!=='change');
 const gate=document.getElementById('securityPinGate');
 const confirmWrap=document.getElementById('securityPinConfirmWrap');
 const forgot=document.getElementById('securityPinForgot');
 const title=document.getElementById('securityPinTitle');
 const subtitle=document.getElementById('securityPinSubtitle');
 const submit=document.getElementById('securityPinSubmit');
 const input=document.getElementById('securityPinInput');
 const confirmInput=document.getElementById('securityPinConfirm');
 if(!gate)return;
 gate.classList.remove('hidden');
 document.getElementById('appWorkspace')?.classList.add('hidden');
 document.getElementById('accountCard')?.classList.add('hidden');
 document.getElementById('authLoading')?.style.setProperty('display','none');
 if(mode==='setup'||mode==='change'){
  title.textContent=mode==='setup'?'Create your Sellbook PIN':'Change your Sellbook PIN';
  subtitle.textContent=mode==='setup'
   ?'Create a six-digit PIN to protect your private sales, products, stock and expenses on this account.'
   :'Choose a new six-digit PIN for this account.';
  submit.textContent=mode==='setup'?'Create PIN':'Save new PIN';
  confirmWrap.classList.remove('hidden');
  forgot.classList.add('hidden');
  input.autocomplete='new-password';
 }else{
  title.textContent='Enter your Sellbook PIN';
  subtitle.textContent='Your business records are locked until you verify your six-digit PIN.';
  submit.textContent='Unlock Sellbook';
  confirmWrap.classList.add('hidden');
  forgot.classList.remove('hidden');
  input.autocomplete='current-password';
 }
 input.value='';confirmInput.value='';
 document.getElementById('securityPinMessage').textContent=message||'';
 setTimeout(()=>input.focus(),40);
}
function hideSecurityPinGate(){
 securityPinGateVisible=false;
 document.getElementById('securityPinGate')?.classList.add('hidden');
}
async function ensureSellbookPinAccess(){
 if(!cloudUser||!supabaseClient)throw Error('Sign in before verifying your Sellbook PIN.');
 if(sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes'){
  showSecurityPinGate('verify','Verify your registered email address to reset your Sellbook PIN.');
  if(!accountEmailOtpState&&!accountEmailOtpBusy){
   requestAccountActionEmailOtp('change_pin').catch(error=>{
    document.getElementById('securityPinMessage').textContent='Could not send the email verification code: '+(error.message||'Please retry PIN recovery.');
   });
  }
  return false;
 }
 const {data,error}=await supabaseClient.rpc('get_app_pin_status');
 if(error)throw error;
 // No PIN is an enrollment state, not an unlocked state. The database RLS
 // helper allows pre-enrollment accounts to migrate safely, but the new UI
 // requires PIN creation before loading any private rows.
 if(data?.has_pin!==true){
  showSecurityPinGate('setup','A security PIN is required before your business records can open.');
  return false;
 }
 if(data?.verified===true){
  hideSecurityPinGate();
  if(!armSecurityPinExpiry(data.expires_at))return false;
  return true;
 }
 showSecurityPinGate('verify','Enter your PIN to unlock your business records.');
 return false;
}
document.getElementById('securityPinInput')?.addEventListener('input',event=>{event.target.value=Array.from(event.target.value).filter(ch=>ch>='0'&&ch<='9').slice(0,6).join('');});
document.getElementById('securityPinConfirm')?.addEventListener('input',event=>{event.target.value=Array.from(event.target.value).filter(ch=>ch>='0'&&ch<='9').slice(0,6).join('');});
document.getElementById('securityPinForm')?.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!cloudUser||!supabaseClient)return;
 const pin=document.getElementById('securityPinInput').value;
 const confirmation=document.getElementById('securityPinConfirm').value;
 const status=document.getElementById('securityPinMessage');
 const button=document.getElementById('securityPinSubmit');
 if(pin.length!==6||!Array.from(pin).every(ch=>ch>='0'&&ch<='9')){status.textContent='Enter exactly six digits.';return;}
 if((securityPinGateMode==='setup'||securityPinGateMode==='change')&&pin!==confirmation){status.textContent='The two PIN entries do not match.';return;}
 button.disabled=true;button.textContent=(securityPinGateMode==='setup'||securityPinGateMode==='change')?'Saving…':'Verifying…';
 status.textContent='Checking your PIN securely…';
 try{
  const settingPin=securityPinGateMode==='setup'||securityPinGateMode==='change';
  const {data,error}=await supabaseClient.rpc(settingPin?'set_app_pin':'verify_app_pin',{p_pin:pin});
  if(error)throw error;
  if(data?.requires_setup===true){showSecurityPinGate('setup','Create a new six-digit PIN to secure this account.');return;}
  if(data?.verified!==true){
   const locked=data?.locked_until?(' Locked until '+new Date(data.locked_until).toLocaleTimeString()+'.'):'';
   status.textContent=(data?.message||'The PIN could not be verified.')+(Number.isFinite(Number(data?.attempts_remaining))?' Attempts remaining: '+data.attempts_remaining+'.':'')+locked;
   return;
  }
  document.getElementById('securityPinForm').reset();
  hideSecurityPinGate();
  const pendingGooglePinChangeSession=sessionStorage.getItem(SECURITY_PIN_CHANGE_AFTER_GOOGLE_KEY);
  await handleCloudAuthChange();
  if(pendingGooglePinChangeSession){
   const current=await getSellbookAccountSession();
   if(current.sessionId!==pendingGooglePinChangeSession){
    sessionStorage.removeItem(SECURITY_PIN_CHANGE_AFTER_GOOGLE_KEY);
    showToast('Your sign-in session changed. Start the PIN change again to keep your account protected.','error');
   }else{
    const {data:pinStatus,error:pinStatusError}=await supabaseClient.rpc('get_app_pin_status');
    if(pinStatusError)throw pinStatusError;
    if(pinStatus?.verified===true){
     sessionStorage.removeItem(SECURITY_PIN_CHANGE_AFTER_GOOGLE_KEY);
     showSecurityPinGate('change','Your current PIN is verified. Enter a new six-digit PIN twice to complete the change.');
    }else{
     status.textContent='Sellbook could not confirm the PIN verification for this Google sign-in. Please verify your current PIN again.';
    }
   }
  }
 }catch(error){
  status.textContent='PIN operation failed: '+(error.message||'Please try again.');
 }finally{
  button.disabled=false;
  button.textContent=(securityPinGateMode==='setup'||securityPinGateMode==='change')?(securityPinGateMode==='setup'?'Create PIN':'Save new PIN'):'Unlock Sellbook';
 }
});
document.getElementById('securityPinForgot')?.addEventListener('click',async()=>{
 if(!supabaseClient||!navigator.onLine){document.getElementById('securityPinMessage').textContent='Connect to the internet before resetting your PIN.';return;}
 const button=document.getElementById('securityPinForgot');button.disabled=true;
 document.getElementById('securityPinMessage').textContent='Signing out so you can securely sign in again…';
 try{
  sessionStorage.setItem('sellbook-pin-reset-after-auth','yes');
  const {error}=await supabaseClient.auth.signOut({scope:'local'});
  if(error)throw error;
  hideSecurityPinGate();
  document.getElementById('accountCard')?.classList.remove('hidden');
  document.getElementById('accountMessage').textContent='Sign in again with Google or email to reset your PIN. The reset is allowed only immediately after a fresh sign-in.';
  await refreshAccountStatus();
 }catch(error){
  sessionStorage.removeItem('sellbook-pin-reset-after-auth');
  document.getElementById('securityPinMessage').textContent='Could not start PIN recovery: '+(error.message||'Please try again.');
 }finally{button.disabled=false;}
});
// Existing PIN changes are started only after successful email OTP verification.
document.getElementById('securityPinCancel')?.addEventListener('click',()=>{
 if(securityPinGateMode!=='change')return;
 if(!securityPinExpiresAt||securityPinExpiresAt<=Date.now()){
  lockSellbookForPin('Your security PIN session has expired. Enter your PIN again.');
  return;
 }
 hideSecurityPinGate();
 document.getElementById('appWorkspace')?.classList.remove('hidden');
 recheckSellbookPinStatus();
});

async function handleCloudAuthChange() {
  if(sessionStorage.getItem(SECURITY_OAUTH_PENDING_KEY)&&!securityOauthFinalizing)return;

  if (authTransition) { authTransitionPending = true; return; }
  authTransition = true;
  let activeUser = null;
  let coreWorkspaceLoaded = false;
  let pinCheckCompleted = false;
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

    // A session can change accounts without a full page reload. Clear any
    // previous administrator privilege before the new identity is checked.
    if (!user || cloudUser?.id !== user.id) {
      // Clear the old identity before the admin reset can repaint the screen.
      cloudUser = null;
      clearAccountScopedUiState();
    }

    if (user) {
      cloudUser = user;
      // Password recovery must finish before the PIN gate or any business data
      // loading. The recovery session is valid only for changing the password.
      if (recoveryMode) {
        document.getElementById('appWorkspace').classList.add('hidden');
        document.getElementById('accountCard').classList.remove('hidden');
        setAuthScreen('new-password');
        coreWorkspaceLoaded = true;
        finishStartup();
        return;
      }
      // Every normal authenticated Sellbook session must pass the server-side PIN gate
      // before any private business rows are loaded or rendered.
      const pinAllowed = await ensureSellbookPinAccess();
      // Also recheck after the asynchronous PIN lookup in case a recovery
      // callback arrived while that request was in flight.
      if (recoveryMode) {
        hideSecurityPinGate();
        document.getElementById('appWorkspace').classList.add('hidden');
        document.getElementById('accountCard').classList.remove('hidden');
        setAuthScreen('new-password');
        coreWorkspaceLoaded = true;
        finishStartup();
        return;
      }
      if (!pinAllowed) {
        document.getElementById('appWorkspace').classList.add('hidden');
        document.getElementById('accountCard').classList.add('hidden');
        coreWorkspaceLoaded = true;
        finishStartup();
        return;
      }
      pinCheckCompleted = true;
      if (storageMode !== 'cloud') localSnapshot = snapshotLocalRecords();
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
        const loaded=await cloudLoadAll();
        if(loaded===false){coreWorkspaceLoaded=true;finishStartup();return;}
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
      // The local PIN-recovery sign-out path skips restoreLocalRecords so it
      // cannot expose the old account's offline snapshot. Clear its identity
      // and administrator state explicitly nonetheless.
      cloudUser = null;
      clearAccountScopedUiState();
      hideSecurityPinGate();
      securityPinExpiresAt=0;
      if(securityPinExpiryTimer){clearTimeout(securityPinExpiryTimer);securityPinExpiryTimer=null;}
      if(sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes'){
        // Do not render the previous account's local snapshot during PIN recovery.
        workspaceReady=false;
        document.getElementById('appWorkspace').classList.add('hidden');
        document.getElementById('accountCard').classList.remove('hidden');
      }else{
        restoreLocalRecords();
      }
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
    // Fail closed if PIN status or reauthentication could not be confirmed.
    // Do not render an offline cache until the server says this auth session is PIN-verified.
    if (activeUser && !pinCheckCompleted) {
      cloudUser = activeUser;
      document.getElementById('appWorkspace').classList.add('hidden');
      document.getElementById('accountCard').classList.add('hidden');
      showSecurityPinGate('verify','Sellbook could not confirm this session\'s PIN status. Reconnect and verify again.');
      document.getElementById('securityPinMessage').textContent=err.message||'PIN verification service is unavailable.';
      coreWorkspaceLoaded = true;
      finishStartup();
      console.error('Sellbook PIN gate check failed:',err);
      return;
    }
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
      // If session lookup failed while signed out, never retain the previous
      // account identity or admin UI as an offline fallback.
      cloudUser = null;
      clearAccountScopedUiState();
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
    if(authTransitionPending){
      authTransitionPending=false;
      setTimeout(()=>handleCloudAuthChange(),0);
    }
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
  if(!cloudUser||!supabaseClient){setConnectionView(false);status.textContent='Sign in to Sellbook to connect to Buybook.';if(activity)activity.classList.add('hidden');return;}
  const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
  const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
  status.textContent='Checking Buybook connection…';
  const {data,error}=await supabaseClient.from('marketplace_shops').select('name,description,phone,address,city,state,is_connected,is_active').eq('owner_id',requestedUserId).maybeSingle();
  if(!current())return;
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
    document.getElementById('buybookShopName').value=db.profile?.businessName||'';
    if(!db.profile?.businessName&&cloudUser?.id===requestedUserId)document.getElementById('buybookShopName').value=cloudUser.user_metadata?.business_name||cloudUser.user_metadata?.full_name||'';
  }
  if(!current())return;
  setConnectionView(connected);
  if(connected) await loadBuybookActivity();
}
let buybookConnectionState=null;
let marketplaceSubscribersCache=[];
let marketplaceSelectedBuyerId=null;
let marketplaceActivityBusy=false;
let marketplaceActivityRequestId=0;
function marketplaceBuyerName(id){return marketplaceSubscribersCache.find(x=>x.buyer_id===id)?.display_name||('Buyer '+String(id||'').slice(-6));}
async function loadBuybookActivity(){
 const subscribersTarget=document.getElementById('marketplaceSubscriberList');
 const reservationsTarget=document.getElementById('marketplaceReservationsList');
 if(!subscribersTarget||!reservationsTarget)return;
 if(!cloudUser||!supabaseClient){subscribersTarget.innerHTML='<div class="empty">Sign in to see your subscribers.</div>';reservationsTarget.innerHTML='<div class="empty">Sign in to view product reservations.</div>';return;}
 if(marketplaceActivityBusy)return;
 marketplaceActivityBusy=true;
 const requestId=++marketplaceActivityRequestId;
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>requestId===marketplaceActivityRequestId&&accountRequestIsCurrent(requestedUserId,requestEpoch);
 try{
  const {data:subs,error:subsError}=await supabaseClient.rpc('get_my_marketplace_subscribers');
  if(!current())return;
  if(subsError)throw subsError;
  marketplaceSubscribersCache=subs||[];
  subscribersTarget.className=marketplaceSubscribersCache.length?'marketplace-subscriber-list':'empty';
  subscribersTarget.innerHTML=marketplaceSubscribersCache.length?marketplaceSubscribersCache.map(sub=>'<button type="button" class="marketplace-subscriber-button '+(marketplaceSelectedBuyerId===sub.buyer_id?'active':'')+'" data-marketplace-buyer="'+escAdmin(sub.buyer_id)+'"><span class="chat-support-avatar" aria-hidden="true">👤</span><span class="subscriber-meta"><strong>'+escAdmin(sub.display_name||marketplaceBuyerName(sub.buyer_id))+'</strong><small>Subscribed '+escAdmin(new Date(sub.created_at).toLocaleDateString())+'</small></span><span aria-hidden="true">›</span></button>').join(''):'No subscribers yet. When a buyer subscribes to your shop on Buybook, they will appear here.';
  const reservationResult=await fetchAllCloudRows(()=>supabaseClient.from('marketplace_reservations').select('id,buyer_id,status,buyer_note,created_at,expires_at').eq('owner_id',requestedUserId).order('created_at',{ascending:false}).order('id',{ascending:false}));
  if(!current())return;
  if(reservationResult.error)throw reservationResult.error;
  const reservations=reservationResult.data||[];
  const itemsByReservation={};const reservationIds=reservations.map(r=>r.id);
  for(let offset=0;offset<reservationIds.length;offset+=100){
   const {data,error}=await supabaseClient.from('marketplace_reservation_items').select('reservation_id,product_name,quantity,unit_price').in('reservation_id',reservationIds.slice(offset,offset+100));
   if(!current())return;
   if(error)throw error;
   for(const item of (data||[])){(itemsByReservation[item.reservation_id] ||= []).push(item);}
  }
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
  if(current()){
   if(!marketplaceSubscribersCache.length)subscribersTarget.innerHTML='Could not load subscribers: '+escAdmin(err.message||String(err));
   reservationsTarget.innerHTML='Could not load reservations: '+escAdmin(err.message||String(err));
  }
 }finally{if(requestId===marketplaceActivityRequestId)marketplaceActivityBusy=false;}
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

async function requireCloudUser(expectedUserId=cloudUser?.id||null) {
  if (!supabaseClient) throw Error('Cloud connection is unavailable.');
  const {data,error}=await supabaseClient.auth.getUser();
  if(error) throw error;
  if(!data.user) throw Error('Sign in to Sellbook before saving cloud records.');
  if(expectedUserId&&data.user.id!==expectedUserId)throw Error('Your Sellbook account changed during this operation. Please retry from the current account.');
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

// Supabase REST applies a row cap to each request. Page through owned records
// so long-running businesses do not silently lose older sales, expenses or stock history.
async function fetchAllCloudRows(buildQuery,pageSize=500){
  const rows=[];
  for(let offset=0;;offset+=pageSize){
    const {data,error}=await buildQuery().range(offset,offset+pageSize-1);
    if(error)return {data:null,error};
    const page=Array.isArray(data)?data:[];
    rows.push(...page);
    if(page.length<pageSize)break;
  }
  return {data:rows,error:null};
}

async function cloudLoadAll() {
  const expectedUserId=cloudUser?.id||null;
  const user=await requireCloudUser(expectedUserId);
  const loadEpoch=accountSessionEpoch;
  // Stock-before and stock-after are persisted in Supabase so history is complete on every device.
  // Keep cached values only as a compatibility fallback for older rows.
  const cachedRestockDetails=new Map((db.restocks||[]).map(item=>[String(item.id),item]));
  const [pr,sr,er,ar,rr,profileResult]=await Promise.all([
    fetchAllCloudRows(()=>supabaseClient.from('products').select('id,name,category,cost_price,selling_price,stock,base_unit,purchase_unit,units_per_purchase,pack_unit,units_per_pack,pack_selling_price,image_path,created_at,updated_at').eq('user_id',user.id).order('created_at').order('id')),
    fetchAllCloudRows(()=>supabaseClient.from('sales').select('id,product_id,product_name,quantity,unit_price,unit_cost,total,gross_profit,note,sold_at,base_quantity,sale_unit,units_per_sale').eq('user_id',user.id).order('sold_at').order('id')),
    fetchAllCloudRows(()=>supabaseClient.from('expenses').select('id,description,amount,spent_at').eq('user_id',user.id).order('spent_at').order('id')),
    fetchAllCloudRows(()=>supabaseClient.from('stock_adjustments').select('id,product_id,product_name,previous_stock,new_stock,quantity_change,reason,adjusted_at').eq('user_id',user.id).order('adjusted_at',{ascending:false}).order('id',{ascending:false})),
    fetchAllCloudRows(()=>supabaseClient.from('stock_purchases').select('id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,base_quantity,cost_per_purchase_unit,total_cost,average_cost_before,average_cost_after,previous_stock,new_stock,restocked_at').eq('user_id',user.id).order('restocked_at',{ascending:false}).order('id',{ascending:false})),
    supabaseClient.from('user_profiles').select('business_name,business_logo').eq('user_id',user.id).maybeSingle()
  ]);
  if(pr.error)throw pr.error;if(sr.error)throw sr.error;if(er.error)throw er.error;if(ar.error)throw ar.error;if(rr.error)throw rr.error;if(profileResult.error)throw profileResult.error;
  if(!accountRequestIsCurrent(user.id,loadEpoch))return false;
  let fallbackProfile={business_name:'',business_logo:null};
  if(!profileResult.data){const identity=String(user.user_metadata?.business_name||user.user_metadata?.full_name||user.email?.split('@')[0]||'My').trim();fallbackProfile={business_name:(identity.endsWith('Business')?identity:identity+' Business').slice(0,100),business_logo:null};const {error}=await supabaseClient.from('user_profiles').upsert({user_id:user.id,...fallbackProfile,updated_at:now()},{onConflict:'user_id',ignoreDuplicates:true});if(error)throw error;}
  if(!accountRequestIsCurrent(user.id,loadEpoch))return false;
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
      // Sign photos in bounded batches. The bulk Storage API replaces one
      // network request per product and keeps large catalogues from flooding
      // slower mobile connections after the first screen has rendered.
      let changed=false;
      for(let offset=0;offset<productsWithImages.length;offset+=100){
        if(!cloudUser||cloudUser.id!==user.id||!navigator.onLine)return;
        const batch=productsWithImages.slice(offset,offset+100);
        const paths=batch.map(product=>product.imagePath);
        try{
          const {data,error}=await supabaseClient.storage.from('product-images').createSignedUrls(paths,3600);
          if(error)throw error;
          const urlsByPath=new Map((data||[]).filter(item=>item?.path&&item?.signedUrl).map(item=>[item.path,item.signedUrl]));
          for(const product of batch){
            const signedUrl=urlsByPath.get(product.imagePath);
            const current=db.products.find(item=>String(item.id)===String(product.id));
            if(signedUrl&&current&&current.image!==signedUrl){current.image=signedUrl;changed=true;}
          }
        }catch(imageError){
          console.warn('Could not refresh a batch of product photo URLs:',imageError);
        }
      }
      if(!cloudUser||cloudUser.id!==user.id)return;
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
  return true;
}

async function cloudUploadProductImage(imageData,expectedUserId=cloudUser?.id) {
  if(!imageData||!imageData.startsWith('data:image/')) return null;
  const user=await requireCloudUser(expectedUserId);
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

async function cloudSaveProduct(product,isNew,expectedUserId=cloudUser?.id) {
  const user=await requireCloudUser(expectedUserId);
  // Keep the original photo data before replacing it with a signed private-bucket URL.
  // The original data is the most reliable source for publishing the matching Buybook photo.
  const newImageData=product.image&&product.image.startsWith('data:image/')?product.image:null;
  const imagePath= newImageData ? await cloudUploadProductImage(newImageData,expectedUserId) : (product.imagePath||null);
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

async function cloudRemoveProductImage(product,expectedUserId=cloudUser?.id) {
  const user=await requireCloudUser(expectedUserId);
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

async function cloudDeleteProduct(product,expectedUserId=cloudUser?.id) {
  const user=await requireCloudUser(expectedUserId);
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
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 try{
  const reservationResult=await fetchAllCloudRows(()=>supabaseClient.from('marketplace_reservations').select('id,buyer_id,status,buyer_note,created_at,expires_at').eq('owner_id',requestedUserId).order('created_at',{ascending:false}).order('id',{ascending:false}));
  if(!current())return;
  if(reservationResult.error)throw reservationResult.error;marketplaceReservationsCache=reservationResult.data||[];
  if(!marketplaceReservationsCache.length){target.innerHTML='<div class="empty">No reservations yet. Customer reservations from Buybook will appear here.</div>';return;}
  const byId={};const reservationIds=marketplaceReservationsCache.map(r=>r.id);
  for(let offset=0;offset<reservationIds.length;offset+=100){
   const result=await supabaseClient.from('marketplace_reservation_items').select('reservation_id,product_name,quantity,unit_price').in('reservation_id',reservationIds.slice(offset,offset+100));
   if(!current())return;
   if(result.error)throw result.error;for(const item of(result.data||[]))(byId[item.reservation_id] ||= []).push(item);
  }
  marketplaceReservationsCache.forEach(r=>r.items=byId[r.id]||[]);
  target.innerHTML=marketplaceReservationsCache.map(r=>{const products=r.items.map(x=>escAdmin(x.product_name)+' × '+Number(x.quantity||0)).join(', ');const status=String(r.status||'pending').replace(/[_-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());return '<button type="button" class="messenger-picker-row reservation-page-row" data-reservation-id="'+escAdmin(r.id)+'" style="width:100%;text-align:left"><span class="chat-support-avatar" aria-hidden="true">▣</span><span class="subscriber-meta"><strong>'+escAdmin(marketplaceBuyerName(r.buyer_id))+'</strong><small>'+escAdmin(products||'Product details unavailable')+'</small><small>'+escAdmin(new Date(r.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+' · '+escAdmin(status)+'</small></span><span aria-hidden="true">›</span></button>';}).join('');
  target.querySelectorAll('[data-reservation-id]').forEach(b=>b.addEventListener('click',()=>showReservationDetails(b.dataset.reservationId)));
 }catch(err){if(current())target.innerHTML='<div class="empty">Could not load reservations: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
async function retryReservationNotification(id,button){
 if(!cloudUser||!supabaseClient)return;
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch,current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 const reservation=marketplaceReservationsCache.find(item=>String(item.id)===String(id));
 const decision=String(reservation?.status||'').toLowerCase();
 if(!reservation||!['approved','rejected'].includes(decision))return;
 const original=button?.textContent;if(button){button.disabled=true;button.textContent='Sending…';}
 try{
  const result=await supabaseClient.functions.invoke('notify-reservation-decision',{body:{reservation_id:id,decision}});
  if(!current())return;
  if(result.error)throw result.error;
  if(typeof showToast==='function')showToast('Buyer notification sent.');else alert('Buyer notification sent.');
  if(button){button.textContent='Notification sent';button.disabled=true;}
 }catch(err){
  if(!current())return;
  if(typeof showToast==='function')showToast('Notification could not be sent. Please try again.');else alert('Notification could not be sent: '+(err.message||'Please try again.'));
  if(button){button.disabled=false;button.textContent=original||'Resend buyer notification';}
 }
}
async function updateReservationDecision(id,decision,button){
 if(!cloudUser||!supabaseClient)return;
 if(!['approved','rejected'].includes(decision))return;
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 const reservation=marketplaceReservationsCache.find(item=>String(item.id)===String(id));
 if(!reservation||String(reservation.status||'pending').toLowerCase()!=='pending')return;
 const label=decision==='approved'?'Approve this reservation?':'Reject this reservation?';
 if(!confirm(label+' The buyer will be able to see the updated status in Buybook.'))return;
 if(!current())return;
 const original=button?.textContent;if(button){button.disabled=true;button.textContent='Saving…';}
 try{
  const {data,error}=await supabaseClient.from('marketplace_reservations').update({status:decision,updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',requestedUserId).eq('status','pending').select('id,status').maybeSingle();
  if(!current())return;
  if(error)throw error;
  if(!data)throw new Error('This reservation has already been updated. Refresh the page to see its latest status.');
  reservation.status=decision;
  let notificationFailed=false;
  try{
   const {error:notificationError}=await supabaseClient.functions.invoke('notify-reservation-decision',{body:{reservation_id:id,decision}});
   if(!current())return;
   if(notificationError)throw notificationError;
  }catch(notificationError){
   if(!current())return;
   notificationFailed=true;
   console.error('Sellbook: reservation decision saved, but buyer notification failed.',notificationError);
  }
  await loadReservationsPage();
  if(!current())return;
  showReservationDetails(id,{history:false});
  const message=(decision==='approved'?'Reservation approved.':'Reservation rejected.')+(notificationFailed?' Buyer notification could not be sent; please try again later.':' Buyer notification sent.');
  if(typeof showToast==='function')showToast(message);
  else alert(message);
 }catch(err){if(current())alert('Could not update reservation: '+(err.message||'Please try again.'));if(button){button.disabled=false;button.textContent=original||'Try again';}}
}
function showReservationDetails(id,options={}){
 const r=marketplaceReservationsCache.find(x=>String(x.id)===String(id));if(!r)return;marketplaceSelectedReservationId=r.id;
 if(options.history!==false&&!(history.state?.mySalesBookPage==='reservations'&&history.state?.mySalesBookSubview==='reservation-details'))history.pushState({...history.state,mySalesBookPage:'reservations',mySalesBookSubview:'reservation-details'},'','#reservations');
 document.getElementById('reservationsListView')?.classList.add('hidden');document.getElementById('reservationDetailsView')?.classList.remove('hidden');
 const status=String(r.status||'pending').replace(/[_-]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());
 const products=r.items.map(x=>'<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><span>'+escAdmin(x.product_name)+' × '+Number(x.quantity||0)+'</span><strong>'+escAdmin(money(Number(x.unit_price||0)*Number(x.quantity||0)))+'</strong></div>').join('');
 const total=r.items.reduce((sum,x)=>sum+Number(x.unit_price||0)*Number(x.quantity||0),0);
 const pendingReservation=String(r.status||'pending').toLowerCase()==='pending';
 document.getElementById('reservationDetailsContent').innerHTML='<div style="display:flex;align-items:center;gap:12px;padding:14px 0"><span class="chat-support-avatar" aria-hidden="true">👤</span><div><h3 style="margin:0 0 5px">'+escAdmin(marketplaceBuyerName(r.buyer_id))+'</h3><p class="muted" style="margin:0">Customer on Buybook</p></div></div><div style="padding:12px 0;border-top:1px solid var(--border)"><small class="muted">Reserved on</small><p style="margin:5px 0;font-weight:700">'+escAdmin(new Date(r.created_at).toLocaleString([], {dateStyle:'full',timeStyle:'short'}))+'</p><small class="muted">Status</small><p style="margin:5px 0 12px;font-weight:700">'+escAdmin(status)+'</p>'+(pendingReservation?'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 20px"><button type="button" class="primary" data-reservation-decision="approved" style="width:100%">Approve reservation</button><button type="button" class="secondary" data-reservation-decision="rejected" style="width:100%">Reject reservation</button></div>':(['approved','rejected'].includes(String(r.status||'').toLowerCase())?'<button type="button" class="secondary" data-retry-reservation-notification style="width:100%;margin:8px 0 20px">Resend buyer notification</button>':''))+'<h3>Products</h3>'+(products||'<p class="muted">Product details unavailable.</p>')+'<div style="display:flex;justify-content:space-between;padding:14px 0;font-weight:700"><span>Total</span><span>'+escAdmin(money(total))+'</span></div>'+(r.buyer_note?'<div style="border-top:1px solid var(--border);padding-top:12px"><small class="muted">Customer note</small><p>'+escAdmin(r.buyer_note)+'</p></div>':'')+(r.expires_at?'<p class="muted">Expires '+escAdmin(new Date(r.expires_at).toLocaleString())+'</p>':'')+'</div>';
 document.getElementById('reservationDetailsContent').querySelectorAll('[data-reservation-decision]').forEach(button=>button.addEventListener('click',()=>updateReservationDecision(r.id,button.dataset.reservationDecision,button)));
 document.getElementById('reservationDetailsContent').querySelector('[data-retry-reservation-notification]')?.addEventListener('click',event=>retryReservationNotification(r.id,event.currentTarget));
}
document.getElementById('reservationDetailsBack')?.addEventListener('click',()=>{if(history.state?.mySalesBookPage==='reservations'&&history.state?.mySalesBookSubview==='reservation-details'){history.back();return;}document.getElementById('reservationDetailsView')?.classList.add('hidden');document.getElementById('reservationsListView')?.classList.remove('hidden');});
document.getElementById('reservationMessageButton')?.addEventListener('click',async()=>{const r=marketplaceReservationsCache.find(x=>String(x.id)===String(marketplaceSelectedReservationId));if(!r?.buyer_id)return;showPage('messenger');await loadMessengerConversations();await openMessengerConversation(r.buyer_id);});
async function loadSubscribersPage(){
 const target=document.getElementById('subscribersPageList');if(!target)return;
 document.getElementById('subscribersListView')?.classList.remove('hidden');document.getElementById('subscriberDetailsView')?.classList.add('hidden');
 target.innerHTML='<div class="empty">Loading subscribers…</div>';
 if(!cloudUser||!supabaseClient){target.innerHTML='<div class="empty">Please sign in to view subscribers.</div>';return;}
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 try{const {data,error}=await supabaseClient.rpc('get_my_marketplace_subscribers');if(!current())return;if(error)throw error;marketplaceSubscribersCache=data||[];
 if(!marketplaceSubscribersCache.length){target.innerHTML='<div class="empty">No subscribers yet. Buyers who subscribe to your shop on Buybook will appear here.</div>';return;}
 target.innerHTML=marketplaceSubscribersCache.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).map(s=>'<button type="button" class="messenger-picker-row subscriber-page-row" data-subscriber-id="'+escAdmin(s.buyer_id)+'" style="width:100%;text-align:left"><span class="chat-support-avatar" aria-hidden="true">👤</span><span class="subscriber-meta"><strong>'+escAdmin(s.display_name||marketplaceBuyerName(s.buyer_id))+'</strong><small>Subscribed '+escAdmin(s.created_at?new Date(s.created_at).toLocaleDateString():'date unavailable')+'</small></span><span aria-hidden="true">›</span></button>').join('');
 target.querySelectorAll('[data-subscriber-id]').forEach(b=>b.addEventListener('click',()=>showSubscriberDetails(b.dataset.subscriberId)));
 }catch(err){if(current())target.innerHTML='<div class="empty">Could not load subscribers: '+escAdmin(err.message||'Please try again.')+'</div>';}
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
async function refreshHomeSubscriberCount(){
 const el=document.getElementById('subscriberCountHome');if(!el)return;
 if(!cloudUser||!supabaseClient){el.textContent='—';return;}
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 try{
  const {data,error}=await supabaseClient.rpc('get_my_marketplace_subscribers');
  if(!accountRequestIsCurrent(requestedUserId,requestEpoch))return;
  if(error)throw error;
  el.textContent=String((data||[]).length);
 }catch(_){if(accountRequestIsCurrent(requestedUserId,requestEpoch))el.textContent='—';}
}
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
    // The Buybook connection page can be opened from either Settings or the
    // Home connect shortcut. Prefer its real navigation origin when available;
    // fall back to Settings after a direct URL/PWA restore.
    if(current==='settings-buybook'){
      const previous=history.state&&history.state.mySalesBookPage===current?history.state.mySalesBookPreviousPage:null;
      if(previous&&previous!==current&&['settings','home','me'].includes(previous))return previous;
      return 'settings';
    }
    // Prefer the page the user actually came from, consistently across the app.
    // Explicit button targets and inline handlers are fallbacks only: they may be
    // static defaults that ignore the user's real navigation path.
    const previous=history.state&&history.state.mySalesBookPage===current?history.state.mySalesBookPreviousPage:null;
    if(previous&&previous!==current&&VALID_PAGES.has(previous))return previous;
    if(button.dataset.appBack&&VALID_PAGES.has(button.dataset.appBack))return button.dataset.appBack;
    if(button.dataset.openPage&&VALID_PAGES.has(button.dataset.openPage))return button.dataset.openPage;
    const inline=button.getAttribute('onclick')||'';
    const match=inline.match(/showPage\(['"]([^'"]+)['"]\)/);
    return match&&VALID_PAGES.has(match[1])?match[1]:(parentPages[current]||'home');
  }
  document.addEventListener('click',function(event){
    const button=event.target.closest('.products-back-button,.settings-back-button,.business-profile-back,.reports-back-button,.notifications-back-button,.support-back-button,.stock-back-button,.stock-history-back-button,.stock-history-detail-back-button,.settings-main-back-button,.about-sellbook-back-button,.legal-page-back,[data-app-back]');
    if(!button)return;
    // Resolve the page from the clicked arrow's own section, not from a
    // global first-visible-page lookup. This prevents stale/overlapping page
    // visibility during re-render from assigning the wrong parent destination.
    const current=button.closest('.page')?.id||currentPage();
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
    // Navigate directly to the declared parent. Calling history.back() here
    // is unreliable when Android's installed-PWA history stack has been
    // restored or when an earlier page entry was replaced.
    showPage(fallback,{replaceHistory:true});
  },true);
})();
function refreshStockHistoryBadges(){
 const tabs=document.getElementById('stockHistoryTabs');if(!tabs)return;
 const counts={added:(db.productAdditions||[]).length,adjustments:(db.stockAdjustments||[]).length,restocks:(db.restocks||[]).length};
 tabs.querySelectorAll('[data-stock-history-tab]').forEach(button=>{const count=button.querySelector('[data-history-count]');if(count)count.textContent=String(counts[button.dataset.stockHistoryTab]||0);});
}
async function refreshStockHistoryFromCloud(){
 const renderAll=()=>{renderProductCreationHistory();renderStockAdjustments();renderRestockHistory();refreshStockHistoryBadges();};
 if(!cloudUser||!navigator.onLine||storageMode==='local'){renderAll();return;}
 const uid=cloudUser.id;
 try{
  const [result,historyResult]=await Promise.all([
   supabaseClient.from('stock_purchases').select('id,product_id,product_name,purchase_quantity,purchase_unit,units_per_purchase,base_quantity,cost_per_purchase_unit,total_cost,average_cost_before,average_cost_after,previous_stock,new_stock,restocked_at').eq('user_id',uid).order('restocked_at',{ascending:false}).limit(500),
   fetchAllCloudRows(()=>supabaseClient.from('product_creation_history').select('id,product_id,product_name,category,cost_price,selling_price,initial_stock,image_path,base_unit,purchase_unit,units_per_purchase,pack_unit,units_per_pack,pack_selling_price,added_at').eq('user_id',uid).order('added_at',{ascending:false}).order('id',{ascending:false}))
  ]);
  if(result.error)throw result.error;if(historyResult.error)throw historyResult.error;
  if(!cloudUser||cloudUser.id!==uid)return;
  const restocks=new Map();
  for(const row of db.restocks||[])if(row?.id!=null)restocks.set(String(row.id),row);
  for(const row of result.data||[]){const old=restocks.get(String(row.id))||{};restocks.set(String(row.id),{id:row.id,productId:row.product_id,productName:row.product_name,purchaseQuantity:Number(row.purchase_quantity),purchaseUnit:row.purchase_unit,unitsPerPurchase:Number(row.units_per_purchase),baseQuantity:Number(row.base_quantity),costPerPurchaseUnit:Number(row.cost_per_purchase_unit),totalCost:Number(row.total_cost),averageCostBefore:Number(row.average_cost_before),averageCostAfter:Number(row.average_cost_after),previousStock:row.previous_stock??old.previousStock,newStock:row.new_stock??old.newStock,date:row.restocked_at});}
  for(const item of readQueue(uid)){const row=item.payload?.restock;if(item.type==='stock_restock'&&item.status!=='synced'&&row)restocks.set(String(row.id),row);}
  db.restocks=[...restocks.values()].sort((a,b)=>safeDate(b.date)-safeDate(a.date));
  const additions=new Map();
  const put=row=>{const key=String(row?.productId||row?.product_id||row?.id||'');if(key)additions.set(key,{...(additions.get(key)||{}),...row});};
  for(const row of db.productAdditions||[])put(row);
  for(const row of historyResult.data||[])put({id:row.product_id,productId:row.product_id,productName:row.product_name,category:row.category,cost:Number(row.cost_price),price:Number(row.selling_price),initialStock:Number(row.initial_stock),imagePath:row.image_path||'',baseUnit:row.base_unit||'unit',purchaseUnit:row.purchase_unit||'unit',unitsPerPurchase:Number(row.units_per_purchase||1),packUnit:row.pack_unit||'',unitsPerPack:Number(row.units_per_pack||1),packPrice:row.pack_selling_price==null?null:Number(row.pack_selling_price),addedAt:row.added_at});
  for(const item of readQueue(uid)){const p=item.payload?.product;if(item.type==='product_save'&&item.payload?.isNew&&item.status!=='synced'&&p)put(productCreationSnapshot(p));}
  db.productAdditions=[...additions.values()].sort((a,b)=>safeDate(b.addedAt)-safeDate(a.addedAt));
  renderAll();cacheCloudData(uid);
 }catch(error){console.warn('Product history refresh failed:',error);cloudMessage('Product history could not be refreshed. Showing the saved history on this phone.');renderAll();}
}

let messengerReturnPage='home';function showPage(name,options={}){if(!VALID_PAGES.has(name))return;const previous=currentPage();if(name==='messenger'&&previous!=='messenger')messengerReturnPage=previous;document.body.classList.toggle('user-support-open',name==='support'&&!sellbookIsAdmin);document.body.classList.toggle('messenger-open',name==='messenger');if(name!=='messenger')document.body.classList.remove('messenger-conversation-open');if(name==='messenger'&&cloudUser)loadMessengerConversations();if(name==='stock-history'){renderProductCreationHistory();renderStockAdjustments();refreshStockHistoryBadges();void refreshStockHistoryFromCloud();}if(!options.fromHistory&&previous!==name){const previousForHistory=options.replaceHistory?(history.state&&history.state.mySalesBookPreviousPage):previous;const state={mySalesBookPage:name,mySalesBookPreviousPage:previousForHistory,mySalesBookReturnPage:name==='messenger'?messengerReturnPage:undefined};if(options.replaceHistory)history.replaceState(state,'','#'+name);else history.pushState(state,'','#'+name);}paintPage(name,options.scroll!==false);}
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
document.getElementById('messengerPageBack')?.addEventListener('click',()=>{const target=VALID_PAGES.has(messengerReturnPage)&&messengerReturnPage!=='messenger'?messengerReturnPage:'home';if(location.hash==='#messenger'&&history.state?.mySalesBookPage==='messenger'){history.back();setTimeout(()=>{if(currentPage()==='messenger')showPage(target,{replaceHistory:true});},180);}else showPage(target);});
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
  document.getElementById('dashboardGreeting').textContent='';const sellerGreeting=document.getElementById('businessTitle');const meta=cloudUser?.user_metadata||{};const displayName=String(meta.first_name||meta.given_name||meta.full_name||meta.name||cloudUser?.email?.split('@')[0]||'there').trim();const firstName=displayName.split(/\s+/)[0];const hour=new Date().getHours();const greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';if(sellerGreeting)sellerGreeting.textContent=greeting+' '+firstName.toUpperCase();const meFirstName=document.getElementById('meUserFirstName');if(meFirstName)meFirstName.textContent=firstName.toUpperCase();
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
 function reportRows(){const range=document.getElementById('reportRange')?.value||'30';const allTime=range==='all';const days=allTime?0:Number(range);const start=new Date();start.setHours(0,0,0,0);if(!allTime)start.setDate(start.getDate()-days+1);else{const dates=[...(db.sales||[]),...(db.expenses||[])].map(x=>validDateKey(x.date)).filter(Boolean).map(key=>{const [year,month,day]=key.split('-').map(Number);return new Date(year,month-1,day);}).filter(d=>d<=new Date());if(dates.length){const earliest=dates.reduce((minimum,d)=>Math.min(minimum,d.getTime()),Infinity);start.setTime(earliest);start.setHours(0,0,0,0);}else{start.setFullYear(start.getFullYear(),0,1);}}const span=Math.max(1,Math.floor((new Date().setHours(0,0,0,0)-start.getTime())/86400000)+1);const size=allTime?Math.max(1,Math.ceil(span/14)):Math.max(1,Math.ceil(days/14));const dailyTotals=salesTotalsByDate(),rows=[];for(let offset=0;offset<span;offset+=size){const d=new Date(start);d.setDate(start.getDate()+offset);let total=0;for(let i=offset;i<Math.min(span,offset+size);i++){const day=new Date(start);day.setDate(start.getDate()+i);total+=dailyTotals.get(dateKey(day))||0;}rows.push({label:d.toLocaleDateString(undefined,{month:'numeric',day:'numeric'}),sales:total});}return {start,rows};}
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
function renderProductCreationHistory(){
 const target=document.getElementById('productCreationHistoryList');if(!target)return;
 const rows=[...(db.productAdditions||[])].sort((a,b)=>safeDate(b.addedAt)-safeDate(a.addedAt));
 target.innerHTML=rows.length?rows.map(row=>'<button type="button" class="stock-history-row" data-stock-history-id="'+esc(String(row.productId||row.id))+'" data-stock-history-kind="added"><span class="row"><strong>'+esc(row.productName||'Product')+'</strong><strong>'+Number(row.initialStock||0).toLocaleString('en-NG')+' units</strong></span><span class="muted">Added '+safeDate(row.addedAt).toLocaleString()+' · Cost '+money(row.cost)+' · Selling '+money(row.price)+'</span></button>').join(''):'<div class="empty">No products added in this history yet. New products will appear here from now on; earlier product details cannot be reconstructed reliably.</div>';
}
function renderStockHistoryDetail(kind,id){
 const row=(kind==='added'?(db.productAdditions||[]):kind==='restock'?(db.restocks||[]):(db.stockAdjustments||[])).find(x=>String(kind==='added'?(x.productId||x.id):x.id)===String(id));
 const target=document.getElementById('stockHistoryDetailContent');if(!target||!row)return;
 const fields=kind==='added'?[
  ['Type','Product added'],['Product',row.productName||'Product'],['Date and time',safeDate(row.addedAt).toLocaleString()],
  ['Category',row.category||'Uncategorized'],['Initial stock',String(row.initialStock??0)+' units'],
  ['Cost price',money(Number(row.cost)||0)],['Selling price',money(Number(row.price)||0)],
  ['Base unit',row.baseUnit||'unit'],['Pack unit',row.packUnit||'Not used'],
  ['Units per pack',row.packUnit?String(row.unitsPerPack||1):'Not applicable'],
  ['Pack selling price',row.packPrice==null?'Not set':money(Number(row.packPrice))]
 ]:kind==='restock'?[
  ['Type','Restock'],['Product',row.productName||db.products.find(p=>p.id===row.productId)?.name||'Product'],['Date and time',safeDate(row.date).toLocaleString()],
  ['Purchase quantity',(row.purchaseQuantity||0)+' '+(row.purchaseUnit||'unit')],['Units per purchase',row.unitsPerPurchase||1],
  ['Total units added',row.baseQuantity||((row.purchaseQuantity||0)*(row.unitsPerPurchase||1))],
  ['Cost per purchase unit',money(Number(row.costPerPurchaseUnit)||0)],['Total purchase cost',money(Number(row.totalCost)||((row.purchaseQuantity||0)*(Number(row.costPerPurchaseUnit)||0)))],
  ['Stock after restock',row.newStock??'—'],['Average cost per unit',money(Number(row.averageCostAfter)||0)]
 ]:[
  ['Type','Stock adjustment'],['Product',row.productName||'Product'],['Date and time',safeDate(row.date).toLocaleString()],
  ['Previous stock',String(row.previousStock??'—')+' units'],['New stock',String(row.newStock??'—')+' units'],
  ['Change',((Number(row.quantityChange)>0?'+':'')+String(row.quantityChange??0))+' units'],['Reason',row.reason||'Not specified']
 ];
 target.innerHTML=fields.map(([label,value])=>'<div class="stock-history-detail-field"><span>'+esc(label)+'</span><strong>'+esc(String(value))+'</strong></div>').join('');
}
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
 const restock={id:crypto.randomUUID(),productId:p.id,productName:p.name,purchaseQuantity,purchaseUnit,unitsPerPurchase,costPerPurchaseUnit,date:now(),previousStock:p.stock,newStock,baseQuantity,totalCost,averageCostAfter};db.restocks.push(restock);
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
 const addition=productCreationSnapshot(product);
 if(cloudUser){
   db.productAdditions=db.productAdditions||[];db.productAdditions.push(addition);
   try { await saveCloudChangeLocally('product_save',{product,isNew:true}); }
   catch(err){db.productAdditions=db.productAdditions.filter(x=>String(x.productId||x.id)!==String(product.id));return alert(err.message || String(err));}
 }else{
   db.products.push(product);db.productAdditions=db.productAdditions||[];db.productAdditions.push(addition);
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
let emailAuthMode = 'signin';
let authScreenMode = 'choices';
let confirmationEmail = '';
let emailAuthInProgress = false;

function setAuthScreen(mode) {
  const choices=document.getElementById('authSignInChoices');
  const emailPanel=document.getElementById('emailAuthPanel');
  const recovery=document.getElementById('accountRecoveryRequestForm');
  const newPassword=document.getElementById('recoveryPasswordForm');
  const card=document.getElementById('accountCard');
  if(!choices||!emailPanel||!recovery||!newPassword||!card)return;
  authScreenMode=mode;
  choices.classList.toggle('hidden',mode!=='choices');
  emailPanel.classList.toggle('hidden',mode!=='email');
  emailPanel.setAttribute('aria-hidden',mode!=='email'?'true':'false');
  recovery.classList.toggle('hidden',mode!=='recovery');
  newPassword.classList.toggle('hidden',mode!=='new-password');
  card.classList.toggle('auth-recovery-request-open',mode==='recovery'||mode==='new-password');
  if(mode==='choices'){
    document.getElementById('authCardTitle').textContent='Welcome back';
    document.getElementById('accountStatus').textContent='Sign in securely to access your business records.';
  } else if(mode==='email'){
    document.getElementById('authCardTitle').textContent=emailAuthMode==='signup'?'Create your account':'Sign in with email';
  document.getElementById('accountStatus').textContent=emailAuthMode==='signup'?'Set up an account to keep your business records safely in one place.':'Enter your email and password to access your business records.';
    document.getElementById('emailAuthHeading').textContent=emailAuthMode==='signup'?'Create your Sellbook account':'Sign in with email';
    document.getElementById('accountStatus').textContent=emailAuthMode==='signup'?'Set up an account to keep your business records safely in one place.':'Enter your email and password to access your business records.';
    document.getElementById('emailAuthDescription').textContent=emailAuthMode==='signup'
      ?'Use an email address you can access. We’ll ask you to confirm it before your first sign-in.'
      :'Use the email address and password linked to your Sellbook account.';
  }
  if(mode!=='email')document.getElementById('resendConfirmationBtn')?.classList.add('hidden');
}
function passwordPolicyError(password) {
  if(password.length<8)return 'Use at least 8 characters.';
  if(!/[a-z]/.test(password))return 'Add at least one lowercase letter.';
  if(!/[A-Z]/.test(password))return 'Add at least one uppercase letter.';
  if(!/[0-9]/.test(password))return 'Add at least one number.';
  if(!/[^A-Za-z0-9\s]/.test(password))return 'Add at least one symbol, such as ! or #.';
  return '';
}
function friendlyAuthError(error) {
  const code=String(error?.code||error?.name||'').toLowerCase();
  const message=String(error?.message||'').toLowerCase();
  if(code.includes('invalid_credentials')||message.includes('invalid login credentials'))return 'That email address or password is incorrect. Check your details and try again.';
  if(code.includes('email_not_confirmed')||message.includes('email not confirmed'))return 'Please confirm your email address before signing in. You can resend the confirmation email below.';
  if(code.includes('email_address_not_authorized')||message.includes('email address is not authorized')||message.includes('only authorized'))return 'Sellbook’s current email sender cannot deliver to this address yet. Email confirmation requires a verified sending service. You can still sign in with an already confirmed account or use Google.';
  if(code.includes('over_email_send_rate_limit')||code.includes('rate_limit')||message.includes('rate limit'))return 'Too many email requests were made. Wait a little before trying again.';
  if(code.includes('weak_password')||message.includes('password should'))return 'That password does not meet the security requirements. Use at least 8 characters with uppercase, lowercase, a number and a symbol.';
  if(message.includes('failed to fetch')||message.includes('network')||!navigator.onLine)return 'Sellbook could not reach the account service. Check your internet connection and try again.';
  return error?.message||'We could not complete that account request. Please try again.';
}


function readPendingGoogleSecurityAction(){
  try{
    const raw=sessionStorage.getItem(SECURITY_OAUTH_PENDING_KEY);
    if(!raw)return null;
    const value=JSON.parse(raw);
    if(!value||!['change_pin','change_email'].includes(value.action)||!value.userId||!value.email||
       !/^[0-9a-f-]{36}$/i.test(String(value.previousSessionId||''))||
       !Number.isFinite(Number(value.startedAt)))return null;
    return value;
  }catch(_){return null;}
}
async function beginGoogleSecurityReauth(action,current){
  const recovery=sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes';
  const pending={
    action,
    userId:current.user.id,
    email:String(current.user.email||'').trim(),
    previousSessionId:current.sessionId,
    recovery,
    startedAt:Date.now()
  };
  sessionStorage.setItem(SECURITY_OAUTH_PENDING_KEY,JSON.stringify(pending));
  // Force a new Supabase session: OAuth on the already-active session can
  // otherwise return the same session_id and cannot authorise a step-up grant.
  const {error:signOutError}=await supabaseClient.auth.signOut({scope:'local'});
  if(signOutError){sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);throw signOutError;}
  const redirectTo=new URLSearchParams(window.location.search).get('native')==='1'
    ?'sellbook://auth'
    :window.location.origin+window.location.pathname+window.location.search+window.location.hash;
  const {error}=await supabaseClient.auth.signInWithOAuth({
    provider:'google',
    options:{
      redirectTo,
      queryParams:{prompt:'login',login_hint:pending.email}
    }
  });
  if(error){
    sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);
    const {error:restoreError}=await supabaseClient.auth.setSession({access_token:current.session.access_token,refresh_token:current.session.refresh_token});
    if(restoreError)console.warn('Sellbook could not restore the prior session after Google sign-in failed:',restoreError);
    throw error;
  }
}
async function completePendingGoogleSecurityReauth(){
  if(securityOauthFinalizing)return;
  const pending=readPendingGoogleSecurityAction();
  if(!pending)return;
  securityOauthFinalizing=true;
  securityOauthFinalizeScheduled=false;
  try{
    if(Date.now()-pending.startedAt>15*60*1000)throw Error('Google verification timed out. Start the account change again.');
    const {data,error}=await supabaseClient.auth.getSession();
    if(error)throw error;
    const session=data?.session,user=session?.user;
    if(!session||!user)throw Error('Google sign-in did not return a valid Sellbook session.');
    if(user.id!==pending.userId){
      sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);
      sessionStorage.removeItem('sellbook-pin-reset-after-auth');
      await supabaseClient.auth.signOut({scope:'local'}).catch(()=>{});
      refreshAccountStatus();
      showToast('Google sign-in used a different account. Sign in with the same Google account linked to your Sellbook account, then try again.','error');
      return;
    }
    if(!user.email_confirmed_at||String(user.email||'').toLowerCase()!==pending.email.toLowerCase()){
      throw Error('Google did not confirm the same registered Sellbook email address.');
    }
    const providers=new Set([
      ...(Array.isArray(user.app_metadata?.providers)?user.app_metadata.providers:[]),
      ...(Array.isArray(user.identities)?user.identities.map(identity=>identity?.provider):[])
    ].filter(Boolean));
    if(!providers.has('google'))throw Error('This Google account is not linked to your Sellbook account.');
    const claims=decodeSellbookJwtPayload(session.access_token);
    const sessionId=String(claims.session_id||'');
    if(claims.sub!==user.id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)){
      throw Error('Google sign-in returned an invalid Sellbook session.');
    }
    if(sessionId===pending.previousSessionId)throw Error('Google verification has not completed yet. Please retry.');
    const {data:grant,error:grantError}=await supabaseClient.rpc('grant_sellbook_email_action',{
      p_target_session_id:sessionId,
      p_action:pending.action,
      p_previous_session_id:pending.recovery?null:pending.previousSessionId
    });
    if(grantError)throw grantError;
    if(grant?.verified!==true||grant?.method!=='google')throw Error('Sellbook could not confirm the Google verification. Start again.');
    cloudUser=user;
    sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);
    if(pending.recovery){
      const {data:resetData,error:resetError}=await supabaseClient.rpc('reset_app_pin_after_reauth');
      if(resetError)throw resetError;
      if(resetData?.reset!==true)throw Error('Sellbook could not authorise the PIN recovery. Start again.');
      sessionStorage.removeItem('sellbook-pin-reset-after-auth');
      document.getElementById('accountManagePanel')?.classList.add('hidden');
      showSecurityPinGate('setup','Your Google account has been reverified. Create a new six-digit PIN to finish PIN recovery.');
      return;
    }
    if(pending.action==='change_pin'){
      // The fresh Google session is not yet PIN-verified. Require the current
      // PIN in this new session before exposing the change-PIN form.
      sessionStorage.setItem(SECURITY_PIN_CHANGE_AFTER_GOOGLE_KEY,sessionId);
      showSecurityPinGate('verify','Google verification is complete. Enter your current six-digit Sellbook PIN to unlock this sign-in, then choose your new PIN.');
      return;
    }
    await handleCloudAuthChange();
    showPage('settings-account');
      document.getElementById('accountManagePanel')?.classList.remove('hidden');
      document.getElementById('changeEmailForm')?.classList.remove('hidden');
      showToast('Google verification successful. Enter the new email address; Supabase will ask you to confirm it before it becomes active.','success');
      document.getElementById('newAccountEmail').focus();
  }catch(error){
    sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);
    if(pending.recovery)sessionStorage.removeItem('sellbook-pin-reset-after-auth');
    const {data}=await supabaseClient.auth.getSession().catch(()=>({data:null}));
    if(data?.session?.user?.id===pending.userId){
      cloudUser=data.session.user;
      await handleCloudAuthChange().catch(()=>{});
    }else{
      await supabaseClient.auth.signOut({scope:'local'}).catch(()=>{});
    }
    showToast('Google verification could not authorise this account change: '+(error.message||'Please try again.'),'error');
  }finally{
    securityOauthFinalizing=false;
  }
}
function schedulePendingGoogleSecurityReauth(){
  if(securityOauthFinalizeScheduled||securityOauthFinalizing)return;
  securityOauthFinalizeScheduled=true;
  setTimeout(()=>completePendingGoogleSecurityReauth(),0);
}

function decodeSellbookJwtPayload(token){
  try{
    const encoded=String(token||'').split('.')[1];
    if(!encoded)throw Error('missing token payload');
    const base64=encoded.replace(/-/g,'+').replace(/_/g,'/');
    const padded=base64+'='.repeat((4-base64.length%4)%4);
    const binary=atob(padded);
    const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(_){throw Error('Sellbook could not validate the active sign-in session. Sign in again and retry.');}
}
async function getSellbookAccountSession(){
  if(!supabaseClient)throw Error('Account service is unavailable.');
  const {data,error}=await supabaseClient.auth.getSession();
  if(error)throw error;
  const session=data?.session,user=session?.user;
  if(!session||!user||!cloudUser||user.id!==cloudUser.id)throw Error('Your Sellbook sign-in session has changed. Sign in again and retry.');
  const claims=decodeSellbookJwtPayload(session.access_token);
  if(claims.sub!==user.id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(claims.session_id||'')))throw Error('Sellbook could not validate the active sign-in session. Sign in again and retry.');
  return {session,user,sessionId:claims.session_id};
}
function createAccountStepUpClient(){
  const memory=new Map();
  const storage={
    getItem:key=>memory.has(key)?memory.get(key):null,
    setItem:(key,value)=>memory.set(key,value),
    removeItem:key=>memory.delete(key)
  };
  return window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
    auth:{
      storage,
      storageKey:'sellbook-account-step-up-'+crypto.randomUUID(),
      persistSession:true,
      autoRefreshToken:false,
      detectSessionInUrl:false,
      flowType:'pkce'
    }
  });
}
async function requestAccountActionEmailOtp(action){
  if(accountEmailOtpBusy)return;
  if(!['change_pin','change_email'].includes(action))throw Error('This account action is not supported.');
  if(!navigator.onLine)throw Error('Connect to the internet before requesting an email verification code.');
  accountEmailOtpBusy=true;
  let otpClient=null;
  try{
    const current=await getSellbookAccountSession();
    const email=String(current.user.email||'').trim();
    if(!email)throw Error('This account does not have a registered email address. Add and verify an email before continuing.');
    if(!current.user.email_confirmed_at)throw Error('Your registered email is not verified. Confirm it before requesting a sensitive account change.');
    const linkedProviders=new Set([
      ...(Array.isArray(current.user.app_metadata?.providers)?current.user.app_metadata.providers:[]),
      ...(Array.isArray(current.user.identities)?current.user.identities.map(identity=>identity?.provider):[])
    ].filter(Boolean));
    if(!linkedProviders.has('email')){
      if(!linkedProviders.has('google'))throw Error('This account needs a verified email sign-in method before sensitive account changes can be made.');
      await beginGoogleSecurityReauth(action,current);
      return;
    }
    if(accountEmailOtpState?.client){try{await accountEmailOtpState.client.auth.signOut({scope:'local'});}catch(_){}}
    otpClient=createAccountStepUpClient();
    const {error}=await otpClient.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
    if(error)throw error;
    startAccountOtpResendCooldown(60);
    accountEmailOtpState={action,client:otpClient,userId:current.user.id,email,targetSessionId:current.sessionId};
    document.getElementById('accountManagePanel').classList.add('hidden');
    document.getElementById('changeEmailForm')?.classList.add('hidden');
    document.getElementById('accountEmailOtpPanel').showModal();
    document.getElementById('accountEmailOtpTitle').textContent=action==='change_pin'?'Verify email to change your PIN':'Verify your current email address';
    document.getElementById('accountEmailOtpDescription').textContent='Enter the six-digit verification code sent to '+email+'. The code is required before Sellbook allows this account change.';
    document.getElementById('accountEmailOtp').value='';
    document.getElementById('accountEmailOtpMessage').textContent='Verification code sent. Check your inbox and spam folder.';
    document.getElementById('accountEmailOtp').focus();
  }catch(error){
    if(otpClient){try{await otpClient.auth.signOut({scope:'local'});}catch(_){}}
    throw error;
  }finally{accountEmailOtpBusy=false;}
}

function startAccountOtpResendCooldown(seconds=60){
  if(accountOtpResendTimer)clearInterval(accountOtpResendTimer);
  const button=document.getElementById('resendAccountEmailOtpButton');
  if(!button)return;
  let remaining=Math.max(1,Math.floor(seconds));
  button.disabled=true;
  button.textContent='Resend in '+remaining+'s';
  accountOtpResendTimer=setInterval(()=>{
    remaining-=1;
    if(!document.getElementById('accountEmailOtpPanel')?.open||remaining<=0){
      clearInterval(accountOtpResendTimer);accountOtpResendTimer=null;
      button.disabled=false;button.textContent='Resend code';
      return;
    }
    button.textContent='Resend in '+remaining+'s';
  },1000);
}
function clearAccountEmailOtp(){
  const pending=accountEmailOtpState;accountEmailOtpState=null;
  if(pending?.client)pending.client.auth.signOut({scope:'local'}).catch(()=>{});
  document.getElementById('accountEmailOtpPanel')?.close();
  if(accountOtpResendTimer){clearInterval(accountOtpResendTimer);accountOtpResendTimer=null;}
  const resendButton=document.getElementById('resendAccountEmailOtpButton');if(resendButton){resendButton.disabled=false;resendButton.textContent='Resend code';}
  document.getElementById('accountManagePanel')?.classList.remove('hidden');
  const code=document.getElementById('accountEmailOtp');if(code)code.value='';
  if(sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes')showSecurityPinGate('verify','Email verification is required before Sellbook can reset your PIN.');
}
document.getElementById('changeEmailVerifyButton')?.addEventListener('click',async()=>{
  const button=document.getElementById('changeEmailVerifyButton');
  button.disabled=true;button.textContent='Sending verification code…';
  try{await requestAccountActionEmailOtp('change_email');}
  catch(error){showToast('Could not send the verification code: '+(error.message||'Please try again.'),'error');}
  finally{button.disabled=false;button.textContent='Verify current email';}
});
document.getElementById('changeSecurityPinButton')?.addEventListener('click',async()=>{
  const button=document.getElementById('changeSecurityPinButton');
  button.disabled=true;button.textContent='Sending verification code…';
  try{await requestAccountActionEmailOtp('change_pin');}
  catch(error){showToast('Could not send the verification code: '+(error.message||'Please try again.'),'error');}
  finally{button.disabled=false;button.textContent='Verify email and change PIN';}
});
document.getElementById('resendAccountEmailOtpButton')?.addEventListener('click',async()=>{
  const state=accountEmailOtpState,button=document.getElementById('resendAccountEmailOtpButton'),message=document.getElementById('accountEmailOtpMessage');
  if(!state||accountEmailOtpBusy)return;
  accountEmailOtpBusy=true;button.disabled=true;button.textContent='Sending…';message.textContent='Requesting another code…';
  try{
    const current=await getSellbookAccountSession();
    if(current.user.id!==state.userId||current.sessionId!==state.targetSessionId)throw Error('Your Sellbook session changed. Cancel and start verification again.');
    const {error}=await state.client.auth.signInWithOtp({email:state.email,options:{shouldCreateUser:false}});
    if(error)throw error;
    startAccountOtpResendCooldown(60);
    document.getElementById('accountEmailOtp').value='';message.textContent='A new verification code has been sent. Use the latest code.';
  }catch(error){message.textContent='Could not resend the code: '+(error.message||'Please try again.');}
  finally{accountEmailOtpBusy=false;if(!accountOtpResendTimer){button.disabled=false;button.textContent='Resend code';}}
});
document.getElementById('cancelAccountEmailOtpButton')?.addEventListener('click',clearAccountEmailOtp);
document.getElementById('accountEmailOtpPanel')?.addEventListener('cancel',()=>{
  const pending=accountEmailOtpState;accountEmailOtpState=null;
  if(pending?.client)pending.client.auth.signOut({scope:'local'}).catch(()=>{});
  if(sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes')showSecurityPinGate('verify','Email verification is required before Sellbook can reset your PIN.');
});
document.getElementById('accountEmailOtp')?.addEventListener('input',event=>{
  event.target.value=Array.from(event.target.value).filter(ch=>ch>='0'&&ch<='9').slice(0,6).join('');
});
document.getElementById('accountEmailOtpForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const state=accountEmailOtpState,token=document.getElementById('accountEmailOtp').value.trim();
  const message=document.getElementById('accountEmailOtpMessage'),button=document.getElementById('verifyAccountEmailOtpButton');
  if(!state){message.textContent='Start email verification again before entering a code.';return;}
  if(!/^[0-9]{6}$/.test(token)){message.textContent='Enter the six-digit code from your email.';return;}
  if(accountEmailOtpBusy)return;
  accountEmailOtpBusy=true;button.disabled=true;button.textContent='Verifying…';message.textContent='Verifying your email code securely…';
  try{
    const {data,error}=await state.client.auth.verifyOtp({email:state.email,token,type:'email'});
    if(error)throw error;
    const verifiedUser=data?.user||data?.session?.user;
    if(!verifiedUser||verifiedUser.id!==state.userId)throw Error('The code did not verify the same Sellbook account. No account change was authorised.');
    const current=await getSellbookAccountSession();
    if(current.user.id!==state.userId||current.sessionId!==state.targetSessionId)throw Error('Your Sellbook sign-in session changed during verification. Cancel and start again.');
    const {data:grant,error:grantError}=await state.client.rpc('grant_sellbook_email_action',{p_target_session_id:state.targetSessionId,p_action:state.action,p_previous_session_id:state.action==='change_pin'&&sessionStorage.getItem('sellbook-pin-reset-after-auth')!=='yes'?state.targetSessionId:null});
    if(grantError)throw grantError;
    if(grant?.verified!==true)throw Error('Sellbook could not authorise this account change. Request a new code and retry.');
    const action=state.action,otpClient=state.client;accountEmailOtpState=null;
    document.getElementById('accountEmailOtpPanel').close();document.getElementById('accountEmailOtp').value='';
    if(action==='change_pin'&&sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes'){
      const {data:resetData,error:resetError}=await supabaseClient.rpc('reset_app_pin_after_reauth');
      if(resetError)throw resetError;
      if(resetData?.reset!==true)throw Error('Sellbook could not authorise the PIN reset. Start PIN recovery again.');
      sessionStorage.removeItem('sellbook-pin-reset-after-auth');
      document.getElementById('accountManagePanel').classList.add('hidden');
      showSecurityPinGate('setup','Your email address is verified. Create a new six-digit PIN to finish PIN recovery.');
    }else if(action==='change_pin'){
      document.getElementById('accountManagePanel').classList.add('hidden');
      showSecurityPinGate('change','Your email address has been verified. Enter a new six-digit PIN twice to complete the change.');
    }else{
      document.getElementById('accountManagePanel').classList.remove('hidden');
      document.getElementById('changeEmailForm').classList.remove('hidden');
      showToast('Email verified. Enter the new address; Supabase will ask you to confirm it before it becomes active.','success');
      document.getElementById('newAccountEmail').focus();
    }
    otpClient.auth.signOut({scope:'local'}).catch(()=>{});
  }catch(error){
    const failure='Email verification failed: '+(error.message||'Check the code and try again.');
    if(sessionStorage.getItem('sellbook-pin-reset-after-auth')==='yes'){
      showSecurityPinGate('verify','Your email code was accepted, but the PIN reset did not finish. Please restart PIN recovery and verify your email again.');
      document.getElementById('securityPinMessage').textContent=failure;
    }else{
      message.textContent=failure;
    }
  }finally{accountEmailOtpBusy=false;button.disabled=false;button.textContent='Verify code';}
});
document.getElementById('cancelChangeEmailButton')?.addEventListener('click',()=>{
  document.getElementById('changeEmailForm')?.classList.add('hidden');
  document.getElementById('changeEmailForm')?.reset();
});

async function refreshAccountStatus(){
  const status=document.getElementById('accountStatus');
  const signIn=document.getElementById('googleSignIn');
  const emailEntry=document.getElementById('openEmailSignIn');
  const signOut=document.getElementById('googleSignOut');
  if(!supabaseClient){
    status.textContent='Account service is unavailable. Check your connection and try again.';
    signIn.disabled=true;
    if(emailEntry)emailEntry.disabled=true;
    return;
  }
  let data,error;
  try{({data,error}=await supabaseClient.auth.getSession());}
  catch(sessionError){
    status.textContent='Could not check your sign-in status. Check your connection and try again.';
    cloudMessage('Sellbook could not verify your secure sign-in. Your saved records have not been changed.');
    document.getElementById('appWorkspace').classList.add('hidden');
    console.warn('Supabase session check failed:',sessionError);
    return;
  }
  if(error){
    status.textContent='Could not check your sign-in status. Check your connection and try again.';
    cloudMessage('Sellbook could not verify your secure sign-in. Your saved records have not been changed.');
    document.getElementById('appWorkspace').classList.add('hidden');
    console.warn('Supabase session check returned an error:',error);
    return;
  }
  const user=data.session?.user||null;
  const registeredEmail=document.getElementById('accountEmailAddress');
  const emailVerifyButton=document.getElementById('changeEmailVerifyButton');
  const pinChangeButton=document.getElementById('changeSecurityPinButton');
  if(registeredEmail)registeredEmail.textContent=user?(String(user.email||'No email address')+' · '+(user.email_confirmed_at?'Verified':'Not verified')):'Not signed in.';
  if(emailVerifyButton)emailVerifyButton.disabled=!user||!user.email_confirmed_at;
  if(pinChangeButton)pinChangeButton.disabled=!user||!user.email_confirmed_at;
  status.textContent=user?'Signed in as '+(user.email||'your account')+'.':(!navigator.onLine?'Connect to the internet to sign in or create an account.':'Choose how you would like to sign in to your private business records.');
  signIn.classList.toggle('hidden',!!user);
  if(emailEntry)emailEntry.classList.toggle('hidden',!!user);
  if(signOut)signOut.classList.toggle('hidden',!user);
  document.getElementById('authSignInChoices').classList.toggle('hidden',!!user||authScreenMode!=='choices');
  document.getElementById('emailAuthPanel').classList.toggle('hidden',!!user||authScreenMode!=='email');
  document.getElementById('accountRecoveryRequestForm').classList.toggle('hidden',!!user||authScreenMode!=='recovery');
  document.getElementById('accountManagePanel').classList.toggle('hidden',!user);
  document.getElementById('securityPinGate')?.classList.toggle('hidden',!securityPinGateVisible);
  document.getElementById('accountCard').classList.toggle('hidden',!!user&&(securityPinGateVisible||(workspaceReady&&!recoveryMode)));
  document.getElementById('settingsAccountStatus').textContent=user?'Signed in as '+(user.email||'your account')+'.':'Not signed in.';
  document.getElementById('settingsAccountMessage').textContent=document.getElementById('accountMessage').textContent||'';
  if(recoveryMode){
    setAuthScreen('new-password');
    document.getElementById('accountManagePanel').classList.add('hidden');
    document.getElementById('appWorkspace').classList.add('hidden');
  }else if(user)document.getElementById('recoveryPasswordForm').classList.add('hidden');
  const importButton=document.getElementById('importLocalRecordsBtn');
  const hasLocal=!!(localSnapshot&&(localSnapshot.products.length||localSnapshot.sales.length||localSnapshot.expenses.length));
  const importOwner=localStorage.getItem('my-sales-book-legacy-import-owner-v1');
  const alreadyImported=user&&(localStorage.getItem('my-sales-book-imported-v1:'+user.id)==='yes'||(importOwner&&importOwner!==user.id));
  importButton.classList.toggle('hidden',!user||!hasLocal||alreadyImported);
  document.getElementById('appWorkspace').classList.toggle('hidden',!user||!workspaceReady||securityPinGateVisible||recoveryMode);
  document.getElementById('securityPinGate')?.classList.toggle('hidden',!securityPinGateVisible);
  document.getElementById('accountCard').classList.toggle('hidden',!!user&&(securityPinGateVisible||(workspaceReady&&!recoveryMode)));
  if(user&&workspaceReady){
    document.getElementById('settingsAccountStatus').textContent='Signed in as '+(user.email||'your account')+'.';
    document.getElementById('settingsAccountMessage').textContent=document.getElementById('accountMessage').textContent||'';
  }
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


document.getElementById('openEmailSignIn').addEventListener('click',()=>{
  if(!supabaseClient)return cloudMessage('Account service is unavailable right now. Check your connection and try again.');
  emailAuthMode='signin';
  document.getElementById('emailAuthForm').reset();
  document.getElementById('authPasswordConfirmField').classList.add('hidden');
  document.getElementById('authPasswordConfirm').disabled=true;
  document.getElementById('authPasswordConfirm').required=false;
  document.getElementById('authPassword').autocomplete='current-password';
  document.getElementById('authPasswordHint').textContent='Enter your account password.';
  document.getElementById('toggleEmailAuth').textContent='New to Sellbook? Create an account';
  setAuthScreen('email');
  cloudMessage('');
  document.getElementById('authEmail').focus();
});
document.getElementById('backToAuthOptions').addEventListener('click',()=>{
  document.getElementById('emailAuthForm').reset();
  emailAuthMode='signin';setAuthScreen('choices');cloudMessage('');
});
document.getElementById('toggleEmailAuth').addEventListener('click',()=>{
  emailAuthMode=emailAuthMode==='signin'?'signup':'signin';
  const confirmWrap=document.getElementById('authPasswordConfirmField');
  const confirmInput=document.getElementById('authPasswordConfirm');
  confirmWrap.classList.toggle('hidden',emailAuthMode!=='signup');
  confirmInput.disabled=emailAuthMode!=='signup';
  confirmInput.required=emailAuthMode==='signup';
  if(emailAuthMode!=='signup')confirmInput.value='';
  document.getElementById('authPassword').autocomplete=emailAuthMode==='signup'?'new-password':'current-password';
  document.getElementById('authPasswordHint').textContent=emailAuthMode==='signup'
    ?'At least 8 characters, including uppercase and lowercase letters, a number and a symbol.'
    :'Enter your account password.';
  document.getElementById('authCardTitle').textContent=emailAuthMode==='signup'?'Create your account':'Sign in with email';
  document.getElementById('emailAuthSubmit').textContent=emailAuthMode==='signup'?'Create account':'Sign in with email';
  document.getElementById('toggleEmailAuth').textContent=emailAuthMode==='signup'?'Already have an account? Sign in':'New to Sellbook? Create an account';
  document.getElementById('emailAuthHeading').textContent=emailAuthMode==='signup'?'Create your Sellbook account':'Sign in with email';
  document.getElementById('emailAuthDescription').textContent=emailAuthMode==='signup'
    ?'Use an email address you can access. We’ll ask you to confirm it before your first sign-in.'
    :'Use the email address and password linked to your Sellbook account.';
  document.getElementById('resendConfirmationBtn').classList.add('hidden');
  cloudMessage(emailAuthMode==='signup'?'Create an account with a strong password. Email confirmation is required before the first sign-in.':'Sign in to access your private business records.');
});
document.getElementById('emailAuthForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(emailAuthInProgress)return;
  if(!supabaseClient)return cloudMessage('Account service is unavailable. Check your internet connection.');
  const emailInput=document.getElementById('authEmail'),passwordInput=document.getElementById('authPassword');
  const confirmInput=document.getElementById('authPasswordConfirm'),submit=document.getElementById('emailAuthSubmit');
  const email=emailInput.value.trim().toLowerCase(),password=passwordInput.value;
  if(!emailInput.checkValidity()){emailInput.reportValidity();return;}
  if(!password){passwordInput.reportValidity();return;}
  if(!navigator.onLine)return cloudMessage('Internet is required for email sign-in and account creation. Connect and try again.');
  if(emailAuthMode==='signup'){
    const policyError=passwordPolicyError(password);
    if(policyError){cloudMessage(policyError);passwordInput.focus();return;}
    if(password!==confirmInput.value){cloudMessage('The passwords do not match. Check both fields and try again.');confirmInput.focus();return;}
  }
  emailAuthInProgress=true;submit.disabled=true;submit.setAttribute('aria-busy','true');
  submit.textContent=emailAuthMode==='signup'?'Creating account…':'Signing in…';
  document.getElementById('toggleEmailAuth').disabled=true;
  document.getElementById('backToAuthOptions').disabled=true;
  document.getElementById('resendConfirmationBtn').classList.add('hidden');
  try{
    if(emailAuthMode==='signup'){
      cloudMessage('Creating your Sellbook account securely…');
      const {data,error}=await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname+window.location.search}});
      if(error)throw error;
      if(!data.user||(Array.isArray(data.user.identities)&&data.user.identities.length===0)){
        confirmationEmail=email;emailInput.value=email;
        cloudMessage('If this address can be registered, a confirmation email will be sent. Try signing in if you already have an account.');
        return;
      }
      if(!data.session){
        confirmationEmail=email;emailInput.value=email;passwordInput.value='';confirmInput.value='';
        document.getElementById('resendConfirmationBtn').classList.remove('hidden');
        cloudMessage('Your account has been created. Confirm your email using the link we sent, then return here to sign in. Check your spam folder too.');
        return;
      }
      cloudMessage('Account created. Opening your protected business records…');
      await handleCloudAuthChange();
    }else{
      cloudMessage('Signing in securely…');
      const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(!data.session?.user)throw new Error('The account service did not return a valid sign-in session. Please try again.');
      confirmationEmail='';
      cloudMessage('Signed in. Checking your Sellbook security PIN…');
      await handleCloudAuthChange();
    }
  }catch(error){
    console.warn('Sellbook email authentication failed:',error);
    const code=String(error?.code||'').toLowerCase();
    if(code.includes('email_not_confirmed')||String(error?.message||'').toLowerCase().includes('email not confirmed')){
      confirmationEmail=email;emailInput.value=email;
      document.getElementById('resendConfirmationBtn').classList.remove('hidden');
    }
    cloudMessage(friendlyAuthError(error));
  }finally{
    emailAuthInProgress=false;submit.disabled=false;submit.removeAttribute('aria-busy');
    submit.textContent=emailAuthMode==='signup'?'Create account':'Sign in with email';
    document.getElementById('toggleEmailAuth').disabled=false;
    document.getElementById('backToAuthOptions').disabled=false;
  }
});
document.getElementById('resendConfirmationBtn').addEventListener('click',async()=>{
  const email=(confirmationEmail||document.getElementById('authEmail').value).trim().toLowerCase();
  const button=document.getElementById('resendConfirmationBtn');
  if(!email){cloudMessage('Enter the email address you used to create your account first.');document.getElementById('authEmail').focus();return;}
  if(!navigator.onLine)return cloudMessage('Connect to the internet before requesting another confirmation email.');
  if(!supabaseClient)return cloudMessage('Account service is unavailable right now. Try again later.');
  button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Sending…';
  try{
    const {error}=await supabaseClient.auth.resend({type:'signup',email,options:{emailRedirectTo:window.location.origin+window.location.pathname+window.location.search}});
    if(error)throw error;
    cloudMessage('If this account still needs confirmation, a new email has been requested. Check your inbox and spam folder.');
  }catch(error){cloudMessage(friendlyAuthError(error));}
  finally{button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Resend confirmation email';}
});

// Password recovery is a distinct state on the full authentication page.
const accountRecoveryRequestForm = document.getElementById('accountRecoveryRequestForm');
const openPasswordRecoveryButton = document.getElementById('openPasswordRecovery');
const cancelPasswordRecoveryButton = document.getElementById('cancelPasswordRecovery');
let recoveryReturnScreen = 'choices';
function openRecoveryScreen(){
  if(!supabaseClient){cloudMessage('Account recovery is unavailable right now. Check your connection and try again.');return;}
  recoveryReturnScreen=authScreenMode==='email'?'email':'choices';
  document.getElementById('recoveryEmail').value=document.getElementById('authEmail').value.trim();
  setAuthScreen('recovery');cloudMessage('');document.getElementById('recoveryEmail').focus();
}
openPasswordRecoveryButton?.addEventListener('click',openRecoveryScreen);
document.getElementById('emailPasswordRecovery')?.addEventListener('click',openRecoveryScreen);
cancelPasswordRecoveryButton?.addEventListener('click',()=>{
  accountRecoveryRequestForm.classList.add('hidden');document.getElementById('recoveryEmail').value='';
  setAuthScreen(recoveryReturnScreen);cloudMessage('');
});

accountRecoveryRequestForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const emailInput = document.getElementById('recoveryEmail');
  const submit = document.getElementById('recoveryEmailSubmit');
  const email = emailInput.value.trim();
  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }
  if (!navigator.onLine) {
    cloudMessage('Connect to the internet before requesting a recovery link.');
    return;
  }
  if (!supabaseClient) {
    cloudMessage('Account recovery is unavailable right now. Check your connection and try again.');
    return;
  }
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  submit.textContent = 'Sending recovery link…';
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + window.location.search
    });
    if (error) throw error;
    cloudMessage('If an account matches that email address, a recovery link will be sent. Check your inbox and spam folder.');
  } catch (error) {
    console.warn('Sellbook password recovery request failed:', error);
    cloudMessage('We could not send the recovery request. Check your connection and try again.');
  } finally {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    submit.textContent = 'Send recovery link';
  }
});

// Password-reset requests are handled by the dedicated recovery page above.
document.getElementById('recoveryPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('recoveryPassword').value;
  const policyError = passwordPolicyError(password);
  if (policyError) { cloudMessage(policyError); document.getElementById('recoveryPassword').focus(); return; }
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    recoveryMode = false;
    setAuthScreen('choices');
    document.getElementById('recoveryPasswordForm').classList.add('hidden');
    document.getElementById('recoveryPasswordForm').reset();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    cloudMessage('Password updated. You can continue using your account.');
    await handleCloudAuthChange();
  } catch (error) {
    cloudMessage('Could not update password: ' + (error.message || String(error)));
  }
});

async function finishVerifiedAccountDeletion(user){
  if(!pendingDeleteAccountUserId||pendingDeleteAccountUserId!==user.id)throw Error('The account selected for deletion changed. Start again.');
  const buckets=['marketplace-product-images','product-images'];
  const pathsByBucket={};
  for(const bucket of buckets){
    const paths=[];let offset=0;
    for(let page=0;page<100;page++){
      const {data:files,error:listError}=await supabaseClient.storage.from(bucket).list(user.id,{limit:1000,offset,sortBy:{column:'name',order:'asc'}});
      if(listError)throw Error('Could not list your '+bucket+' files. Your account records have not been deleted.');
      const pageFiles=files||[];
      paths.push(...pageFiles.filter(file=>file?.id&&file?.name).map(file=>user.id+'/'+file.name));
      if(pageFiles.length<1000)break;
      offset+=pageFiles.length;
      if(page===99)throw Error('This account has too many stored photos to safely finish deletion in one attempt. Contact Sellbook support.');
    }
    pathsByBucket[bucket]=paths;
  }
  for(const bucket of buckets){
    const paths=pathsByBucket[bucket];
    for(let offset=0;offset<paths.length;offset+=100){
      const {error:removeError}=await supabaseClient.storage.from(bucket).remove(paths.slice(offset,offset+100));
      if(removeError)throw Error('Could not finish removing your '+bucket+' files. Your account and business records remain, but some photos may already have been removed. Retry deletion or contact Sellbook support.');
    }
  }
  const latest=await requireCloudUser();
  if(latest.id!==user.id)throw Error('Your signed-in account changed. No account records were deleted.');
  const {error}=await supabaseClient.rpc('delete_my_account');
  if(error)throw error;
  localStorage.removeItem(cloudCacheKey(user.id));localStorage.removeItem(cloudQueueKey(user.id));
  localStorage.removeItem('my-sales-book-imported-v1:'+user.id);
  cloudUser=null;cloudReady=false;workspaceReady=false;pendingDeleteAccountUserId=null;
  document.getElementById('deleteAccountPinDialog')?.close();
  await supabaseClient.auth.signOut({scope:'local'}).catch(()=>{});
  document.getElementById('appWorkspace').classList.add('hidden');
  await refreshAccountStatus();
  cloudMessage('Account and cloud business records were deleted. Any separate local-device backup was not deleted.');
}
document.getElementById('deleteAccountBtn').addEventListener('click',async()=>{
  const first=prompt('Deleting your account permanently deletes your cloud products, sales, expenses and product photos. This cannot be undone. Type DELETE to continue.');
  if(first!=='DELETE')return;
  if(!confirm('Final confirmation: permanently delete this account and all its cloud business records?'))return;
  try{
    if(!navigator.onLine)throw Error('Connect to the internet before deleting your account.');
    const user=await requireCloudUser();
    const pending=readQueue(user.id).filter(item=>item.status!=='synced');
    if(pending.length&&!confirm('There are '+pending.length+' unsynchronised change(s). Deleting the account will also remove this account\'s local cache and pending queue. Continue?'))return;
    pendingDeleteAccountUserId=user.id;
    document.getElementById('deleteAccountPinForm').reset();
    document.getElementById('deleteAccountPinMessage').textContent='Enter your PIN. Five incorrect attempts will temporarily lock PIN verification.';
    document.getElementById('deleteAccountPinDialog').showModal();
    setTimeout(()=>document.getElementById('deleteAccountPinInput').focus(),40);
  }catch(error){cloudMessage('Could not start account deletion: '+(error.message||'Please try again.'));}
});
document.getElementById('deleteAccountPinInput')?.addEventListener('input',event=>{
  event.target.value=Array.from(event.target.value).filter(ch=>ch>='0'&&ch<='9').slice(0,6).join('');
});
document.getElementById('cancelDeleteAccountPin')?.addEventListener('click',()=>{
  pendingDeleteAccountUserId=null;document.getElementById('deleteAccountPinDialog')?.close();
});
document.getElementById('deleteAccountPinForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const status=document.getElementById('deleteAccountPinMessage'),button=document.getElementById('confirmDeleteAccountPin');
  const pin=document.getElementById('deleteAccountPinInput').value;
  if(!/^[0-9]{6}$/.test(pin)){status.textContent='Enter exactly six digits.';return;}
  if(!pendingDeleteAccountUserId){status.textContent='Start account deletion again before confirming your PIN.';return;}
  if(!navigator.onLine){status.textContent='Connect to the internet before verifying your PIN.';return;}
  button.disabled=true;button.textContent='Verifying PIN…';status.textContent='Checking your PIN securely…';
  try{
    const user=await requireCloudUser();
    if(user.id!==pendingDeleteAccountUserId)throw Error('Your signed-in account changed. Cancel and start again.');
    const {data,error}=await supabaseClient.rpc('verify_app_pin_for_account_deletion',{p_pin:pin});
    if(error)throw error;
    if(data?.requires_setup===true)throw Error('Create a six-digit Sellbook PIN before deleting your account.');
    if(data?.verified!==true){
      const attempts=Number.isFinite(Number(data?.attempts_remaining))?' Attempts remaining: '+data.attempts_remaining+'.':'';
      const locked=data?.locked_until?' PIN verification is locked until '+new Date(data.locked_until).toLocaleTimeString()+'.':'';
      status.textContent=(data?.message||'The PIN is incorrect.')+attempts+locked;
      document.getElementById('deleteAccountPinInput').value='';return;
    }
    status.textContent='PIN confirmed. Removing your cloud records securely…';button.textContent='Deleting account…';
    await finishVerifiedAccountDeletion(user);
  }catch(error){
    status.textContent='Account deletion could not be completed: '+(error.message||'Please try again.');
    console.error('Sellbook account deletion failed:',error);
  }finally{
    button.disabled=false;button.textContent='Verify PIN and delete';
    if(document.getElementById('deleteAccountPinDialog')?.open)document.getElementById('deleteAccountPinInput').value='';
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

document.getElementById('changeEmailForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!supabaseClient)return cloudMessage('Account service is unavailable.');
  const email=document.getElementById('newAccountEmail').value.trim();
  const button=document.querySelector('#changeEmailForm button[type="submit"]');
  try{
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid new email address.');
    const current=await getSellbookAccountSession();
    if(email.toLowerCase()===String(current.user.email||'').toLowerCase())throw Error('Enter an email address different from your current address.');
    button.disabled=true;button.textContent='Requesting change…';
    const {data:grant,error:grantError}=await supabaseClient.rpc('consume_sellbook_email_action',{p_action:'change_email'});
    if(grantError)throw grantError;
    if(grant?.verified!==true)throw Error('Verify your current email address before requesting an email change.');
    const {error}=await supabaseClient.auth.updateUser({email});
    if(error)throw error;
    document.getElementById('changeEmailForm').reset();
    document.getElementById('changeEmailForm').classList.add('hidden');
    document.getElementById('settingsAccountMessage').textContent='Email change requested. Follow the confirmation instructions sent by Supabase. The new address is not active until the required confirmation is completed.';
  }catch(error){
    document.getElementById('settingsAccountMessage').textContent='Could not request an email change: '+(error.message||'Please try again. Verify your current email again if the code has expired.');
  }finally{if(button){button.disabled=false;button.textContent='Request email change';}}
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
let adminAccessEpoch=0;
function adminRequestIsCurrent(userId,epoch){
 return !!sellbookIsAdmin &&
   !!userId &&
   cloudUser?.id===userId &&
   adminAccessEpoch===epoch;
}
function escAdmin(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setAdminAccess(isAdmin){
 const next=!!isAdmin;
 // Invalidate all in-flight admin reads/writes when access is removed or changes.
 if(sellbookIsAdmin!==next||!next)adminAccessEpoch++;
 sellbookIsAdmin=next;
 if(!sellbookIsAdmin){
  adminUsersCache=[];
  adminConversationRequestId++;
  adminConversationLoading=false;
 }
 document.body.classList.toggle('admin-mode',sellbookIsAdmin);
 document.getElementById('adminMenuTile')?.classList.toggle('hidden',!sellbookIsAdmin);
 if(sellbookIsAdmin&&currentPage()!=='admin'&&currentPage()!=='support')showPage('admin');
 if(!sellbookIsAdmin&&currentPage()==='admin')showPage('home');
}
function clearAccountScopedUiState(){
 accountSessionEpoch++;
 pendingSync=[];
 setAdminAccess(false);
 setUnreadBadge('notificationBadge',0);
 setUnreadBadge('messageBadge',0);
 marketplaceActivityBusy=false;
 marketplaceActivityRequestId++;
 marketplaceSubscribersCache=[];
 marketplaceSelectedBuyerId=null;
 marketplaceReservationsCache=[];
 marketplaceSelectedReservationId=null;
 adminUsersCache=[];
 userNotificationsCache=[];
 messengerSelectedConversation=null;
 messengerConversationCache=[];
 messengerConversationRequestId++;
 adminConversationLoading=false;
 document.body.classList.remove('messenger-conversation-open','admin-conversation-open');
 document.getElementById('messengerSubscriberPicker')?.classList.add('hidden');
 const resetPanels=[
  ['recentConversationList','Sign in to view conversations.'],
  ['userNotificationsList','Sign in to view notifications.'],
  ['userSupportMessages','Sign in to view support messages.'],
  ['userFeedbackList','Sign in to view feedback.'],
  ['marketplaceSubscriberList','Sign in to view subscribers.'],
  ['marketplaceReservationsList','Sign in to view reservations.'],
  ['reservationsPageList','Sign in to view reservations.'],
  ['subscribersPageList','Sign in to view subscribers.'],
  ['messengerConversationList','Sign in to use Messenger.'],
  ['messengerTranscript','Sign in to use Messenger.'],
  ['messengerSubscriberPickerList','Sign in to view subscribers.']
 ];
 resetPanels.forEach(([id,message])=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="empty">'+message+'</div>';});
 const messengerInput=document.getElementById('messengerBody');
 const messengerSend=document.querySelector('#messengerComposer button[type="submit"]');
 if(messengerInput){messengerInput.value='';messengerInput.disabled=true;}
 if(messengerSend)messengerSend.disabled=true;
}
function showAdminPanel(name){
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
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
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const chart=document.getElementById('adminTrafficChart');if(chart)chart.textContent='Loading traffic…';
 const {data,error}=await supabaseClient.rpc('sellbook_admin_platform_metrics');
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
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
 const expectedUserId=cloudUser?.id||null;
 if(!supabaseClient||!expectedUserId){setAdminAccess(false);return false;}
 try{
  const {data,error}=await supabaseClient.rpc('is_sellbook_admin');
  if(error)throw error;
  // Ignore a late response from the previous account after a fast sign-out
  // or account switch. Admin state belongs to one authenticated user only.
  if(cloudUser?.id!==expectedUserId)return false;
  const allowed=data===true;
  setAdminAccess(allowed);
  return allowed;
 }catch(e){
  if(cloudUser?.id===expectedUserId)setAdminAccess(false);
  return false;
 }
}
async function loadAdminDashboard(){
 const requestedUserId=cloudUser?.id||null;
 if(!requestedUserId||!await verifyAdminAccess()||cloudUser?.id!==requestedUserId)return;
 const requestEpoch=adminAccessEpoch;
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;

 const {data:overview,error}=await supabaseClient.rpc('sellbook_admin_overview');
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(error){cloudMessage('Admin dashboard could not load: '+error.message);return;}
 document.getElementById('adminTotalUsers').textContent=overview.total_users??'—';
 document.getElementById('adminNewUsers').textContent=overview.new_users_30d??'—';
 document.getElementById('adminOpenFeedback').textContent=overview.feedback_open??'—';
 document.getElementById('adminUnreadMessages').textContent=overview.messages_unread??'—';

 const {data:metrics,error:metricsError}=await supabaseClient.rpc('sellbook_admin_platform_metrics');
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(metricsError){document.getElementById('adminPlatformProducts').textContent='—';document.getElementById('adminPlatformSales').textContent='—';document.getElementById('adminPlatformSalesValue').textContent='Unavailable';}
 else{document.getElementById('adminPlatformProducts').textContent=metrics.total_products??0;document.getElementById('adminPlatformSales').textContent=metrics.total_sales??0;document.getElementById('adminPlatformSalesValue').textContent=formatAdminNaira(metrics.sales_value);}
 document.querySelectorAll('[data-open-page="settings-buybook"]').forEach(el=>{
  if(el.dataset.sellbookConnectionListener==='yes')return;
  el.dataset.sellbookConnectionListener='yes';
  el.addEventListener('click',()=>loadBuybookConnection());
 });
 if(adminRequestIsCurrent(requestedUserId,requestEpoch))showAdminPanel(sessionStorage.getItem('sellbook-admin-panel')||'overview');
}
async function loadAdminUsers(){
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const target=document.getElementById('adminUsersList');if(target)target.textContent='Loading users…';
 const list=document.getElementById('adminChatUserList');if(list)list.innerHTML='<div class="empty">Loading chats…</div>';
 const {data,error}=await supabaseClient.rpc('sellbook_admin_users');
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(error){if(target)target.textContent='Could not load users: '+error.message;if(list)list.innerHTML='<div class="empty">Could not load chats: '+escAdmin(error.message)+'</div>';return;}
 const rowsForUser=(data||[]).filter(u=>u.user_id!==requestedUserId);
 const opts='<option value="">Choose a user</option>'+rowsForUser.map(u=>'<option value="'+escAdmin(u.user_id)+'">'+escAdmin(u.email||'No email')+'</option>').join('');
 const chatSelect=document.getElementById('adminMessageUser'),previousUser=chatSelect.value;
 chatSelect.innerHTML=opts;
 document.getElementById('notificationUser').innerHTML=opts;
 if(target)target.innerHTML=rowsForUser.length?rowsForUser.map(u=>'<div class="item"><strong>'+escAdmin(u.email||'No email')+'</strong><div class="muted">Joined '+escAdmin(u.created_at?new Date(u.created_at).toLocaleDateString():'unknown')+' · Last sign-in '+escAdmin(u.last_sign_in_at?new Date(u.last_sign_in_at).toLocaleDateString():'not available')+'</div></div>').join(''):'<div class="empty">No registered users found.</div>';
 const {data:allMessages,error:msgError}=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').order('created_at',{ascending:false}).limit(1000);
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(msgError){if(list)list.innerHTML='<div class="empty">Could not load chat previews: '+escAdmin(msgError.message)+'</div>';return;}
 const msgs=allMessages||[];
 const rows=rowsForUser.map(u=>{const convo=msgs.filter(m=>(m.sender_id===u.user_id)||(m.recipient_id===u.user_id));const latest=convo[0]||null;const unread=convo.filter(m=>m.sender_id===u.user_id&&!m.read_at).length;return {...u,latest,unread};}).sort((x,y)=>new Date(y.latest?.created_at||y.created_at||0)-new Date(x.latest?.created_at||x.created_at||0));
 adminUsersCache=rowsForUser;
 if(list)list.innerHTML=rows.length?rows.map(u=>'<button type="button" class="admin-chat-user-row" data-chat-user="'+escAdmin(u.user_id)+'"><span class="chat-support-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><span class="admin-chat-user-meta"><strong>'+escAdmin(u.email||'Sellbook user')+'</strong><span class="muted admin-chat-preview">'+escAdmin(u.latest?.body||'No messages yet')+'</span><span class="muted">'+escAdmin(u.latest?new Date(u.latest.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'No conversation yet')+'</span></span>'+(u.unread?'<span class="admin-chat-unread" aria-label="'+u.unread+' unread messages">'+u.unread+'</span>':'')+'<span class="admin-chat-arrow" aria-hidden="true">›</span></button>').join(''):'<div class="empty">No registered users found.</div>';
 if(list)list.querySelectorAll('[data-chat-user]').forEach(btn=>btn.addEventListener('click',()=>openAdminConversation(btn.dataset.chatUser)));
 if(previousUser&&adminUsersCache.some(u=>u.user_id===previousUser))chatSelect.value=previousUser;
 if(adminRequestIsCurrent(requestedUserId,requestEpoch))await updateUnreadBadges();
}

async function loadAdminFeedback(){
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const target=document.getElementById('adminFeedbackList');target.textContent='Loading feedback…';
 const {data,error}=await supabaseClient.from('user_feedback').select('id,user_id,category,subject,message,status,admin_reply,created_at').order('created_at',{ascending:false}).limit(100);
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(error){target.textContent='Could not load feedback: '+error.message;return;}
 target.innerHTML=(data||[]).length?data.map(f=>'<div class="item"><div class="row"><strong>'+escAdmin(f.subject)+'</strong><span class="status-pill">'+escAdmin(f.status)+'</span></div><div class="muted">'+escAdmin(f.category)+' · '+escAdmin(f.user_id)+' · '+escAdmin(new Date(f.created_at).toLocaleString())+'</div><p>'+escAdmin(f.message)+'</p><label>Status</label><select data-feedback-status="'+escAdmin(f.id)+'"><option value="new" '+(f.status==='new'?'selected':'')+'>New</option><option value="in_review" '+(f.status==='in_review'?'selected':'')+'>In review</option><option value="resolved" '+(f.status==='resolved'?'selected':'')+'>Resolved</option><option value="declined" '+(f.status==='declined'?'selected':'')+'>Declined</option></select><label>Reply to user</label><textarea data-feedback-reply="'+escAdmin(f.id)+'" rows="2" maxlength="4000" style="width:100%;padding:10px;border:1px solid #ccd6ce;border-radius:8px;font:inherit">'+escAdmin(f.admin_reply||'')+'</textarea><button type="button" data-save-feedback="'+escAdmin(f.id)+'" style="margin-top:8px">Save / send reply</button></div>').join(''):'<div class="empty">No feedback has been submitted yet.</div>';
 target.querySelectorAll('[data-save-feedback]').forEach(b=>b.addEventListener('click',async()=>{
  if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
  const id=b.dataset.saveFeedback,status=target.querySelector('[data-feedback-status="'+id+'"]').value,reply=target.querySelector('[data-feedback-reply="'+id+'"]').value.trim();
  b.disabled=true;
  const {error}=await supabaseClient.from('user_feedback').update({status,admin_reply:reply||null,replied_at:reply?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',id);
  if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
  b.disabled=false;
  if(error){alert('Could not save feedback: '+error.message);return;}
  await loadAdminFeedback();
  if(cloudUser?.id===requestedUserId)await loadUserSupport();
 }));
}
async function loadAdminNotifications(){
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const target=document.getElementById('adminNotificationsList');
 const {data,error}=await supabaseClient.from('app_notifications').select('id,title,body,kind,recipient_id,created_at').order('created_at',{ascending:false}).limit(20);
 if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(error){target.textContent='Could not load notifications: '+error.message;return;}
 localStorage.setItem('sellbook-notifications-seen-'+requestedUserId,new Date().toISOString());
 target.innerHTML=(data||[]).length?data.map(n=>'<div class="item"><strong>'+escAdmin(n.title)+'</strong><div class="muted">'+escAdmin(n.kind)+' · '+(n.recipient_id?'Specific user':'All users')+' · '+escAdmin(new Date(n.created_at).toLocaleString())+'</div><p>'+escAdmin(n.body)+'</p></div>').join(''):'<div class="empty">No notifications published yet.</div>';
}
function updateBusinessDetailsPage(){
 const profile=getProfile();
 const businessName=String(profile.businessName||'').trim();
 const nameEl=document.getElementById('businessDetailsBusinessName');
 if(nameEl)nameEl.textContent=businessName||'Not set';

 const logo=document.getElementById('businessDetailsLogo');
 const avatar=document.getElementById('businessDetailsAvatar');
 const avatarIcon=avatar?.querySelector('svg');
 const logoUrl=String(profile.businessLogo||'').trim();
 if(logo&&avatarIcon){
  if(logoUrl){
   logo.src=logoUrl;
   logo.classList.remove('hidden');
   avatarIcon.classList.add('hidden');
  }else{
   logo.removeAttribute('src');
   logo.classList.add('hidden');
   avatarIcon.classList.remove('hidden');
  }
 }

 const email=document.getElementById('businessDetailsEmail');
 if(email)email.textContent=cloudUser?.email||'Not signed in';
 const registered=document.getElementById('businessDetailsRegistered');
 if(registered){
  const raw=cloudUser?.created_at||cloudUser?.createdAt;
  const date=raw?new Date(raw):null;
  registered.textContent=date&&!Number.isNaN(date.getTime())
   ?date.toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})
   :'Not available for this device';
 }
 const status=document.getElementById('businessDetailsStatus');
 if(status)status.textContent=cloudUser?'Registered account':'Device profile';
}
function updateMePanel(){const profile=getProfile();const name=String(profile.businessName||'').trim()||'Sellbook';const b=document.getElementById('meBusinessName');if(b)b.textContent=name;}
function setUnreadBadge(id,count){const el=document.getElementById(id);if(!el)return;const n=Math.max(0,Number(count)||0);el.textContent=n>99?'99+':String(n);el.classList.toggle('hidden',n===0);}
async function updateUnreadBadges(){
 if(!cloudUser||!supabaseClient){setUnreadBadge('notificationBadge',0);setUnreadBadge('messageBadge',0);return;}
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 try{
  const ns=localStorage.getItem('sellbook-notifications-seen-'+requestedUserId)||'1970-01-01T00:00:00.000Z';
  const notificationQuery=supabaseClient.from('app_notifications').select('id,created_at').or('recipient_id.is.null,recipient_id.eq.'+requestedUserId).gt('created_at',ns).limit(100);
  const messageQuery=sellbookIsAdmin?supabaseClient.from('support_messages').select('id',{count:'exact',head:true}).neq('sender_id',requestedUserId).or('recipient_id.is.null,recipient_id.eq.'+requestedUserId).is('read_at',null):supabaseClient.from('support_messages').select('id',{count:'exact',head:true}).eq('recipient_id',requestedUserId).is('read_at',null);
  const marketplaceMessageQuery=supabaseClient.from('marketplace_messages').select('id',{count:'exact',head:true}).eq('owner_id',requestedUserId).neq('sender_id',requestedUserId).is('read_at',null);
  const [nr,mr,mmr]=await Promise.all([notificationQuery,messageQuery,marketplaceMessageQuery]);
  if(!accountRequestIsCurrent(requestedUserId,requestEpoch))return;
  setUnreadBadge('notificationBadge',nr.error?0:(nr.data||[]).length);
  setUnreadBadge('messageBadge',(mr.error?0:(mr.count??(mr.data||[]).length))+(mmr.error?0:(mmr.count??(mmr.data||[]).length)));
 }catch(_){/* Keep the interface quiet if the device is offline. */}
}
let userNotificationsCache=[];let userNotificationCategory='all';
function renderUserNotifications(){const target=document.getElementById('userNotificationsList');if(!target)return;const rows=userNotificationCategory==='all'?userNotificationsCache:userNotificationsCache.filter(n=>String(n.kind||'').toLowerCase()===userNotificationCategory);target.innerHTML=rows.length?rows.map(n=>'<div class="item"><strong>'+escAdmin(n.title)+'</strong><div class="muted">'+escAdmin(({reservation:'Reservation',update:'Update',announcement:'Announcement',support:'Support',maintenance:'Maintenance'})[String(n.kind||'').toLowerCase()]||n.kind||'Notification')+' · '+escAdmin(new Date(n.created_at).toLocaleString())+'</div><p>'+escAdmin(n.body)+'</p></div>').join(''):'<div class="empty">'+(userNotificationCategory==='all'?'No notifications yet.':'No '+escAdmin(userNotificationCategory==='reservation'?'reservation':userNotificationCategory)+' notifications yet.')+'</div>';}
async function loadUserNotifications(){
 const target=document.getElementById('userNotificationsList');if(!target)return;
 if(!cloudUser||!supabaseClient){userNotificationsCache=[];target.textContent='Sign in to view app announcements.';return;}
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 target.textContent='Loading notifications…';
 const {data,error}=await supabaseClient.from('app_notifications').select('id,title,body,kind,created_at').or('recipient_id.is.null,recipient_id.eq.'+requestedUserId).order('created_at',{ascending:false}).limit(100);
 if(!accountRequestIsCurrent(requestedUserId,requestEpoch))return;
 if(error){target.textContent='Could not load notifications: '+error.message;return;}
 userNotificationsCache=data||[];renderUserNotifications();
}

let messageListOpen=true;
function backFromMessageConversation(){messageListOpen=true;document.getElementById('conversationListView')?.classList.remove('hidden');document.getElementById('supportConversationView')?.classList.add('hidden');loadConversationList();}
async function openMessageConversation(id){marketplaceSelectedBuyerId=id==='support'?null:id;const selector=document.getElementById('messageConversationSelect');if(selector)selector.value=id;messageListOpen=false;document.getElementById('conversationListView')?.classList.add('hidden');document.getElementById('supportConversationView')?.classList.remove('hidden');await loadUserSupport();}
async function loadConversationList(){
 const target=document.getElementById('recentConversationList');if(!target)return;
 if(!cloudUser||!supabaseClient){target.innerHTML='<div class="empty">Sign in to view conversations.</div>';return;}
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 target.innerHTML='<div class="empty">Loading conversations…</div>';
 const [subsRes,supportRes,marketRes]=await Promise.all([
  supabaseClient.rpc('get_my_marketplace_subscribers'),
  fetchAllCloudRows(()=>supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,read_at').or('sender_id.eq.'+requestedUserId+',recipient_id.eq.'+requestedUserId).order('created_at',{ascending:false}).order('id',{ascending:false})),
  fetchAllCloudRows(()=>supabaseClient.from('marketplace_messages').select('id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',requestedUserId).order('created_at',{ascending:false}).order('id',{ascending:false}))
 ]);
 if(!current())return;
 if(!subsRes.error)marketplaceSubscribersCache=subsRes.data||[];
 const conversations=[];
 const latestSupport=(supportRes.data||[])[0];
 if(latestSupport)conversations.push({id:'support',name:'Sellbook Support',body:latestSupport.body,time:latestSupport.created_at,unread:(supportRes.data||[]).filter(m=>m.sender_id!==requestedUserId&&m.recipient_id===requestedUserId&&!m.read_at).length});
 const byBuyer=new Map();
 (marketRes.data||[]).forEach(m=>{const old=byBuyer.get(m.buyer_id);if(!old||new Date(m.created_at)>new Date(old.created_at))byBuyer.set(m.buyer_id,m);});
 marketplaceSubscribersCache.forEach(sub=>{const m=byBuyer.get(sub.buyer_id);if(m)conversations.push({id:sub.buyer_id,name:sub.display_name||marketplaceBuyerName(sub.buyer_id),body:m.body,time:m.created_at,unread:(marketRes.data||[]).filter(x=>x.buyer_id===sub.buyer_id&&x.sender_id===sub.buyer_id&&!x.read_at).length});});
 conversations.sort((a,b)=>new Date(b.time)-new Date(a.time));
 target.innerHTML=conversations.length?conversations.map(c=>'<button type="button" class="conversation-list-button" data-conversation-id="'+escAdmin(c.id)+'"><span class="chat-support-avatar" aria-hidden="true">'+(c.id==='support'?'SB':'👤')+'</span><span class="conversation-preview"><strong>'+escAdmin(c.name)+'</strong><small>'+escAdmin(c.body||'No message text')+'</small></span><span><span class="conversation-time">'+escAdmin(new Date(c.time).toLocaleDateString())+'</span>'+(c.unread?'<span class="status-pill">'+c.unread+'</span>':'')+'</span></button>').join(''):'<div class="empty">No conversations yet. Your recent messages will appear here.</div>';
 target.querySelectorAll('[data-conversation-id]').forEach(b=>b.addEventListener('click',()=>openMessageConversation(b.dataset.conversationId)));
 if(!current())return;
 await updateUnreadBadges();
}

async function loadUserSupport(){
 if(!cloudUser||!supabaseClient)return;
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 const feedback=document.getElementById('userFeedbackList'),messages=document.getElementById('userSupportMessages'),selector=document.getElementById('messageConversationSelect');
 const [fr,mr,sr]=await Promise.all([
  supabaseClient.from('user_feedback').select('id,category,subject,message,status,admin_reply,created_at').eq('user_id',requestedUserId).order('created_at',{ascending:false}).limit(50),
  supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+requestedUserId+',recipient_id.eq.'+requestedUserId).order('created_at',{ascending:true}).limit(100),
  supabaseClient.rpc('get_my_marketplace_subscribers')
 ]);
 if(!current())return;
 if(feedback)feedback.innerHTML=fr.error?'Could not load feedback: '+escAdmin(fr.error.message):(fr.data||[]).length?fr.data.map(f=>'<div class="item"><div class="row"><strong>'+escAdmin(f.subject)+'</strong><span class="status-pill">'+escAdmin(f.status)+'</span></div><div class="muted">'+escAdmin(f.category)+' · '+escAdmin(new Date(f.created_at).toLocaleString())+'</div><p>'+escAdmin(f.message)+'</p>'+(f.admin_reply?'<p><strong>Sellbook reply:</strong> '+escAdmin(f.admin_reply)+'</p>':'')+'</div>').join(''):'<div class="empty">You have not sent feedback yet.</div>';
 if(!sr.error)marketplaceSubscribersCache=sr.data||[];
 if(selector){const old=selector.value||'support';selector.innerHTML='<option value="support">Sellbook Support</option>'+marketplaceSubscribersCache.map(x=>'<option value="'+escAdmin(x.buyer_id)+'">'+escAdmin(x.display_name||marketplaceBuyerName(x.buyer_id))+' · Buybook</option>').join('');selector.value=old==='support'||marketplaceSubscribersCache.some(x=>x.buyer_id===old)?old:'support';}
 const chosen=selector?selector.value:'support';
 const title=document.getElementById('supportConversationTitle'),status=document.getElementById('supportChatStatus');
 if(title)title.textContent=chosen==='support'?'Sellbook Support':marketplaceBuyerName(chosen);
 if(status)status.textContent=chosen==='support'?'Support conversation':'Buybook subscriber conversation';
 if(messages&&chosen==='support'){
  let rows=mr.data||[];
  const incoming=currentPage()==='support'?rows.filter(m=>m.sender_id!==requestedUserId&&m.recipient_id===requestedUserId&&!m.read_at).map(m=>m.id):[];
  if(incoming.length){const stamp=new Date().toISOString();const {error}=await supabaseClient.from('support_messages').update({delivered_at:stamp,read_at:stamp}).in('id',incoming).eq('recipient_id',requestedUserId).select('id');if(!current())return;if(!error){const fresh=await supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+requestedUserId+',recipient_id.eq.'+requestedUserId).order('created_at',{ascending:true}).limit(100);if(!current())return;if(!fresh.error)rows=fresh.data||rows;}}
  messages.innerHTML=mr.error?'Could not load messages: '+escAdmin(mr.error.message):rows.length?rows.map(m=>{const mine=m.sender_id===requestedUserId,receipt=mine?(m.read_at?'Opened':m.delivered_at?'Delivered':'Sent'):'';return '<div class="chat-message '+(mine?'from-user':'from-support')+'"><strong>'+(mine?'You':'Sellbook Support')+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(new Date(m.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(receipt?' · '+receipt:'')+'</time></div>';}).join(''):'<div class="empty">No support messages yet. Send a message below to start chatting.</div>';
 }else if(messages){
  const {data,error}=await supabaseClient.from('marketplace_messages').select('id,owner_id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',requestedUserId).eq('buyer_id',chosen).order('created_at',{ascending:true}).limit(200);
  if(!current())return;
  let rows=data||[];const incoming=rows.filter(m=>m.sender_id===chosen&&!m.read_at).map(m=>m.id);
  if(incoming.length){const stamp=new Date().toISOString();const {error:readError}=await supabaseClient.from('marketplace_messages').update({read_at:stamp}).in('id',incoming).eq('owner_id',requestedUserId).eq('buyer_id',chosen);if(!current())return;if(!readError)rows=rows.map(m=>incoming.includes(m.id)?{...m,read_at:stamp}:m);}
  messages.innerHTML=error?'<div class="empty">Could not load Buybook messages: '+escAdmin(error.message)+'</div>':rows.length?rows.map(m=>{const mine=m.sender_id===requestedUserId;return '<div class="chat-message '+(mine?'from-user':'from-support')+'"><strong>'+escAdmin(mine?'You':marketplaceBuyerName(chosen))+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(new Date(m.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(mine&&m.read_at?' · Read':'')+'</time></div>';}).join(''):'<div class="empty">No messages from this subscriber yet. You can start the conversation below.</div>';
 }
 if(!current())return;
 if(messages)messages.scrollTop=messages.scrollHeight;
 await loadUserNotifications();
 if(!current())return;
 await updateUnreadBadges();
}
document.getElementById('userFeedbackForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!cloudUser||!supabaseClient)return document.getElementById('feedbackFormStatus').textContent='Please sign in first.';
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch,current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 const status=document.getElementById('feedbackFormStatus');status.textContent='Sending…';
 try{
  const {error}=await supabaseClient.from('user_feedback').insert({user_id:requestedUserId,category:document.getElementById('feedbackCategory').value,subject:document.getElementById('feedbackSubject').value.trim(),message:document.getElementById('feedbackMessage').value.trim()});
  if(!current())return;
  if(error){status.textContent='Could not send feedback: '+error.message;return;}
  e.target.reset();status.textContent='Feedback sent. Thank you.';await loadUserSupport();
 }catch(error){if(current())status.textContent='Could not send feedback: '+(error.message||'Please try again.');}
});
document.getElementById('supportMessageForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!cloudUser||!supabaseClient)return document.getElementById('supportMessageStatus').textContent='Please sign in first.';
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch,chosenConversation= document.getElementById('messageConversationSelect')?.value||'support';
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch)&&String(document.getElementById('messageConversationSelect')?.value||'support')===String(chosenConversation);
 const form=e.target,body=document.getElementById('supportMessageBody'),status=document.getElementById('supportMessageStatus'),button=form.querySelector('button[type="submit"]'),message=body.value.trim();if(!message)return;
 button.disabled=true;status.textContent='Sending…';
 try{
  let error;
  if(chosenConversation==='support')({error}=await supabaseClient.from('support_messages').insert({sender_id:requestedUserId,recipient_id:null,body:message}));
  else ({error}=await supabaseClient.from('marketplace_messages').insert({owner_id:requestedUserId,buyer_id:chosenConversation,sender_id:requestedUserId,body:message}));
  if(!current())return;
  if(error){status.textContent='Could not send message: '+error.message;return;}
  form.reset();body.style.height='auto';status.textContent='';await loadUserSupport();
 }catch(error){if(current())status.textContent='Could not send message: '+(error.message||'Please try again.');}
 finally{button.disabled=false;}
});

let messengerSelectedConversation=null;
let messengerConversationCache=[];
let messengerConversationRequestId=0;
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
 const uid=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(uid,requestEpoch);
 if(!options.quiet)list.innerHTML='<div class="empty">Loading chats…</div>';
 try{
  const [supportRes,marketRes,subsRes]=await Promise.all([
   supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+uid+',recipient_id.eq.'+uid).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100),
   supabaseClient.from('marketplace_messages').select('id,owner_id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',uid).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(300),
   supabaseClient.rpc('get_my_marketplace_subscribers')
  ]);
  if(!current())return;
  const conversations=[];
  if(!supportRes.error&&(supportRes.data||[]).length){const rows=supportRes.data;const m=rows[0];conversations.push({id:'support',title:'Sellbook Support',body:m.body,time:m.created_at,unread:rows.filter(x=>x.sender_id!==uid&&x.recipient_id===uid&&!x.read_at).length,lastMine:m.sender_id===uid,lastDelivered:!!m.delivered_at,lastRead:!!m.read_at});}
  const subs=subsRes.data||[],msgs=marketRes.data||[],ids=[...new Set([...subs.map(x=>x.buyer_id),...msgs.map(x=>x.buyer_id)])];
  for(const id of ids){const m=msgs.find(x=>x.buyer_id===id);const sub=subs.find(x=>x.buyer_id===id);if(!m&&!sub)continue;conversations.push({id,title:sub?.display_name||marketplaceBuyerName(id),body:m?.body||'Start a conversation',time:m?.created_at||sub?.created_at||new Date().toISOString(),unread:msgs.filter(x=>x.buyer_id===id&&x.sender_id!==uid&&!x.read_at).length,lastMine:!!m&&m.sender_id===uid,lastDelivered:false,lastRead:!!m&&!!m.read_at});}
  if(supportRes.error&&marketRes.error&&subsRes.error)throw supportRes.error;
  messengerConversationCache=conversations.sort((a,b)=>new Date(b.time)-new Date(a.time));
  renderMessengerConversationList();
  if(options.refreshSelected&&messengerSelectedConversation&&document.body.classList.contains('messenger-conversation-open'))await openMessengerConversation(messengerSelectedConversation,{quiet:true});
 }catch(err){if(current()&&!options.quiet)list.innerHTML='<div class="empty">Could not load chats: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
async function openMessengerConversation(id,options={}){
 if(!cloudUser||!supabaseClient)return;
 const uid=cloudUser.id,requestEpoch=accountSessionEpoch,requestId=++messengerConversationRequestId;
 const current=()=>accountRequestIsCurrent(uid,requestEpoch)&&requestId===messengerConversationRequestId&&String(messengerSelectedConversation)===String(id);
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
  let rows=[],error=null;
  if(id==='support'){const query=()=>supabaseClient.from('support_messages').select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at').or('sender_id.eq.'+uid+',recipient_id.eq.'+uid);const r=options.quiet?await query().order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100):await fetchAllCloudRows(()=>query().order('created_at',{ascending:true}).order('id',{ascending:true}));rows=r.data||[];if(options.quiet)rows.reverse();error=r.error;if(!error){const incoming=rows.filter(m=>m.recipient_id===uid&&!m.delivered_at).map(m=>m.id);if(incoming.length){const stamp=now();const ack=await supabaseClient.from('support_messages').update({delivered_at:stamp}).in('id',incoming).eq('recipient_id',uid).is('delivered_at',null);if(!ack.error)rows=rows.map(m=>incoming.includes(m.id)?{...m,delivered_at:stamp}:m);}}}
  else{const query=()=>supabaseClient.from('marketplace_messages').select('id,owner_id,buyer_id,sender_id,body,created_at,read_at').eq('owner_id',uid).eq('buyer_id',id);const r=options.quiet?await query().order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100):await fetchAllCloudRows(()=>query().order('created_at',{ascending:true}).order('id',{ascending:true}));rows=r.data||[];if(options.quiet)rows.reverse();error=r.error;}
  if(!current())return;
  if(error)throw error;
  const wasNearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<120;
  const messageHtml=rows.map(m=>'<div data-message-id="'+escAdmin(m.id)+'" class="chat-message '+(m.sender_id===uid?'from-user':'from-support')+'"><strong>'+(m.sender_id===uid?'You':(id==='support'?'Sellbook Support':escAdmin(convo?.title||marketplaceBuyerName(id))))+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(messengerTime(m.created_at))+(m.sender_id===uid?' · <span class="messenger-message-ticks'+(m.read_at?' is-read':'')+'">'+(m.read_at?'✓✓ Read':(id==='support'&&m.delivered_at?'✓✓ Delivered':'✓ Sent'))+'</span>':'')+'</time></div>').join('');
  if(options.quiet){const existingNodes=new Map([...target.querySelectorAll('[data-message-id]')].map(node=>[node.dataset.messageId,node]));const existing=new Set(existingNodes.keys());rows.forEach(m=>{const node=existingNodes.get(String(m.id));const tick=node?.querySelector('.messenger-message-ticks');if(tick&&m.read_at){tick.classList.add('is-read');tick.textContent='✓✓ Read';}else if(tick&&id==='support'&&m.delivered_at){tick.textContent='✓✓ Delivered';}});const additions=rows.filter(m=>!existing.has(String(m.id)));if(additions.length){target.querySelector('.empty')?.remove();target.insertAdjacentHTML('beforeend',additions.map(m=>'<div data-message-id="'+escAdmin(m.id)+'" class="chat-message '+(m.sender_id===uid?'from-user':'from-support')+'"><strong>'+(m.sender_id===uid?'You':(id==='support'?'Sellbook Support':escAdmin(convo?.title||marketplaceBuyerName(id))))+'</strong><p>'+escAdmin(m.body)+'</p><time class="chat-time">'+escAdmin(messengerTime(m.created_at))+(m.sender_id===uid?' · <span class="messenger-message-ticks'+(m.read_at?' is-read':'')+'">'+(m.read_at?'✓✓ Read':(id==='support'&&m.delivered_at?'✓✓ Delivered':'✓ Sent'))+'</span>':'')+'</time></div>').join(''));}}
  else target.innerHTML=messageHtml||'<div class="empty">Say hello to start the conversation.</div>';
  if(wasNearBottom||!options.quiet)target.scrollTop=target.scrollHeight;
  const status=document.getElementById('messengerStatus');if(status)status.textContent='';
 }catch(err){if(current()&&!options.quiet)target.innerHTML='<div class="empty">Could not load messages: '+escAdmin(err.message||'Please try again.')+'</div>';}
}
async function openMessengerSubscriberPicker(){
 const overlay=document.getElementById('messengerSubscriberPicker'),list=document.getElementById('messengerSubscriberPickerList');
 overlay?.classList.remove('hidden');list.innerHTML='<div class="empty">Loading subscribers…</div>';
 if(!cloudUser||!supabaseClient){list.innerHTML='<div class="empty">Please sign in to see subscribed buyers.</div>';return;}
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch);
 try{
  const {data,error}=await supabaseClient.rpc('get_my_marketplace_subscribers');
  if(!current())return;
  if(error)throw error;
  marketplaceSubscribersCache=data||[];
  if(!marketplaceSubscribersCache.length){list.innerHTML='<div class="empty">No subscribed buyers yet. Buyers who subscribe to your shop on Buybook will appear here.</div>';return;}
  renderMessengerSubscriberPicker();
 }catch(err){if(current())list.innerHTML='<div class="empty">Could not load subscribers: '+escAdmin(err.message||'Please try again.')+'</div>';}
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
 e.preventDefault();if(!cloudUser||!supabaseClient||!messengerSelectedConversation)return;
 const requestedUserId=cloudUser.id,requestEpoch=accountSessionEpoch,conversationId=messengerSelectedConversation;
 const current=()=>accountRequestIsCurrent(requestedUserId,requestEpoch)&&String(messengerSelectedConversation)===String(conversationId);
 const input=document.getElementById('messengerBody'),status=document.getElementById('messengerStatus'),button=e.currentTarget.querySelector('button[type="submit"]'),body=input.value.trim();if(!body)return;
 button.disabled=true;status.textContent='Sending…';
 try{
  let result;
  if(conversationId==='support')result=await supabaseClient.from('support_messages').insert({sender_id:requestedUserId,recipient_id:null,body});
  else result=await supabaseClient.from('marketplace_messages').insert({owner_id:requestedUserId,buyer_id:conversationId,sender_id:requestedUserId,body});
  if(!current())return;
  if(result.error)throw result.error;
  input.value='';input.style.height='auto';status.textContent='';
  await openMessengerConversation(conversationId);
  if(!current())return;
  await loadMessengerConversations();
 }catch(err){if(current())status.textContent='Message not sent: '+(err.message||'Please try again.');}
 finally{button.disabled=false;}
});
if(messengerRefreshTimer)clearInterval(messengerRefreshTimer);
messengerRefreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&currentPage()==='messenger'&&cloudUser)loadMessengerConversations({quiet:true,refreshSelected:true});},12000);

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
let adminConversationRequestId=0;
async function loadAdminConversation(){
 if(adminConversationLoading||!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestId=++adminConversationRequestId;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const current=()=>adminRequestIsCurrent(requestedUserId,requestEpoch);
 adminConversationLoading=true;
 const target=document.getElementById('adminSupportMessages');
 const input=document.getElementById('adminReplyBody');
 const send=document.querySelector('#adminReplyForm button[type="submit"]');
 try{
  const uid=document.getElementById('adminMessageUser').value;
  if(!uid){target.innerHTML='<div class="empty">Choose a user to view messages.</div>';input.disabled=true;send.disabled=true;return;}
  const user=adminUsersCache.find(u=>u.user_id===uid);
  document.getElementById('adminChatContactName').textContent=user?.email||'Sellbook user';
  document.getElementById('adminChatContactStatus').textContent='Online chat · messages update automatically';
  input.disabled=false;send.disabled=false;
  const firstLoad=!target.dataset.loaded;
  if(firstLoad)target.innerHTML='<div class="empty">Loading conversation…</div>';
  const wasNearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<100;

  let {data,error}=await supabaseClient.from('support_messages')
   .select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at')
   .or('sender_id.eq.'+uid+',recipient_id.eq.'+uid)
   .order('created_at',{ascending:true}).limit(200);
  if(!current())return;
  if(error){target.innerHTML='<div class="empty">Could not load conversation: '+escAdmin(error.message)+'</div>';return;}

  const unread=(data||[]).filter(m=>m.sender_id===uid&&!m.read_at).map(m=>m.id);
  if(unread.length){
   const stamp=new Date().toISOString();
   const {error:updateError}=await supabaseClient.from('support_messages')
    .update({delivered_at:stamp,read_at:stamp}).in('id',unread).select('id');
   if(!current())return;
   if(!updateError){
    const fresh=await supabaseClient.from('support_messages')
     .select('id,sender_id,recipient_id,body,created_at,delivered_at,read_at')
     .or('sender_id.eq.'+uid+',recipient_id.eq.'+uid)
     .order('created_at',{ascending:true}).limit(200);
    if(!current())return;
    if(!fresh.error)data=fresh.data;
    else console.error('Could not refresh admin chat receipts:',fresh.error.message);
    await loadAdminUsers();
    if(!current())return;
   }
  }

  if(!current())return;
  const messages=data||[];
  const conversationHtml=messages.length?messages.map(m=>{
   const mine=m.sender_id===requestedUserId;
   const receipt=mine?(m.read_at?'✓✓ Opened':m.delivered_at?'✓✓ Delivered':'✓ Sent'):'';
   return '<div class="admin-chat-bubble '+(mine?'from-admin':'from-user')+'">'+escAdmin(m.body)+'<span class="chat-time">'+escAdmin(new Date(m.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))+(receipt?' · '+receipt:'')+'</span></div>';
  }).join(''):'<div class="empty">No messages yet. You can send the first message below.</div>';
  if(target.innerHTML!==conversationHtml)target.innerHTML=conversationHtml;
  target.dataset.loaded='true';
  if(wasNearBottom)target.scrollTop=target.scrollHeight;
  if(current())await updateUnreadBadges();
 }catch(error){
  if(current())target.innerHTML='<div class="empty">Could not load conversation: '+escAdmin(error.message||'Please try again.')+'</div>';
 }finally{
  if(adminConversationRequestId===requestId)adminConversationLoading=false;
 }
}
document.getElementById('adminReplyForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const uid=document.getElementById('adminMessageUser').value,input=document.getElementById('adminReplyBody'),body=input.value.trim(),status=document.getElementById('adminReplyStatus'),send=e.target.querySelector('button[type="submit"]');
 if(!uid){status.textContent='Choose a user first.';return;}if(!body)return;
 send.disabled=true;status.textContent='Sending…';
 try{
  const {error}=await supabaseClient.from('support_messages')
   .insert({sender_id:requestedUserId,recipient_id:uid,body});
  if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
  if(error){status.textContent='Could not send message: '+error.message;return;}
  input.value='';input.style.height='auto';status.textContent='Message sent.';
  await loadAdminConversation();
  if(adminRequestIsCurrent(requestedUserId,requestEpoch))await loadAdminUsers();
 }catch(error){
  if(adminRequestIsCurrent(requestedUserId,requestEpoch))status.textContent='Could not send message: '+(error.message||'Please try again.');
 }finally{
  send.disabled=false;
 }
});
setInterval(()=>{if(cloudUser&&!document.hidden&&currentPage()==='settings-buybook'){loadBuybookActivity();}},15000);
setInterval(()=>{if(sellbookIsAdmin&&currentPage()==='admin'&&sessionStorage.getItem('sellbook-admin-panel')==='support'){if(!document.getElementById('adminChatConversationView').classList.contains('hidden')&&document.getElementById('adminMessageUser').value)loadAdminConversation();else loadAdminUsers();}},15000);
setInterval(()=>{if(!cloudUser||document.hidden)return;if(!sellbookIsAdmin&&currentPage()==='support')loadUserSupport();else updateUnreadBadges();},30000);

document.getElementById('notificationAudience').addEventListener('change',e=>document.getElementById('notificationUserWrap').classList.toggle('hidden',e.target.value!=='selected'));
document.getElementById('adminNotificationForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!supabaseClient||!cloudUser||!sellbookIsAdmin)return;
 const requestedUserId=cloudUser.id,requestEpoch=adminAccessEpoch;
 const audience=document.getElementById('notificationAudience').value,uid=document.getElementById('notificationUser').value,status=document.getElementById('adminNotificationStatus');
 if(audience==='selected'&&!uid){status.textContent='Choose a user.';return;}
 const payload={created_by:requestedUserId,recipient_id:audience==='selected'?uid:null,kind:document.getElementById('notificationKind').value,title:document.getElementById('notificationTitle').value.trim(),body:document.getElementById('notificationBody').value.trim()};
 const button=e.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
 try{
  const {error}=await supabaseClient.from('app_notifications').insert(payload);
  if(!adminRequestIsCurrent(requestedUserId,requestEpoch))return;
  if(error){status.textContent='Could not publish notification: '+error.message;return;}
  e.target.reset();document.getElementById('notificationUserWrap').classList.add('hidden');status.textContent='Notification published.';
  await loadAdminNotifications();
 }catch(error){
  if(adminRequestIsCurrent(requestedUserId,requestEpoch))status.textContent='Could not publish notification: '+(error.message||'Please try again.');
 }finally{
  if(button)button.disabled=false;
 }
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
    const pendingGoogleAction=readPendingGoogleSecurityAction();
    if(pendingGoogleAction){
      if(event==='SIGNED_IN'){
        schedulePendingGoogleSecurityReauth();
        return;
      }
      if(event==='INITIAL_SESSION'){
        try{
          const claims=decodeSellbookJwtPayload(session?.access_token);
          if(claims.session_id&&claims.session_id!==pendingGoogleAction.previousSessionId){
            schedulePendingGoogleSecurityReauth();
          }
        }catch(_){}
        return;
      }
      if(event==='TOKEN_REFRESHED')return;
    }
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      document.getElementById('appWorkspace').classList.add('hidden');
      document.getElementById('accountManagePanel').classList.add('hidden');
      setAuthScreen('new-password');
      cloudMessage('Choose a new password to finish recovering your account.');
    }
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      const nextUserId=session?.user?.id||null;
      if((cloudUser?.id||null)!==nextUserId){
        // Hide private business data immediately, before any deferred auth
        // work. A fast account switch must never leave the prior dashboard visible.
        document.getElementById('appWorkspace')?.classList.add('hidden');
        document.getElementById('accountCard')?.classList.add('hidden');
        cloudUser=null;
        clearAccountScopedUiState();
      }
      setTimeout(() => handleCloudAuthChange(), 0);
    }
  });
  if(readPendingGoogleSecurityAction()){
    // A cancelled OAuth page return has no SIGNED_IN event. Give Supabase time
    // to exchange the OAuth code, then safely resume the original account.
    setTimeout(async()=>{
      if(!readPendingGoogleSecurityAction()||securityOauthFinalizing)return;
      try{
        const {data}=await supabaseClient.auth.getSession();
        const claims=data?.session?.access_token?decodeSellbookJwtPayload(data.session.access_token):null;
        const pending=readPendingGoogleSecurityAction();
        if(pending&&claims?.session_id&&claims.session_id!==pending.previousSessionId){
          schedulePendingGoogleSecurityReauth();
        }else if(pending&&Date.now()-pending.startedAt>=5000){
          sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);
          if(pending.recovery)sessionStorage.removeItem('sellbook-pin-reset-after-auth');
          await handleCloudAuthChange();
          showToast('Google verification was not completed. Your account was not changed. Start the action again when ready.','error');
        }
      }catch(error){
        const pending=readPendingGoogleSecurityAction();
        if(pending&&Date.now()-pending.startedAt>=5000){
          sessionStorage.removeItem(SECURITY_OAUTH_PENDING_KEY);
          if(pending.recovery)sessionStorage.removeItem('sellbook-pin-reset-after-auth');
          await handleCloudAuthChange().catch(()=>{});
          showToast('Google verification could not be completed. Your account was not changed.','error');
        }
      }
    },6000);
  }else{
    handleCloudAuthChange();
  }
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