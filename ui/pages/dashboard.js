function heading(title,desc,actions=''){return '<div class="page-heading"><div><h1>'+title+'</h1><p>'+desc+'</p></div><div class="heading-actions">'+actions+'</div></div>';}
function btn(label,action,kind=''){return '<button class="btn '+kind+'" data-action="'+action+'">'+label+'</button>';}

function isInquiryRecord(c){
  if(!c) return false;
  if(c.recordType==='inquiry') return true;
  if(c.recordType==='complaint') return false;
  const cat=norm(c.category||'');
  const nat=norm(c.nature||'');
  return cat.includes('استفسار') || nat==='استفسار' || nat.includes('استفسار');
}
function pillRecordType(c){
  if(isInquiryRecord(c))
    return '<span class="pill pill-inquiry" title="استفسار">استفسار</span>';
  return '<span class="pill pill-complaint" title="شكوى">شكوى</span>';
}

/** Current registry layout preference: 'table' | 'cards' */
function registryLayoutMode(){
  try{
    const v=localStorage.getItem('complaints-registry-layout');
    return v==='cards'?'cards':'table';
  }catch(_){return 'table';}
}
function setRegistryLayoutMode(mode){
  const next=mode==='cards'?'cards':'table';
  try{localStorage.setItem('complaints-registry-layout',next);}catch(_){}
  return next;
}

function complaintCards(rows,opts={}){
  if(!rows.length)return '<div class="empty-state registry-empty"><div class="empty-icon" aria-hidden="true">☰</div><p>'+esc(opts.emptyMessage||'لا توجد سجلات في هذا العرض.')+'</p></div>';
  return '<div class="registry-cards" role="list">'+rows.map(c=>{
    const late=isLate(c);
    const incomplete=typeof isIncomplete==='function'&&isIncomplete(c);
    const cardClass=['registry-card',late?'is-late':'',incomplete?'is-incomplete':'',selectedIds.has(c.id)?'is-selected':''].filter(Boolean).join(' ');
    const meta=[c.name||'غير محدد',c.province||'',c.nature||c.category||''].filter(Boolean).join(' · ');
    return '<article class="'+cardClass+'" role="listitem" data-id="'+esc(c.id)+'">'+ 
      (opts.select?'<label class="card-check"><input class="table-check row-check" type="checkbox" aria-label="تحديد '+esc(c.id)+'" data-id="'+esc(c.id)+'" '+(selectedIds.has(c.id)?'checked':'')+'></label>':'')+
      '<div class="card-top">'+ 
        '<span class="ticket-id" dir="ltr"><bdi>'+esc(c.id)+'</bdi></span>'+
        pillRecordType(c)+
        pillStatus(c.status)+
        pillPriority(c.priority)+
      '</div>'+
      '<button type="button" class="text-link card-title" data-action="detail" data-id="'+esc(c.id)+'">'+esc(c.summary||'بدون موضوع')+'</button>'+
      '<p class="card-meta">'+esc(meta)+'</p>'+missingFieldsHtml(c)+
      '<div class="card-footer">'+
        '<div class="sla-cell">'+slaIndicator(c)+'<span class="age '+(late?'late':ageDays(c)>5?'soon':'ok')+'">'+ageDays(c)+'ي'+(late?' · متأخرة':'')+'</span></div>'+
        '<span class="card-date">'+dateText(c.created)+'</span>'+
        '<div class="action-cell card-actions">'+complaintRecordActions(c,true)+'</div>'+
      '</div>'+
    '</article>';
  }).join('')+'</div>';
}

