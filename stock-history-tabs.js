
(function(){
 let selected='added';
 function renderTabs(){
  const tabs=document.getElementById('stockHistoryTabs');if(!tabs)return;
  const additions=Array.isArray(db.productAdditions)?db.productAdditions:[];
  const adjustments=Array.isArray(db.stockAdjustments)?db.stockAdjustments:[];
  const restocks=Array.isArray(db.restocks)?db.restocks:[];
  tabs.querySelectorAll('[data-stock-history-tab]').forEach(button=>{
   const active=button.dataset.stockHistoryTab===selected;
   button.classList.toggle('active',active);button.setAttribute('aria-selected',active?'true':'false');
   const count=button.querySelector('[data-history-count]');
   if(count)count.textContent=String(button.dataset.stockHistoryTab==='added'?additions.length:button.dataset.stockHistoryTab==='adjustments'?adjustments.length:restocks.length);
  });
  const pp=document.getElementById('productCreationHistoryPanel'),ap=document.getElementById('stockAdjustmentPanel'),rp=document.getElementById('restockHistoryPanel');
  if(pp)pp.hidden=selected!=='added';if(ap)ap.hidden=selected!=='adjustments';if(rp)rp.hidden=selected!=='restocks';
 }
 const originalRender=renderStockAdjustments;
 renderStockAdjustments=function(){originalRender();renderTabs();};
 document.getElementById('stockHistoryTabs')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-stock-history-tab]');if(!button)return;
  selected=button.dataset.stockHistoryTab==='restocks'?'restocks':'adjustments';
  // Repaint the selected list at the moment its tab is opened. Do not rely on
  // the adjustments renderer having run earlier or on hidden-panel contents.
  if(selected==='added')renderProductCreationHistory();else if(selected==='restocks')renderRestockHistory();else renderStockAdjustments();
  renderTabs();
 });
 setTimeout(()=>{renderProductCreationHistory();renderStockAdjustments();renderTabs();},0);
})();