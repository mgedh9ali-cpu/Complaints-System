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
    await persistUiNow();
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
  if(!confirm('تأكيد حذف جميع '+label+' من خيارات الإدخال؟ لن تُحذف القيم المحفوظة في الشكاوى السابقة.'))return;
  const previous = structuredClone(db.settings);
  db.settings[type]=[];setOptionListCleared(type,true);const key=settingDescriptionKey(type);if(key)db.settings[key]={};await persistRecordOptions(previous);render();toast('تم إفراغ القائمة.');
}
async function restoreDefaultSettings(type='all'){
  if(!uiCan('settings.manage')||!['all',...managedTypes].includes(type))return;const labels={all:'كل القوائم',categories:'التصنيفات',natures:'طبيعة الشكاوي',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'};
  if(!confirm('استعادة '+labels[type]+' الافتراضية؟ لن تتغير الشكاوى السابقة.'))return;
  const previous = structuredClone(db.settings);
  for(const key of managedTypes){if(type!=='all'&&type!==key)continue;setOptionListCleared(key,false);db.settings[key]=key==='priorities'?seed.settings.priorities.map(x=>({...x})): [...(seed.settings[key]||[])];const descKey=settingDescriptionKey(key);if(descKey)db.settings[descKey]={};}
  await persistRecordOptions(previous);render();toast('تمت استعادة '+labels[type]+' الافتراضية.');
}
function editComplaintModal(id){
  const c=db.complaints.find(c=>c.id===id);if(!c||!uiCan('complaints.update'))return;
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
  try{await flushUiBeforeAction();const result=await api('/api/complaints/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});closeModal();await reloadStoredState();toast('حُفظت بيانات الشكوى.');if(result.undoToken)showStatusUndo(id,result.undoToken,result.undoExpiresAt,'edit');}catch(error){return toast(error.message,'error');}
}
async function flushUiBeforeAction(){if(stateConflict)throw new Error('حل تعارض البيانات قبل تنفيذ إجراء جديد.');await persistQueue;if(persistTimer)await persistUiNow();}
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
let pendingSyncPackage=null,syncImportTarget=null,syncImportResolve=null;
function finishSyncImportWait(){if(typeof syncImportResolve==='function'){const done=syncImportResolve;syncImportResolve=null;done();}}
function handleSyncImportChange(target){
  const file=target?.files?.[0];if(!file)return Promise.resolve();
  return (async()=>{
    try{
      const text=await file.text();
      pendingSyncPackage=JSON.parse(text);
      syncImportTarget=target;
      return await new Promise(resolve=>{syncImportResolve=resolve;modal('عبارة مرور النقل','أدخل عبارة المرور المستخدمة عند تصدير الملف. الاستيراد يستبدل بيانات النسخة الحالية.','<div class="form-field"><label for="syncPassword">عبارة المرور</label><input class="field" id="syncPassword" type="password" autocomplete="off"></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="confirm-sync-password">تأكيد الاستيراد</button>');});
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
    const password=$('#syncPassword')?.value||'';
    await api('/api/sync/import',{method:'POST',body:JSON.stringify({package:pendingSyncPackage,password,expectedRevision:stateRevision})});
    if(syncImportTarget)syncImportTarget.value='';
    const input=$('#syncImportFile');if(input)input.value='';
    pendingSyncPackage=null;syncImportTarget=null;closeModal();
    await reloadStoredState();toast('تم استيراد ملف المزامنة.');
  }catch(error){return toast(error.message,'error');}
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
function cancelPendingSyncImport(){pendingSyncPackage=null;if(syncImportTarget){try{syncImportTarget.value='';}catch(_){}}syncImportTarget=null;finishSyncImportWait();}

