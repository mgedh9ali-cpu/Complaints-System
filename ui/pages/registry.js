let registryPage=1;
let dateTypeFilter='created';
let recordTypeFilter='all';
let dateFrom='';
let dateTo='';
let registryAdvancedOpen=false;
const registryQueueLabels={all:'كل السجلات',late:'متجاوزة المهلة','due-soon':'تستحق خلال 48 ساعة',missing:'بيانات غير مكتملة','urgent-no-reply':'عاجلة بلا رد','new-today':'جديدة اليوم',archived:'الأرشيف'};
function normalizeRegistryQueue(value){return Object.hasOwn(registryQueueLabels,value)?value:'all';}
function waitingForReferral(c){return !c.archivedAt&&!['closed','cancelled'].includes(c.status)&&(c.status==='awaiting_reply'||(c.referrals||[]).some(r=>!r.response&&!r.completedAt));}
function resetRegistryFilters(){
  clearTimeout(registrySearchTimer);
  searchText='';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';
  recordTypeFilter='all';dateTypeFilter='created';dateFrom='';dateTo='';quickView='all';registryPage=1;
}
function openRegistryQueue(queue){
  resetRegistryFilters();quickView=normalizeRegistryQueue(queue);
  if(page==='complaints')render();else go('complaints');
}
function activeRegistryFilters(){
  const filters=[];
  if(searchText)filters.push(['search','البحث: '+searchText]);
  if(statusFilter!=='all')filters.push(['status','الحالة: '+statusLabel(statusFilter)]);
  if(priorityFilter!=='all')filters.push(['priority','الأولوية: '+priorityLabel(priorityFilter)]);
  if(categoryFilter!=='all')filters.push(['category','التصنيف: '+categoryFilter]);
  if(natureFilter!=='all')filters.push(['nature','الطبيعة: '+natureFilter]);
  if(recordTypeFilter!=='all')filters.push(['type',({ complaint:'شكاوى فقط', inquiry:'استفسارات فقط', contact:'تواصل فقط' })[recordTypeFilter]]);
  if(quickView!=='all')filters.push(['queue',registryQueueLabels[normalizeRegistryQueue(quickView)]]);
  if(dateFrom||dateTo)filters.push(['dates','التاريخ: '+(dateFrom||'البداية')+' — '+(dateTo||'اليوم')]);
  return filters;
}
function activeRegistryFiltersHtml(){
  const filters=activeRegistryFilters();
  if(!filters.length)return '';
  return '<div class="registry-active-filters" id="registryActiveFilters" tabindex="-1" aria-label="المرشحات النشطة">'+
    (filters.length?'<span>المرشحات النشطة:</span>'+filters.map(([key,label])=>'<button type="button" class="filter-chip active" data-action="remove-registry-filter" data-filter-key="'+key+'" aria-label="إزالة '+esc(label)+'">'+esc(label)+' <span aria-hidden="true">×</span></button>').join('')+'<button type="button" class="btn btn-sm btn-quiet" data-action="clear-filters">مسح الكل</button>':'<span class="small-copy">تُعرض كل السجلات النشطة دون مرشحات.</span>')+'</div>';
}
function removeRegistryFilter(key){
  switch(key){
    case 'search':searchText='';break;
    case 'status':statusFilter='all';break;
    case 'priority':priorityFilter='all';break;
    case 'category':categoryFilter='all';break;
    case 'nature':natureFilter='all';break;
    case 'type':recordTypeFilter='all';break;
    case 'queue':quickView='all';break;
    case 'dates':dateFrom='';dateTo='';dateTypeFilter='created';break;
    default:return;
  }
  registryPage=1;render();$('#registryActiveFilters')?.focus({preventScroll:true});
}
let registrySearchTimer=null;
function scheduleRegistrySearch(input){
  clearTimeout(registrySearchTimer);
  searchText=input.value;
  registryPage=1;
  const owner=authenticatedUser;
  registrySearchTimer=setTimeout(()=>{
    registrySearchTimer=null;
    if(!owner||owner!==authenticatedUser||page!=='complaints'||$('#complaintSearch')!==input)return;
    const focused=document.activeElement===input;
    const start=input.selectionStart,end=input.selectionEnd;
    render();
    const replacement=$('#complaintSearch');
    if(focused&&replacement){
      replacement.focus({preventScroll:true});
      if(start!==null&&end!==null)replacement.setSelectionRange(start,end);
    }
  },150);
}

function complaintDateValue(c, type){
  if(type==='first_contact') return c.firstContactDate || '';
  if(type==='updated') return c.updated || c.created || '';
  if(type==='due') return c.due || '';
  if(type==='closed') return c.closedAt || c.closed || '';
  if(type==='referral_sent'){
    const refs=c.referrals||[];
    if(!refs.length) return '';
    return refs.map(r=>r.sent||r.at||'').filter(Boolean).sort().pop()||'';
  }
  return c.created || c.createdAt || '';
}

