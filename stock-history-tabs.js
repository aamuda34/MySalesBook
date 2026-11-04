(function(){
 let selected='added';
 const keys=['added','sales','adjustments','restocks','changes'];
 function renderTabs(){
  const tabs=document.getElementById('stockHistoryTabs');if(!tabs)return;
  const counts={added:(db.productAdditions||[]).length,sales:(db.sales||[]).length,adjustments:(db.stockAdjustments||[]).length,restocks:(db.restocks||[]).length,changes:(db.productActivity||[]).length};
  tabs.querySelectorAll('[data-stock-history-tab]').forEach(button=>{const key=button.dataset.stockHistoryTab,active=key===selected;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));const count=button.querySelector('[data-history-count]');if(count)count.textContent=String(counts[key]||0);});
  const panels={added:'productCreationHistoryPanel',sales:'productSalesHistoryPanel',adjustments:'stockAdjustmentPanel',restocks:'restockHistoryPanel',changes:'productActivityHistoryPanel'};
  Object.entries(panels).forEach(([key,id])=>{const panel=document.getElementById(id);if(panel)panel.hidden=key!==selected;});
 }
 const originalRender=renderStockAdjustments;
 renderStockAdjustments=function(){originalRender();renderTabs();};
 document.getElementById('stockHistoryTabs')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-stock-history-tab]');if(!button)return;
  const key=button.dataset.stockHistoryTab;if(!keys.includes(key))return;selected=key;
  if(key==='added')renderProductCreationHistory();else if(key==='sales')renderProductSalesHistory();else if(key==='adjustments')renderStockAdjustments();else if(key==='restocks')renderRestockHistory();else if(key==='changes')renderProductActivityHistory();
  renderTabs();
 });
 setTimeout(()=>{renderProductCreationHistory();renderProductSalesHistory();renderStockAdjustments();renderRestockHistory();renderProductActivityHistory();renderTabs();},0);
})();