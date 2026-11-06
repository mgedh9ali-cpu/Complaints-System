(function ensureIntakeWizardStyles(){
  if (document.getElementById('intake-wizard-styles')) return;
  const s = document.createElement('style');
  s.id = 'intake-wizard-styles';
  s.textContent = `
.intake-progress{height:6px;border-radius:999px;background:#d9ddd0;margin:4px 0 10px;overflow:hidden}
.intake-progress-bar{height:100%;background:linear-gradient(90deg,#1E3A2E,#3E5A3F);border-radius:999px;transition:width .25s ease}
.intake-step-label{margin:0 0 12px!important;color:var(--muted,#3D4337)}
.intake-type-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:8px}
.intake-type-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:start;padding:18px 16px;border-radius:14px;border:1px solid var(--line,#b8bda8);background:#fafbf7;cursor:pointer;font:inherit;color:inherit;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
.intake-type-card:hover,.intake-type-card:focus-visible{border-color:#3E5A3F;background:#f0f3ea;box-shadow:0 6px 18px rgba(15,31,23,.08);outline:none}
.intake-type-card strong{font-size:16px;color:#0F1F17}
.intake-type-card span:last-child{font-size:12px;color:var(--muted,#3D4337);line-height:1.5}
.intake-type-icon{width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:#1E3A2E;color:#C7CBB8;font-weight:700;font-size:18px}
.intake-choice-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.intake-choice{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid var(--line,#b8bda8);background:#fff;font-size:13px;cursor:pointer}
.intake-choice:has(input:checked){border-color:#3E5A3F;background:#eef2e6;font-weight:600}
.intake-actions{width:100%}
@media (max-width:640px){.intake-type-cards{grid-template-columns:1fr}}
`;
  document.head.appendChild(s);
})();

/* Sequential intake wizard: شكوى / استفسار step-by-step with تخطي */

let intakeWizard = {
  step: 0,
  recordType: null,
  data: {}
};

function intakeCollectVisible() {
  const form = $('#newComplaintForm');
  if (!form) return;
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.id && el.type !== 'radio') return;
    if (el.type === 'radio') {
      if (el.checked) intakeWizard.data[el.name || el.id] = el.value;
      return;
    }
    if (el.type === 'checkbox') {
      intakeWizard.data[el.id] = el.checked;
      return;
    }
    if (el.id) intakeWizard.data[el.id] = el.value;
  });
}

function intakeStepCount() {
  if (intakeWizard.recordType === 'inquiry') return 4;
  if (intakeWizard.recordType === 'complaint') return 5;
  return 1;
}

function intakeProgressHtml() {
  const total = Math.max(1, intakeStepCount() - 1);
  const current = Math.max(0, intakeWizard.step);
  const pct = Math.round((current / total) * 100);
  const label = intakeWizard.recordType === 'inquiry' ? 'استفسار' : intakeWizard.recordType === 'complaint' ? 'شكوى' : 'اختيار النوع';
  return '<div class="intake-progress" aria-hidden="true"><div class="intake-progress-bar" style="width:' + pct + '%"></div></div>' +
    '<p class="small-copy intake-step-label">الخطوة ' + (current + 1) + ' من ' + intakeStepCount() + (intakeWizard.recordType ? ' · ' + label : '') + '</p>';
}

function intakeTypeStep() {
  return intakeProgressHtml() +
    '<div class="intake-type-cards" role="group" aria-label="نوع السجل">' +
    '<button type="button" class="intake-type-card" data-action="intake-pick-type" data-type="complaint">' +
    '<span class="intake-type-icon" aria-hidden="true">!</span><strong>شكوى</strong><span>تسجيل شكوى للمتابعة والمعالجة</span></button>' +
    '<button type="button" class="intake-type-card" data-action="intake-pick-type" data-type="inquiry">' +
    '<span class="intake-type-icon" aria-hidden="true">?</span><strong>استفسار</strong><span>سؤال أو طلب معلومة بدون شكوى رسمية</span></button>' +
    '</div>';
}

function intakeInquirySubjectStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    '<div class="form-field full"><label for="cSummary">موضوع الاستفسار</label><input class="field" id="cSummary" maxlength="180" placeholder="بماذا يستفسر المتصل؟" value="' + esc(d.cSummary || '') + '"></div>' +
    '<div class="form-field full"><label>هل متعلق بالوضع الحالي؟</label>' +
    '<div class="intake-choice-row">' +
    '<label class="intake-choice"><input type="radio" name="cRelatedToCurrent" value="yes"' + (d.cRelatedToCurrent === 'yes' ? ' checked' : '') + '> نعم</label>' +
    '<label class="intake-choice"><input type="radio" name="cRelatedToCurrent" value="no"' + (d.cRelatedToCurrent === 'no' ? ' checked' : '') + '> لا</label>' +
    '<label class="intake-choice"><input type="radio" name="cRelatedToCurrent" value="unknown"' + (!d.cRelatedToCurrent || d.cRelatedToCurrent === 'unknown' ? ' checked' : '') + '> غير محدد</label>' +
    '</div></div></div>';
}

function intakeInquiryContactStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    field('رقم التواصل', 'cPhone', d.cPhone || '', 'tel', false, 'autocomplete="off"') +
    selectField('كيفية التواصل', 'cSource', [
      { value: 'phone', label: 'الهاتف' },
      { value: 'whatsapp', label: 'واتساب' },
      { value: 'telegram', label: 'تلغرام' },
      { value: 'other', label: 'أخرى' }
    ], d.cSource || 'phone', false) +
    '</div>';
}

function intakeInquiryFinishStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    field('اسم المتصل', 'cName', d.cName || '', 'text', false, 'autocomplete="off"') +
    '<div class="form-field full"><label for="cDetails">تفاصيل إضافية (اختياري)</label><textarea class="textarea-field" id="cDetails" placeholder="أي ملاحظة تساعد على الرد">' + esc(d.cDetails || '') + '</textarea></div>' +
    '<div class="form-field full" id="duplicateMount"></div></div>';
}

function intakeComplaintSubjectStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    '<div class="form-field full"><label for="cSummary">موضوع الشكوى</label><input class="field" id="cSummary" maxlength="180" placeholder="ملخص واضح ومختصر" value="' + esc(d.cSummary || '') + '"></div>' +
    '<div class="form-field full"><label for="cDetails">التفاصيل</label><textarea class="textarea-field" id="cDetails" placeholder="ما ذكره المتصل وما يلزم متابعته">' + esc(d.cDetails || '') + '</textarea></div>' +
    '</div>';
}

function intakeComplaintClassifyStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    selectField('المحافظة', 'cProvince', db.settings.provinces, d.cProvince || '', false) +
    selectField('التصنيف', 'cCategory', db.settings.categories, d.cCategory || '', false) +
    selectField('طبيعة الشكاوي', 'cNature', db.settings.natures || [], d.cNature || '', false) +
    selectField('الجهة المختصة', 'cEntity', db.settings.entities, d.cEntity || '', false) +
    '</div>';
}

function intakeComplaintContactStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    field('اسم المشتكي', 'cName', d.cName || '', 'text', false, 'autocomplete="off"') +
    field('رقم الهاتف', 'cPhone', d.cPhone || '', 'tel', false, 'autocomplete="off"') +
    selectField('قناة الورود', 'cSource', [
      { value: 'phone', label: 'الهاتف' },
      { value: 'whatsapp', label: 'واتساب (تسجيل يدوي)' },
      { value: 'telegram', label: 'تلغرام (تسجيل يدوي)' },
      { value: 'other', label: 'أخرى' }
    ], d.cSource || 'phone', false) +
    field('تاريخ أول تواصل', 'cFirstContactDate', d.cFirstContactDate || workDayKey(new Date()), 'date', false) +
    '<div class="form-field full" id="duplicateMount"></div></div>';
}

