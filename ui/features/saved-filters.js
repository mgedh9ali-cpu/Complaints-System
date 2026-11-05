/** Saved registry filter presets (local to this browser user). */
const SAVED_FILTERS_KEY = 'complaints_saved_filters_v1';

function loadSavedFilterPresets(){
  try{
    const raw = localStorage.getItem(SAVED_FILTERS_KEY);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.slice(0, 12) : [];
  }catch(_){ return []; }
}

function storeSavedFilterPresets(list){
  try{ localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list.slice(0, 12))); }catch(_){}
}

function currentRegistryFilterSnapshot(){
  return {
    searchText: typeof searchText === 'string' ? searchText : '',
    statusFilter: typeof statusFilter !== 'undefined' ? statusFilter : 'all',
    priorityFilter: typeof priorityFilter !== 'undefined' ? priorityFilter : 'all',
    categoryFilter: typeof categoryFilter !== 'undefined' ? categoryFilter : 'all',
    natureFilter: typeof natureFilter !== 'undefined' ? natureFilter : 'all',
    recordTypeFilter: typeof recordTypeFilter !== 'undefined' ? recordTypeFilter : 'all',
    quickView: typeof quickView !== 'undefined' ? quickView : 'all',
    dateTypeFilter: typeof dateTypeFilter !== 'undefined' ? dateTypeFilter : 'created',
    dateFrom: typeof dateFrom !== 'undefined' ? dateFrom : '',
    dateTo: typeof dateTo !== 'undefined' ? dateTo : ''
  };
}

function applyRegistryFilterSnapshot(snap){
  if(!snap || typeof snap !== 'object') return;
  if(typeof searchText !== 'undefined') searchText = String(snap.searchText || '');
  if(typeof statusFilter !== 'undefined') statusFilter = snap.statusFilter || 'all';
  if(typeof priorityFilter !== 'undefined') priorityFilter = snap.priorityFilter || 'all';
  if(typeof categoryFilter !== 'undefined') categoryFilter = snap.categoryFilter || 'all';
  if(typeof natureFilter !== 'undefined') natureFilter = snap.natureFilter || 'all';
  if(typeof recordTypeFilter !== 'undefined') recordTypeFilter = snap.recordTypeFilter || 'all';
  if(typeof quickView !== 'undefined') quickView = snap.quickView || 'all';
  if(typeof dateTypeFilter !== 'undefined') dateTypeFilter = snap.dateTypeFilter || 'created';
  if(typeof dateFrom !== 'undefined') dateFrom = snap.dateFrom || '';
  if(typeof dateTo !== 'undefined') dateTo = snap.dateTo || '';
  if(typeof registryPage !== 'undefined') registryPage = 1;
  if(typeof render === 'function') render();
}

function savedFiltersBarHtml(){
  const presets = loadSavedFilterPresets();
  const chips = presets.map((p, i) =>
    '<button type="button" class="filter-chip" data-action="apply-saved-filter" data-index="'+i+'" title="'+esc(p.name||'')+'">'+esc(p.name||('مرشح '+(i+1)))+'</button>'+
    '<button type="button" class="btn btn-sm btn-quiet" data-action="delete-saved-filter" data-index="'+i+'" aria-label="حذف المرشح" style="padding:2px 6px;min-width:auto">×</button>'
  ).join(' ');
  return '<div class="saved-filters-bar" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px">'+
    '<span class="small-copy" style="margin:0">مرشحات محفوظة:</span>'+
    (chips || '<span class="small-copy" style="margin:0;opacity:.7">لا يوجد بعد</span>')+
    '<button type="button" class="btn btn-sm" data-action="save-current-filters">حفظ المرشحات الحالية</button>'+
    '</div>';
}

(function installSavedFilters(){
  function enhanceComplaintsPage(){
    if(typeof complaintsPage !== 'function' || complaintsPage.__savedFiltersWrapped) return;
    const orig = complaintsPage;
    function wrapped(){
      let html = orig.apply(this, arguments);
      if(typeof html !== 'string') return html;
      if(html.indexOf('saved-filters-bar') >= 0) return html;
      const bar = savedFiltersBarHtml();
      if(html.indexOf('filters-row') >= 0){
        html = html.replace('<div class="filters-row"', bar + '<div class="filters-row"');
      }
      return html;
    }
    wrapped.__savedFiltersWrapped = true;
    complaintsPage = wrapped;
  }
  enhanceComplaintsPage();
  setTimeout(enhanceComplaintsPage, 0);
  setTimeout(enhanceComplaintsPage, 50);

  document.addEventListener('click', function(e){
    const t = e.target && e.target.closest && e.target.closest('[data-action]');
    if(!t) return;
    const action = t.getAttribute('data-action');
    if(action === 'save-current-filters'){
      e.preventDefault();
      const name = window.prompt('اسم المرشح المحفوظ (مثال: عاجلة المسندة لي):', '');
      if(!name || !String(name).trim()) return;
      const list = loadSavedFilterPresets();
      list.unshift({ name: String(name).trim().slice(0, 40), filters: currentRegistryFilterSnapshot(), at: new Date().toISOString() });
      storeSavedFilterPresets(list);
      if(typeof toast === 'function') toast('تم حفظ المرشح.');
      if(typeof render === 'function') render();
      return;
    }
    if(action === 'apply-saved-filter'){
      e.preventDefault();
      const i = Number(t.getAttribute('data-index'));
      const list = loadSavedFilterPresets();
      if(!list[i]) return;
      applyRegistryFilterSnapshot(list[i].filters);
      if(typeof toast === 'function') toast('طُبّق المرشح: ' + (list[i].name || ''));
      return;
    }
    if(action === 'delete-saved-filter'){
      e.preventDefault();
      const i = Number(t.getAttribute('data-index'));
      const list = loadSavedFilterPresets();
      if(!list[i]) return;
      list.splice(i, 1);
      storeSavedFilterPresets(list);
      if(typeof toast === 'function') toast('حُذف المرشح.');
      if(typeof render === 'function') render();
    }
  }, true);
})();
