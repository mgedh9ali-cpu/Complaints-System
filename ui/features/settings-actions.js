const managedTypes=['categories','natures','provinces','entities','priorities'];
function validSettingType(type){return managedTypes.includes(type);}
function settingDescriptionKey(type){return type==='categories'?'categoryDescriptions':type==='natures'?'natureDescriptions':type==='entities'?'entityDescriptions':null;}
function settingEntries(type){ensureManagedSettings();return type==='priorities'?db.settings.priorities.map(x=>({value:x.value,label:x.label})):(db.settings[type]||[]).map(x=>({value:x,label:x}));}
function addSetting(type,value){
  if(!validSettingType(type))return;ensureManagedSettings();const editing=typeof value==='string';value=value||'';
  const entry=editing?settingEntries(type).find(x=>x.value===value):null;if(editing&&!entry)return toast('تعذر العثور على الخيار المطلوب.','error');
  const key=settingDescriptionKey(type);if(key)db.settings[key] ||= {};
  const title=(editing?'تعديل ':'إضافة ')+({categories:'تصنيف',natures:'طبيعة الشكاوي',provinces:'محافظة',entities:'جهة مختصة',priorities:'أولوية'})[type];
  const label=entry?.label||'';const desc=key?(db.settings[key][value]||''):'';
  modal(title,'تُحفظ القيم في قاعدة البيانات المحلية. حذف خيار لا يغيّر الشكاوى السابقة.','<form id="settingForm"><div class="form-field"><label for="settingValue">الاسم</label><input class="field" id="settingValue" required maxlength="100" value="'+esc(label)+'"></div>'+(key?'<div class="form-field" style="margin-top:12px"><label for="settingDescription">الوصف</label><textarea class="textarea-field" id="settingDescription" maxlength="500" placeholder="وصف اختياري">'+esc(desc)+'</textarea></div>':'')+'</form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-setting" data-type="'+type+'" data-mode="'+(editing?'edit':'create')+'" data-original="'+esc(value)+'">حفظ</button>');
}
async function deleteSetting(type,value){
  if(!validSettingType(type))return;ensureManagedSettings();const entries=settingEntries(type);if(!entries.some(x=>x.value===value))return;
  const label=({categories:'التصنيف',natures:'طبيعة الشكاوي',provinces:'المحافظة',entities:'الجهة المختصة',priorities:'الأولوية'})[type];
  if(!confirm('حذف «'+(entries.find(x=>x.value===value)?.label||value)+'» من قائمة '+label+'؟ ستبقى القيمة كما هي في الشكاوى السابقة.'))return;
  if(type==='priorities')db.settings.priorities=db.settings.priorities.filter(x=>x.value!==value);else db.settings[type]=db.settings[type].filter(item=>item!==value);
  const key=settingDescriptionKey(type);if(key)delete (db.settings[key] ||= {})[value];await persistUiNow();render();toast('تم حذف الخيار من القائمة.');
}
async function clearSettingType(type){
  if(!validSettingType(type))return;ensureManagedSettings();const label=({categories:'التصنيفات',natures:'طبيعة الشكاوي',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'})[type];
  if(!settingEntries(type).length)return toast('القائمة فارغة بالفعل.','warn');
  if(!confirm('تأكيد حذف جميع '+label+' من خيارات الإدخال؟ لن تُحذف القيم المحفوظة في الشكاوى السابقة.'))return;
  db.settings[type]=[];const key=settingDescriptionKey(type);if(key)db.settings[key]={};await persistUiNow();render();toast('تم إفراغ القائمة.');
}
async function restoreDefaultSettings(type='all'){
  if(!['all',...managedTypes].includes(type))return;const labels={all:'كل القوائم',categories:'التصنيفات',natures:'طبيعة الشكاوي',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'};
  if(!confirm('استعادة '+labels[type]+' الافتراضية؟ لن تتغير الشكاوى السابقة.'))return;
  for(const key of managedTypes){if(type!=='all'&&type!==key)continue;db.settings[key]=key==='priorities'?seed.settings.priorities.map(x=>({...x})): [...(seed.settings[key]||[])];const descKey=settingDescriptionKey(key);if(descKey)db.settings[descKey]={};}
  await persistUiNow();render();toast('تمت استعادة '+labels[type]+' الافتراضية.');
}
function editComplaintModal(id){
  const c=db.complaints.find(c=>c.id===id);if(!c||!uiCan('complaints.update'))return;
  ensureManagedSettings();
  const options=(items,current)=>items.includes(current)?items:[current,...items].filter(Boolean);
  modal('استكمال وتعديل بيانات الشكوى','الرقم وتاريخ التسجيل وسجل الإجراءات ثابتة.',
  '<form id="editComplaintForm"><div class="form-grid">'+field('اسم المشتكي','editName',c.name||'')+field('رقم الهاتف','editPhone',c.phone||'','tel')+
  selectField('المحافظة','editProvince',options(db.settings.provinces,c.province),c.province,true)+selectField('التصنيف','editCategory',options(db.settings.categories,c.category),c.category,true)+
  selectField('طبيعة الشكاوي','editNature',options(db.settings.natures||[],c.nature||''),c.nature||'',false)+
  selectField('الجهة','editEntity',options(db.settings.entities,c.entity),c.entity||'')+field('الموضوع','editSummary',c.summary||'','text',true,'maxlength="180"')+
  '<div class="form-field full"><label for="editDetails">التفاصيل</label><textarea class="textarea-field" id="editDetails" maxlength="10000">'+esc(c.details||'')+'</textarea></div></div></form>',
  '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-complaint-edit" data-id="'+esc(id)+'">حفظ البيانات</button>');
}
async function saveComplaintEdit(id){
  if(!$('#editComplaintForm')?.reportValidity())return;
  const body={name:$('#editName').value.trim(),phone:phoneNorm($('#editPhone').value),province:$('#editProvince').value,category:$('#editCategory').value,nature:$('#editNature')?.value||'',entity:$('#editEntity').value,summary:$('#editSummary').value.trim(),details:$('#editDetails').value.trim()};
  try{await flushUiBeforeAction();await api('/api/complaints/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});closeModal();await reloadStoredState();toast('حُفظت بيانات الشكوى.');}catch(error){toast(error.message,'error');}
}
async function flushUiBeforeAction(){if(stateConflict)throw new Error('حل تعارض البيانات قبل تنفيذ إجراء جديد.');await persistQueue;if(persistTimer)await persistUiNow();}
async function reloadStoredState(){const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number(stored.revision)||0;stateConflict=false;stateLoaded=true;render();}
function permissionsPanel(){if(authenticatedUser?.role!=='admin')return '';return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>صلاحيات الحسابات الفردية</h2></div><div class="panel-body">'+managedUsers.filter(u=>u.role!=='admin').map(u=>'<div class="setting-row"><strong>'+esc(u.username)+'</strong><button class="btn btn-sm" data-action="edit-user-permissions" data-id="'+esc(u.id)+'">تخصيص الصلاحيات</button></div>').join('')+'</div></section>';}
function maintenancePanel(){if(authenticatedUser?.role!=='admin')return '';return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>صحة النظام</h2></div><div class="panel-body"><p class="small-copy">لوحة الصيانة متاحة للمدير.</p></div></section>';}
function securityPanel(){return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>الأمان</h2></div><div class="panel-body"><button class="btn btn-sm" data-action="change-password">تغيير كلمة المرور</button></div></section>';}
function passwordChangeModal(){modal('تغيير كلمة المرور','أدخل كلمة المرور الحالية والجديدة.','<div class="form-field"><label for="currentPassword">الحالية</label><input class="field" id="currentPassword" type="password"></div><div class="form-field"><label for="newPassword">الجديدة</label><input class="field" id="newPassword" type="password" minlength="12"></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-password-change">حفظ</button>');}
async function savePasswordChange(){try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#currentPassword')?.value,newPassword:$('#newPassword')?.value})});closeModal();toast('تم تغيير كلمة المرور.');}catch(e){toast(e.message,'error');}}
function auditPanel(){return '';}
function approvalsPanel(complaintId){return '';}
