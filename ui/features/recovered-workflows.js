/* Recovered from v1.0.0-rc.3; calls the current authenticated server APIs. */
let approvalRequests=[],maintenanceHealth=null,displayedAudit=[],auditCheck=null;
const approvalKindName={complaint_archive:'أرشفة شكوى',complaint_cancel:'إلغاء بعد إجراء رسمي',attachment_delete:'حذف مرفق إلى الأرشيف',complaint_duplicate:'ربط شكوى مكررة'};
function newReply(){const rows=db.complaints.filter(c=>!c.reply);if(!rows.length)return toast('كل السجلات لديها رد مرتبط.','warn');modal('إنشاء رد','اختر السجل المراد إعداد رد له','<div class="form-field"><label for="replyComplaint">الشكوى</label><select class="select-field" id="replyComplaint">'+rows.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.id+' · '+c.summary)+'</option>').join('')+'</select></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="reply-next">متابعة</button>');}

function newReferralGlobal(){const rows=db.complaints.filter(c=>c.status!=='closed'&&c.status!=='cancelled');modal('إحالة جديدة','اختر الشكوى لبدء تسجيل الإحالة','<div class="form-field"><label for="refComplaint">الشكوى</label><select class="select-field" id="refComplaint">'+rows.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.id+' · '+c.summary)+'</option>').join('')+'</select></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="referral-next">متابعة</button>');}

async function archiveSetting(type,value){
  if(!validSettingType(type)||!db.settings[type].includes(value))return;
  if(!confirm('أرشفة «'+value+'» من القيم المتاحة الجديدة؟ لن تتغير السجلات السابقة.'))return;
  db.settings[type]=db.settings[type].filter(x=>x!==value);
  (db.settings.archived ||= []).push({type,value,at:new Date().toISOString()});
  await persistUiNow();render();toast('أُرشفت القيمة؛ السجلات القديمة محفوظة.');
}

async function refreshApprovals(){
 if(!authenticatedUser)return;
 try{approvalRequests=(await api('/api/approvals')).requests||[];if(['settings','complaint-detail'].includes(page))render();}catch(_){}
}

function approvalsPanel(complaintId){
 const requests=approvalRequests.filter(r=>!complaintId||r.complaint_id===complaintId);
 return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>تأكيد الإجراءات</h2><button class="btn btn-sm" data-action="refresh-approvals">تحديث</button></div><div class="panel-body">'+
 (requests.length?requests.map(r=>'<div class="setting-row"><div><strong>'+esc(approvalKindName[r.kind]||r.kind)+' · <bdi dir="ltr">'+esc(r.complaint_id)+'</bdi></strong><p>'+esc(r.reason)+'</p><small>'+esc(r.requester)+' · '+esc(({pending:'بانتظار القرار',approved:'معتمد ومنفذ',rejected:'مرفوض',expired:'منتهي'})[r.status]||r.status)+(r.approver?' · '+esc(r.approver):'')+'</small></div>'+(r.status==='pending'&&uiCan('approvals.decide')?'<div><button class="btn btn-sm btn-primary" data-action="approval-decision" data-id="'+esc(r.id)+'" data-decision="approved">اعتماد وتنفيذ</button> <button class="btn btn-sm" data-action="approval-decision" data-id="'+esc(r.id)+'" data-decision="rejected">رفض</button></div>':'')+'</div>').join(''):'<p class="small-copy">لا توجد طلبات موافقة.</p>')+'</div></section>';
}

function approvalRequestModal(kind,id,targetId=id){
 if(!uiCan('approvals.request'))return toast('لا تملك صلاحية تقديم هذا الطلب.','error');
 modal(approvalKindName[kind]||'طلب موافقة','راجع السبب ثم أكّد تنفيذ الإجراء من طلبات التأكيد.',
 '<div class="form-field"><label for="approvalReason">سبب الطلب</label><textarea class="textarea-field" id="approvalReason" required minlength="3" maxlength="500"></textarea></div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="submit-approval" data-kind="'+esc(kind)+'" data-id="'+esc(id)+'" data-target="'+esc(targetId)+'">إرسال الطلب</button>');
}

async function submitApproval(kind,id,targetId,reason){
 try{
   await flushUiBeforeAction();
   const request=await api('/api/approvals',{method:'POST',body:JSON.stringify({kind,complaintId:id,targetId,reason})});
   if(kind==='complaint_archive' && uiCan('approvals.decide') && request.id){
     await refreshApprovals();
     approvalDecisionModal(request.id,'approved');
     return;
   }
   closeModal();await refreshApprovals();toast('حُفظ الطلب بانتظار تأكيدك للتنفيذ.');
 }
 catch(error){toast(error.message,'error');}
}

