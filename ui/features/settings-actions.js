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
async function archiveSetting(type,value){
  if(!validSettingType(type)||!(db.settings[type]||[]).includes(value))return;
  if(!confirm('أرشفة «'+value+'» من القيم المتاحة الجديدة؟ لن تتغير السجلات السابقة.'))return;
  db.settings[type]=db.settings[type].filter(x=>x!==value);
  (db.settings.archived ||= []).push({type,value,at:new Date().toISOString()});
  await persistUiNow();render();toast('أُرشفت القيمة؛ السجلات القديمة محفوظة.');
}
function csvSafe(value){const text=String(value??'');return /^[\s\u0000-\u001f]*[=+\-@]/.test(text)?"'"+text:text;}
async function exportCsv(selected=null){
 try{
  await flushUiBeforeAction();
  const ids=selected||filteredComplaints().filter(c=>!c.archivedAt).map(c=>c.id);
  if(!ids.length)return toast('لا توجد سجلات غير مؤرشفة للتصدير في هذا العرض.','warn');
  const response=await fetch('/api/export/csv/selection',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':await getWriteCsrf()},body:JSON.stringify({ids})});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'تعذر التصدير.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='complaints.csv';document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);toast('أُنشئ CSV وسُجل التصدير في التدقيق.');
 }catch(error){toast(error.message,'error');}
}

