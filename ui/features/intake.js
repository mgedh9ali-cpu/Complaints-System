/* Single-screen intake; keep the shared draft/file state used by attachments. */
let intakeWizard = { step: 1, recordType: 'complaint', data: {}, files: [] };
const intakeTypes = { complaint: 'شكوى', inquiry: 'استفسار', contact: 'تواصل' };
let intakeDraftFiles = { owner: null, files: [] };
let intakeDraftTimer = null, intakePhoneTimer = null;
function cancelIntakeTimers(){
  if(intakeDraftTimer!==null)clearTimeout(intakeDraftTimer);
  if(intakePhoneTimer!==null)clearTimeout(intakePhoneTimer);
  intakeDraftTimer=null;intakePhoneTimer=null;
}
function scheduleIntakeDraft(){
  if(intakeDraftTimer!==null)clearTimeout(intakeDraftTimer);
  const wizard=intakeWizard, owner=complaintDraftStorageKey();
  intakeDraftTimer=setTimeout(()=>{
    intakeDraftTimer=null;
    if(wizard===intakeWizard&&owner===complaintDraftStorageKey()&&$('#newComplaintForm')&&!intakeSavePending)saveComplaintDraft();
  },350);
}
function scheduleIntakePhoneHint(){
  if(intakePhoneTimer!==null)clearTimeout(intakePhoneTimer);
  // Exact draft matches remain immediate; the expensive record scan waits.
  intakePhoneHint(false);
  const wizard=intakeWizard, owner=complaintDraftStorageKey();
  intakePhoneTimer=setTimeout(()=>{
    intakePhoneTimer=null;
    if(wizard===intakeWizard&&owner===complaintDraftStorageKey()&&$('#newComplaintForm')&&!intakeSavePending)intakePhoneHint();
  },220);
}

function intakeCollectVisible() {
  const form = $('#newComplaintForm');
  if (!form) return;
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.type === 'file' || !el.id) return;
    intakeWizard.data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
}

function intakeSuggestions(key, configured) {
  const cache=intakeWizard.suggestions||(intakeWizard.suggestions=new Map());
  const cacheKey=JSON.stringify([key,configured||null]);
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const counts = new Map();
  const available = configured && new Set(configured);
  for (const c of db.complaints || []) {
    const value = String(c[key] || '').trim();
    if (value && !c.archivedAt && (!available || available.has(value))) counts.set(value, (counts.get(value) || 0) + 1);
  }
  for (const value of configured || []) if (typeof value === 'string' && value.trim() && !counts.has(value)) counts.set(value, 0);
  const html = [...counts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], 'ar')).slice(0,60)
    .map(([value]) => '<option value="'+esc(value)+'"></option>').join('');
  cache.set(cacheKey,html);
  return html;
}

function intakeTextField(label, id, options = {}) {
  const value = intakeWizard.data[id] || '';
  return '<div class="form-field '+(options.full?'full':'')+'"><label for="'+id+'">'+label+
    (options.required?' <span class="intake-required">مطلوب</span>':'')+'</label><input class="field" id="'+id+'" name="'+id+'" type="'+(options.type||'text')+'" '+
    (options.required?'required ':'')+'maxlength="'+(options.max||120)+'" autocomplete="off" '+
    (options.placeholder?'placeholder="'+esc(options.placeholder)+'" ':'')+(options.list?'list="'+options.list+'" ':'')+(options.type==='tel'?'dir="ltr" inputmode="tel" ':'')+
    'aria-describedby="'+id+'Error'+(options.hint?' '+id+'Hint':'')+'" value="'+esc(value)+'">'+(options.hint?'<p class="small-copy" id="'+id+'Hint">'+esc(options.hint)+'</p>':'')+'<p class="field-error" id="'+id+'Error" hidden></p></div>';
}