function complaintTable(rows,opts={}){
  if(!rows.length)return '<div class="empty-state registry-empty"><div class="empty-icon" aria-hidden="true">☰</div><p>'+esc(opts.emptyMessage||'لا توجد سجلات في هذا العرض.')+'</p></div>';
  const layout=opts.layout||registryLayoutMode();
  if(layout==='cards')return complaintCards(rows,opts);
  return '<div class="table-wrap registry-table-wrap"><table class="registry-table"><thead><tr>'+
    (opts.select?'<th class="col-check"><input class="table-check" type="checkbox" aria-label="تحديد الكل" data-action="select-all"></th>':'')+
    '<th class="col-id">رقم السجل</th><th class="col-type">النوع</th><th class="col-subject">الموضوع / المشتكي</th><th class="col-prov">المحافظة</th><th class="col-status">الحالة</th><th class="col-pri">الأولوية</th><th class="col-age">مدة البقاء</th><th class="col-act">الإجراءات</th></tr></thead><tbody>'+
    rows.map(c=>{
      const late=isLate(c);
      const incomplete=typeof isIncomplete==='function'&&isIncomplete(c);
      const rowClass=[late?'is-late':'',incomplete?'is-incomplete':'',selectedIds.has(c.id)?'is-selected':''].filter(Boolean).join(' ');
      const meta=[c.name||'غير محدد',c.nature||'',c.category||''].filter(Boolean).join(' · ');
      return '<tr class="'+rowClass+'" data-id="'+esc(c.id)+'">'+ 
      (opts.select?'<td class="col-check"><input class="table-check row-check" type="checkbox" aria-label="تحديد '+esc(c.id)+'" data-id="'+esc(c.id)+'" '+(selectedIds.has(c.id)?'checked':'')+'></td>':'')+
      '<td class="col-id"><span class="ticket-id" dir="ltr"><bdi>'+esc(c.id)+'</bdi></span><span class="row-sub">'+dateText(c.created)+'</span></td>'+
      '<td class="col-type">'+pillRecordType(c)+'</td>'+
      '<td class="col-subject"><button class="text-link row-title" data-action="detail" data-id="'+esc(c.id)+'">'+esc(c.summary)+'</button><span class="row-sub">'+esc(meta)+'</span>'+missingFieldsHtml(c)+'</td>'+
      '<td class="col-prov">'+esc(c.province||'—')+'</td>'+
      '<td class="col-status">'+pillStatus(c.status)+'</td>'+
      '<td class="col-pri">'+pillPriority(c.priority)+'</td>'+
      '<td class="col-age"><div class="sla-cell">'+slaIndicator(c)+'<span class="age '+(late?'late':ageDays(c)>5?'soon':'ok')+'">'+ageDays(c)+'ي'+(late?' · متأخرة':'')+'</span></div></td>'+
      '<td class="col-act"><div class="action-cell">'+complaintRecordActions(c,true)+'</div></td></tr>';
    }).join('')+
    '</tbody></table></div>';
}

function slaIndicator(c){
  const start=new Date(c.created).getTime(),due=new Date(c.due).getTime();
  if(!db.settings.slaApproved||!Number.isFinite(start)||!Number.isFinite(due)||due<=start)
    return '<span class="sla-unset" title="لا توجد مهلة معتمدة">—</span>';
  const p=Math.max(0,Math.min(100,Math.round((Date.now()-start)/(due-start)*100)));
  const level=Date.now()>due?'late':p>=75?'warn':'normal';
  return '<span class="sla-ring" style="--p:'+p+'" data-level="'+level+'" role="img" aria-label="'+p+'٪ من المهلة، '+(level==='late'?'متأخرة':level==='warn'?'تقترب من المهلة':'ضمن المهلة')+'" title="'+p+'٪ من المهلة"></span>';
}

function isCreatedToday(c){
  const raw=c.created||c.createdAt;
  return Boolean(raw&&workDayKey(raw)&&workDayKey(raw)===workDayKey(Date.now()));
}

