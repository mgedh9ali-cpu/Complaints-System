let settingsOptionGroup = '';
const managedTypes=['categories','natures','provinces','entities','priorities'];
function validSettingType(type){return managedTypes.includes(type);}
function settingDescriptionKey(type){return type==='categories'?'categoryDescriptions':type==='natures'?'natureDescriptions':type==='entities'?'entityDescriptions':null;}
function settingEntries(type){ensureManagedSettings();return type==='priorities'?db.settings.priorities.map(x=>({value:x.value,label:x.label})):(db.settings[type]||[]).map(x=>({value:x,label:x}));}
function setOptionListCleared(type, cleared) {
  const keys = new Set(db.settings.clearedOptionLists || []);
  if (cleared) keys.add(type);
  else keys.delete(type);
  db.settings.clearedOptionLists = [...keys];
}
async function persistRecordOptions(previous) {
  try {
    const saved = await api('/api/settings', {method:'PUT', headers:{'X-State-Revision':String(stateRevision)}, body:JSON.stringify(db.settings)});
    db.settings = saved.settings || db.settings;
    stateRevision = saved.revision;
  } catch (error) {
    db.settings = previous;
    throw error;
  }
}
function addSetting(type,value){
  if(!uiCan('settings.manage')||!validSettingType(type))return;ensureManagedSettings();settingsOptionGroup=type;const editing=typeof value==='string';value=value||'';
  const entry=editing?settingEntries(type).find(x=>x.value===value):null;if(editing&&!entry)return toast('تعذر العثور على الخيار المطلوب.','error');
  const key=settingDescriptionKey(type);if(key)db.settings[key] ||= {};
  const title=(editing?'تعديل ':'إضافة ')+({categories:'تصنيف',natures:'طبيعة الشكاوي',provinces:'محافظة',entities:'جهة مختصة',priorities:'أولوية'})[type];
  const label=entry?.label||'';const desc=key?(db.settings[key][value]||''):'';
  modal(title,'تُحفظ القيم في قاعدة البيانات المحلية. حذف خيار لا يغيّر الشكاوى السابقة.','<form id="settingForm"><div class="form-field"><label for="settingValue">الاسم</label><input class="field" id="settingValue" required maxlength="100" value="'+esc(label)+'"></div>'+(key?'<div class="form-field" style="margin-top:12px"><label for="settingDescription">الوصف</label><textarea class="textarea-field" id="settingDescription" maxlength="500" placeholder="وصف اختياري">'+esc(desc)+'</textarea></div>':'')+'</form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-setting" data-type="'+type+'" data-mode="'+(editing?'edit':'create')+'" data-original="'+esc(value)+'">حفظ</button>');
}
async function saveSetting(type,mode,original){
  if(!uiCan('settings.manage')||!validSettingType(type))return;
  ensureManagedSettings();
  const name=($('#settingValue')?.value||'').trim();
  if(!name)return toast('أدخل الاسم.','warn');
  await flushUiBeforeAction();
  const previous = structuredClone(db.settings);
  const key=settingDescriptionKey(type);
  const desc=($('#settingDescription')?.value||'').trim();
  if(type==='priorities'){
    if(mode==='edit'){
      const i=db.settings.priorities.findIndex(p=>p.value===original);
      if(i>=0)db.settings.priorities[i]={value:original,label:name};
    }else{
      if(db.settings.priorities.some(p=>p.label===name))return toast('القيمة موجودة مسبقاً.','warn');
      db.settings.priorities.push({value:'custom_'+crypto.randomUUID().replaceAll('-',''),label:name});
    }
  }else{
    if(name!==original&&(db.settings[type]||[]).includes(name))return toast('القيمة موجودة مسبقاً.','warn');
    if(mode==='edit'){
      const i=(db.settings[type]||[]).indexOf(original);
      if(i>=0)db.settings[type][i]=name;
      if(key&&original!==name){db.settings[key][name]=desc;delete db.settings[key][original];}
      else if(key)db.settings[key][name]=desc;
    }else{
      if((db.settings[type]||[]).includes(name))return toast('القيمة موجودة مسبقاً.','warn');
      db.settings[type]=[...(db.settings[type]||[]),name];
      if(key){db.settings[key]||={};db.settings[key][name]=desc;}
    }
  }
  setOptionListCleared(type,false);
  await persistRecordOptions(previous);closeModal();render();toast('تم حفظ الخيار.');
}
async function deleteSetting(type,value){
  if(!uiCan('settings.manage')||!validSettingType(type))return;ensureManagedSettings();const entries=settingEntries(type);if(!entries.some(x=>x.value===value))return;
  const label=({categories:'التصنيف',natures:'طبيعة الشكاوي',provinces:'المحافظة',entities:'الجهة المختصة',priorities:'الأولوية'})[type];
  if(!await confirmDialog({title:'حذف خيار',message:'حذف «'+(entries.find(x=>x.value===value)?.label||value)+'» من قائمة '+label+'؟',detail:'تبقى القيمة محفوظة في السجلات السابقة.',confirmLabel:'حذف',danger:true}))return;
  await flushUiBeforeAction();
  settingsOptionGroup=type;
  const previous = structuredClone(db.settings);
  if(type==='priorities')db.settings.priorities=db.settings.priorities.filter(x=>x.value!==value);else db.settings[type]=db.settings[type].filter(item=>item!==value);
  const key=settingDescriptionKey(type);if(key)delete (db.settings[key] ||= {})[value];setOptionListCleared(type,!db.settings[type].length);await persistRecordOptions(previous);render();toast('تم حذف الخيار من القائمة.');
}
async function clearSettingType(type){
  if(!uiCan('settings.manage')||!validSettingType(type))return;ensureManagedSettings();const label=({categories:'التصنيفات',natures:'طبيعة الشكاوي',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'})[type];
  if(!settingEntries(type).length)return toast('القائمة فارغة بالفعل.','warn');
  if(!await confirmDialog({title:'إفراغ القائمة',message:'حذف جميع '+label+' من خيارات الإدخال؟',detail:'تبقى القيم محفوظة في السجلات السابقة.',confirmLabel:'حذف',danger:true}))return;
  await flushUiBeforeAction();
  const previous = structuredClone(db.settings);
  db.settings[type]=[];setOptionListCleared(type,true);const key=settingDescriptionKey(type);if(key)db.settings[key]={};await persistRecordOptions(previous);render();toast('تم إفراغ القائمة.');
}
async function restoreDefaultSettings(type='all'){
  if(!uiCan('settings.manage')||!['all',...managedTypes].includes(type))return;const labels={all:'كل القوائم',categories:'التصنيفات',natures:'طبيعة الشكاوي',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'};
  if(!await confirmDialog({title:'استعادة الخيارات',message:'استعادة '+labels[type]+' الافتراضية؟',detail:'لن تتغير السجلات السابقة.',confirmLabel:'استعادة'}))return;
  await flushUiBeforeAction();
  const previous = structuredClone(db.settings);
  for(const key of managedTypes){if(type!=='all'&&type!==key)continue;setOptionListCleared(key,false);db.settings[key]=key==='priorities'?seed.settings.priorities.map(x=>({...x})): [...(seed.settings[key]||[])];const descKey=settingDescriptionKey(key);if(descKey)db.settings[descKey]={};}
  await persistRecordOptions(previous);render();toast('تمت استعادة '+labels[type]+' الافتراضية.');
}
function editComplaintModal(id){
  const c=db.complaints.find(c=>c.id===id);if(!c||!canEditRecord(c))return toast('لا تملك صلاحية تعديل هذا السجل.','error');
  ensureManagedSettings();
  const options=(items,current)=>items.includes(current)?items:[current,...items].filter(Boolean);
  modal(c.status==='draft'?'استكمال المسودة':'استكمال وتعديل بيانات الشكوى',c.status==='draft'?'أكمل البيانات ثم افتح السجل من إجراءات الحالة. يبقى الرقم وتاريخ التسجيل ثابتين.':'الرقم وتاريخ التسجيل وسجل الإجراءات ثابتة.',
  '<form id="editComplaintForm"><div class="form-grid">'+field('اسم المشتكي','editName',c.name||'')+field('تاريخ أول تواصل','editFirstContactDate',c.firstContactDate||'','date')+field('رقم الهاتف','editPhone',c.phone||'','tel')+
  selectField('المحافظة','editProvince',options(db.settings.provinces,c.province),c.province,true)+selectField('التصنيف','editCategory',options(db.settings.categories,c.category),c.category,true)+
  selectField('طبيعة الشكاوي','editNature',options(db.settings.natures||[],c.nature||''),c.nature||'',false)+
  selectField('الجهة','editEntity',options(db.settings.entities,c.entity),c.entity||'')+field('الموضوع','editSummary',c.summary||'','text',true,'maxlength="180"')+
  '<div class="form-field full"><label for="editDetails">التفاصيل</label><textarea class="textarea-field" id="editDetails" maxlength="10000">'+esc(c.details||'')+'</textarea></div></div></form>',
  '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-complaint-edit" data-id="'+esc(id)+'">حفظ البيانات</button>');
}
async function saveComplaintEdit(id){
  if(!$('#editComplaintForm')?.reportValidity())return false;
  const body={firstContactDate:$('#editFirstContactDate')?.value||null,name:$('#editName').value.trim(),phone:phoneNorm($('#editPhone').value),province:$('#editProvince').value,category:$('#editCategory').value,nature:$('#editNature')?.value||'',entity:$('#editEntity').value,summary:$('#editSummary').value.trim(),details:$('#editDetails').value.trim()};
  try{await flushUiBeforeAction();const result=await api('/api/complaints/'+encodeURIComponent(id),{method:'PATCH',headers:{'X-State-Revision':String(stateRevision)},body:JSON.stringify(body)});closeModal();await reloadStoredState();toast('حُفظت بيانات الشكوى.');if(result.undoToken)showStatusUndo(id,result.undoToken,result.undoExpiresAt,'edit');}catch(error){return toast(error.message,'error');}
}
async function flushUiBeforeAction(){if(stateConflict)throw new Error('حل تعارض البيانات قبل تنفيذ إجراء جديد.');await persistQueue;if(persistTimer){clearTimeout(persistTimer);persistTimer=null;await persistUiNow();}}
async function reloadStoredState(){const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number(stored.revision)||0;stateConflict=false;stateLoaded=true;render();}
function maintenancePanel(){
  if(authenticatedUser?.role!=='admin')return '';
  return '<section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>صحة النظام ونزاهة البيانات</h2><p>فحص سلامة قاعدة البيانات وسلسلة التدقيق من داخل البرنامج</p></div></div><div class="panel-body">'
    +'<div class="footer-actions" style="margin-bottom:12px">'
    +'<button class="btn btn-primary" data-action="audit-verify">فحص سلامة قاعدة البيانات وسلسلة التدقيق الآن</button>'
    +'<button class="btn" data-action="verify-document-dialog">التحقق من مستند مطبوع</button>'
    +'</div><div id="integrityCert" class="small-copy">اضغط الزر لعرض شهادة النزاهة.</div></div></section>';
}

function passwordChangeModal(){modal('تغيير كلمة المرور','أدخل كلمة المرور الحالية والجديدة.','<div class="form-field"><label for="currentPassword">الحالية</label><input class="field" id="currentPassword" type="password"></div><div class="form-field"><label for="newPassword">الجديدة</label><input class="field" id="newPassword" type="password" minlength="12"></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-password-change">حفظ</button>');}
async function savePasswordChange(){try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#currentPassword')?.value,newPassword:$('#newPassword')?.value})});closeModal();toast('تم تغيير كلمة المرور.');}catch(e){return toast(e.message,'error');}}



/* Encrypted offline sync import (password-gated) */
let pendingSyncPackage=null,syncImportTarget=null,syncImportResolve=null,pendingSyncPreview=null;
function finishSyncImportWait(){if(typeof syncImportResolve==='function'){const done=syncImportResolve;syncImportResolve=null;done();}}
function handleSyncImportChange(target){
  const file=target?.files?.[0];if(!file)return Promise.resolve();
  return (async()=>{
    try{
      if(file.size>48*1024*1024)throw new Error('ملف المزامنة كبير جدًا؛ استخدم النسخة الكاملة لنقل الأرشيف.');
      const text=await file.text();
      pendingSyncPackage=JSON.parse(text);
      syncImportTarget=target;
      return await new Promise(resolve=>{syncImportResolve=resolve;modal('عبارة مرور النقل','أدخل عبارة المرور المستخدمة عند التصدير. ستظهر المعاينة قبل الدمج.','<div class="form-field"><label for="syncPassword">عبارة المرور</label><input class="field" id="syncPassword" type="password" autocomplete="off"></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="confirm-sync-password">تأكيد الاستيراد</button>');});
    }catch(error){toast(error.message||'تعذر قراءة ملف المزامنة.','error');if(target)target.value='';finishSyncImportWait();}
  })();
}
async function confirmSyncPassword(){
  if(!pendingSyncPackage && typeof syncPasswordResolve==='function'){
    const input=$('#syncPassword'), confirmation=$('#syncPasswordConfirm');
    if(!input||!input.reportValidity())return;
    if(confirmation&&confirmation.value!==input.value)return toast('عبارتا المرور غير متطابقتين.','warn');
    const password=input.value,done=syncPasswordResolve;syncPasswordResolve=null;
    input.value='';if(confirmation)confirmation.value='';closeModal();done?.(password);
    return;
  }
  try{
    if(!pendingSyncPackage)return toast('لا توجد حزمة مزامنة معلّقة.','warn');
    const password=$('#syncPassword')?.value||'', owner=authenticatedUser, transfer=pendingSyncPackage;
    await flushUiBeforeAction();
    const preview=await api('/api/sync/preview',{method:'POST',body:JSON.stringify({package:transfer,password})});
    if(owner!==authenticatedUser||transfer!==pendingSyncPackage)return false;
    pendingSyncPreview={preview,password,owner,transfer};
    const conflicts=(preview.conflicts||[]).filter(c=>c.kind!=='missing_from_incoming');
    modal('معاينة المزامنة الآمنة','لن يُحذف أي سجل محلي. عند تعارض نفس الرقم تبقى النسخة المحلية.',
      '<ul class="update-steps"><li>سجلات جديدة: '+esc(preview.added||0)+'</li><li>سجلات محلية غير موجودة بالملف وتبقى محفوظة: '+esc(preview.removed||0)+'</li><li>تعارضات تبقى فيها البيانات المحلية: '+conflicts.length+'</li></ul>'+
      (conflicts.length?'<p class="small-copy">الأرقام المتعارضة: '+conflicts.slice(0,30).map(c=>esc(c.id)).join('، ')+'</p>':'')+
      '<p>تُحفظ نسخة أمان كاملة قبل الدمج.</p>',
      '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="confirm-sync-merge">تأكيد الدمج</button>');
    return;
  }catch(error){toast(error.message,'error');cancelPendingSyncImport();closeModal();}
}
async function confirmSyncMerge(){
  const pending=pendingSyncPreview;
  if(!pending||!pendingSyncPackage||pending.owner!==authenticatedUser||pending.transfer!==pendingSyncPackage)return toast('أعد معاينة ملف المزامنة.','warn');
  try{
    await flushUiBeforeAction();
    const result=await api('/api/sync/import',{method:'POST',body:JSON.stringify({package:pending.transfer,password:pending.password,expectedRevision:pending.preview.revision,merge:true})});
    if(pending.owner!==authenticatedUser||pending.transfer!==pendingSyncPackage)return false;
    if(syncImportTarget)syncImportTarget.value='';
    const input=$('#syncImportFile');if(input)input.value='';
    pendingSyncPackage=null;pendingSyncPreview=null;syncImportTarget=null;closeModal();
    await reloadStoredState();toast('تم دمج ملف المزامنة. التعارضات المحفوظة محليًا: '+(result.preservedConflicts||0));
  }catch(error){toast(error.message,'error');cancelPendingSyncImport();closeModal();}
  finally{finishSyncImportWait();}
}
async function exportEncryptedSync(){
  if(!uiCan('sync.export')){toast('ليس لديك صلاحية تصدير المزامنة.','error');return false;}
  const password=await askSyncPassword(true);
  if(!password)return false;
  const sealed=await api('/api/sync/export',{method:'POST',body:JSON.stringify({password})});
  const filename='complaints-sync-'+new Date().toISOString().slice(0,10)+'.json';
  const blob=new Blob([JSON.stringify(sealed)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;a.hidden=true;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('تم تنزيل ملف المزامنة المشفر. انقله يدويًا واحفظ عبارة المرور منفصلة.');
  return true;
}
function cancelPendingSyncImport(){pendingSyncPackage=null;pendingSyncPreview=null;if(syncImportTarget){try{syncImportTarget.value='';}catch(_){}}syncImportTarget=null;finishSyncImportWait();}