function intakeQuickFormHtml() {
  const d = intakeWizard.data, type = intakeWizard.recordType;
  const label = { complaint: 'الشكوى', inquiry: 'الاستفسار', contact: 'التواصل' }[type];
  return '<p class="intake-section-label" id="intakeTypeLabel">نوع السجل</p><div class="intake-record-type" role="group" aria-labelledby="intakeTypeLabel">'+
    Object.entries(intakeTypes).map(([type,label])=>'<button type="button" class="btn btn-sm" data-action="intake-pick-type" data-type="'+type+'" aria-pressed="'+(type===intakeWizard.recordType)+'">'+label+'</button>').join('')+'</div>'+
    '<div class="form-grid">'+
    intakeTextField('ملخص '+label,'cSummary',{required:true,max:180,full:true,placeholder:'اكتب موضوع السجل باختصار'})+
    intakeTextField((type === 'complaint' ? 'اسم مقدم الشكوى' : 'اسم المتصل') + ' (اختياري)','cName',{list:'intakeNames',placeholder:'الاسم الكامل',hint:'اترك الاسم فارغًا عند عدم معرفته.'})+
    intakeTextField('الهاتف (اختياري)','cPhone',{type:'tel',max:40,placeholder:'09XXXXXXXX'})+
    '<div class="form-field full"><div id="duplicateMount" class="intake-phone-hint" role="status" aria-live="polite"></div></div></div>'+
    '<datalist id="intakeNames">'+intakeSuggestions('name')+'</datalist>'+
    '<datalist id="intakeEntities">'+intakeSuggestions('entity',recordOptions('entities'))+'</datalist>'+
    '<datalist id="intakeCategories">'+intakeSuggestions('category',recordOptions('categories'))+'</datalist>'+
    '<details class="intake-additional" id="intakeAdditional"><summary><span>تفاصيل إضافية</span> <span class="small-copy">اختياري</span></summary><div class="form-grid">'+
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

function intakeTitle() { return 'تسجيل ' + intakeTypes[intakeWizard.recordType]; }
function intakeNeedsCompletion() {
  const d = intakeWizard.data;
  return !String(d.cSummary||'').trim();
}
function intakeFooterHtml() {
  return '<div class="intake-save-actions"><span class="small-copy">Ctrl + Enter للحفظ</span>'+
    (uiCan('settings.manage')?'<button type="button" class="btn" data-action="intake-settings">خيارات التسجيل</button>':'')+
    '<button type="button" class="btn" data-action="close-modal">إلغاء</button>'+
    '<button type="button" class="btn btn-primary" data-action="save-complaint">حفظ السجل</button></div>';
}
function renderIntakeWizard() {
  intakeWizard.rendering=true;
  try{modal(intakeTitle(),'اختر نوع السجل وأدخل الملخص. يُنشأ رقم السجل تلقائيًا عند الحفظ.',
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
  cancelIntakeTimers();
  intakeWizard={step:1,recordType:'complaint',data:{...intakeDefaults,cFirstContactDate:workDayKey(new Date()),cSource:'phone',cPriority:'normal'},files:[],priorDraft:readComplaintDraft(),priorFiles:intakeDraftFiles.owner===complaintDraftStorageKey()?[...intakeDraftFiles.files]:[],startedAt:Date.now()};
  renderIntakeWizard();
}
function intakePickType(type) {
  if(!Object.hasOwn(intakeTypes, type)||intakeSavePending)return;
  cancelIntakeTimers();
  intakeCollectVisible();
  intakeWizard.recordType=type;
  // Rerendering retains the full draft and selected files; nothing is submitted.
  renderIntakeWizard();saveComplaintDraft();
}
function preserveIntakeDraft() {
  if($('#newComplaintForm')&&!intakeSavePending&&!intakeWizard.completed&&!intakeWizard.rendering){cancelIntakeTimers();saveComplaintDraft();}
}
function intakePhoneHint(scanRecords = true) {
  const mount=$('#duplicateMount');if(!mount||!authenticatedUser)return;
  const phone=phoneNorm($('#cPhone')?.value??intakeWizard.data.cPhone??'');
  const matches=scanRecords&&phone.length>=7?(db.complaints||[]).filter(c=>!c.archivedAt&&phoneNorm(c.phone||'')===phone):[];
  const saved = matchingIntakeDraft(phone);
  mount.innerHTML=(saved?'<div class="intake-draft" id="draftBanner"><span>توجد مسودة لهذا الرقم.</span><button type="button" class="btn btn-sm" data-action="restore-draft">استعادة المسودة</button><button type="button" class="btn btn-sm" data-action="discard-draft">تجاهل</button></div>':'')+(matches.length?'<details><summary>لهذا الرقم '+matches.length+' سجل سابق — افتحه للمراجعة أو تابع تسجيل سجل جديد</summary>'+matches.slice(0,5).map(c=>'<button type="button" class="btn btn-sm" data-action="detail" data-id="'+esc(c.id)+'"><bdi>'+esc(c.id)+'</bdi> · '+esc(c.summary||'')+'</button>').join('')+'</details>':'');
}
function duplicateCheck() { intakeCollectVisible();intakePhoneHint(); }
function intakeSavedModal(id, elapsed, asDraft = false) {
  modal(asDraft?'تم حفظ المسودة':'تم فتح السجل','رقم السجل: '+esc(id),'<p class="intake-saved-id"><bdi>'+esc(id)+'</bdi></p><p class="small-copy">'+(asDraft?'يمكن استكمال الموضوع من صفحة السجل.':'يمكن متابعة السجل من صفحته.')+'</p><p class="small-copy">من فتح النموذج إلى الحفظ: '+elapsed+' ثانية.</p>',
    '<button type="button" class="btn" data-action="intake-view" data-id="'+esc(id)+'">فتح السجل</button><button type="button" class="btn btn-primary" data-action="intake-new">تسجيل سجل آخر</button>');
}

function readComplaintDraft() {
  const key=complaintDraftStorageKey();
  if(!key)return false;
  try {
    localStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return d && d._ownerUserId === String(authenticatedUser?.id || '') ? d : null;
  } catch (_) {
    return false;
  }
}

function matchingIntakeDraft(phone = phoneNorm(intakeWizard.data.cPhone || '')) {
  const draft = intakeWizard.priorDraft;
  return phone && draft && phoneNorm(draft.cPhone || '') === phone ? draft : null;
}

function dismissIntakeDraftOffer() {
  intakeWizard.priorDraft = null;
  intakePhoneHint();
}

function saveComplaintDraft() {
  if(intakeDraftTimer!==null)clearTimeout(intakeDraftTimer);
  intakeDraftTimer=null;
  const key=complaintDraftStorageKey();
  if(!key||intakeWizard.completed)return;
  intakeCollectVisible();
  const hasContent = ['cName','cSummary','cDetails'].some(field => String(intakeWizard.data[field] || '').trim());
  if (matchingIntakeDraft() || (!hasContent && !intakeWizard.files.length)) return;
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
    status.dataset.state=saved?'saved':'failed';
  }
  return saved;
}

function restoreComplaintDraft() {
  const key=complaintDraftStorageKey();
  if(!key)return;
  cancelIntakeTimers();
  try {
    localStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    intakeCollectVisible();
    const draft = matchingIntakeDraft();
    if (!draft || draft._ownerUserId !== String(authenticatedUser?.id || '')) return;
    intakeWizard.data = Object.assign({}, draft);
    if (Object.hasOwn(intakeTypes, draft._recordType)) {
      intakeWizard.recordType = draft._recordType;
      intakeWizard.step = 1;
    }
    intakeWizard.priorDraft=null;
    intakeWizard.files=intakeWizard.priorFiles || [];
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
    intakePhoneHint();
    saveComplaintDraft();
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
  const recordType = intakeWizard.recordType;
  const hasContactOptions = recordType !== 'complaint';
  const body = {
    name: String(d.cName || '').trim(),
    firstContactDate: d.cFirstContactDate || null,
    phone: phoneNorm(d.cPhone || ''),
    province: d.cProvince || 'غير محددة',
    category: d.cCategory || (hasContactOptions ? intakeTypes[recordType] + ' عام' : 'غير مصنفة'),
    nature: d.cNature || (hasContactOptions ? intakeTypes[recordType] : ''),
    entity: d.cEntity || '',
    priority: d.cPriority || 'normal',
    summary: String(d.cSummary || '').trim() || (asDraft ? 'مسودة بانتظار الاستكمال' : ''),
    details: String(d.cDetails || '').trim(),
    source: d.cSource || 'phone',
    recordType,
    relatedToCurrent: hasContactOptions ? (d.cRelatedToCurrent || 'unknown') : undefined,
    asDraft
  };
  const files = Array.from(intakeWizard.files?.length ? intakeWizard.files : form.querySelector('#cAttachments')?.files || []);
  cancelIntakeTimers();
  saveComplaintDraft();
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
      const storedDraft = readComplaintDraft();
      if(draftKey && (!intakeWizard.priorDraft || storedDraft?._savedAt !== intakeWizard.priorDraft._savedAt || matchingIntakeDraft())){
        localStorage.removeItem(draftKey);sessionStorage.removeItem(draftKey);
      }
      localStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
    intakeWizard.completed=true;
    if(!readComplaintDraft())intakeDraftFiles={owner:null,files:[]};
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
  if(intakeSavePending)return;
  scheduleIntakeDraft();
  if(e.target.id==='cPhone')scheduleIntakePhoneHint();
});
document.addEventListener('change',function(e){if(e.target.closest?.('#newComplaintForm')&&e.target.type!=='file'){saveComplaintDraft();}});
document.addEventListener('submit',function(e){
  if(e.target?.id!=='newComplaintForm')return;
  e.preventDefault();$('[data-action="save-complaint"]')?.click();
});
window.addEventListener('pagehide',preserveIntakeDraft);
window.addEventListener('beforeunload',preserveIntakeDraft);
