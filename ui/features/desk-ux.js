/** Desk UX enhancements (suggestions 1–5): queues, dual SLA, structured close, smarter intake, reception. */
(function deskUxModule(){
  'use strict';

  const ROOT_CAUSES = [
    'إهمال خدمة','تأخير معاملة','سوء معاملة','نقص معلومات','خطأ إجرائي',
    'مشكلة فنية','تعارض صلاحيات','أخرى'
  ];
  const NOTIFY_CHANNELS = [
    {value:'phone',label:'اتصال هاتفي'},
    {value:'whatsapp',label:'واتساب'},
    {value:'telegram',label:'تلغرام'},
    {value:'in_person',label:'حضوري'},
    {value:'other',label:'أخرى'}
  ];

  function settings(){
    return (typeof db !== 'undefined' && db && db.settings) ? db.settings : {};
  }

  function firstResponseHours(){
    const s = settings();
    const h = Number(s.firstResponseHours);
    return Number.isFinite(h) && h > 0 ? h : 48;
  }

  function resolutionDays(){
    const s = settings();
    const d = Number(s.slaDays);
    return Number.isFinite(d) && d > 0 ? d : 7;
  }

  function createdMs(c){
    const t = Date.parse(c && (c.created || c.createdAt));
    return Number.isFinite(t) ? t : NaN;
  }

  function firstResponseDueMs(c){
    const start = createdMs(c);
    if (!Number.isFinite(start)) return NaN;
    return start + firstResponseHours() * 3600000;
  }

  function resolutionDueMs(c){
    if (c && c.due) {
      const t = Date.parse(c.due);
      if (Number.isFinite(t)) return t;
    }
    const start = createdMs(c);
    if (!Number.isFinite(start)) return NaN;
    return start + resolutionDays() * 86400000;
  }

  function hasOfficialReply(c){
    return Boolean(c && c.reply && ['approved','sent','review','approval'].includes(c.reply.status));
  }

  function firstResponseMet(c){
    if (!c) return false;
    if (hasOfficialReply(c)) return true;
    if ((c.referrals || []).length) return true;
    if ((c.notes || []).length) return true;
    return false;
  }

  function isFirstResponseLate(c){
    if (!c || c.archivedAt || ['closed','cancelled'].includes(c.status)) return false;
    if (firstResponseMet(c)) return false;
    const due = firstResponseDueMs(c);
    return Number.isFinite(due) && Date.now() > due;
  }

  function isAtRisk(c){
    if (!c || c.archivedAt || ['closed','cancelled'].includes(c.status)) return false;
    const start = createdMs(c);
    const due = resolutionDueMs(c);
    if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return false;
    if (typeof isLate === 'function' && isLate(c)) return false;
    const p = (Date.now() - start) / (due - start);
    return p >= 0.75 && p < 1;
  }

  function dualSlaHtml(c){
    if (!c) return '';
    const s = settings();
    const frDue = firstResponseDueMs(c);
    const resDue = resolutionDueMs(c);
    const frLate = isFirstResponseLate(c);
    const resLate = typeof isLate === 'function' && isLate(c);
    const frOk = firstResponseMet(c);
    const frLabel = frOk ? 'تم أول رد' : (frLate ? 'تأخر أول رد' : 'مهلة أول رد');
    const resLabel = resLate ? 'تجاوز الحل' : (isAtRisk(c) ? 'قرب انتهاء الحل' : 'مهلة الحل');
    const fmt = (ms) => Number.isFinite(ms) && typeof dateText === 'function' ? dateText(new Date(ms).toISOString()) : '—';
    return '<div class="dual-sla-bar" role="group" aria-label="مهل المتابعة">' +
      '<div class="dual-sla-item' + (frLate ? ' is-late' : frOk ? ' is-ok' : '') + '">' +
        '<span class="dual-sla-label">' + frLabel + '</span>' +
        '<strong>' + (frOk ? 'مكتمل' : fmt(frDue)) + '</strong>' +
        '<small>' + firstResponseHours() + ' ساعة من التسجيل</small></div>' +
      '<div class="dual-sla-item' + (resLate ? ' is-late' : isAtRisk(c) ? ' is-warn' : '') + '">' +
        '<span class="dual-sla-label">' + resLabel + '</span>' +
        '<strong>' + fmt(resDue) + '</strong>' +
        '<small>' + (s.slaApproved ? resolutionDays() + ' أيام معتمدة' : resolutionDays() + ' أيام — غير معتمدة بعد') + '</small></div>' +
      '</div>';
  }

  function injectDualSlaStyles(){
    if (document.getElementById('desk-ux-styles')) return;
    const s = document.createElement('style');
    s.id = 'desk-ux-styles';
    s.textContent =
      '.dual-sla-bar{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 14px}' +
      '.dual-sla-item{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface)}' +
      '.dual-sla-item.is-late{border-color:#c45c5c;background:rgba(196,92,92,.08)}' +
      '.dual-sla-item.is-warn{border-color:#c9a227;background:rgba(201,162,39,.08)}' +
      '.dual-sla-item.is-ok{border-color:#2f7d4a;background:rgba(47,125,74,.08)}' +
      '.dual-sla-label{display:block;font-size:11px;opacity:.75;margin-bottom:2px}' +
      '.dual-sla-item strong{display:block;font-size:14px}' +
      '.dual-sla-item small{display:block;margin-top:4px;font-size:11px;opacity:.7}' +
      '.workspace-queues{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line)}' +
      '.workspace-queues .btn{font-size:12px}' +
      '.queue-chip-count{margin-inline-start:4px;opacity:.75}' +
      '.structured-close-fields{display:grid;gap:10px;margin-top:10px}' +
      '.reception-banner{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px}' +
      '.story-timeline{margin:0 0 14px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}' +
      '.story-timeline h3{margin:0 0 8px;font-size:14px}' +
      '.story-item{padding:8px 0;border-bottom:1px solid var(--line)}' +
      '.story-item:last-child{border-bottom:0}' +
      '.story-item strong{display:block}' +
      '.story-item small{opacity:.7}' +
      '@media(max-width:640px){.dual-sla-bar{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  function storyTimelineHtml(c){
    if (!c) return '';
    const items = [];
    items.push({at:c.created,event:'تسجيل السجل',detail:(c.summary||'')+' — قناة: '+(c.source||'')});
    (c.notes||[]).forEach(n=>items.push({at:n.at,event:'ملاحظة داخلية',detail:n.text,by:n.by}));
    (c.referrals||[]).forEach(r=>items.push({at:r.sent||r.at,event:'إحالة إلى '+(r.entity||''),detail:r.note||'',by:r.by}));
    if (c.reply) items.push({at:c.reply.approvedAt||c.reply.updatedAt||c.reply.createdAt,event:'رد ('+(c.reply.status||'')+')',detail:c.reply.text||''});
    (c.timeline||[]).forEach(t=>items.push({at:t.at,event:t.event,detail:t.detail,by:t.by}));
    items.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
    const top = items.slice(0,8);
    const body = top.map(t=>'<div class="story-item"><strong>'+esc(t.event||'')+'</strong>' +
      (t.detail?'<p class="detail-prose">'+esc(String(t.detail).slice(0,240))+'</p>':'') +
      '<small>'+esc(t.by||'')+(t.at?' · '+(typeof timeText==='function'?timeText(t.at):t.at):'')+'</small></div>').join('')
      || '<p class="detail-empty">لا أحداث بعد.</p>';
    return '<section class="story-timeline" id="complaint-story"><h3>قصة السجل</h3>'+body +
      '<button type="button" class="btn btn-sm" data-action="detail-section" data-target="complaint-timeline">السجل الكامل مع التصفية</button></section>';
  }

  function enhanceDetailPage(){
    if (typeof complaintDetailPage !== 'function' || complaintDetailPage.__deskUxWrapped) return;
    const orig = complaintDetailPage;
    function wrapped(){
      let html = orig.apply(this, arguments);
      if (typeof html !== 'string') return html;
      injectDualSlaStyles();
      const id = typeof currentId !== 'undefined' ? currentId : null;
      const c = (db.complaints||[]).find(x=>x&&x.id===id);
      if (!c) return html;
      if (html.indexOf('dual-sla-bar') < 0) {
        html = html.replace('recordOverviewHtml(c)', '/*patched*/');
        // inject after overview or badges
        const dual = dualSlaHtml(c);
        const story = storyTimelineHtml(c);
        if (html.indexOf('class="record-overview"') >= 0) {
          html = html.replace(/<\/dl>/, '</dl>'+dual);
        } else if (html.indexOf('complaint-page-badges') >= 0) {
          html = html.replace(/<\/div><\/div><\/div>/, '</div></div></div>'+dual);
        }
        if (html.indexOf('complaint-story') < 0 && story) {
          html = html.replace('<div class="detail-grid">', story+'<div class="detail-grid">');
        }
      }
      // Structured close fields when status select is shown
      if (html.indexOf('structured-close-fields') < 0 && html.indexOf('id="statusReason"') >= 0) {
        const closeFields =
          '<div class="structured-close-fields" id="structuredCloseFields" hidden>' +
          '<div class="form-field"><label for="closeRootCause">السبب الجذري</label>' +
          '<select class="select-field" id="closeRootCause"><option value="">اختر السبب</option>' +
          ROOT_CAUSES.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('') +
          '</select></div>' +
          '<div class="form-field"><label for="closeActionTaken">الإجراء المتخذ</label>' +
          '<textarea class="textarea-field" id="closeActionTaken" maxlength="2000" placeholder="ما الذي أُنجز لمعالجة السجل؟"></textarea></div>' +
          '<div class="form-field"><label for="closeNotifyChannel">قناة إبلاغ المواطن</label>' +
          '<select class="select-field" id="closeNotifyChannel"><option value="">اختر القناة</option>' +
          NOTIFY_CHANNELS.map(o=>'<option value="'+o.value+'">'+o.label+'</option>').join('') +
          '</select></div></div>';
        html = html.replace('</textarea></div>', '</textarea></div>'+closeFields);
      }
      return html;
    }
    wrapped.__deskUxWrapped = true;
    complaintDetailPage = wrapped;
  }

  function wireStatusSelect(){
    document.addEventListener('change', function(e){
      if (e.target && e.target.id === 'detailStatus') {
        const box = document.getElementById('structuredCloseFields');
        if (!box) return;
        const v = e.target.value;
        box.hidden = !['closed','cancelled'].includes(v);
      }
    });
  }

  // Patch changeStatus to require structured fields on close
  function patchChangeStatus(){
    if (typeof changeStatus !== 'function' || changeStatus.__deskUxPatched) return;
    const orig = changeStatus;
    async function wrapped(id){
      const next = document.getElementById('detailStatus')?.value;
      if (['closed','cancelled'].includes(next)) {
        const root = document.getElementById('closeRootCause')?.value?.trim() || '';
        const action = document.getElementById('closeActionTaken')?.value?.trim() || '';
        const channel = document.getElementById('closeNotifyChannel')?.value || '';
        if (!root) return toast('حدّد السبب الجذري قبل الإغلاق أو الإلغاء.','warn');
        if (action.length < 3) return toast('اكتب الإجراء المتخذ (3 أحرف على الأقل).','warn');
        const reasonEl = document.getElementById('statusReason');
        if (reasonEl) {
          const base = reasonEl.value.trim();
          const channelLabel = (NOTIFY_CHANNELS.find(x=>x.value===channel)||{}).label || channel || 'غير محددة';
          reasonEl.value = [base, 'السبب الجذري: '+root, 'الإجراء: '+action, 'قناة الإبلاغ: '+channelLabel].filter(Boolean).join(' | ');
        }
      }
      return orig.apply(this, arguments);
    }
    wrapped.__deskUxPatched = true;
    changeStatus = wrapped;
  }

  // Registry: at-risk queue
  function patchRegistryQueues(){
    if (typeof registryQueueLabels === 'object' && registryQueueLabels && !registryQueueLabels['at-risk']) {
      registryQueueLabels['at-risk'] = 'مهددة بالتأخر';
      registryQueueLabels['first-response-late'] = 'تأخر أول رد';
    }
    if (typeof filteredComplaints === 'function' && !filteredComplaints.__deskUxPatched) {
      const orig = filteredComplaints;
      function wrapped(){
        const rows = orig.apply(this, arguments);
        const q = typeof quickView !== 'undefined' ? quickView : 'all';
        if (q === 'at-risk') return (db.complaints||[]).filter(c=>!c.archivedAt && isAtRisk(c));
        if (q === 'first-response-late') return (db.complaints||[]).filter(c=>!c.archivedAt && isFirstResponseLate(c));
        return rows;
      }
      // Better: filter within orig result path — override by re-filtering open set
      function wrapped2(){
        const q = typeof normalizeRegistryQueue === 'function' ? normalizeRegistryQueue(quickView) : quickView;
        if (q === 'at-risk' || q === 'first-response-late') {
          const base = (db.complaints||[]).filter(c=>{
            if (c.archivedAt) return false;
            if (typeof searchText === 'string' && searchText) {
              const blob = [c.id,c.name,c.phone,c.summary,c.details].join(' ');
              if (typeof norm === 'function' && !norm(blob).includes(norm(searchText))) return false;
            }
            return q === 'at-risk' ? isAtRisk(c) : isFirstResponseLate(c);
          });
          return base;
        }
        return orig.apply(this, arguments);
      }
      wrapped2.__deskUxPatched = true;
      filteredComplaints = wrapped2;
    }
    if (typeof complaintsPage === 'function' && !complaintsPage.__deskUxPatched) {
      const origPage = complaintsPage;
      function pageWrapped(){
        let html = origPage.apply(this, arguments);
        if (typeof html !== 'string') return html;
        if (html.indexOf('data-queue="at-risk"') < 0) {
          html = html.replace(
            'data-value="missing">بيانات غير مكتملة</button>',
            'data-value="missing">بيانات غير مكتملة</button>' +
            '<button class="filter-chip '+(typeof quickView!=='undefined'&&quickView==='at-risk'?'active':'')+'" data-action="registry-queue" data-queue="at-risk">مهددة بالتأخر</button>' +
            '<button class="filter-chip '+(typeof quickView!=='undefined'&&quickView==='first-response-late'?'active':'')+'" data-action="registry-queue" data-queue="first-response-late">تأخر أول رد</button>'
          );
        }
        return html;
      }
      pageWrapped.__deskUxPatched = true;
      complaintsPage = pageWrapped;
    }
  }

  // Dashboard: add at-risk + first-response tasks
  function patchDashboard(){
    if (typeof dashboard !== 'function' || dashboard.__deskUxPatched) return;
    const orig = dashboard;
    function wrapped(){
      let html = orig.apply(this, arguments);
      if (typeof html !== 'string') return html;
      injectDualSlaStyles();
      const open = (db.complaints||[]).filter(c=>!c.archivedAt&&!['closed','cancelled'].includes(c.status));
      const atRisk = open.filter(isAtRisk).length;
      const frLate = open.filter(isFirstResponseLate).length;
      if (atRisk > 0 && html.indexOf('data-queue="at-risk"') < 0) {
        const row = '<div class="task-row task-row-amber" role="listitem" data-brief-key="at-risk">' +
          '<div class="task-symbol amber" aria-hidden="true">◷</div>' +
          '<div class="task-copy"><strong>مهددة بالتأخر</strong><small>تجاوزت 75٪ من مهلة الحل</small></div>' +
          '<div class="task-controls"><span class="task-value">'+atRisk+'</span>' +
          '<button type="button" class="btn btn-sm task-review" data-action="registry-queue" data-queue="at-risk">فتح السجلات</button></div></div>';
        html = html.replace('<div class="task-list" role="list"', row+'<div class="task-list" role="list"');
      }
      if (frLate > 0 && html.indexOf('data-queue="first-response-late"') < 0) {
        const row = '<div class="task-row task-row-red" role="listitem" data-brief-key="first-response-late">' +
          '<div class="task-symbol red" aria-hidden="true">!</div>' +
          '<div class="task-copy"><strong>تأخر أول رد</strong><small>لم يُسجَّل رد أو إحالة خلال مهلة أول رد</small></div>' +
          '<div class="task-controls"><span class="task-value">'+frLate+'</span>' +
          '<button type="button" class="btn btn-sm task-review" data-action="registry-queue" data-queue="first-response-late">فتح السجلات</button></div></div>';
        html = html.replace('<div class="task-list" role="list"', row+'<div class="task-list" role="list"');
      }
      return html;
    }
    wrapped.__deskUxPatched = true;
    dashboard = wrapped;
  }

  // Smarter duplicate: phone OR (name + category)
  function enhanceDuplicate(){
    if (typeof intakePhoneHint !== 'function' || intakePhoneHint.__deskUxPatched) return;
    const orig = intakePhoneHint;
    function wrapped(){
      orig.apply(this, arguments);
      const mount = document.getElementById('duplicateMount');
      if (!mount || !authenticatedUser) return;
      const phone = typeof phoneNorm === 'function' ? phoneNorm(document.getElementById('cPhone')?.value || '') : '';
      const name = String(document.getElementById('cName')?.value || '').trim();
      const category = String(document.getElementById('cCategory')?.value || '').trim();
      const extra = (db.complaints||[]).filter(c=>{
        if (c.archivedAt) return false;
        if (phone.length >= 7 && typeof phoneNorm === 'function' && phoneNorm(c.phone||'') === phone) return false; // already shown
        if (name.length >= 3 && category && c.name && c.category) {
          const sameName = typeof norm === 'function' ? norm(c.name) === norm(name) : c.name === name;
          const sameCat = typeof norm === 'function' ? norm(c.category) === norm(category) : c.category === category;
          return sameName && sameCat;
        }
        return false;
      }).slice(0,5);
      if (!extra.length) return;
      const block = '<details open><summary>سجلات مشابهة بالاسم والتصنيف ('+extra.length+')</summary>' +
        extra.map(c=>'<button type="button" class="btn btn-sm" data-action="detail" data-id="'+esc(c.id)+'"><bdi>'+esc(c.id)+'</bdi> · '+esc(c.summary||'')+'</button>').join('') +
        '</details>';
      mount.insertAdjacentHTML('beforeend', block);
    }
    wrapped.__deskUxPatched = true;
    intakePhoneHint = wrapped;
  }

  // Reception mode: large simplified intake
  function startReceptionMode(){
    if (!uiCan('complaints.create')) return toast('لا تملك صلاحية إنشاء سجل.','error');
    if (typeof newComplaint === 'function') newComplaint();
    setTimeout(function(){
      const modalEl = document.querySelector('.modal');
      if (!modalEl) return;
      injectDualSlaStyles();
      const banner = document.createElement('div');
      banner.className = 'reception-banner';
      banner.innerHTML = '<strong>وضع الاستقبال</strong><p class="small-copy">سجّل الملخص والهاتف فقط. يُطبع الرقم المرجعي بعد الحفظ. لا يُعرض سجل المكتب الكامل في هذا الوضع.</p>';
      const form = document.getElementById('newComplaintForm');
      if (form && !document.getElementById('receptionBanner')) {
        banner.id = 'receptionBanner';
        form.parentNode.insertBefore(banner, form);
      }
      const additional = document.getElementById('intakeAdditional');
      if (additional) additional.open = false;
      document.getElementById('cSummary')?.focus?.();
    }, 50);
  }

  function installWorkspaceQueues(){
    const host = document.getElementById('workspaceShortcuts');
    if (!host || host.dataset.deskQueues === '1') return;
    host.dataset.deskQueues = '1';
    injectDualSlaStyles();
    const bar = document.createElement('div');
    bar.className = 'workspace-queues';
    bar.setAttribute('aria-label', 'طوابير العمل');
    bar.innerHTML =
      '<span class="shortcuts-caption">الطوابير</span>' +
      '<button type="button" class="btn btn-quiet" data-action="registry-queue" data-queue="late">متأخرة</button>' +
      '<button type="button" class="btn btn-quiet" data-action="registry-queue" data-queue="at-risk">مهددة</button>' +
      '<button type="button" class="btn btn-quiet" data-action="registry-queue" data-queue="first-response-late">تأخر أول رد</button>' +
      '<button type="button" class="btn btn-quiet" data-action="registry-queue" data-queue="missing">بيانات ناقصة</button>' +
      '<button type="button" class="btn btn-quiet" data-action="registry-queue" data-queue="waiting-referrals">إحالات</button>' +
      '<button type="button" class="btn btn-quiet" data-goto="replies">اعتمادات</button>' +
      '<button type="button" class="btn btn-quiet" data-action="reception-mode">وضع استقبال</button>';
    host.parentNode.insertBefore(bar, host.nextSibling);
  }

  document.addEventListener('click', function(e){
    const el = e.target.closest?.('[data-action="reception-mode"]');
    if (el) { e.preventDefault(); startReceptionMode(); }
  }, true);

  function boot(){
    injectDualSlaStyles();
    enhanceDetailPage();
    wireStatusSelect();
    patchChangeStatus();
    patchRegistryQueues();
    patchDashboard();
    enhanceDuplicate();
    installWorkspaceQueues();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 0);
  setTimeout(boot, 100);
  window.deskUx = {
    isAtRisk, isFirstResponseLate, dualSlaHtml, firstResponseHours, resolutionDays, startReceptionMode
  };
})();
