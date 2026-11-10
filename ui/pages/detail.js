const recordTimelineFilters=new Map();
function recordTimelineHtml(c){
 const f=recordTimelineFilters.get(c.id)||{event:'',by:'',from:'',to:''};
 const all=c.timeline||[];
 const options=(key,label)=>'<label>'+label+'<select class="select-field" data-timeline-filter="'+key+'"><option value="">الكل</option>'+[...new Set(all.map(t=>t[key]).filter(Boolean))].map(v=>'<option value="'+esc(v)+'" '+(f[key]===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
 const rows=all.filter(t=>{const day=Number.isFinite(Date.parse(t.at))?workDayKey(t.at):'';return (!f.event||t.event===f.event)&&(!f.by||t.by===f.by)&&(!f.from||(day&&day>=f.from))&&(!f.to||(day&&day<=f.to));});
 return '<section class="detail-section" id="complaint-timeline"><h3>سجل الإجراءات</h3><div class="record-filter-grid">'+options('event','الإجراء')+options('by','المستخدم')+['from','to'].map(k=>'<label>'+(k==='from'?'من تاريخ':'إلى تاريخ')+'<input class="field" type="date" data-timeline-filter="'+k+'" value="'+esc(f[k])+'"></label>').join('')+'</div><p class="small-copy">'+rows.length+' من '+all.length+' إجراء</p><div class="timeline">'+(rows.map(t=>'<div class="timeline-item"><strong>'+esc(t.event)+'</strong><p class="detail-prose">'+esc(t.detail||'')+'</p><small>'+esc(t.by||'')+' · '+timeText(t.at)+'</small></div>').join('')||'<p class="detail-empty">لا توجد إجراءات تطابق التصفية.</p>')+'</div></section>';
}
document.addEventListener('change',e=>{
 const key=e.target?.dataset?.timelineFilter;
 if(!['event','by','from','to'].includes(key))return;
 const f=recordTimelineFilters.get(currentId)||{event:'',by:'',from:'',to:''};
 f[key]=e.target.value;recordTimelineFilters.set(currentId,f);render();
});
function recordOverviewHtml(c){
 const last=(c.timeline||[])[0];
 const pending=(c.referrals||[]).filter(r=>!r.response&&!r.completedAt).map(r=>r.due).filter(Boolean).sort();
 const due=[...(!['closed','cancelled'].includes(c.status)?[c.due]:[]),...pending].filter(Boolean).sort()[0];
 return '<dl class="record-overview">'+[['الحالة',statusLabel(c.status)],['المسؤول',c.owner||'غير مسند'],['آخر إجراء',last?.event||'لا توجد إجراءات'],['الموعد القادم',due?dateText(due):'غير محدد']].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';
}
/* Record view: one heading, readable data, and a separate processing column. */
function complaintDetailField(label, value, direction = '') {
  return '<div class="detail-field"><dt>' + esc(label) + '</dt><dd' +
    (direction ? ' dir="' + direction + '"' : '') + '>' + esc(value || 'غير مسجل') + '</dd></div>';
}

function complaintDetailReply(c) {
  const id = esc(c.id), reply = c.reply;
  const receipt = '<button class="btn btn-sm" data-action="print-receipt" data-id="' + id + '">إيصال استلام PDF</button>';
  if (!reply) return '<section class="detail-section" id="complaint-reply"><h3>الرد الخارجي</h3><p class="detail-empty">لم يُضف رد بعد.</p><div class="footer-actions">' +
    (uiCan('replies.draft') ? '<button class="btn btn-sm" data-action="reply-create" data-id="' + id + '">صياغة رد</button>' : '') + receipt + '</div></section>';
  const approved = ['approved', 'sent'].includes(reply.status);
  let actions = receipt;
  if (approved) actions += '<button class="btn btn-sm" data-action="print-approved-reply" data-id="' + id + '">طباعة الرد مع رمز تحقق</button>';
  if (reply.status === 'draft' && uiCan('replies.draft')) actions += '<button class="btn btn-sm" data-action="reply-review" data-id="' + id + '">إرسال للمراجعة</button>';
  const ownReply = reply.authorId === authenticatedUser?.id || reply.editedById === authenticatedUser?.id || reply.author === authenticatedUser?.username;
  if (['draft', 'review', 'approval'].includes(reply.status) && uiCan('replies.approve') && !ownReply)
    actions += '<button class="btn btn-sm btn-primary" data-action="reply-approve" data-id="' + id + '">اعتماد الرد</button>';
  if (reply.status === 'approved' && uiCan('replies.send')) actions += '<button class="btn btn-sm btn-primary" data-action="reply-sent" data-id="' + id + '">توثيق الإرسال</button>';
  return '<section class="detail-section" id="complaint-reply"><h3>الرد الخارجي</h3>' +
    (approved ? '<div class="approval-stamp" role="status" aria-label="الرد معتمد داخليًا"><strong>تم اعتماد الرد</strong><span>اعتماد إداري داخلي</span>' +
      (reply.approvedAt ? '<small>' + esc(reply.approvedBy || '') + ' · ' + timeText(reply.approvedAt) + '</small>' : '') + '</div>' : '') +
    replyStatusPill(reply.status) + '<p class="detail-prose">' + esc(reply.text || '') + '</p><div class="footer-actions">' + actions + '</div></section>';
}

function complaintDetailPage() {
  const id = currentId;
  ensureManagedSettings();
  const c = db.complaints.find(x => x.id === id);
  if (!c) return heading('السجل غير موجود', 'لا يمكن عرض هذا الرقم المرجعي.', '<button class="btn" data-action="detail-back">عودة للسجل</button>');
  const inquiry = typeof isInquiryRecord === 'function' && isInquiryRecord(c);
  const label = inquiry ? 'الاستفسار' : 'الشكوى';
  const transitions = {draft:['new','cancelled'],new:['in_progress','cancelled','draft'],in_progress:['awaiting_reply','awaiting_approval','closed','cancelled'],awaiting_reply:['in_progress','awaiting_approval','closed','cancelled'],awaiting_approval:['in_progress','closed','cancelled'],closed:[],cancelled:[]};
  const next = c.archivedAt ? [] : (['closed','cancelled'].includes(c.status) && uiCan('complaints.reopen') ? ['in_progress'] : transitions[c.status] || []);
  const action = (name, text, kind = '') => '<button type="button" class="btn btn-sm ' + kind + '" data-action="' + name + '" data-id="' + esc(id) + '">' + text + '</button>';
  const fields = [['نوع السجل', inquiry ? 'استفسار' : 'شكوى'], [inquiry ? 'اسم المتصل' : 'اسم المشتكي', c.name], ['رقم الهاتف', c.phone, 'ltr'],
    ['قناة الورود', ({phone:'الهاتف',whatsapp:'واتساب',telegram:'تلغرام',other:'أخرى'})[c.source] || c.source],
    ['المحافظة', c.province], ['التصنيف', c.category], ['طبيعة السجل', c.nature], ['الجهة المختصة', c.entity],
    ['المسؤول الرئيسي', c.owner], ['تاريخ أول تواصل', c.firstContactDate], ['تاريخ التسجيل', dateText(c.created)]];
  const summary = '<section class="detail-section" id="complaint-summary"><h3>بيانات ' + label + '</h3><dl class="record-data-grid">' +
    fields.map(([title, value, dir]) => complaintDetailField(title, value, dir)).join('') + '</dl><div class="record-description"><h4>التفاصيل</h4><p class="detail-prose">' + esc(c.details || 'لم تُضف تفاصيل إضافية.') + '</p></div></section>';
  const canChangeStatus = uiCan('complaints.status') && next.length > 0;
  const processing = '<section class="detail-section" id="complaint-actions"><h3>إجراءات الحالة</h3>' + (canChangeStatus ?
    '<div class="form-field"><label for="detailStatus">الحالة الجديدة</label><select class="select-field" id="detailStatus"><option value="">اختر الحالة</option>' +
      next.map(s => '<option value="' + s + '">' + statusLabel(s) + '</option>').join('') + '</select></div>' +
    '<div class="form-field"><label for="statusReason">سبب تغيير الحالة</label><textarea class="textarea-field" id="statusReason" placeholder="اكتب سبب الإغلاق أو الإلغاء أو إعادة الفتح"></textarea></div>' +
    (uiCan('complaints.closeException') ? '<label class="detail-checkbox"><input type="checkbox" id="closureException"> استثناء إغلاق موثق</label>' : '') +
    action('change-status', 'تحديث الحالة', 'btn-primary') : '<p class="detail-empty">لا توجد انتقالات متاحة لهذا السجل.</p>') +
    (uiCan('complaints.assign') && !c.archivedAt && !['closed','cancelled'].includes(c.status) ? '<details class="glass-inline-menu"><summary>إسناد المسؤول</summary><div class="form-field"><label for="assignOwner">المسؤول الرئيسي</label><select class="select-field" id="assignOwner">' +
      availableOwners().map(n => '<option value="' + esc(n) + '" ' + (c.owner === n ? 'selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div></details>' : '') +
    (uiCan('complaints.update') && !c.archivedAt && !['closed','cancelled'].includes(c.status) ? '<details class="glass-inline-menu"><summary>تغيير الأولوية</summary><div class="form-field"><label for="detailPriority">الأولوية</label><select class="select-field" id="detailPriority">' +
      db.settings.priorities.map(p => '<option value="' + esc(p.value) + '" ' + (c.priority === p.value ? 'selected' : '') + '>' + esc(p.label) + '</option>').join('') +
      (!db.settings.priorities.some(p => p.value === c.priority) && c.priority ? '<option value="' + esc(c.priority) + '" selected>' + esc(priorityLabel(c.priority)) + '</option>' : '') + '</select></div></details>' : '') + '</section>';
  const timeline = recordTimelineHtml(c);
  const notes = '<section class="detail-section" id="complaint-notes"><h3>الملاحظات الداخلية</h3>' +
    ((c.notes || []).map(n => '<div class="record-note"><strong>' + esc(n.by || '') + '</strong><p class="detail-prose">' + esc(n.text) + '</p><small>' + timeText(n.at) + '</small></div>').join('') || '<p class="detail-empty">لا توجد ملاحظات داخلية.</p>') + '</section>';
  const referralActions = uiCan('complaints.update') ? action('referral-create', 'إضافة إحالة') + action('survey', 'تسجيل رأي المتصل') : '';
  return '<article class="complaint-page' + (authenticatedUser?.role === 'reviewer' ? ' readonly' : '') + (authenticatedUser?.role === 'admin' ? ' can-approve' : '') + '" data-complaint-id="' + esc(id) + '">' +
    '<div class="complaint-page-header"><button class="btn" data-action="detail-back">العودة إلى السجل</button><div class="complaint-page-heading"><span class="eyebrow">ملف ' + label + '</span><h1>' + esc(c.summary) + '</h1><p class="record-reference">الرقم المرجعي <strong class="ticket-id" dir="ltr"><bdi>' + esc(id) + '</bdi></strong></p>' +
    '<div class="complaint-page-badges">' + (typeof pillRecordType === 'function' ? pillRecordType(c) : '') + pillStatus(c.status) + pillPriority(c.priority) + slaIndicator(c) + '<span class="age-badge' + (isLate(c) ? ' late' : '') + '">مدة البقاء: ' + ageDays(c) + ' يوم</span></div></div></div>' +
    recordOverviewHtml(c) + '<div class="complaint-record-actions" aria-label="إجراءات السجل">' + complaintRecordActions(c, false) + action('print-complaint-cover', 'طباعة', 'btn-print') +
    (uiCan('complaints.update') ? action('set-reminder', 'تذكير') + action('add-note', 'ملاحظة داخلية') : '') + '</div>' +
    '<nav class="complaint-page-tabs" aria-label="أقسام ملف السجل">' +
    [['complaint-summary','البيانات'],['complaint-attachments','المرفقات'],['complaint-actions','المعالجة'],['complaint-reply','الردود'],['complaint-referrals','الإحالات'],['complaint-timeline','سجل الأحداث'],['complaint-notes','الملاحظات']].map(([target, title]) => '<button type="button" data-action="detail-section" data-target="' + target + '">' + title + '</button>').join('') +
    '</nav><div class="complaint-page-content"><div class="detail-grid"><div>' + summary + complaintDetailReply(c) + '<section class="detail-section" id="complaint-attachments"><h3>المرفقات الخاصة</h3></section>' +
    '<section class="detail-section" id="complaint-referrals"><h3>الإحالات والمتابعة</h3><div class="footer-actions">' + referralActions + '</div></section>' +
    complaintWorkflowPanel(c) + '</div><aside class="record-side" aria-label="المعالجة وسجل الإجراءات">' + processing + timeline + notes + '</aside></div></div></article>';
}

function detailModal(id){
  if(!authenticatedUser) return;
  if(!db.complaints.some(c=>c?.id===id)) return toast('الشكوى غير موجودة.','error');
  const changed=page!=='complaint-detail'||currentId!==id;
  if(page!=='complaint-detail') detailReturnPage=page;
  if(changed)routeScrollPositions.set(page,window.scrollY||0);
  closeModal();
  currentId=id;page='complaint-detail';
  if(changed) history.pushState({view:page,id},'', '#complaint/'+encodeURIComponent(id));
  const paint=()=>{render();if(changed)window.scrollTo?.({top:0,behavior:'instant'});};
  paint();
  $('#content')?.focus({preventScroll:true});
}
