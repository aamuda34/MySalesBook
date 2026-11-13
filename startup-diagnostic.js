(()=>{
 'use strict';
 let shown=false;
 function showSellbookStartupDiagnostic(reason){
  if(shown)return;
  shown=true;
  try{console.error('Sellbook startup diagnostic:',reason);}catch(_){}
  const existing=document.getElementById('sellbookStartupDiagnostic');
  if(existing)return;
  const panel=document.createElement('div');
  panel.id='sellbookStartupDiagnostic';
  panel.setAttribute('role','alert');
  panel.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:#f5f7f5;color:#17231c;font:14px/1.5 Arial,sans-serif;';
  const card=document.createElement('div');
  card.style.cssText='width:100%;max-width:420px;padding:24px;border:1px solid #dfe8e0;border-radius:18px;background:#fff;box-shadow:0 12px 35px rgba(21,54,34,.09);';
  const brand=document.createElement('div');brand.textContent='SELLBOOK · Made Business Simple';brand.style.cssText='margin-bottom:22px;color:#14532d;font-weight:800;letter-spacing:.02em;';
  const title=document.createElement('h1');title.textContent='Sellbook could not finish opening';title.style.cssText='margin:0 0 10px;font-size:22px;line-height:1.25;';
  const message=document.createElement('p');message.textContent='The app stopped while opening your business records. Your saved records have not been deleted.';message.style.cssText='margin:0 0 12px;color:#52635a;';
  const detail=document.createElement('pre');detail.textContent=String(reason||'Startup did not complete.').slice(0,500);detail.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto;padding:10px;border-radius:9px;background:#f3f6f3;color:#52635a;font:11px/1.45 monospace;';
  const help=document.createElement('p');help.textContent='Please take a screenshot of this message and send it to Sellbook Support. Do not clear app storage.';help.style.cssText='margin:12px 0;color:#52635a;font-size:12px;';
  const reload=document.createElement('button');reload.type='button';reload.textContent='Reload Sellbook';reload.style.cssText='width:100%;min-height:46px;margin-top:10px;border:0;border-radius:10px;background:#14532d;color:#fff;font-weight:750;font-size:14px;';reload.addEventListener('click',()=>location.reload());
  card.append(brand,title,message,detail,help,reload);panel.append(card);(document.body||document.documentElement).append(panel);
 }
 window.addEventListener('error',event=>{
  if(event.target&&event.target!==window){
   const tag=String(event.target.tagName||'').toLowerCase();
   if(tag==='script'&&event.target.src)showSellbookStartupDiagnostic('A required script could not load: '+event.target.src);
   return;
  }
  const detail=event.message||event.error?.message||'A JavaScript error interrupted startup';
  showSellbookStartupDiagnostic(detail+(event.filename?'\n'+event.filename+':'+(event.lineno||0)+':'+(event.colno||0):''));
 },true);
 window.addEventListener('unhandledrejection',event=>{
  const reason=event.reason?.message||event.reason||'An asynchronous startup operation failed';
  showSellbookStartupDiagnostic(reason);
 });
 let lastScreenSeenAt=Date.now();
 let initializingSince=0;
 const check=()=>{
  const body=document.body;
  if(!body||shown)return;
  const visible=(id)=>{const el=document.getElementById(id);return !!el&&!el.classList.contains('hidden');};
  const initializing=body.classList.contains('auth-initializing');
  const app=visible('appWorkspace'),pin=visible('securityPinGate'),account=visible('accountCard'),recovery=visible('workspaceLoadRecovery');
  if(app||pin||account||recovery){lastScreenSeenAt=Date.now();initializingSince=0;return;}
  if(initializing){
   if(!initializingSince)initializingSince=Date.now();
   if(Date.now()-initializingSince>30000){
    showSellbookStartupDiagnostic('Sellbook remained on its startup screen for more than 30 seconds without opening the business workspace.');
   }
   return;
  }
  if(Date.now()-lastScreenSeenAt>8000){
   showSellbookStartupDiagnostic('Sellbook stopped without displaying the sign-in page, PIN screen, recovery screen, or business workspace.');
  }
 };
 window.setInterval(check,2000);
})();
