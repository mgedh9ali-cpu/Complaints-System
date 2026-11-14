/** Suggested next action on complaint detail (guidance, not automation). */
function suggestedNextStep(c){
  if(!c || c.archivedAt || c.status==='cancelled') return null;
  const can=permission=>typeof uiCan==='function'&&uiCan(permission);
  if(c.status==='closed') return !c.survey&&can('complaints.update')
    ? {title:'تسجيل رأي المشتكي',desc:'السجل مغلق. وثّق نتيجة المعالجة ورأي المشتكي.',action:'survey',label:'تسجيل الرأي'} : null;
  const incomplete = isIncomplete(c);
  if((c.status==='draft'||incomplete)&&can('complaints.update'))
    return {title:'استكمال البيانات',desc:missingFields(c).map(field=>field.label).join('، '),action:'edit-complaint',label:'استكمال الآن'};
  if(c.reply?.status==='approved'&&can('replies.send'))
    return {title:'توثيق إرسال الرد',desc:'الرد معتمد. وثّق إرساله بعد إبلاغ المشتكي فعليًا.',action:'reply-sent',label:'توثيق الإرسال'};
  if(c.reply?.status==='sent'&&can('complaints.status'))
    return {title:'مراجعة إغلاق السجل',desc:'راجع اكتمال الإحالات ونتيجة المعالجة قبل الإغلاق.',action:'focus-status',label:'إجراءات الحالة'};
  if(['review','approval'].includes(c.reply?.status)&&can('replies.approve'))
    return {title:'مراجعة الرد واعتماده',desc:'راجع النص في قسم الردود قبل الاعتماد.',action:'focus-reply',label:'مراجعة الرد'};
  if(c.reply?.status==='draft'&&can('replies.draft'))
    return {title:'مراجعة مسودة الرد',desc:'راجع النص أو عدّله قبل إرساله للمراجعة والاعتماد.',action:'focus-reply',label:'فتح المسودة'};
  if(c.status==='new'&&can('complaints.status'))
    return {title:'بدء المعالجة',desc:'حدّد الحالة الجديدة وسجّل إجراء المتابعة.',action:'focus-status',label:'إجراءات الحالة'};
  if(c.status==='awaiting_reply'&&can('complaints.read'))
    return {title:'متابعة رد الجهة',desc:'راجع الإحالة وسجّل رد الجهة عند وروده.',action:'focus-referrals',label:'عرض الإحالات'};
  if(c.status==='in_progress'&&!(c.referrals||[]).length&&!c.reply&&can('complaints.update'))
    return {title:'إحالة إلى الجهة المختصة',desc:'سجّل الجهة والموعد المتوقع للرد، أو صغ ردًا من قسم الردود.',action:'referral-create',label:'إضافة إحالة'};
  if(c.status==='awaiting_approval'&&!c.reply&&can('replies.draft'))
    return {title:'صياغة الرد',desc:'لا يوجد رد مرتبط بهذا السجل بعد.',action:'reply-create',label:'صياغة رد'};
  if(typeof isLate==='function'&&isLate(c)&&can('complaints.status'))
    return {title:'معالجة التأخير',desc:'راجع الحالة والموعد القادم قبل إغلاق المتابعة.',action:'focus-status',label:'مراجعة الحالة'};
  return null;
}

function nextStepPanelHtml(c){
  const step = suggestedNextStep(c);
  if(!step) return '';
  let btn = '';
  if(['edit-complaint','reply-create','reply-sent'].includes(step.action))
    btn = '<button class="btn btn-sm btn-primary" data-action="'+step.action+'" data-id="'+esc(c.id)+'">'+esc(step.label)+'</button>';
  else if(step.action === 'referral-create')
    btn = '<button class="btn btn-sm btn-primary" data-action="referral-create" data-id="' + esc(c.id) + '">' + esc(step.label) + '</button>';
  else if(step.action === 'survey')
    btn = '<button class="btn btn-sm btn-primary" data-action="survey" data-id="' + esc(c.id) + '">' + esc(step.label) + '</button>';
  else if(step.action === 'focus-status')
    btn = '<button class="btn btn-sm btn-primary" data-action="detail-section" data-target="complaint-actions">' + esc(step.label) + '</button>';
  else if(step.action === 'focus-reply')
    btn = '<button class="btn btn-sm btn-primary" data-action="detail-section" data-target="complaint-reply">' + esc(step.label) + '</button>';
  else if(step.action === 'focus-referrals')
    btn = '<button class="btn btn-sm btn-primary" data-action="detail-section" data-target="complaint-referrals">' + esc(step.label) + '</button>';
  else if(step.action === 'focus-summary')
    btn = '<button class="btn btn-sm btn-primary" data-action="detail-section" data-target="complaint-summary">' + esc(step.label) + '</button>';
  return '<div class="detail-section next-step-panel" id="complaint-next-step">' +
    '<div class="next-step-inner">' +
    '<div><div class="eyebrow">الخطوة التالية المقترحة</div><strong>' + esc(step.title) + '</strong>' +
    '<p class="small-copy">' + esc(step.desc) + '</p></div>' + btn + '</div></div>';
}

(function injectNextStepStyles(){
  if(document.getElementById('next-step-styles')) return;
  const s = document.createElement('style');
  s.id = 'next-step-styles';
  s.textContent =
    '.next-step-panel{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:12px 14px;margin:0 0 14px}' +
    '.next-step-inner{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;justify-content:space-between}' +
    '.next-step-panel .eyebrow{margin:0 0 4px}' +
    '.next-step-panel strong{display:block;margin-bottom:4px;color:var(--ink)}' +
    '.next-step-panel .small-copy{margin:0}';
  document.head.appendChild(s);
})();

/** Defer wrap until complaintDetailPage exists (loads after this file in the bundle). */
function installDetailNextStepEnhancer(){
  if(typeof complaintDetailPage !== 'function') return false;
  if(complaintDetailPage.__nextStepWrapped) return true;
  const orig = complaintDetailPage;
  function wrapped(){
    let html = orig.apply(this, arguments);
    if(typeof html !== 'string') return html;
    const id = currentId;
    const c = (db.complaints || []).find(x => x && x.id === id);
    if(!c) return html;
    if(html.indexOf('complaint-next-step') < 0 && typeof nextStepPanelHtml === 'function'){
      const panel = nextStepPanelHtml(c);
      if(panel) html = html.replace('<div class="detail-grid">', panel + '<div class="detail-grid">');
    }
    if(html.indexOf('pill-inquiry') < 0 && html.indexOf('pill-complaint') < 0 && typeof pillRecordType === 'function'){
      html = html.replace('<div class="complaint-page-badges">', '<div class="complaint-page-badges">' + pillRecordType(c));
    }
    if(html.indexOf('نوع السجل') < 0){
      const label = (typeof isInquiryRecord === 'function' && isInquiryRecord(c)) ? 'استفسار' : 'شكوى';
      html = html.replace(
        '<div class="detail-field"><span>اسم المشتكي</span>',
        '<div class="detail-field"><span>نوع السجل</span><span>' + label + '</span></div><div class="detail-field"><span>اسم المشتكي</span>'
      );
    }
    return html;
  }
  wrapped.__nextStepWrapped = true;
  complaintDetailPage = wrapped;
  return true;
}
if(!installDetailNextStepEnhancer()){
  document.addEventListener('DOMContentLoaded', function(){ installDetailNextStepEnhancer(); });
  setTimeout(installDetailNextStepEnhancer, 0);
  setTimeout(installDetailNextStepEnhancer, 50);
}
