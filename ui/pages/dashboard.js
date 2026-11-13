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
      '<p class="card-meta">'+esc(meta)+'</p>'+
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
    '<th class="col-id">رقم السجل</th><th class="col-type">النوع</th><th class="col-subject">الموضوع / المشتكي</th><th class="col-prov">المحافظة</th><th class="col-status">الحالة</th><th class="col-pri">الأولوية</th><th class="col-age">مدة البقاء</th><th class="col-act">الإجراء</th></tr></thead><tbody>'+
    rows.map(c=>{
      const late=isLate(c);
      const incomplete=typeof isIncomplete==='function'&&isIncomplete(c);
      const rowClass=[late?'is-late':'',incomplete?'is-incomplete':'',selectedIds.has(c.id)?'is-selected':''].filter(Boolean).join(' ');
      const meta=[c.name||'غير محدد',c.nature||'',c.category||''].filter(Boolean).join(' · ');
      return '<tr class="'+rowClass+'" data-id="'+esc(c.id)+'">'+ 
      (opts.select?'<td class="col-check"><input class="table-check row-check" type="checkbox" aria-label="تحديد '+esc(c.id)+'" data-id="'+esc(c.id)+'" '+(selectedIds.has(c.id)?'checked':'')+'></td>':'')+
      '<td class="col-id"><span class="ticket-id" dir="ltr"><bdi>'+esc(c.id)+'</bdi></span><span class="row-sub">'+dateText(c.created)+'</span></td>'+
      '<td class="col-type">'+pillRecordType(c)+'</td>'+
      '<td class="col-subject"><button class="text-link row-title" data-action="detail" data-id="'+esc(c.id)+'">'+esc(c.summary)+'</button><span class="row-sub">'+esc(meta)+'</span></td>'+
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
  const raw=c.created||c.createdAt||'';
  if(!raw) return false;
  const day=String(raw).slice(0,10);
  const today=new Date();
  const y=today.getFullYear();
  const m=String(today.getMonth()+1).padStart(2,'0');
  const d=String(today.getDate()).padStart(2,'0');
  return day===y+'-'+m+'-'+d;
}

function dashboard(){
  const late=lateComplaints(),approvals=pendingApprovals();
  const open=db.complaints.filter(c=>!c.archivedAt&&!['closed','cancelled'].includes(c.status));
  const dueSoon=open.filter(c=>isDueSoon(c));
  const missing=open.filter(isIncomplete);
  const pendingReferrals=referralList().filter(r=>!r.response);
  const urgentNoReply=open.filter(c=>c.priority==='urgent'&&!c.reply);
  const newToday=open.filter(c=>c.status==='new'||isCreatedToday(c));
  const priority=[...open].sort((a,b)=>{
    const score=c=>(isLate(c)?-1e14:0)+(c.priority==='urgent'?-1e12:c.priority==='high'?-1e11:0);
    const due=c=>{const n=new Date(c.due).getTime();return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;};
    return score(a)-score(b)||due(a)-due(b);
  }).slice(0,5);
  const tasks=[
    [late.length,'red','!','شكاوى متجاوزة للمهلة','وفق المهلة المعتمدة — عالجها أولًا','filter-late',null],
    [urgentNoReply.length,'red','⚡','عاجلة بلا رد','أولوية عاجلة ولم يُصغَ رد بعد','urgent-no-reply',null],
    [dueSoon.length,'amber','◷','مهل تستحق خلال 48 ساعة','ابدأ المتابعة قبل تجاوز المهلة','filter-due-soon',null],
    [approvals.length,'amber','✓','ردود تنتظر الاعتماد','اعتماد الرد من مستخدم مخوّل','', 'replies'],
    [pendingReferrals.length,'blue','↗','إحالات لم يصل ردها','تابع الجهات المحال إليها','', 'referrals'],
    [missing.length,'amber','≡','سجلات تحتاج استكمالًا','نقص في الحقول الأساسية','filter-missing',null],
    [newToday.length,'blue','＋','جديدة اليوم','وردت أو ما زالت بحالة جديدة','quick-filter','',{value:'all'}]
  ].filter(task=>task[0]>0);
  const taskHtml=tasks.length?tasks.map(([n,color,icon,label,description,action,dest])=>
    '<div class="task-row" role="listitem">'+
      '<div class="task-symbol '+color+'" aria-hidden="true">'+icon+'</div>'+
      '<div class="task-copy"><strong>'+label+'</strong><small>'+description+'</small></div>'+
      '<div class="task-controls"><span class="task-value" aria-label="عدد السجلات: '+n+'">'+n+'</span>'+
      '<button type="button" class="btn btn-sm task-review" aria-label="مراجعة '+label+'" '+(dest?'data-goto="'+dest+'"':(action==='quick-filter'?'data-action="quick-filter" data-value="all"':'data-action="'+action+'"'))+'>مراجعة</button></div>'+
    '</div>'
  ).join(''):'<div class="empty-state calm-empty">لا شيء يحتاج انتباهك الآن. يمكنك مراجعة السجل أو تسجيل شكوى جديدة.</div>';
  const statusGroups=[['جديدة',countStatus('new')],['قيد المعالجة',countStatus('in_progress')],['بانتظار رد الجهة',countStatus('awaiting_reply')],['بانتظار الاعتماد',countStatus('awaiting_approval')],['مغلقة',countStatus('closed')]];
  const totalActive=db.complaints.filter(c=>!c.archivedAt).length;
  return '<div class="dashboard-workspace">'+heading('مكتب الفرز والمتابعة','رتّب العمل وفق المهلة والأولوية، ثم انتقل مباشرة إلى الإجراء المطلوب.',uiCan('complaints.create')?btn('＋ تسجيل شكوى','new-complaint','btn-primary'):'')+
    (typeof workdayPanel==='function'?workdayPanel():'')+
    '<div class="dashboard-stats" aria-label="مؤشرات سريعة">'+
      [['جميع السجلات',totalActive],['مفتوحة',open.length],['متأخرة',late.length],['بانتظار رد الجهة',countStatus('awaiting_reply')]].map(([label,n],i)=>
        '<div class="stat-item '+(i===0?'stat-primary':i===2&&n?'alert':'')+'"><strong>'+n+'</strong><span>'+label+'</span></div>'
      ).join('')+
    '</div>'+
    '<div class="work-grid"><section class="panel dashboard-actions"><div class="panel-header"><div><h2>ما الذي يحتاج إجراءً الآن؟</h2><p>المهام المفتوحة فقط — الأهم أولًا</p></div><button type="button" class="btn btn-sm" data-goto="complaints">فتح السجل</button></div><div class="panel-body"><div class="task-list" role="list" aria-label="المهام التي تحتاج إجراء">'+taskHtml+'</div></div></section>'+
    '<section class="panel"><div class="panel-header"><div><h2>توزيع الحالات</h2><p>من أصل '+totalActive+' سجلًا نشطًا</p></div></div><div class="panel-body"><div class="status-list">'+statusGroups.map(([label,n],i)=>
      '<div><div class="status-line"><span>'+label+'</span><span>'+n+'</span></div><div class="progress"><span class="'+(i===0?'blue-fill':i===3?'amber-fill':'')+'" style="width:'+(totalActive?Math.max(n?5:0,n/totalActive*100):0)+'%"></span></div></div>'
    ).join('')+'</div></div></section></div>'+
    '<section class="panel table-panel"><div class="panel-header"><div><h2>أولوية المتابعة</h2><p>المتأخرة أولًا، ثم العاجلة، ثم الأقرب إلى انتهاء المهلة</p></div><button class="text-link" data-goto="complaints">عرض جميع الشكاوى</button></div>'+
      complaintTable(priority,{emptyMessage:'لا توجد شكاوى مفتوحة تحتاج إلى متابعة.'})+
    '</section></div>';
}
