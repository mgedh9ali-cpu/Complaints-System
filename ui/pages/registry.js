let registryPage=1;
let dateTypeFilter='created';
let recordTypeFilter='all';
let dateFrom='';
let dateTo='';

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
  const day=String(raw).slice(0,10);
  if(dateFrom && day < dateFrom) return false;
  if(dateTo && day > dateTo) return false;
  return true;
}

function filters(){
  ensureManagedSettings();
  const cats=db.settings.categories||[];
  const natures=db.settings.natures||[];
  return '<div class="table-tools registry-tools">'+
  '<div class="search-box registry-search"><span aria-hidden="true">⌕</span><input class="field" id="complaintSearch" aria-label="بحث في الشكاوى" placeholder="ابحث بالرقم أو الاسم أو الهاتف أو النص..." value="'+esc(searchText)+'"></div>'+
  '<div class="filter-group" role="group" aria-label="تصفية الحالة والأولوية">'+
  '<select class="select-field" id="statusFilter" aria-label="تصفية حسب الحالة"><option value="all">كل الحالات</option>'+['draft','new','in_progress','awaiting_reply','awaiting_approval','closed','cancelled'].map(s=>'<option value="'+s+'" '+(statusFilter===s?'selected':'')+'>'+statusLabel(s)+'</option>').join('')+'</select>'+
  '<select class="select-field" id="priorityFilter" aria-label="تصفية حسب الأولوية"><option value="all">كل الأولويات</option>'+['urgent','high','normal','low'].map(p=>'<option value="'+p+'" '+(priorityFilter===p?'selected':'')+'>'+priorityLabel(p)+'</option>').join('')+'</select>'+
  '</div>'+
  '<div class="filter-group" role="group" aria-label="تصفية التصنيف والطبيعة">'+
  '<select class="select-field" id="categoryFilter" aria-label="تصفية حسب التصنيف"><option value="all">كل التصنيفات</option>'+cats.map(c=>'<option value="'+esc(c)+'" '+(categoryFilter===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
  '<select class="select-field" id="natureFilter" aria-label="تصفية حسب طبيعة الشكاوي"><option value="all">كل الطبائع</option>'+natures.map(n=>'<option value="'+esc(n)+'" '+(natureFilter===n?'selected':'')+'>'+esc(n)+'</option>').join('')+'</select>'+
  '</div>'+
  '<div class="filter-group filter-dates" role="group" aria-label="نطاق التاريخ">'+
  '<select class="select-field" id="dateTypeFilter" aria-label="نوع التاريخ">'+
  [['first_contact','تاريخ أول تواصل'],['created','تاريخ التسجيل'],['updated','آخر تحديث'],['due','موعد المتابعة'],['referral_sent','إرسال إحالة'],['closed','تاريخ الإغلاق']].map(([v,l])=>'<option value="'+v+'" '+(dateTypeFilter===v?'selected':'')+'>'+l+'</option>').join('')+
  '</select>'+
  '<input class="field" id="dateFrom" type="date" aria-label="من تاريخ" value="'+esc(dateFrom||'')+'">'+
  '<input class="field" id="dateTo" type="date" aria-label="إلى تاريخ" value="'+esc(dateTo||'')+'">'+
  '</div>'+
  '<div class="filter-actions">'+
  '<button class="btn btn-primary" type="button" data-action="global-search">بحث عام</button>'+
  '<button class="btn" data-action="clear-filters">مسح المرشحات</button>'+
  '</div></div>';
}

function filteredComplaints(){
  const q=norm(searchText);
  return db.complaints.filter(c=>
    (quickView==='archived'?Boolean(c.archivedAt):!c.archivedAt)&&
    (!q||norm([c.id,c.name,c.phone,c.province,c.entity,c.category,c.nature,c.summary,c.details].join(' ')).includes(q))&&
    (statusFilter==='all'||c.status===statusFilter)&&
    (priorityFilter==='all'||c.priority===priorityFilter)&&
    (categoryFilter==='all'||c.category===categoryFilter)&&
    (natureFilter==='all'||(c.nature||'')===natureFilter)&&
    (recordTypeFilter==='all'||(recordTypeFilter==='inquiry'? (typeof isInquiryRecord==='function'&&isInquiryRecord(c)) : !(typeof isInquiryRecord==='function'&&isInquiryRecord(c))))&&
    inDateRange(c)&&
    (quickView==='all'||quickView==='archived'||
      (quickView==='late'&&isLate(c))||
      (quickView==='due-soon'&&isDueSoon(c))||
      (quickView==='missing'&&isIncomplete(c))||
      (quickView==='mine')||
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
  return heading('سجل الشكاوى والاستفسارات','ابحث بالعربية مع تجاهل التشكيل. زر «بحث عام» لأي رقم أو اسم أو هاتف.',(!uiCan('complaints.create')?'':btn('＋ تسجيل شكوى جديدة','new-complaint','btn-primary'))+btn('أعمدة السجل','registry-columns')+(selectedIds.size?btn('إجراءات جماعية','bulk-open'):''))+
  '<div class="registry-summary" aria-label="ملخص النتائج"><span class="reg-sum-item"><strong>'+rows.length+'</strong> نتيجة</span><span class="reg-sum-item">مفتوحة: <strong>'+openN+'</strong></span><span class="reg-sum-item'+(lateN?' is-late':'')+'">متأخرة: <strong>'+lateN+'</strong></span><span class="reg-sum-item muted">صفحة '+registryPage+' / '+totalPages+'</span></div>'+
  '<div class="filters-row registry-chips"><button class="filter-chip '+(quickView==='all'?'active':'')+'" data-action="quick-filter" data-value="all">كل السجلات</button><button class="filter-chip '+(recordTypeFilter==='complaint'?'active':'')+'" data-action="filter-record-type" data-value="complaint">شكاوى فقط</button><button class="filter-chip '+(recordTypeFilter==='inquiry'?'active':'')+'" data-action="filter-record-type" data-value="inquiry">استفسارات فقط</button><button class="filter-chip '+(quickView==='urgent-no-reply'?'active':'')+'" data-action="urgent-no-reply">عاجلة بلا رد</button><button class="filter-chip" data-goto="replies">تنتظر الاعتماد</button><button class="filter-chip '+(quickView==='late'?'active':'')+'" data-action="filter-late">متجاوزة المهلة</button><button class="filter-chip '+(quickView==='missing'?'active':'')+'" data-action="quick-filter" data-value="missing">بيانات غير مكتملة</button><button class="filter-chip '+(quickView==='archived'?'active':'')+'" data-action="quick-filter" data-value="archived">الأرشيف</button></div>'+
  '<section class="panel table-panel registry-panel">'+filters()+'<div id="bulkMount">'+(selectedIds.size?'<div class="bulk-bar"><span>تم تحديد '+selectedIds.size+' سجلًا</span><div class="footer-actions"><button class="btn btn-sm" data-action="bulk-priority">تغيير الأولوية</button><button class="btn btn-sm" data-action="export-selected">تصدير المحدد</button><button class="btn btn-sm btn-quiet" data-action="clear-selection">إلغاء التحديد</button></div></div>':'')+'</div>'+complaintTable(visibleRows,{select:true,emptyMessage:db.complaints.length?'لا توجد شكاوى تطابق المرشحات الحالية. امسح المرشحات لعرض السجل.':'لا توجد شكاوى مسجلة بعد. يمكنك تسجيل شكوى جديدة.'})+'<div class="table-footer registry-footer"><span>عرض '+(visibleRows.length?((registryPage-1)*50+1):0)+'–'+((registryPage-1)*50+visibleRows.length)+' من '+rows.length+'</span><div class="pager"><button class="btn btn-sm" data-action="registry-prev" '+(registryPage<=1?'disabled':'')+'>السابق</button> <span class="pager-label">'+registryPage+' / '+totalPages+'</span> <button class="btn btn-sm" data-action="registry-next" '+(registryPage>=totalPages?'disabled':'')+'>التالي</button></div></div></section>';
}
