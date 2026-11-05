document.addEventListener('click', function(e){
  const btn = e.target && e.target.closest && e.target.closest('[data-action="filter-record-type"]');
  if(!btn) return;
  const v = btn.getAttribute('data-value') || 'all';
  if(typeof recordTypeFilter === 'undefined') return;
  recordTypeFilter = (recordTypeFilter === v) ? 'all' : v;
  if(typeof registryPage !== 'undefined') registryPage = 1;
  if(typeof render === 'function') render();
}, true);
