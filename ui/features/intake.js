/* Single-screen intake; keep the shared draft/file state used by attachments. */
let intakeWizard = { step: 1, recordType: 'complaint', data: {}, files: [] };
let intakePhoneHintTimer = null;
let intakeDraftFiles = { owner: null, files: [] };

function intakeCollectVisible() {
  const form = $('#newComplaintForm');
  if (!form) return;
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.type === 'file' || !el.id) return;
    intakeWizard.data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
}

function intakeSuggestions(key, configured = []) {
  const counts = new Map();
  for (const c of db.complaints || []) {
    const value = String(c[key] || '').trim();
    if (value && !c.archivedAt) counts.set(value, (counts.get(value) || 0) + 1);
  }
  for (const value of configured) if (typeof value === 'string' && value.trim() && !counts.has(value)) counts.set(value, 0);
  return [...counts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], 'ar')).slice(0,60)
    .map(([value]) => '<option value="'+esc(value)+'"></option>').join('');
}

function intakeTextField(label, id, options = {}) {
  const value = intakeWizard.data[id] || '';
  return '<div class="form-field '+(options.full?'full':'')+'"><label for="'+id+'">'+label+
    (options.required?' <span class="intake-required">مطلوب</span>':'')+'</label><input class="field" id="'+id+'" name="'+id+'" type="'+(options.type||'text')+'" '+
    (options.required?'required ':'')+'maxlength="'+(options.max||120)+'" autocomplete="off" '+
    (options.list?'list="'+options.list+'" ':'')+(options.type==='tel'?'dir="ltr" inputmode="tel" ':'')+
    'aria-describedby="'+id+'Error'+(options.hint?' '+id+'Hint':'')+'" value="'+esc(value)+'">'+(options.hint?'<p class="small-copy" id="'+id+'Hint">'+esc(options.hint)+'</p>':'')+'<p class="field-error" id="'+id+'Error" hidden></p></div>';
}