function inDateRange(c){
  if(!dateFrom && !dateTo) return true;
  const raw=complaintDateValue(c, dateTypeFilter);
  if(!raw) return false;
  const day=/^\d{4}-\d{2}-\d{2}$/.test(String(raw))?String(raw):Number.isFinite(Date.parse(raw))?workDayKey(raw):'';
  if(!day)return false;
  if(dateFrom && day < dateFrom) return false;
  if(dateTo && day > dateTo) return false;
  return true;
}

function filters(){
  ensureManagedSettings();
  const cats=db.settings.categories||[];
  const natures=db.settings.natures||[];
  const layout=typeof registryLayoutMode==='function'?registryLayoutMode():'table';
  return '<div class="table-tools registry-tools registry-compact-tools">'+
  '<div class="search-box registry-search"><span aria-hidden="true">⌕</span><input class="field" id="complaintSearch" aria-label="بحث في الشكاوى" placeholder="ابحث بالرقم أو الاسم أو الهاتف أو النص..." value="'+esc(searchText)+'"></div>'+
  '<div class="filter-actions registry-view-actions">'+
  '<div class="layout-toggle" role="group" aria-label="طريقة العرض">'+
  '<button type="button" class="btn btn-sm layout-btn '+(layout==='table'?'is-active':'')+'" data-action="registry-layout" data-layout="table" aria-pressed="'+(layout==='table')+'">جدول</button>'+
  '<button type="button" class="btn btn-sm layout-btn '+(layout==='cards'?'is-active':'')+'" data-action="registry-layout" data-layout="cards" aria-pressed="'+(layout==='cards')+'">بطاقات</button>'+
  '</div>'+
  '</div>'+
  '<details class="registry-advanced" id="registryAdvanced" '+(registryAdvancedOpen?'open':'')+'><summary>مرشحات إضافية <span class="small-copy">الحالة والأولوية والتصنيف والتاريخ</span></summary><div class="registry-advanced-fields">'+
  '<div class="filter-group" role="group" aria-label="تصفية الحالة والأولوية">'+
  '<select class="select-field" id="statusFilter" aria-label="تصفية حسب الحالة"><option value="all">كل الحالات</option>'+['draft','new','in_progress','closed','cancelled'].map(s=>'<option value="'+s+'" '+(statusFilter===s?'selected':'')+'>'+statusLabel(s)+'</option>').join('')+'</select>'+
  '<select class="select-field" id="priorityFilter" aria-label="تصفية حسب الأولوية"><option value="all">كل الأولويات</option>'+['urgent','high','normal','low'].map(p=>'<option value="'+p+'" '+(priorityFilter===p?'selected':'')+'>'+priorityLabel(p)+'</option>').join('')+'</select>'+
  '</div>'+
  '<div class="filter-group" role="group" aria-label="تصفية التصنيف والطبيعة">'+
  '<select class="select-field" id="categoryFilter" aria-label="تصفية حسب التصنيف"><option value="all">كل التصنيفات</option>'+cats.map(c=>'<option value="'+esc(c)+'" '+(categoryFilter===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
  '<select class="select-field" id="natureFilter" aria-label="تصفية حسب طبيعة الشكاوي"><option value="all">كل أنواع الطبيعة</option>'+natures.map(n=>'<option value="'+esc(n)+'" '+(natureFilter===n?'selected':'')+'>'+esc(n)+'</option>').join('')+'</select>'+
  '</div>'+
  '<div class="filter-group filter-dates" role="group" aria-label="نطاق التاريخ">'+
  '<select class="select-field" id="dateTypeFilter" aria-label="نوع التاريخ">'+
  [['first_contact','تاريخ أول تواصل'],['created','تاريخ التسجيل'],['updated','آخر تحديث'],['due','موعد المتابعة'],['closed','تاريخ الإغلاق']].map(([v,l])=>'<option value="'+v+'" '+(dateTypeFilter===v?'selected':'')+'>'+l+'</option>').join('')+
  '</select>'+
  '<input class="field" id="dateFrom" type="date" aria-label="من تاريخ" value="'+esc(dateFrom||'')+'">'+
  '<input class="field" id="dateTo" type="date" aria-label="إلى تاريخ" value="'+esc(dateTo||'')+'">'+
  '</div>'+
  '<div class="registry-filter-footer"><span class="small-copy">تُطبّق المرشحات فور اختيارها.</span><button type="button" class="btn btn-sm" data-action="clear-filters">مسح المرشحات</button><button type="button" class="btn btn-sm" data-action="close-registry-filters">تم</button></div>'+
  (typeof savedFiltersBarHtml==='function'?savedFiltersBarHtml():'')+'</div></details></div>';
}

function filteredComplaints(){
  quickView=normalizeRegistryQueue(quickView);
  const q=norm(searchText);
  return db.complaints.filter(c=>
    (quickView==='archived'?Boolean(c.archivedAt):!c.archivedAt)&&
    (!q||norm([c.id,c.name,c.phone,c.province,c.entity,c.category,c.nature,c.summary,c.details].join(' ')).includes(q))&&
    (statusFilter==='all'||c.status===statusFilter||(statusFilter==='in_progress'&&['awaiting_reply','awaiting_approval'].includes(c.status)))&&
    (priorityFilter==='all'||c.priority===priorityFilter)&&
    (categoryFilter==='all'||c.category===categoryFilter)&&
    (natureFilter==='all'||(c.nature||'')===natureFilter)&&
    (recordTypeFilter==='all'||recordTypeOf(c)===recordTypeFilter)&&
    inDateRange(c)&&
    (quickView==='all'||quickView==='archived'||
      (quickView==='late'&&isLate(c))||
      (quickView==='due-soon'&&isDueSoon(c))||
      (quickView==='missing'&&isIncomplete(c))||
      (quickView==='new-today'&&!['closed','cancelled'].includes(c.status)&&isCreatedToday(c))||
      (quickView==='urgent-no-reply'&&c.priority==='urgent'&&!c.reply))
  );
}

function complaintsPage(){
  const rows=filteredComplaints();
  const totalPages=Math.max(1,Math.ceil(rows.length/50));
  registryPage=Math.min(Math.max(1,registryPage),totalPages);
  const visibleRows=rows.slice((registryPage-1)*50,registryPage*50);
  const lateN=rows.filter(isLate).length;
  const openN=rows.filter(c=>!['closed','cancelled'].includes(c.status)).length;
  const layout=typeof registryLayoutMode==='function'?registryLayoutMode():'table';
  return '<div class="registry-workspace">'+heading('سجل الشكاوى والاستفسارات','إدارة الشكاوى والاستفسارات والتواصل.',(!uiCan('complaints.create')?'':btn('＋ تسجيل سجل جديد','new-complaint','btn-primary'))+btn('بحث عام','global-search')+(uiCan('export.xlsx')?btn('تصدير PDF','export-registry-pdf'):'')+btn('أعمدة السجل','registry-columns'))+
  '<div class="registry-summary" aria-label="ملخص النتائج"><span class="reg-sum-item"><strong>'+rows.length+'</strong> نتيجة</span><span class="reg-sum-item">مفتوحة: <strong>'+openN+'</strong></span><span class="reg-sum-item'+(lateN?' is-late':'')+'">متأخرة: <strong>'+lateN+'</strong></span><span class="reg-sum-item muted">صفحة '+registryPage+' / '+totalPages+'</span></div>'+
  '<div class="filters-row registry-chips"><button class="filter-chip '+(quickView==='all'&&recordTypeFilter==='all'?'active':'')+'" data-action="quick-filter" data-value="all">الكل</button><button class="filter-chip '+(recordTypeFilter==='complaint'?'active':'')+'" data-action="filter-record-type" data-value="complaint">شكاوى</button><button class="filter-chip '+(recordTypeFilter==='inquiry'?'active':'')+'" data-action="filter-record-type" data-value="inquiry">استفسارات</button><button class="filter-chip '+(recordTypeFilter==='contact'?'active':'')+'" data-action="filter-record-type" data-value="contact">تواصل</button><button class="filter-chip '+(quickView==='late'?'active':'')+'" data-action="filter-late">متأخرة</button><button class="filter-chip '+(quickView==='missing'?'active':'')+'" data-action="quick-filter" data-value="missing">غير مكتملة</button><button class="filter-chip '+(quickView==='archived'?'active':'')+'" data-action="quick-filter" data-value="archived">الأرشيف</button></div>'+
  '<section class="panel table-panel registry-panel">'+filters()+activeRegistryFiltersHtml()+complaintTable(visibleRows,{select:false,layout:layout,emptyMessage:db.complaints.length?'لا توجد شكاوى تطابق المرشحات الحالية. امسح المرشحات لعرض السجل.':'لا توجد شكاوى مسجلة بعد. يمكنك تسجيل سجل جديد.'})+'<div class="table-footer registry-footer"><span>عرض '+(visibleRows.length?((registryPage-1)*50+1):0)+'–'+((registryPage-1)*50+visibleRows.length)+' من '+rows.length+'</span><div class="pager"><button class="btn btn-sm" data-action="registry-prev" '+(registryPage<=1?'disabled':'')+'>السابق</button> <span class="pager-label">'+registryPage+' / '+totalPages+'</span> <button class="btn btn-sm" data-action="registry-next" '+(registryPage>=totalPages?'disabled':'')+'>التالي</button></div></div></section></div>';
}
