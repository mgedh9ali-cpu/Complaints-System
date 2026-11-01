function heading(title,desc,actions=''){return '<div class="page-heading"><div><div class="eyebrow">شعبة الاستفسارات والشكاوى</div><h1>'+title+'</h1><p>'+desc+'</p></div><div class="heading-actions">'+actions+'</div></div>';}
function btn(label,action,kind=''){return '<button class="btn '+kind+'" data-action="'+action+'">'+label+'</button>';}
function complaintTable(rows,opts={}){if(!rows.length)return '<div class="empty-state">'+esc(opts.emptyMessage||'لا توجد سجلات في هذا العرض.')+'</div>';return '<div class="table-wrap"><table><thead><tr>'+(opts.select?'<th><input class="table-check" type="checkbox" aria-label="تحديد الكل" data-action="select-all"></th>':'')+'<th>رقم الشكوى</th><th>الموضوع / المشتكي</th><th>المحافظة</th><th>الحالة</th><th>الأولوية</th><th>المسؤول</th><th>مدة البقاء</th><th>الإجراء</th></tr></thead><tbody>'+rows.map(c=>'<tr>'+(opts.select?'<td><input class="table-check row-check" type="checkbox" aria-label="تحديد '+esc(c.id)+'" data-id="'+esc(c.id)+'" '+(selectedIds.has(c.id)?'checked':'')+'></td>':'')+'<td><span class="ticket-id" dir="ltr"><bdi>'+esc(c.id)+'</bdi></span><span class="row-sub">'+dateText(c.created)+'</span></td><td><button class="text-link row-title" data-action="detail" data-id="'+esc(c.id)+'">'+esc(c.summary)+'</button><span class="row-sub">'+esc(c.name||'غير محدد')+'</span></td><td>'+esc(c.province||'—')+'</td><td>'+pillStatus(c.status)+'</td><td>'+pillPriority(c.priority)+'</td><td>'+esc(c.owner||'غير مسند')+'</td><td><div class="sla-cell">'+slaIndicator(c)+'<span class="age '+(isLate(c)?'late':ageDays(c)>5?'soon':'ok')+'">'+ageDays(c)+' يوم'+(isLate(c)?' · متأخرة':'')+'</span></div></td><td><div class="action-cell"><button data-action="detail" data-id="'+esc(c.id)+'" aria-label="فتح تفاصيل '+esc(c.id)+'">عرض</button></div></td></tr>').join('')+'</tbody></table></div>';}

function slaIndicator(c){
  const start=new Date(c.created).getTime(),due=new Date(c.due).getTime();
  if(!db.settings.slaApproved||!Number.isFinite(start)||!Number.isFinite(due)||due<=start)
    return '<span class="sla-unset" title="لا توجد مهلة معتمدة">—</span>';
  const p=Math.max(0,Math.min(100,Math.round((Date.now()-start)/(due-start)*100)));
  const level=Date.now()>due?'late':p>=75?'warn':'normal';
  return '<span class="sla-ring" style="--p:'+p+'" data-level="'+level+'" role="img" aria-label="'+p+'٪ من المهلة، '+(level==='late'?'متأخرة':level==='warn'?'تقترب من المهلة':'ضمن المهلة')+'" title="'+p+'٪ من المهلة"></span>';
}
function dashboard(){
  const late=lateComplaints(),approvals=pendingApprovals();
  const open=db.complaints.filter(c=>!['closed','cancelled'].includes(c.status));
  const missing=open.filter(c=>!c.province||!c.summary||!c.owner);
  const pendingReferrals=referralList().filter(r=>!r.response);
  const priority=[...open].sort((a,b)=>{
    const score=c=>(isLate(c)?-1e14:0)+(c.priority==='urgent'?-1e12:c.priority==='high'?-1e11:0);
    const due=c=>{const n=new Date(c.due).getTime();return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;};
    return score(a)-score(b)||due(a)-due(b);
  }).slice(0,5);
  const tasks=[
    [late.length,'red','!','شكاوى متجاوزة للمهلة','وفق المهلة المعتمدة','filter-late',null],
    [approvals.length,'amber','✓','ردود تنتظر الاعتماد','اعتماد الرد من مستخدم مخوّل','', 'replies'],
    [pendingReferrals.length,'blue','↗','إحالات لم يصل ردها','تابع الجهات المحال إليها','', 'referrals'],
    [missing.length,'amber','≡','سجلات تحتاج استكمالًا','نقص في الحقول الأساسية','filter-missing',null]
  ].filter(task=>task[0]>0);
  const taskHtml=tasks.length?tasks.map(([n,color,icon,label,description,action,dest])=>
    '<div class="task-row"><div class="task-symbol '+color+'">'+icon+'</div><div class="task-copy"><strong>'+label+'</strong><small>'+description+'</small></div><span class="task-value">'+n+'</span><button class="btn btn-sm" '+(dest?'data-goto="'+dest+'"':'data-action="'+action+'"')+'>مراجعة</button></div>'
  ).join(''):'<div class="empty-state calm-empty">لا شيء يحتاج انتباهك الآن. يمكنك مراجعة السجل أو تسجيل شكوى جديدة.</div>';
  const statusGroups=[['جديدة',countStatus('new')],['قيد المعالجة',countStatus('in_progress')],['بانتظار رد الجهة',countStatus('awaiting_reply')],['بانتظار الاعتماد',countStatus('awaiting_approval')],['مغلقة',countStatus('closed')]];
  return heading('مكتب الفرز والمتابعة','رتّب العمل وفق المهلة والأولوية، ثم انتقل مباشرة إلى الإجراء المطلوب.',authenticatedUser?.role==='reviewer'?'':btn('＋ تسجيل شكوى جديدة','new-complaint','btn-primary'))+
    '<div class="dashboard-stats" aria-label="مؤشرات سريعة">'+
      [['جميع السجلات',db.complaints.length],['مفتوحة',open.length],['متأخرة',late.length],['بانتظار الاعتماد',approvals.length]].map(([label,n],i)=>
        '<div class="stat-item '+(i===2&&n?'alert':'')+'"><strong>'+n+'</strong><span>'+label+'</span></div>'
      ).join('')+
    '</div>'+
    '<div class="work-grid"><section class="panel"><div class="panel-header"><div><h2>ما الذي يحتاج إجراءً الآن؟</h2><p>المهام المفتوحة، دون إظهار طوابير فارغة</p></div><button class="text-link" data-goto="complaints">فتح السجل</button></div><div class="panel-body"><div class="task-list">'+taskHtml+'</div></div></section>'+
    '<section class="panel"><div class="panel-header"><div><h2>توزيع الحالات</h2><p>من أصل '+db.complaints.length+' سجلًا</p></div></div><div class="panel-body"><div class="status-list">'+statusGroups.map(([label,n],i)=>
      '<div><div class="status-line"><span>'+label+'</span><span>'+n+'</span></div><div class="progress"><span class="'+(i===0?'blue-fill':i===3?'amber-fill':'')+'" style="width:'+(db.complaints.length?Math.max(n?5:0,n/db.complaints.length*100):0)+'%"></span></div></div>'
    ).join('')+'</div></div></section></div>'+
    '<section class="panel table-panel"><div class="panel-header"><div><h2>أولوية المتابعة</h2><p>المتأخرة أولًا، ثم العاجلة، ثم الأقرب إلى انتهاء المهلة</p></div><button class="text-link" data-goto="complaints">عرض جميع الشكاوى</button></div>'+
      complaintTable(priority,{emptyMessage:'لا توجد شكاوى مفتوحة تحتاج إلى متابعة.'})+
    '</section>';
}