function intakeQuickFormHtml() {
  const d = intakeWizard.data, inquiry = intakeWizard.recordType === 'inquiry';
  return '<div class="intake-record-type" role="group" aria-label="نوع السجل">'+
    [['complaint','شكوى'],['inquiry','استفسار']].map(([type,label])=>'<button type="button" class="btn btn-sm" data-action="intake-pick-type" data-type="'+type+'" aria-pressed="'+(type===intakeWizard.recordType)+'">'+label+'</button>').join('')+'</div>'+
    '<div class="form-grid">'+
    intakeTextField(inquiry?'ملخص الاستفسار':'ملخص الشكوى','cSummary',{required:true,max:180,full:true})+
    intakeTextField(inquiry?'اسم مقدم الاستفسار (اختياري)':'اسم مقدم الشكوى (اختياري)','cName',{list:'intakeNames',hint:'اتركه فارغًا إذا كان البلاغ مجهولًا.'})+
    intakeTextField('الهاتف (اختياري)','cPhone',{type:'tel',max:40})+
    '<div class="form-field full"><div id="duplicateMount" class="intake-phone-hint" role="status" aria-live="polite"></div></div></div>'+
    '<datalist id="intakeNames">'+intakeSuggestions('name')+'</datalist>'+
    '<datalist id="intakeEntities">'+intakeSuggestions('entity',db.settings.entities?.length?db.settings.entities:seed.settings.entities||[])+'</datalist>'+
    '<datalist id="intakeCategories">'+intakeSuggestions('category',db.settings.categories?.length?db.settings.categories:seed.settings.categories||[])+'</datalist>'+
    '<details class="intake-additional" id="intakeAdditional"><summary>تفاصيل إضافية <span class="small-copy">اختياري</span></summary><div class="form-grid">'+
    intakeTextField('الجهة (إن عُرفت)','cEntity',{list:'intakeEntities'})+
    intakeTextField('التصنيف (إن عُرف)','cCategory',{list:'intakeCategories'})+
    '<div class="form-field full"><label for="cDetails">التفاصيل المطولة (اختياري)</label><textarea class="textarea-field" id="cDetails" maxlength="10000" aria-describedby="cDetailsError">'+esc(d.cDetails||'')+'</textarea><p class="field-error" id="cDetailsError" hidden></p></div>'+
    selectField('المحافظة','cProvince',db.settings.provinces,d.cProvince||'',false)+
    selectField('طبيعة السجل','cNature',db.settings.natures||[],d.cNature||'',false)+
    selectField('الأولوية','cPriority',db.settings.priorities,d.cPriority||'normal',false)+
    selectField('قناة الورود','cSource',[{value:'phone',label:'الهاتف'},{value:'whatsapp',label:'واتساب'},{value:'telegram',label:'تلغرام'},{value:'other',label:'أخرى'}],d.cSource||'phone',false)+
    field('تاريخ أول تواصل','cFirstContactDate',d.cFirstContactDate||workDayKey(new Date()),'date',false)+
    '<div class="form-field"><label for="cRelatedToCurrent">متعلق بالوضع الحالي</label><select class="select-field" id="cRelatedToCurrent">'+[['unknown','غير محدد'],['yes','نعم'],['no','لا']].map(([v,l])=>'<option value="'+v+'" '+((d.cRelatedToCurrent||'unknown')===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div></div>'+
    '<div id="intakeAttachmentsMount"></div><p class="small-copy">تُحفظ بيانات المسودة على هذا الجهاز. بعد إعادة تشغيل التطبيق أعد اختيار المرفقات قبل الحفظ.</p></details>';
}

function intakeTitle() { return intakeWizard.recordType==='inquiry'?'تسجيل استفسار':'تسجيل شكوى'; }
function intakeNeedsCompletion() {
  const d = intakeWizard.data;
  return !String(d.cEntity||'').trim() || !String(d.cCategory||'').trim() ||
    d.cCategory==='غير مصنفة' || !d.cProvince || d.cProvince==='غير محددة';
}
function intakeSaveLabel() { return intakeNeedsCompletion() ? 'حفظ كمسودة' : 'فتح سجل'; }
function intakeUpdateSaveLabel() {
  const button=$('[data-action="save-complaint"]');
  if(button&&!intakeSavePending)button.textContent=intakeSaveLabel();
}
function intakeFooterHtml() {
  return '<div class="intake-save-actions"><span class="small-copy">Ctrl + Enter للحفظ</span>'+
    '<button type="button" class="btn btn-primary" data-action="save-complaint">'+intakeSaveLabel()+'</button></div>';
}
function renderIntakeWizard() {
  const banner = intakeWizard.offerDraft && hasComplaintDraft()
    ? '<div class="intake-draft" id="draftBanner"><span>لديك مسودة محفوظة</span><button type="button" class="btn btn-sm" data-action="restore-draft">استعادة المسودة</button><button type="button" class="btn btn-sm" data-action="discard-draft">تجاهل</button></div>' : '';
  intakeWizard.rendering=true;
  try{modal(intakeTitle(),'الملخص مطلوب فقط. يُحفظ السجل كمسودة برقم رسمي حتى تُستكمل الجهة والتصنيف والمحافظة.',banner+
    '<form id="newComplaintForm" novalidate>'+intakeQuickFormHtml()+'<p id="intakeDraftStatus" class="small-copy" role="status" aria-live="polite"></p></form>',intakeFooterHtml(),true);}finally{intakeWizard.rendering=false;}
  $('.modal')?.classList.add('intake-dialog','intake-quick');
  $('#cSummary')?.focus?.();
  intakePhoneHint();
}
function intakeFieldError(id, message) {
  const input=$('#'+id), error=$('#'+id+'Error');
  if(input){const additional=input.closest?.('#intakeAdditional');if(additional)additional.open=true;input.setAttribute('aria-invalid','true');input.focus?.();}
  if(error){error.hidden=false;error.textContent=message;}
  return false;
}
function intakeRequireSummary() {
  if(String(intakeWizard.data.cSummary||'').trim())return true;
  return intakeFieldError('cSummary','اكتب ملخصًا للسجل قبل الحفظ.');
}
function intakeValidate() {
  if(!intakeRequireSummary())return false;
  const d=intakeWizard.data;
  for(const [id,max,label] of [['cName',120,'الاسم'],['cPhone',40,'رقم الهاتف'],['cEntity',120,'الجهة'],['cCategory',120,'التصنيف'],['cSummary',180,'الملخص'],['cDetails',10000,'التفاصيل']]) {
    if(String(d[id]||'').length>max)return intakeFieldError(id,label+' أطول من الحد المسموح ('+max+' حرفًا).');
  }
  if(d.cPhone&&!/^[\d٠-٩۰-۹\s+().-]*$/.test(d.cPhone))return intakeFieldError('cPhone','استخدم أرقامًا ورمز + فقط مع المسافات أو الشرطات.');
  return true;
}
function newComplaint() {
  if(!uiCan('complaints.create'))return toast('لا تملك صلاحية إنشاء شكوى.','error');
  preserveIntakeDraft();
  intakeWizard={step:1,recordType:'complaint',data:{...intakeDefaults,cFirstContactDate:workDayKey(new Date()),cSource:'phone',cPriority:'normal'},files:[],offerDraft:true,startedAt:Date.now()};
  renderIntakeWizard();
}
function intakePickType(type) {
  if(!['complaint','inquiry'].includes(type)||intakeSavePending)return;
  intakeCollectVisible();
  intakeWizard.recordType=type;
  // Rerendering retains the full draft and selected files; nothing is submitted.
  renderIntakeWizard();saveComplaintDraft();
}
function preserveIntakeDraft() {
  if($('#newComplaintForm')&&!intakeSavePending&&!intakeWizard.completed&&!intakeWizard.rendering)saveComplaintDraft();
}
function intakePhoneHint() {
  const mount=$('#duplicateMount');if(!mount||!authenticatedUser)return;
  const phone=phoneNorm($('#cPhone')?.value||intakeWizard.data.cPhone||'');
  const matches=phone.length>=7?(db.complaints||[]).filter(c=>!c.archivedAt&&phoneNorm(c.phone||'')===phone):[];
  mount.innerHTML=matches.length?'<details><summary>لهذا الرقم '+matches.length+' سجل سابق — افتحه للمراجعة أو تابع تسجيل سجل جديد</summary>'+matches.slice(0,5).map(c=>'<button type="button" class="btn btn-sm" data-action="detail" data-id="'+esc(c.id)+'"><bdi>'+esc(c.id)+'</bdi> · '+esc(c.summary||'')+'</button>').join('')+'</details>':'';
}
function duplicateCheck() { intakeCollectVisible();intakePhoneHint(); }
function intakeSavedModal(id, elapsed, asDraft = false) {
  modal(asDraft?'تم حفظ المسودة':'تم فتح السجل','رقم السجل: '+esc(id),'<p class="intake-saved-id"><bdi>'+esc(id)+'</bdi></p><p class="small-copy">'+(asDraft?'مسودة تحتاج استكمال الجهة أو التصنيف أو المحافظة من صفحة السجل.':'يمكن متابعة السجل من صفحته.')+'</p><p class="small-copy">من فتح النموذج إلى الحفظ: '+elapsed+' ثانية.</p>',
    '<button type="button" class="btn" data-action="intake-view" data-id="'+esc(id)+'">فتح السجل</button><button type="button" class="btn btn-primary" data-action="intake-new">تسجيل شكوى أخرى</button>');
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
    return d && typeof d === 'object' && d._ownerUserId === String(authenticatedUser?.id || '') && ['cName','cPhone','cSummary','cDetails','cEntity','cCategory'].some(k=>String(d[k]||'').trim());
  } catch (_) {
    return false;
  }
}

function saveComplaintDraft() {
  const key=complaintDraftStorageKey();
  if(!key||intakeWizard.completed)return;
  intakeCollectVisible();
  intakeDraftFiles={owner:key,files:Array.from(intakeWizard.files||[])};
  const draft = Object.assign({}, intakeWizard.data, {
    _recordType: intakeWizard.recordType || '',
    _step: intakeWizard.step,
    _ownerUserId: String(authenticatedUser.id),
    _savedAt: Date.now()
  });
  ['cName', 'cPhone', 'cFirstContactDate', 'cProvince', 'cCategory', 'cNature', 'cEntity', 'cPriority', 'cSummary', 'cDetails', 'cSource', 'cRelatedToCurrent'].forEach(id => {
    const el = $('#' + id);
    if (el) draft[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  const status=$('#intakeDraftStatus');
  let saved=false;
  const text=JSON.stringify(draft);
  try { localStorage.setItem(key,text); saved=true; } catch (_) {}
  try { sessionStorage.setItem(key,text); saved=true; } catch (_) {}
  if(status){
    status.textContent=saved?'مسودة محفوظة على هذا الجهاز · '+new Date(draft._savedAt).toLocaleTimeString('ar-SY-u-nu-latn'):'تعذر حفظ المسودة على هذا الجهاز. احتفظ بالنموذج مفتوحًا وأعد المحاولة.';
    status.classList.toggle('danger-text',!saved);
  }
  return saved;
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
      intakeWizard.step = 1;
    }
    intakeWizard.offerDraft=false;
    intakeWizard.files=intakeDraftFiles.owner===key?Array.from(intakeDraftFiles.files):[];
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
    toast('تم استعادة المسودة.');
  } catch (e) {}
}

let intakeSavePending = false;
async function createComplaint(asDraft = false, addAnother = false) {
  if(intakeSavePending)return false;
  intakeCollectVisible();
  const d = intakeWizard.data;
  const form = $('#newComplaintForm');
  if (!form) return false;
  if (!intakeValidate()) return false;
  asDraft = asDraft || intakeNeedsCompletion();
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
    summary: String(d.cSummary || '').trim() || (asDraft ? 'مسودة بانتظار الاستكمال' : ''),
    details: String(d.cDetails || '').trim(),
    source: d.cSource || 'phone',
    recordType: isInquiry ? 'inquiry' : 'complaint',
    relatedToCurrent: isInquiry ? (d.cRelatedToCurrent || 'unknown') : undefined,
    asDraft
  };
  const files = Array.from(intakeWizard.files?.length ? intakeWizard.files : form.querySelector('#cAttachments')?.files || []);
  intakeSavePending = true;
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
    intakeWizard.completed=true;
    intakeDraftFiles={owner:null,files:[]};
    closeModal();
    page = 'complaints';
    history.replaceState({ view: 'complaints' }, '', '#complaints');
    render();
    if(!addAnother)intakeSavedModal(response.complaint.id,Math.max(0,Math.round((Date.now()-(intakeWizard.startedAt||Date.now()))/1000)),asDraft);
    window.dispatchEvent(new CustomEvent('complaints:created', { detail: { id: response.complaint.id, files } }));
    intakeWizard.files = [];
    if(addAnother){render();newComplaint();}
    toast((asDraft?'تم حفظ المسودة ':'تم فتح السجل ') + response.complaint.id);
  } catch (error) {
    toast('تعذر حفظ السجل: ' + error.message, 'error');
    throw error;
  } finally { intakeSavePending = false; }
}