function intakeComplaintExtraStep() {
  const d = intakeWizard.data;
  return intakeProgressHtml() +
    '<div class="form-grid">' +
    selectField('الأولوية', 'cPriority', db.settings.priorities, d.cPriority || 'normal', false) +
    field('المسؤول الرئيسي', 'cOwner', d.cOwner || (authenticatedUser?.username || '')) +
    '</div>';
}

function intakeRenderStepBody() {
  const t = intakeWizard.recordType;
  const s = intakeWizard.step;
  if (s === 0 || !t) return intakeTypeStep();
  if (t === 'inquiry') {
    if (s === 1) return intakeInquirySubjectStep();
    if (s === 2) return intakeInquiryContactStep();
    return intakeInquiryFinishStep();
  }
  if (s === 1) return intakeComplaintSubjectStep();
  if (s === 2) return intakeComplaintClassifyStep();
  if (s === 3) return intakeComplaintContactStep();
  return intakeComplaintExtraStep();
}

function intakeFooterHtml() {
  const s = intakeWizard.step;
  const last = s >= intakeStepCount() - 1 && intakeWizard.recordType;
  const canBack = s > 0;
  const canSkip = s > 0 && !last;
  let html = '<span class="small-copy">يمكنك تخطي أي حقل غير متوفر الآن. Ctrl+S للحفظ في الخطوة الأخيرة.</span><div class="right-actions intake-actions">';
  html += '<button type="button" class="btn" data-action="close-modal">إلغاء</button>';
  if (canBack) html += '<button type="button" class="btn" data-action="intake-back">رجوع</button>';
  if (canSkip) html += '<button type="button" class="btn" data-action="intake-skip">تخطي</button>';
  if (!intakeWizard.recordType) {
    /* type step */
  } else if (last) {
    html += '<button type="button" class="btn" data-action="save-incomplete">حفظ كمسودة</button>';
    html += '<button type="button" class="btn btn-primary" data-action="save-complaint">حفظ</button>';
  } else {
    html += '<button type="button" class="btn btn-primary" data-action="intake-next">التالي</button>';
  }
  html += '</div>';
  return html;
}

function intakeTitle() {
  if (!intakeWizard.recordType) return 'تسجيل جديد';
  return intakeWizard.recordType === 'inquiry' ? 'تسجيل استفسار' : 'تسجيل شكوى';
}

function intakeSubtitle() {
  if (!intakeWizard.recordType) return 'اختر نوع السجل أولاً — خطوة واحدة تلو الأخرى';
  return 'نموذج تراتبي أثناء المكالمة · خطوة واحدة في كل مرة';
}

function renderIntakeWizard() {
  const draftBanner = hasComplaintDraft()
    ? '<div class="risk-note" id="draftBanner" role="status" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between"><span><strong>مسودة محلية لهذا الحساب:</strong> لا تدخل في قاعدة الشكاوى أو النسخ الاحتياطية حتى تضغط «حفظ».</span><span class="right-actions" style="gap:6px"><button type="button" class="btn btn-sm btn-primary" data-action="restore-draft">استعادة المسودة</button><button type="button" class="btn btn-sm" data-action="discard-draft">تجاهل</button></span></div>'
    : '';
  const body = draftBanner +
    '<form id="newComplaintForm" onsubmit="return false">' +
    '<div class="risk-note">سيُنشأ رقم مرجعي عند الحفظ. الحقول غير الإلزامية يمكن تخطيها.</div>' +
    '<div id="intakeStepMount">' + intakeRenderStepBody() + '</div></form>';
  modal(intakeTitle(), intakeSubtitle(), body, intakeFooterHtml());
  if (['cName', 'cPhone', 'cSummary'].some(id => $('#' + id))) duplicateCheck();
  const focusEl = $('#intakeStepMount input, #intakeStepMount select, #intakeStepMount textarea, #intakeStepMount button.intake-type-card');
  focusEl?.focus?.();
}

function newComplaint() {
  if (!uiCan('complaints.create')) return toast('لا تملك صلاحية إنشاء شكوى.', 'error');
  intakeWizard = { step: 0, recordType: null, data: {} };
  renderIntakeWizard();
}

