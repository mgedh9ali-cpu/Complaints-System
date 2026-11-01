async function changeStatus(id){
  const c=db.complaints.find(x=>x.id===id);
  const next=$('#detailStatus')?.value;
  const reason=$('#statusReason')?.value.trim()||'';
  if(!c||!next)return toast('اختر حالة جديدة أولًا.','warn');
  const allowed={
    draft:['new','cancelled'],
    new:['in_progress','cancelled','draft'],
    in_progress:['awaiting_reply','awaiting_approval','closed','cancelled'],
    awaiting_reply:['in_progress','awaiting_approval','closed','cancelled'],
    awaiting_approval:['in_progress','closed','cancelled'],
    closed:[],cancelled:[]
  };
  if(!(allowed[c.status]||[]).includes(next))return toast('انتقال الحالة غير مسموح.','error');
  if(['closed','cancelled'].includes(next)&&reason.length<3)
    return toast('يلزم توثيق سبب واضح للإغلاق أو الإلغاء.','error');
  if(!authenticatedUser||authenticatedUser.role==='reviewer')
    return toast('ليس لديك صلاحية تغيير الحالة.','error');
  const button=$('[data-action="change-status"]');
  if(button)button.disabled=true;
  try{
    const pending=Boolean(persistTimer);
    if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
    await persistQueue;
    if(pending){
      const saved=await api('/api/state',{
        method:'PUT',headers:{'X-State-Revision':String(stateRevision)},
        body:JSON.stringify(db)
      });
      stateRevision=saved.revision;
    }
    await api('/api/complaints/'+encodeURIComponent(id)+'/status',{
      method:'PATCH',body:JSON.stringify({status:next,reason})
    });
    const authoritative=await api('/api/state');
    db=authoritative.state||cleanState();
    stateRevision=Number(authoritative.revision)||0;
    stateConflict=false;stateLoaded=true;
    detailModal(id);
    toast('تم تحديث الحالة في قاعدة البيانات.');
  }catch(error){
    toast('تعذر تغيير الحالة: '+error.message,'error');
    if(error.status===409||error.status===428)stateConflict=true;
  }finally{if(button&&document.contains(button))button.disabled=false;}
}
async function saveDetailChange(id,change,success){
 const complaint=db.complaints.find(x=>x?.id===id);
 if(!complaint)return toast('لا توجد شكوى بهذا الرقم.','error');
 if(!authenticatedUser||!['admin','staff'].includes(authenticatedUser.role))
  return toast('لا تملك صلاحية تعديل هذه الشكوى.','error');
 if(['closed','cancelled'].includes(complaint.status))
  return toast('لا يجوز تعديل شكوى مغلقة أو ملغاة.','error');
 const before=structuredClone(db);
 try{
  change(complaint);
  await persistUiNow();
  detailModal(id);
  toast(success);
 }catch(error){
  db=before;
  if(error.status===409||error.status===428)stateConflict=true;
  render();
  toast('تعذر حفظ الإجراء: '+error.message,'error');
 }
}
async function assignOwner(id){
 const owner=$('#assignOwner')?.value;
 if(!owner)return toast('حدد المسؤول أولاً.','warn');
 await saveDetailChange(id,c=>{
  if(c.owner===owner)return;
  c.owner=owner;
  logEvent(c,'تغيير المسؤول','تم إسناد السجل إلى '+owner+'.');
 },'تم تأكيد الإسناد في قاعدة البيانات.');
}
async function changePriority(id){
 const priority=$('#detailPriority')?.value;
 if(!priority)return toast('اختر الأولوية.','warn');
 await saveDetailChange(id,c=>{
  const old=priorityLabel(c.priority);
  c.priority=priority;
  logEvent(c,'تغيير الأولوية',old+' ← '+priorityLabel(priority));
 },'تم حفظ الأولوية في قاعدة البيانات.');
}
function addNote(id){
 if(!db.complaints.some(x=>x?.id===id))return;
 if(!authenticatedUser||!['admin','staff'].includes(authenticatedUser.role))
  return toast('لا تملك صلاحية إضافة ملاحظة.','error');
 modal('إضافة ملاحظة داخلية','هذه الملاحظة للفريق فقط',
 '<form id="noteForm"><div class="form-field"><label for="noteText">الملاحظة</label><textarea class="textarea-field" id="noteText" required maxlength="4000" placeholder="اكتب ملاحظة داخلية للفريق"></textarea></div></form>',
 '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-note" data-id="'+esc(id)+'">حفظ الملاحظة</button>');
}
async function saveNote(id){
 const text=$('#noteText')?.value.trim();
 if(!text)return toast('اكتب الملاحظة أولاً.','warn');
 await saveDetailChange(id,c=>{
  c.notes ||= [];
  c.notes.unshift({text,by:authenticatedUser.username,at:new Date().toISOString()});
  logEvent(c,'إضافة ملاحظة داخلية','تم حفظ ملاحظة داخلية.');
 },'تم حفظ الملاحظة في قاعدة البيانات.');
}
function newReferral(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;modal('إضافة إحالة','تسجيل الجهة وتاريخ الإرسال والموعد المتوقع للرد','<form id="referralForm"><div class="form-grid">'+selectField('الجهة المحال إليها','rEntity',db.settings.entities,'',true)+field('موعد الرد المتوقع','rDue',new Date(Date.now()+7*86400000).toISOString().slice(0,10),'date',true)+'<div class="form-field full"><label for="rNote">ملاحظات الإحالة</label><textarea class="textarea-field" id="rNote" placeholder="ملخص الطلب المرسل"></textarea></div></div></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-referral" data-id="'+esc(id)+'">حفظ الإحالة</button>');}
async function saveReferral(id){
  const complaint=db.complaints.find(x=>x.id===id);
  const entity=$('#rEntity')?.value;
  const dueValue=$('#rDue')?.value;
  const note=$('#rNote')?.value.trim()||'';
  if(!complaint||!entity||!dueValue)return toast('أكمل الجهة وموعد الرد.','warn');
  const button=$('[data-action="save-referral"]');
  if(button)button.disabled=true;
  try{
    const pending=Boolean(persistTimer);
    if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
    await persistQueue;
    if(pending){
      const saved=await api('/api/state',{
        method:'PUT',headers:{'X-State-Revision':String(stateRevision)},
        body:JSON.stringify(db)
      });
      stateRevision=saved.revision;
    }
    await api('/api/complaints/'+encodeURIComponent(id)+'/referrals',{
      method:'POST',
      body:JSON.stringify({
        entity,
        due:new Date(dueValue+'T23:59:00').toISOString(),
        note
      })
    });
    const authoritative=await api('/api/state');
    db=authoritative.state||cleanState();
    stateRevision=Number(authoritative.revision)||0;
    stateConflict=false;stateLoaded=true;
    detailModal(id);render();
    toast('تم تسجيل الإحالة وحفظها على الخادم.');
  }catch(error){
    try{
      const stored=await api('/api/state');
      db=stored.state||cleanState();
      stateRevision=Number(stored.revision)||0;
      render();
    }catch(_) {}
    if(error.status===409||error.status===428)stateConflict=true;
    toast('تعذر حفظ الإحالة: '+error.message,'error');
  }finally{if(button&&document.contains(button))button.disabled=false;}
}
function surveyModal(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;modal('تسجيل رأي المشتكي','توثيق ما إذا أُخذ الرأي وهل عولجت الشكوى','<form id="surveyForm">'+selectField('هل عولجت الشكوى؟','surveyResolved',[{value:'yes',label:'نعم'},{value:'partly',label:'جزئيًا'},{value:'no',label:'لا'},{value:'unknown',label:'لم يحدد'}],c.survey?.resolved||'',true)+'<label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:11px"><input type="checkbox" id="surveyAsked" '+(c.survey?.asked?'checked':'')+'> تم أخذ رأي المشتكي</label></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-survey" data-id="'+esc(id)+'">حفظ</button>');}
async function saveSurvey(id){
 const resolved=$('#surveyResolved')?.value;
 const asked=Boolean($('#surveyAsked')?.checked);
 if(!resolved)return toast('حدد نتيجة المعالجة.','warn');
 const label=$('#surveyResolved')?.selectedOptions?.[0]?.text||resolved;
 await saveDetailChange(id,c=>{
  c.survey={resolved,asked,at:new Date().toISOString()};
  logEvent(c,'تسجيل رأي المشتكي','نتيجة المعالجة: '+label+'؛ أخذ الرأي: '+(asked?'نعم':'لا'));
 },'تم حفظ رأي المشتكي في قاعدة البيانات.');
}