document.addEventListener('click',function(e){
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action;
  if(action==='intake-pick-type'){e.preventDefault();intakePickType(el.dataset.type);}
  if(action==='intake-new'){e.preventDefault();newComplaint();}
  if(action==='intake-view'){e.preventDefault();detailModal(el.dataset.id);}
  if(action==='intake-related'){e.preventDefault();duplicateCheck();}
},true);
document.addEventListener('input',function(e){
  if(!e.target.closest?.('#newComplaintForm'))return;
  const error=$('#'+e.target.id+'Error');if(error){error.hidden=true;error.textContent='';}e.target.removeAttribute?.('aria-invalid');
  saveComplaintDraft();intakeUpdateSaveLabel();
  if(e.target.id==='cPhone'){clearTimeout(intakePhoneHintTimer);intakePhoneHintTimer=setTimeout(()=>{if($('#newComplaintForm'))intakePhoneHint();},250);}
});
document.addEventListener('change',function(e){if(e.target.closest?.('#newComplaintForm')&&e.target.type!=='file'){saveComplaintDraft();intakeUpdateSaveLabel();}});
document.addEventListener('submit',function(e){
  if(e.target?.id!=='newComplaintForm')return;
  e.preventDefault();$('[data-action="save-complaint"]')?.click();
});
window.addEventListener('pagehide',preserveIntakeDraft);
window.addEventListener('beforeunload',preserveIntakeDraft);