function incompleteRecords(){
  const rank=c=>c.status==='draft'?0:missingFields(c).some(field=>field.level==='action')?1:2;
  const created=c=>{const date=Date.parse(c.created);return Number.isFinite(date)?date:Number.MAX_SAFE_INTEGER;};
  return db.complaints.filter(isIncomplete).sort((a,b)=>rank(a)-rank(b)||created(a)-created(b)||String(a.id).localeCompare(String(b.id)));
}
function incompleteRecordsPanel(){
  const title='<div class="completion-heading"><h3 id="completionTitle">سجلات تحتاج استكمالًا</h3>';
  try{
    const rows=incompleteRecords();
    return '<section class="completion-card" aria-labelledby="completionTitle">'+title+'<span>'+rows.length+' سجلات</span></div>'+
      (rows.length?'<ul class="completion-list">'+rows.slice(0,5).map(c=>{
        const days=ageDays(c),age=Number.isFinite(days)?(days===0?'مسجلة اليوم':'مسجلة منذ '+days+' أيام'):'تاريخ التسجيل غير متاح';
        const edit=uiCan('complaints.update');
        return '<li><div class="completion-record"><button type="button" class="text-link" data-action="detail" data-id="'+esc(c.id)+'"><bdi dir="ltr">'+esc(c.id)+'</bdi> · '+esc(c.summary||'بدون موضوع')+'</button>'+pillStatus(c.status)+'</div>'+
          missingFieldsHtml(c)+'<div class="completion-footer"><small>'+age+'</small><button type="button" class="btn btn-sm" data-action="'+(edit?(c.status==='draft'?'complete-draft':'edit-complaint'):'detail')+'" data-id="'+esc(c.id)+'">'+(edit?(c.status==='draft'?'استكمال المسودة':'استكمال البيانات'):'فتح السجل')+'</button></div></li>';
      }).join('')+'</ul><button type="button" class="btn btn-sm" data-action="filter-missing">عرض جميع السجلات الناقصة</button>':
      '<p class="small-copy calm-empty">كل السجلات المفتوحة تحتوي على المعلومات المطلوبة للمتابعة.</p>')+'</section>';
  }catch(_){
    return '<section class="completion-card" aria-labelledby="completionTitle">'+title+'</div><p role="alert">تعذر تحميل قائمة السجلات الناقصة.</p><button type="button" class="btn btn-sm" data-action="retry-missing">إعادة المحاولة</button></section>';
  }
}
async function retryIncompleteRecords(){
  await flushUiBeforeAction();await loadDb();render();
}

function dashboardBriefRank(tasks){
  const order={late:0,'urgent-no-reply':1,'due-soon':2,approvals:3,referrals:4,'new-today':5};
  return [...tasks].sort((a,b)=>(order[a.key]??99)-(order[b.key]??99));
}