function approvalDecisionModal(id,decision){
 modal(decision==='approved'?'اعتماد وتنفيذ الطلب':'رفض الطلب','يُسجل القرار وسببه وهوية الحساب.',
 '<div class="form-field"><label for="decisionReason">سبب القرار</label><textarea class="textarea-field" id="decisionReason" minlength="3" maxlength="500" required></textarea></div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-approval-decision" data-id="'+esc(id)+'" data-decision="'+esc(decision)+'">تأكيد القرار</button>');
}

async function saveApprovalDecision(id,decision){
 try{await flushUiBeforeAction();await api('/api/approvals/'+encodeURIComponent(id)+'/decision',{method:'POST',body:JSON.stringify({decision,reason:$('#decisionReason')?.value.trim()})});closeModal();await reloadStoredState();await refreshApprovals();toast('حُفظ القرار ونُفذ الإجراء المعتمد.');}
 catch(error){toast(error.message,'error');}
}

function complaintWorkflowPanel(c){
 const incomplete=isIncomplete(c);
 if(!incomplete&&!c.archivedAt&&!c.duplicateOf)return '';
 return '<div class="detail-section"><h3>استكمال السجل</h3>'+
 (incomplete?missingFieldsHtml(c)+(canEditRecord(c)?'<button class="btn btn-sm" data-action="edit-complaint" data-id="'+esc(c.id)+'">استكمال البيانات</button>':''):'')+
 (c.archivedAt?'<p class="risk-note">مؤرشفة: '+esc(c.archiveReason||'')+'</p>':'')+
 (c.duplicateOf?'<p>مكررة عن <bdi dir="ltr">'+esc(c.duplicateOf)+'</bdi></p>':'')+'</div>';
}
function openRecordStatus(id){
 const c=db.complaints.find(x=>x.id===id);if(!c||c.archivedAt||!uiCan('complaints.status'))return toast('لا يمكن تغيير حالة هذا السجل.','warn');
 const transitions={draft:['new','cancelled'],new:['in_progress','cancelled','draft'],in_progress:['awaiting_reply','awaiting_approval','closed','cancelled'],awaiting_reply:['in_progress','awaiting_approval','closed','cancelled'],awaiting_approval:['in_progress','closed','cancelled'],closed:uiCan('complaints.reopen')?['in_progress']:[],cancelled:uiCan('complaints.reopen')?['in_progress']:[]};
 const next=transitions[c.status]||[];if(!next.length)return toast('لا توجد انتقالات متاحة.','warn');
 modal('تغيير الحالة',esc(id),'<div class="form-field"><label for="detailStatus">الحالة الجديدة</label><select class="select-field" id="detailStatus"><option value="">اختر الحالة</option>'+next.map(s=>'<option value="'+esc(s)+'">'+esc(statusLabel(s))+'</option>').join('')+'</select></div><div class="form-field"><label for="statusReason">السبب</label><textarea class="textarea-field" id="statusReason"></textarea></div>', '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="change-status" data-id="'+esc(id)+'">حفظ الحالة</button>');
 updateReasonSheet();
}
function openRecordReferrals(id){
 const c=db.complaints.find(x=>x.id===id);if(!c||!uiCan('complaints.read'))return;
 modal('متابعة الإحالات',esc(id),(c.referrals||[]).map((r,i)=>'<div class="setting-row"><div><strong>'+esc(r.entity)+'</strong><p>'+esc(r.response||'بانتظار الرد')+'</p></div>'+(uiCan('complaints.update')&&!c.archivedAt?'<button class="btn btn-sm" data-action="referral-response" data-id="'+esc(id)+'" data-index="'+i+'">تسجيل الرد</button>':'')+'</div>').join('')||'<p>لا توجد إحالات.</p>','<button class="btn" data-action="close-modal">إغلاق</button>');
}
function openRecordApprovals(id){if(!uiCan('approvals.decide'))return;modal('الطلبات السابقة',esc(id),approvalsPanel(id),'<button class="btn" data-action="close-modal">إغلاق</button>');}

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
 modal('اقتراح شكوى مكررة','راجع الربط ثم أكّد التنفيذ مع توثيق السبب.',selectField('الشكوى الأصلية','duplicateOriginal',originals.map(c=>({value:c.id,label:c.id+' · '+c.summary})),'',true)+'<label for="approvalReason">سبب الربط</label><textarea class="textarea-field" id="approvalReason" maxlength="500"></textarea>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="submit-duplicate" data-id="'+esc(id)+'">إرسال الاقتراح</button>');
}