function intakePickType(type) {
  if (type !== 'complaint' && type !== 'inquiry') return;
  intakeWizard.recordType = type;
  intakeWizard.step = 1;
  if (type === 'inquiry') {
    intakeWizard.data.cCategory = intakeWizard.data.cCategory || 'استفسار عام';
    intakeWizard.data.cNature = intakeWizard.data.cNature || 'استفسار';
    intakeWizard.data.cPriority = intakeWizard.data.cPriority || 'normal';
  }
  renderIntakeWizard();
}

function intakeGoNext() {
  intakeCollectVisible();
  const max = intakeStepCount() - 1;
  if (intakeWizard.step < max) {
    intakeWizard.step += 1;
    renderIntakeWizard();
  }
}

function intakeGoBack() {
  intakeCollectVisible();
  if (intakeWizard.step <= 1) {
    intakeWizard.step = 0;
    intakeWizard.recordType = null;
  } else {
    intakeWizard.step -= 1;
  }
  renderIntakeWizard();
}

function intakeSkip() {
  intakeCollectVisible();
  intakeGoNext();
}

function hasComplaintDraft() {
  const key=complaintDraftStorageKey();
  if(!key)return false;
  try {
    localStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && d._ownerUserId === String(authenticatedUser?.id || '') && Object.values(d).some(v => String(v || '').trim());
  } catch (_) {
    return false;
  }
}