function dashboard(){
  const late=lateComplaints(),approvals=pendingApprovals();
  const open=db.complaints.filter(c=>!c.archivedAt&&!['closed','cancelled'].includes(c.status));
  const dueSoon=open.filter(c=>isDueSoon(c));
  const pendingReferrals=open.filter(waitingForReferral);
  const urgentNoReply=open.filter(c=>c.priority==='urgent'&&!c.reply);
  const newToday=open.filter(isCreatedToday);
  const priority=[...open].sort((a,b)=>{
    const score=c=>(isLate(c)?-1e14:0)+(c.priority==='urgent'?-1e12:c.priority==='high'?-1e11:0);
    const due=c=>{const n=new Date(c.due).getTime();return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;};
    return score(a)-score(b)||due(a)-due(b);
  }).slice(0,5);

  const rawTasks=[
    {key:'late',n:late.length,color:'red',icon:'!',label:'شكاوى متجاوزة للمهلة',description:'وفق المهلة المعتمدة — عالجها أولًا',action:'filter-late'},
    {key:'urgent-no-reply',n:urgentNoReply.length,color:'red',icon:'⚡',label:'عاجلة بلا رد',description:'أولوية عاجلة ولم يُصغَ رد بعد',action:'urgent-no-reply'},
    {key:'due-soon',n:dueSoon.length,color:'amber',icon:'◷',label:'مهل تستحق خلال 48 ساعة',description:'ابدأ المتابعة قبل تجاوز المهلة',action:'filter-due-soon'},
    {key:'approvals',n:approvals.length,color:'amber',icon:'✓',label:'ردود تنتظر الاعتماد',description:'راجع نص الرد ثم اعتمده من حسابك',dest:'replies'},
    {key:'referrals',n:pendingReferrals.length,color:'blue',icon:'↗',label:'سجلات بانتظار رد جهة',description:'افتح السجل لمراجعة الإحالة وتسجيل رد الجهة',queue:'waiting-referrals'},
    {key:'new-today',n:newToday.length,color:'blue',icon:'＋',label:'جديدة اليوم',description:'السجلات المفتوحة المسجلة اليوم بتوقيت دمشق',queue:'new-today'}
  ].filter(t=>t.n>0);

  const tasks=dashboardBriefRank(rawTasks);
  const attentionCount=tasks.reduce((s,t)=>s+t.n,0);

  const taskHtml=tasks.length?tasks.map(t=>
    '<div class="task-row task-row-'+t.color+'" role="listitem" data-brief-key="'+t.key+'">'+ 
      '<div class="task-symbol '+t.color+'" aria-hidden="true">'+t.icon+'</div>'+
      '<div class="task-copy"><strong>'+t.label+'</strong><small>'+t.description+'</small></div>'+
      '<div class="task-controls"><span class="task-value" aria-label="عدد السجلات: '+t.n+'">'+t.n+'</span>'+
      '<button type="button" class="btn btn-sm task-review" aria-label="مراجعة '+t.label+'" '+
        (t.queue?'data-action="registry-queue" data-queue="'+t.queue+'"':
         t.dest?'data-goto="'+t.dest+'"':
         'data-action="'+t.action+'"')+
      '>فتح السجلات</button></div>'+
    '</div>'
  ).join(''):'<div class="brief-empty calm-empty"><p class="small-copy">لا توجد مهام عاجلة الآن. يمكنك متابعة السجل أو تسجيل سجل جديد.</p></div>';

  const statusGroups=[['جديدة',countStatus('new')],['قيد المعالجة',countStatus('in_progress')],['بانتظار رد الجهة',countStatus('awaiting_reply')],['بانتظار الاعتماد',countStatus('awaiting_approval')],['مغلقة',countStatus('closed')]];
  const totalActive=db.complaints.filter(c=>!c.archivedAt).length;

  const briefBanner=attentionCount
    ? '<div class="brief-banner" role="status"><strong>موجز اليوم</strong><span>'+attentionCount+' بند يحتاج انتباهًا</span></div>'
    : '<div class="brief-banner brief-banner-ok" role="status"><strong>موجز اليوم</strong><span>لا يوجد ما يستدعي إجراءً عاجلاً</span></div>';
  const slaNotice=db.settings?.slaApproved?'':'<div class="brief-banner brief-banner-sla" role="status"><strong>عدّاد المهلة متوقف</strong><span>طوابير المتأخر وخلال 48 ساعة تبقى فارغة حتى تُعتمد أيام العمل من الإعدادات، ولن يُفعَّل العدّاد وحده.</span><button type="button" class="btn btn-sm" data-goto="settings">فتح إعداد المهلة</button></div>';

  return '<div class="dashboard-workspace">'+heading('مكتب الفرز والمتابعة','رتّب العمل وفق المهلة والأولوية، ثم انتقل مباشرة إلى الإجراء المطلوب.',uiCan('complaints.create')?btn('＋ تسجيل شكوى','new-complaint','btn-primary'):'')+
    (typeof workdayPanel==='function'?workdayPanel():'')+
    briefBanner+slaNotice+
    '<div class="dashboard-stats" aria-label="مؤشرات سريعة">'+
      [['جميع السجلات',totalActive],['مفتوحة',open.length],['متأخرة',late.length],['بانتظار رد الجهة',countStatus('awaiting_reply')]].map(([label,n],i)=>
        '<div class="stat-item '+(i===0?'stat-primary':i===2&&n?'alert':'')+'"><strong>'+n+'</strong><span>'+label+'</span></div>'
      ).join('')+
    '</div>'+
    '<div class="work-grid"><section class="panel dashboard-actions"><div class="panel-header"><div><h2>ما الذي يحتاج إجراءً الآن؟</h2><p>المهام المفتوحة فقط — الأهم أولًا</p></div><button type="button" class="btn btn-sm" data-goto="complaints">فتح السجل</button></div><div class="panel-body"><div class="task-list" role="list" aria-label="المهام التي تحتاج إجراء">'+taskHtml+'</div>'+incompleteRecordsPanel()+'</div></section>'+
    '<section class="panel"><div class="panel-header"><div><h2>توزيع الحالات</h2><p>من أصل '+totalActive+' سجلًا نشطًا</p></div></div><div class="panel-body"><div class="status-list">'+statusGroups.map(([label,n],i)=>
      '<div><div class="status-line"><span>'+label+'</span><span>'+n+'</span></div><div class="progress"><span class="'+(i===0?'blue-fill':i===3?'amber-fill':'')+'" style="width:'+(totalActive?Math.max(n?5:0,n/totalActive*100):0)+'%"></span></div></div>'
    ).join('')+'</div></div></section></div>'+
    '<section class="panel table-panel"><div class="panel-header"><div><h2>أولوية المتابعة</h2><p>المتأخرة أولًا، ثم العاجلة، ثم الأقرب إلى انتهاء المهلة</p></div><button class="text-link" data-goto="complaints">عرض جميع الشكاوى</button></div>'+
      complaintTable(priority,{emptyMessage:'لا توجد شكاوى مفتوحة تحتاج إلى متابعة.'})+
    '</section></div>';
}