async function refreshMaintenanceHealth(){
 if(authenticatedUser?.role!=='admin')return;
 try{maintenanceHealth=await api('/api/health/metrics');if(page==='settings')render();}catch(error){toast(error.message,'error');}
}

async function saveReminderPeriod(){
 const hours=Number($('#completionReminderHours')?.value);if(!Number.isInteger(hours)||hours<1||hours>720)return toast('أدخل فاصلًا بين ساعة و720 ساعة.','warn');
 const before=structuredClone(db);db.settings.completionReminderHours=hours;
 try{await persistUiNow();render();toast('حُفظ فاصل التذكير.');}catch(error){db=before;toast(error.message,'error');}
}

function securityPanel(){
 return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>أمان حسابك</h2><button class="btn btn-sm" data-action="change-password">تغيير كلمة المرور</button></div><div class="panel-body"><p>'+(authenticatedUser?.twoFactorEnabled?'مفعّل: يلزم رمز من تطبيق المصادقة عند الدخول.':'يمكن حماية حسابك برمز مؤقت يعمل دون إنترنت.')+'</p><button class="btn" data-action="'+(authenticatedUser?.twoFactorEnabled?'disable-two-factor':'setup-two-factor')+'">'+(authenticatedUser?.twoFactorEnabled?'تعطيل التحقق الثنائي':'إعداد التحقق الثنائي')+'</button></div></section>';
}