function saveComplaintDraft() {
  const key=complaintDraftStorageKey();
  if(!key)return;
  intakeCollectVisible();
  const draft = Object.assign({}, intakeWizard.data, {
    _recordType: intakeWizard.recordType || '',
    _step: intakeWizard.step,
    _ownerUserId: String(authenticatedUser.id),
    _savedAt: Date.now()
  });
  ['cName', 'cPhone', 'cFirstContactDate', 'cProvince', 'cCategory', 'cNature', 'cEntity', 'cPriority', 'cOwner', 'cSummary', 'cDetails', 'cSource', 'cRelatedToCurrent'].forEach(id => {
    const el = $('#' + id);
    if (el) draft[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch (e) {}
}

function restoreComplaintDraft(force) {
  const key=complaintDraftStorageKey();
  if(!key)return;
  try {
    localStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    const draft = JSON.parse(raw || 'null');
    if (!draft || draft._ownerUserId !== String(authenticatedUser?.id || '')) return;
    if (!force && !hasComplaintDraft()) return;
    intakeWizard.data = Object.assign({}, draft);
    if (draft._recordType === 'complaint' || draft._recordType === 'inquiry') {
      intakeWizard.recordType = draft._recordType;
      intakeWizard.step = Math.min(Number(draft._step) || 1, intakeStepCount() - 1);
    }
    renderIntakeWizard();
    Object.entries(draft).forEach(([id, value]) => {
      if (id.startsWith('_')) return;
      const el = $('#' + id);
      if (!el) return;
      if (el.type === 'radio') {
        document.querySelectorAll('input[name="' + (el.name || id) + '"]').forEach(r => { r.checked = r.value === value; });
        return;
      }
      if (typeof value === 'string' || typeof value === 'boolean') el.value = value;
    });
    $('#draftBanner')?.remove();
    duplicateCheck();
    toast('تم استعادة المسودة.');
  } catch (e) {}
}

function duplicateCheck() {
  const phone = phoneNorm($('#cPhone')?.value || intakeWizard.data.cPhone || '');
  const text = norm($('#cSummary')?.value || intakeWizard.data.cSummary || '');
  const matches = db.complaints.filter(c =>
    (phone && phone.length >= 7 && phoneNorm(c.phone) === phone) ||
    (text.length >= 9 && norm(c.summary).includes(text))
  );
  const mount = $('#duplicateMount');
  if (!mount) return;
  mount.innerHTML = matches.length
    ? '<div class="risk-note"><strong>احتمال تكرار:</strong> عُثر على ' + matches.length + ' سجل مشابه. راجع السجل قبل الإنشاء.<div style="margin-top:8px">' +
      matches.slice(0, 4).map(c => '<button class="btn btn-sm" type="button" data-action="detail" data-id="' + esc(c.id) + '">' + esc(c.id) + ' · ' + esc(c.summary) + '</button>').join(' ') +
      '</div></div>'
    : '';
}

async function createComplaint(asDraft = false) {
  intakeCollectVisible();
  const d = intakeWizard.data;
  const form = $('#newComplaintForm');
  if (!form) return;
  if (!asDraft) {
    if (!d.cSummary || !String(d.cSummary).trim()) {
      toast('أدخل موضوع السجل قبل الحفظ.', 'warn');
      return;
    }
  }
  const isInquiry = intakeWizard.recordType === 'inquiry';
  const body = {
    name: String(d.cName || '').trim(),
    firstContactDate: d.cFirstContactDate || null,
    phone: phoneNorm(d.cPhone || ''),
    province: d.cProvince || 'غير محددة',
    category: d.cCategory || (isInquiry ? 'استفسار عام' : 'غير مصنفة'),
    nature: d.cNature || (isInquiry ? 'استفسار' : ''),
    entity: d.cEntity || '',
    priority: d.cPriority || 'normal',
    owner: String(d.cOwner || authenticatedUser?.username || '').trim(),
    summary: String(d.cSummary || '').trim() || (asDraft ? 'مسودة بانتظار الاستكمال' : ''),
    details: String(d.cDetails || '').trim(),
    source: d.cSource || 'phone',
    recordType: isInquiry ? 'inquiry' : 'complaint',
    relatedToCurrent: isInquiry ? (d.cRelatedToCurrent || 'unknown') : undefined,
    asDraft
  };
  if (!asDraft && !body.summary) {
    toast('الموضوع مطلوب.', 'warn');
    return;
  }
  const files = Array.from(form.querySelector('#cAttachments')?.files || []);
  try {
    const hadPendingSave = Boolean(persistTimer);
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await persistQueue;
    if (hadPendingSave) {
      const saved = await api('/api/state', {
        method: 'PUT',
        headers: { 'X-State-Revision': String(stateRevision) },
        body: JSON.stringify(db)
      });
      stateRevision = saved.revision;
    }
    const response = await api('/api/complaints', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const stored = await api('/api/state');
    db = stored.state || cleanState();
    stateRevision = Number.isSafeInteger(stored.revision) ? stored.revision : response.revision;
    stateConflict = false;
    stateLoaded = true;
    intakeDefaults = { cProvince: body.province, cCategory: body.category, cEntity: body.entity };
    try {
      const draftKey=complaintDraftStorageKey();
      if(draftKey){localStorage.removeItem(draftKey);sessionStorage.removeItem(draftKey);}
      localStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
    closeModal();
    page = 'complaints';
    history.replaceState({ view: 'complaints' }, '', '#complaints');
    detailModal(response.complaint.id);
    window.dispatchEvent(new CustomEvent('complaints:created', { detail: { id: response.complaint.id, files } }));
    toast('تم حفظ السجل ' + response.complaint.id);
    if (!body.details || !body.name || !body.phone) {
      notify('استكمال بيانات مطلوب', response.complaint.id + ' · بعض بيانات السجل غير مكتملة.');
    }
  } catch (error) {
    toast('تعذر حفظ السجل: ' + error.message, 'error');
    throw error;
  }
}

/* Wizard actions — capture phase so they work without events.js changes */
document.addEventListener('click', function intakeWizardClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'intake-pick-type') { e.preventDefault(); intakePickType(el.dataset.type); }
  else if (a === 'intake-next') { e.preventDefault(); intakeGoNext(); }
  else if (a === 'intake-back') { e.preventDefault(); intakeGoBack(); }
  else if (a === 'intake-skip') { e.preventDefault(); intakeSkip(); }
}, true);
