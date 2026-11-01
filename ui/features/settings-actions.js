const managedTypes=['categories','provinces','entities','priorities'];
function validSettingType(type){return managedTypes.includes(type);}
function settingDescriptionKey(type){return type==='categories'?'categoryDescriptions':type==='entities'?'entityDescriptions':null;}
function settingEntries(type){ensureManagedSettings();return type==='priorities'?db.settings.priorities.map(x=>({value:x.value,label:x.label})):db.settings[type].map(x=>({value:x,label:x}));}
function addSetting(type,value){
  if(!validSettingType(type))return;ensureManagedSettings();const editing=typeof value==='string';value=value||'';
  const entry=editing?settingEntries(type).find(x=>x.value===value):null;if(editing&&!entry)return toast('تعذر العثور على الخيار المطلوب.','error');
  const key=settingDescriptionKey(type);if(key)db.settings[key] ||= {};
  const title=(editing?'تعديل ':'إضافة ')+({categories:'تصنيف',provinces:'محافظة',entities:'جهة مختصة',priorities:'أولوية'})[type];
  const label=entry?.label||'';const desc=key?(db.settings[key][value]||''):'';
  modal(title,'تُحفظ القيم في قاعدة البيانات المحلية. حذف خيار لا يغيّر الشكاوى السابقة.','<form id="settingForm"><div class="form-field"><label for="settingValue">الاسم</label><input class="field" id="settingValue" required maxlength="100" value="'+esc(label)+'"></div>'+(key?'<div class="form-field" style="margin-top:12px"><label for="settingDescription">الوصف</label><textarea class="textarea-field" id="settingDescription" maxlength="500" placeholder="وصف اختياري">'+esc(desc)+'</textarea></div>':'')+'</form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-setting" data-type="'+type+'" data-mode="'+(editing?'edit':'create')+'" data-original="'+esc(value)+'">حفظ</button>');
}
function deleteSetting(type,value){
  if(!validSettingType(type))return;ensureManagedSettings();const entries=settingEntries(type);if(!entries.some(x=>x.value===value))return;
  const label=({categories:'التصنيف',provinces:'المحافظة',entities:'الجهة المختصة',priorities:'الأولوية'})[type];
  if(!confirm('حذف «'+(entries.find(x=>x.value===value)?.label||value)+'» من قائمة '+label+'؟ ستبقى القيمة كما هي في الشكاوى السابقة.'))return;
  if(type==='priorities')db.settings.priorities=db.settings.priorities.filter(x=>x.value!==value);else db.settings[type]=db.settings[type].filter(item=>item!==value);
  const key=settingDescriptionKey(type);if(key)delete (db.settings[key] ||= {})[value];persist();render();toast('تم حذف الخيار من القائمة.');
}
function clearSettingType(type){
  if(!validSettingType(type))return;ensureManagedSettings();const label=({categories:'التصنيفات',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'})[type];
  if(!settingEntries(type).length)return toast('القائمة فارغة بالفعل.','warn');
  if(!confirm('تأكيد حذف جميع '+label+' من خيارات الإدخال؟ لن تُحذف القيم المحفوظة في الشكاوى السابقة.'))return;
  db.settings[type]=[];const key=settingDescriptionKey(type);if(key)db.settings[key]={};persist();render();toast('تم إفراغ القائمة.');
}
function restoreDefaultSettings(type='all'){
  if(!['all',...managedTypes].includes(type))return;const labels={all:'كل القوائم',categories:'التصنيفات',provinces:'المحافظات',entities:'الجهات المختصة',priorities:'الأولويات'};
  if(!confirm('استعادة '+labels[type]+' الافتراضية؟ لن تتغير الشكاوى السابقة.'))return;
  for(const key of managedTypes){if(type!=='all'&&type!==key)continue;db.settings[key]=key==='priorities'?seed.settings.priorities.map(x=>({...x})): [...seed.settings[key]];const descKey=settingDescriptionKey(key);if(descKey)db.settings[descKey]={};}
  persist();render();toast('تمت استعادة '+labels[type]+' الافتراضية.');
}
function archiveSetting(type,value){
  if(!validSettingType(type)||!db.settings[type].includes(value))return;
  if(!confirm('أرشفة «'+value+'» من القيم المتاحة الجديدة؟ لن تتغير السجلات السابقة.'))return;
  db.settings[type]=db.settings[type].filter(x=>x!==value);
  (db.settings.archived ||= []).push({type,value,at:new Date().toISOString()});
  persist();render();toast('أُرشفت القيمة؛ السجلات القديمة محفوظة.');
}
function archiveSetting(type,value){if(!confirm('أرشفة «'+value+'» من القيم المتاحة الجديدة؟ لن تتغير السجلات السابقة.'))return;db.settings[type]=db.settings[type].filter(x=>x!==value);(db.settings.archived ||= []).push({type,value,at:new Date().toISOString()});persist();render();toast('أُرشفت القيمة؛ السجلات القديمة محفوظة.');}
function csvSafe(value){const text=String(value??'');return /^[\s\u0000-\u001f]*[=+\-@]/.test(text)?"'"+text:text;}
function exportCsv(){const rows=filteredComplaints();const header=['رقم الشكوى','الموضوع','المحافظة','التصنيف','الحالة','الأولوية','المسؤول','تاريخ التسجيل'];const csv=[header,...rows.map(c=>[c.id,c.summary,c.province,c.category,statusLabel(c.status),priorityLabel(c.priority),c.owner,dateText(c.created)])].map(row=>row.map(v=>'"'+csvSafe(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='complaints.csv';document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);toast('تم إنشاء ملف CSV من السجلات المعروضة.','warn');}