let approvalRequests=[],maintenanceHealth=null,customizablePermissions=[];
const permissionNames={
 'complaints.create':'تسجيل شكوى','complaints.update':'تعديل ومعالجة الشكاوى','complaints.status':'تغيير الحالة',
 'complaints.read':'عرض الشكاوى','complaints.assign':'الإسناد والمساعدون','complaints.reopen':'إعادة الفتح',
 'complaints.closeException':'استثناء الإغلاق','attachments.upload':'رفع المرفقات','attachments.read':'قراءة المرفقات',
 'replies.draft':'صياغة ومراجعة الرد','replies.approve':'اعتماد الرد','replies.send':'توثيق الإرسال',
 'approvals.request':'طلب الحذف أو الإلغاء','export.csv':'تصدير CSV','export.xlsx':'تصدير Excel وPDF',
 'dashboard.view':'لوحة المتابعة','audit.read':'عرض التدقيق','sync.export':'تصدير المزامنة'
};
async function flushUiBeforeAction(){
 if(stateConflict)throw new Error('حل تعارض البيانات قبل تنفيذ إجراء جديد.');
 await persistQueue;
 if(persistTimer)await persistUiNow();
}
async function reloadStoredState(){
 const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number(stored.revision)||0;
 stateConflict=false;stateLoaded=true;render();
}
async function refreshApprovals(){
 if(!authenticatedUser)return;
 try{approvalRequests=(await api('/api/approvals')).requests||[];if(['settings','complaint-detail'].includes(page))render();}catch(_){}
}
const approvalKindName={complaint_archive:'أرشفة شكوى',complaint_cancel:'إلغاء بعد إجراء رسمي',attachment_delete:'حذف مرفق إلى الأرشيف',complaint_duplicate:'ربط شكوى مكررة'};
function approvalsPanel(complaintId){
 const requests=approvalRequests.filter(r=>!complaintId||r.complaint_id===complaintId);
 return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>طلبات الموافقة</h2><button class="btn btn-sm" data-action="refresh-approvals">تحديث</button></div><div class="panel-body">'+
 (requests.length?requests.map(r=>'<div class="setting-row"><div><strong>'+esc(approvalKindName[r.kind]||r.kind)+' · <bdi dir="ltr">'+esc(r.complaint_id)+'</bdi></strong><p>'+esc(r.reason)+'</p><small>'+esc(r.requester)+' · '+esc(({pending:'بانتظار القرار',approved:'معتمد ومنفذ',rejected:'مرفوض',expired:'منتهي'})[r.status]||r.status)+(r.approver?' · '+esc(r.approver):'')+'</small></div>'+(r.status==='pending'&&uiCan('approvals.decide')&&r.requester_id!==authenticatedUser?.id?'<div><button class="btn btn-sm btn-primary" data-action="approval-decision" data-id="'+esc(r.id)+'" data-decision="approved">اعتماد وتنفيذ</button> <button class="btn btn-sm" data-action="approval-decision" data-id="'+esc(r.id)+'" data-decision="rejected">رفض</button></div>':'')+'</div>').join(''):'<p class="small-copy">لا توجد طلبات موافقة.</p>')+'</div></section>';
}
function approvalRequestModal(kind,id,targetId=id){
 if(!uiCan('approvals.request'))return toast('لا تملك صلاحية تقديم هذا الطلب.','error');
 modal(approvalKindName[kind]||'طلب موافقة','سيُراجع الطلب مدير مختلف عن مقدمه.',
 '<div class="form-field"><label for="approvalReason">سبب الطلب</label><textarea class="textarea-field" id="approvalReason" required minlength="3" maxlength="500"></textarea></div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="submit-approval" data-kind="'+esc(kind)+'" data-id="'+esc(id)+'" data-target="'+esc(targetId)+'">إرسال الطلب</button>');
}
async function submitApproval(kind,id,targetId,reason){
 try{await flushUiBeforeAction();await api('/api/approvals',{method:'POST',body:JSON.stringify({kind,complaintId:id,targetId,reason})});closeModal();await refreshApprovals();toast('حُفظ الطلب بانتظار قرار مدير آخر.');}
 catch(error){toast(error.message,'error');}
}
function approvalDecisionModal(id,decision){
 modal(decision==='approved'?'اعتماد وتنفيذ الطلب':'رفض الطلب','يُسجل القرار وسببه وهوية المراجع.',
 '<div class="form-field"><label for="decisionReason">سبب القرار</label><textarea class="textarea-field" id="decisionReason" minlength="3" maxlength="500" required></textarea></div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-approval-decision" data-id="'+esc(id)+'" data-decision="'+esc(decision)+'">تأكيد القرار</button>');
}
async function saveApprovalDecision(id,decision){
 try{await flushUiBeforeAction();await api('/api/approvals/'+encodeURIComponent(id)+'/decision',{method:'POST',body:JSON.stringify({decision,reason:$('#decisionReason')?.value.trim()})});closeModal();await reloadStoredState();await refreshApprovals();toast('حُفظ القرار ونُفذ الإجراء المعتمد.');}
 catch(error){toast(error.message,'error');}
}
function permissionsPanel(){
 if(authenticatedUser?.role!=='admin')return '';
 return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>صلاحيات الحسابات الفردية</h2></div><div class="panel-body">'+managedUsers.filter(u=>u.role!=='admin').map(u=>'<div class="setting-row"><strong>'+esc(u.username)+'</strong><button class="btn btn-sm" data-action="edit-user-permissions" data-id="'+esc(u.id)+'">تخصيص الصلاحيات</button></div>').join('')+'<p class="small-copy">تغيير الصلاحيات يُنهي جلسات الحساب لتطبيق القرار فورًا.</p></div></section>';
}
function editUserPermissions(id){
 const user=managedUsers.find(u=>u.id===id);if(!user||user.role==='admin')return;
 modal('صلاحيات '+user.username,'اختر الصلاحيات المسموح بها لهذا الحساب.',
 '<div class="form-grid">'+customizablePermissions.map((permission,i)=>'<label><input type="checkbox" id="userPermission'+i+'" '+(user.permissions?.includes(permission)?'checked':'')+'> '+esc(permissionNames[permission]||permission)+'</label>').join('')+'</div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-user-permissions" data-id="'+esc(id)+'">حفظ الصلاحيات</button>');
}
async function saveUserPermissions(id){
 const overrides=Object.fromEntries(customizablePermissions.map((p,i)=>[p,Boolean($('#userPermission'+i)?.checked)]));
 try{await api('/api/users/'+encodeURIComponent(id)+'/permissions',{method:'PATCH',body:JSON.stringify({overrides})});closeModal();await refreshManagedUsers();toast('حُفظت الصلاحيات وأُبطلت الجلسات القديمة.');}catch(error){toast(error.message,'error');}
}
function complaintWorkflowPanel(c){
 const collaborators=(c.coAssistants||[]);
 return '<div class="detail-section"><h3>المتابعة والاستكمال</h3><button class="btn btn-sm" data-action="edit-complaint" data-id="'+esc(c.id)+'">استكمال وتعديل البيانات</button>'+
 (isIncomplete(c)?'<p class="small-copy">بيانات هذه الشكوى غير مكتملة.</p>':'<p class="small-copy">الحقول الأساسية مكتملة.</p>')+
 '<button class="btn btn-sm" data-action="toggle-completion-reminder" data-id="'+esc(c.id)+'">'+(c.completionReminderStopped?'استئناف تذكير الاستكمال':'إيقاف تذكير الاستكمال')+'</button> '+
 (uiCan('approvals.request')&&!c.archivedAt?'<button class="btn btn-sm btn-danger" data-action="request-archive" data-id="'+esc(c.id)+'">طلب أرشفة الشكوى</button> <button class="btn btn-sm" data-action="propose-duplicate" data-id="'+esc(c.id)+'">اقتراح ربط كمكررة</button>':'')+
 (c.archivedAt?'<p class="risk-note">مؤرشفة: '+esc(c.archiveReason||'')+'</p>':'')+
 (c.duplicateOf?'<p>مكررة عن <bdi dir="ltr">'+esc(c.duplicateOf)+'</bdi></p>':'')+
 '<div class="form-field" style="margin-top:12px"><label for="coAssistants">المساعدون المشاركون</label><select class="select-field" id="coAssistants" multiple>'+assignees.filter(u=>u.username!==c.owner).map(u=>'<option value="'+esc(u.username)+'" '+(collaborators.includes(u.username)?'selected':'')+'>'+esc(u.username)+'</option>').join('')+'</select><button class="btn btn-sm" data-action="save-collaborators" data-id="'+esc(c.id)+'">حفظ المساعدين</button></div></div>'+
 '<div class="detail-section"><h3>ردود الإحالات</h3>'+(c.referrals||[]).map((r,i)=>'<div class="setting-row"><div><strong>'+esc(r.entity)+'</strong><p>'+esc(r.response||'بانتظار رد الجهة')+'</p><small>'+dateText(r.sent)+' · '+dateText(r.due)+'</small></div><button class="btn btn-sm" data-action="referral-response" data-id="'+esc(c.id)+'" data-index="'+i+'">تسجيل الرد</button></div>').join('')+'</div>'+approvalsPanel(c.id);
}
function referralResponseModal(id,index){
 const c=db.complaints.find(c=>c.id===id),r=c?.referrals?.[index];if(!r)return;
 modal('تسجيل رد '+r.entity,'توثيق رد الجهة على الإحالة.', '<div class="form-field"><label for="referralResponse">نص الرد</label><textarea class="textarea-field" id="referralResponse" maxlength="10000">'+esc(r.response||'')+'</textarea></div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-referral-response" data-id="'+esc(id)+'" data-index="'+index+'">حفظ الرد</button>');
}
async function saveReferralResponse(id,index){
 try{await flushUiBeforeAction();await api('/api/complaints/'+encodeURIComponent(id)+'/referrals/'+index+'/response',{method:'PATCH',body:JSON.stringify({response:$('#referralResponse')?.value.trim()})});closeModal();await reloadStoredState();toast('حُفظ رد الجهة.');}catch(error){toast(error.message,'error');}
}
function duplicateProposalModal(id){
 const originals=db.complaints.filter(c=>c.id!==id&&!c.archivedAt&&!c.duplicateOf);
 if(!originals.length)return toast('لا يوجد سجل آخر صالح للربط.','warn');
 modal('اقتراح شكوى مكررة','يُعتمد الربط من مدير آخر.',selectField('الشكوى الأصلية','duplicateOriginal',originals.map(c=>({value:c.id,label:c.id+' · '+c.summary})),'',true)+'<label for="approvalReason">سبب الربط</label><textarea class="textarea-field" id="approvalReason" maxlength="500"></textarea>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="submit-duplicate" data-id="'+esc(id)+'">إرسال الاقتراح</button>');
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
 const body={name:$('#editName').value.trim(),phone:phoneNorm($('#editPhone').value),province:$('#editProvince').value,category:$('#editCategory').value,nature:$('#editNature')?.value||'',
  entity:$('#editEntity').value,summary:$('#editSummary').value.trim(),details:$('#editDetails').value.trim()};
 try{await flushUiBeforeAction();await api('/api/complaints/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});closeModal();await reloadStoredState();toast('حُفظت بيانات الشكوى.');}catch(error){toast(error.message,'error');}
}
