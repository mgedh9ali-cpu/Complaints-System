/** Suggested next action on complaint detail (guidance, not automation). */
function suggestedNextStep(c){
  if(!c || c.archivedAt) return null;
  const incomplete = !c.name || !c.phone || !c.details;
  if(c.status === 'draft' || incomplete)
    return { title: 'استكمال البيانات', desc: 'بعض الحقول الأساسية ناقصة. أكمل الاسم أو الهاتف أو التفاصيل.', action: 'focus-summary', label: 'عرض البيانات' };
  if(c.status === 'new')
    return { title: 'بدء المعالجة', desc: 'انقل الحالة إلى «قيد المعالجة» وأسند مسؤولاً إن لزم.', action: 'focus-status', label: 'إجراءات الحالة' };
  if(c.status === 'in_progress' && !(c.referrals || []).length && !c.reply)
    return { title: 'إحالة أو صياغة رد', desc: 'أضف إحالة للجهة المختصة أو ابدأ صياغة الرد الخارجي.', action: 'referral-create', label: 'إضافة إحالة' };
  if(c.status === 'awaiting_reply')
    return { title: 'متابعة الجهة', desc: 'بانتظار رد الجهة المحال إليها. سجّل الرد عند وروده.', action: 'focus-referrals', label: 'عرض الإحالات' };
  if(c.status === 'awaiting_approval')
    return { title: 'اعتماد الرد', desc: 'الرد جاهز للمراجعة والاعتماد من المخوّل.', action: 'focus-reply', label: 'قسم الردود' };
  if(c.status === 'in_progress' && c.reply && c.reply.status === 'draft')
    return { title: 'إرسال الرد للمراجعة', desc: 'يوجد مسودة رد. أرسلها للمراجعة أو عدّلها.', action: 'focus-reply', label: 'قسم الردود' };
  if(c.status === 'closed' && !c.survey)
    return { title: 'تسجيل رأي المشتكي', desc: 'السجل مغلق. وثّق إن أُخذ رأي المشتكي ونتيجة المعالجة.', action: 'survey', label: 'تسجيل الرأي' };
  if(['closed', 'cancelled'].includes(c.status)) return null;
  if(typeof isLate === 'function' && isLate(c))
    return { title: 'معالجة التأخير', desc: 'تجاوزت المهلة المعتمدة. راجع الحالة أو حدّث الإحالة.', action: 'focus-status', label: 'مراجعة الحالة' };
  return null;
}

function nextStepPanelHtml(c){
  const step = suggestedNextStep(c);
  if(!step) return '';
  let btn = '';
  if(step.action === 'referral-create')
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
    '.next-step-panel{border:1px solid #b8bda8;background:#f7f8f3;border-radius:12px;padding:12px 14px;margin:0 0 14px}' +
    '.next-step-inner{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;justify-content:space-between}' +
    '.next-step-panel .eyebrow{margin:0 0 4px}' +
    '.next-step-panel strong{display:block;margin-bottom:4px;color:#0F1F17}' +
    '.next-step-panel .small-copy{margin:0}';
  document.head.appendChild(s);
})();
