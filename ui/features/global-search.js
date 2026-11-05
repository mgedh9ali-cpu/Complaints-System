function globalSearchModal(prefill){
  if(!authenticatedUser)return;
  prefill = prefill || '';
  modal('بحث عام','ابحث في كل الشكاوى والاستفسارات بالرقم أو الاسم أو الهاتف أو الموضوع',
    '<div class="form-grid"><div class="form-field full"><label for="globalSearchInput">نص البحث</label>'+
    '<input class="field" id="globalSearchInput" autocomplete="off" placeholder="رقم السجل · الاسم · الهاتف · الموضوع" value="'+esc(prefill)+'"></div>'+
    '<div class="form-field full" id="globalSearchResults"></div></div>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="global-search-go">بحث في السجل</button>');
  const input=$('#globalSearchInput');
  const run=function(){ renderGlobalSearchResults(input && input.value || ''); };
  if(input){
    input.addEventListener('input', function(){ if(input._t) clearTimeout(input._t); input._t=setTimeout(run,120); });
    input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); run(); } });
    input.focus();
    if(input.select) input.select();
  }
  run();
}
function renderGlobalSearchResults(query){
  const mount=$('#globalSearchResults'); if(!mount) return;
  const q=norm(query);
  if(!q){ mount.innerHTML='<p class="small-copy">اكتب حرفين على الأقل للبحث فوراً في السجلات.</p>'; return; }
  const rows=db.complaints.filter(function(c){
    if(c.archivedAt) return false;
    return norm([c.id,c.name,c.phone,c.summary,c.details,c.province,c.category,c.nature,c.owner].join(' ')).includes(q);
  }).slice(0,25);
  if(!rows.length){ mount.innerHTML='<div class="risk-note">لا توجد نتائج مطابقة.</div>'; return; }
  mount.innerHTML='<p class="small-copy">عُثر على '+rows.length+(rows.length===25?'+':'')+' نتيجة</p><div class="command-list">'+
    rows.map(function(c){
      return '<button type="button" data-action="detail" data-id="'+esc(c.id)+'"><strong>'+esc(c.summary||'بدون موضوع')+
        '</strong><small dir="ltr">'+esc(c.id)+'</small><small>'+esc(c.name||'—')+' · '+esc(c.phone||'—')+' · '+esc(statusLabel(c.status))+'</small></button>';
    }).join('')+'</div>';
}
function applyGlobalSearchToRegistry(){
  const q=($('#globalSearchInput') && $('#globalSearchInput').value || '').trim();
  searchText=q; statusFilter='all'; priorityFilter='all'; categoryFilter='all'; natureFilter='all'; quickView='all'; registryPage=1;
  closeModal(); go('complaints'); toast(q ? ('تم تطبيق البحث: '+q) : 'تم فتح السجل.');
}
document.addEventListener('click', function(e){
  const el=e.target.closest('[data-action]'); if(!el) return;
  const a=el.dataset.action;
  if(a==='global-search'){ e.preventDefault(); globalSearchModal(typeof searchText!=='undefined'?searchText:''); }
  else if(a==='global-search-go'){ e.preventDefault(); applyGlobalSearchToRegistry(); }
}, true);
document.addEventListener('keydown', function(e){
  if(!authenticatedUser) return;
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='f' && !e.shiftKey){
    const tag=(document.activeElement && document.activeElement.tagName || '').toLowerCase();
    if(tag==='input'||tag==='textarea') return;
    e.preventDefault(); globalSearchModal(typeof searchText!=='undefined'?searchText:'');
  }
}, true);