function twoFactorPasswordModal(disable=false){
 modal(disable?'تعطيل التحقق الثنائي':'بدء إعداد التحقق الثنائي','تحقق من هويتك بكلمة المرور الحالية.',
 '<label for="twoFactorPassword">كلمة المرور الحالية</label><input class="field" id="twoFactorPassword" type="password" autocomplete="current-password">'+
 (disable?'<label for="twoFactorCode">رمز جديد من تطبيق المصادقة أو رمز استرداد</label><input class="field" id="twoFactorCode" autocomplete="one-time-code" maxlength="40">':''),
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="'+(disable?'confirm-disable-two-factor':'start-two-factor')+'">متابعة</button>');
}

async function startTwoFactor(){
 try{
  const result=await api('/api/auth/2fa/setup',{method:'POST',body:JSON.stringify({password:$('#twoFactorPassword')?.value})});
  modal('ربط تطبيق المصادقة','أضف حسابًا من نوع TOTP في تطبيق المصادقة باستخدام المفتاح، ثم أدخل الرمز الناتج.',
   '<label for="twoFactorSecret">المفتاح (يظهر في هذه الخطوة فقط)</label><input class="field" id="twoFactorSecret" dir="ltr" readonly value="'+esc(result.secret)+'"><label for="twoFactorCode">رمز التحقق المكون من 6 أرقام</label><input class="field" id="twoFactorCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6">',
   '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="confirm-two-factor">تفعيل</button>');
 }catch(error){toast(error.message,'error');}
}

function resetLocalSessionForTwoFactor(){authenticatedUser=null;stateLoaded=false;stateRevision=0;stateConflict=false;db=cleanState();updateSignedInUi();}

async function confirmTwoFactor(){
 try{
  const result=await api('/api/auth/2fa/confirm',{method:'POST',body:JSON.stringify({code:$('#twoFactorCode')?.value.trim()})});
  resetLocalSessionForTwoFactor();
  $('#modalRoot')?.classList.add('auth-recovery');
  modal('احفظ رموز الاسترداد الآن','يُستخدم كل رمز مرة واحدة عند فقدان تطبيق المصادقة. لن تظهر هذه الرموز مرة أخرى.',
   '<div dir="ltr" style="line-height:2">'+result.recoveryCodes.map(code=>'<div><code>'+esc(code)+'</code></div>').join('')+'</div><p class="small-copy">بعد حفظها، سجّل الدخول بكلمة المرور ورمز جديد من تطبيق المصادقة.</p>',
   '<button class="btn btn-primary" data-action="finish-two-factor">حفظت الرموز، الانتقال للدخول</button>');
 }catch(error){toast(error.message,'error');}
}

async function disableTwoFactor(){
 try{await api('/api/auth/2fa/disable',{method:'POST',body:JSON.stringify({password:$('#twoFactorPassword')?.value,code:$('#twoFactorCode')?.value.trim()})});resetLocalSessionForTwoFactor();closeModal();render();showLogin();}catch(error){toast(error.message,'error');}
}

function auditPanel(){
 if(!uiCan('audit.read'))return '';
 const users=new Map(authenticatedUser?[[authenticatedUser.id,authenticatedUser.username]]:[]);
 const labels={complaint_created:'تسجيل شكوى',complaint_updated:'تعديل شكوى',complaint_archived:'أرشفة شكوى',complaint_status_changed:'تغيير حالة',complaint_referred:'تسجيل إحالة',referral_response_recorded:'رد جهة',settings_updated:'تعديل إعدادات',approval_requested:'طلب موافقة',approval_decided:'قرار موافقة',user_permissions_changed:'تعديل صلاحيات',login_succeeded:'دخول ناجح',login_failed:'دخول مرفوض',attachment_uploaded:'رفع مرفق',attachment_accessed:'قراءة مرفق',attachment_deleted:'أرشفة مرفق',csv_export:'تصدير CSV',xlsx_export:'تصدير Excel',two_factor_enabled:'تفعيل التحقق الثنائي',two_factor_disabled:'تعطيل التحقق الثنائي'};
 return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>سجل التدقيق الخادمي</h2><div><button class="btn btn-sm" data-action="refresh-audit">عرض آخر الأحداث</button> '+(uiCan('audit.verify')?'<button class="btn btn-sm" data-action="verify-audit">فحص سلامة السلسلة</button>':'')+'</div></div><div class="panel-body">'+
 (auditCheck?'<p role="status">'+(auditCheck.ok?'نجح فحص السلسلة':'فشل فحص السلسلة؛ يلزم مراجعة النسخة الاحتياطية')+' · '+(auditCheck.checked||0)+' حدث</p>':'')+
 '<p class="small-copy">يعرض آخر 500 حدث من الخادم، ولا يتيح تعديلها أو حذفها.</p>'+displayedAudit.map(e=>'<details class="setting-row" style="display:block"><summary>'+esc(labels[e.action]||e.action)+' · '+esc(users.get(e.actorUserId)||e.actorUserId||'النظام')+' · '+timeText(e.createdAt)+'</summary><p><bdi dir="ltr">'+esc(e.targetId||'')+'</bdi></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(e.details,null,2))+'</pre></details>').join('')+'</div></section>';
}

async function refreshAudit(){try{displayedAudit=(await api('/api/audit')).events||[];render();}catch(error){toast(error.message,'error');}}

async function verifyAudit(){try{auditCheck=await api('/api/audit/verify');render();}catch(error){toast(error.message,'error');}}

async function applyRecoveredBulk(type,value){
 if(type!=='priority'||!value||!uiCan('complaints.update'))return toast('لا تملك صلاحية تنفيذ الإجراء.','error');
 const ids=[...selectedIds];if(!ids.length)return;
 if(!confirm('تأكيد تطبيق الإجراء على '+ids.length+' سجلات؟'))return;
 let saved=0;
 try{
  await flushUiBeforeAction();
  for(const id of ids){
   const result=await api('/api/complaints/'+encodeURIComponent(id),{method:'PATCH',headers:{'X-State-Revision':String(stateRevision)},body:JSON.stringify({priority:value})});
   stateRevision=result.revision;saved++;
  }
  closeModal();selectedIds.clear();await reloadStoredState();toast('حُفظ الإجراء على '+saved+' سجلات.');
 }catch(error){
  await reloadStoredState().catch(()=>{});toast('حُفظ '+saved+' من '+ids.length+'؛ توقف الإجراء: '+error.message,'error');
 }
}


function openOwnerAttachmentDelete(complaintId,storedName){
 if(typeof storedName!=='string'||!storedName||typeof complaintId!=='string'||!complaintId)return toast('تعذر تحديد المرفق.','error');
 if(!uiCan('attachments.delete'))return toast('لا تملك صلاحية حذف المرفق.','error');
 modal('حذف المرفق','سيُنقل الملف إلى الأرشيف ويُوثق السبب في سجل التدقيق.',
 '<div class="form-field"><label for="attachmentDeleteReason">سبب الحذف</label><textarea class="textarea-field" id="attachmentDeleteReason" required minlength="3" maxlength="500"></textarea></div>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-danger" data-action="confirm-attachment-delete" data-file="'+esc(storedName)+'" data-id="'+esc(complaintId)+'">تأكيد الحذف</button>');
}
async function confirmAttachmentDelete(file){
 if(!uiCan('attachments.delete'))return toast('لا تملك صلاحية حذف المرفق.','error');
 const reason=($('#attachmentDeleteReason')?.value||'').trim();
 if(reason.length<3||reason.length>500)return toast('أدخل سبب الحذف.','warn');
 await flushUiBeforeAction();
 await api('/api/attachments/'+encodeURIComponent(file),{method:'DELETE',body:JSON.stringify({reason})});
 closeModal();await reloadStoredState();toast('تم حذف المرفق من القائمة وحفظه في الأرشيف.');
}
