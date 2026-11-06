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
    closed:uiCan('complaints.reopen')?['in_progress']:[],cancelled:uiCan('complaints.reopen')?['in_progress']:[]
  };
  if(!(allowed[c.status]||[]).includes(next))return toast('انتقال الحالة غير مسموح.','error');
  if((['closed','cancelled'].includes(next)||['closed','cancelled'].includes(c.status))&&reason.length<3)
    return toast('يلزم توثيق سبب واضح للإغلاق أو الإلغاء.','error');
  if(!uiCan('complaints.status'))
    return toast('ليس لديك صلاحية تغيير الحالة.','error');
  if(next==='cancelled'&&((c.referrals||[]).length||['approved','sent'].includes(c.reply?.status))){await submitApproval('complaint_cancel',id,id,reason);return;}
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
    const transition=await api('/api/complaints/'+encodeURIComponent(id)+'/status',{
      method:'PATCH',body:JSON.stringify({status:next,reason,closureException:Boolean($('#closureException')?.checked)})
    });
    const authoritative=await api('/api/state');
    db=authoritative.state||cleanState();
    stateRevision=Number(authoritative.revision)||0;
    stateConflict=false;stateLoaded=true;
    detailModal(id);
    toast('تم تحديث الحالة في قاعدة البيانات.');
    if(transition.undoToken)showStatusUndo(id,transition.undoToken,transition.undoExpiresAt);
  }catch(error){
    toast('تعذر تغيير الحالة: '+error.message,'error');
    if(error.status===409||error.status===428)stateConflict=true;
  }finally{if(button&&document.contains(button))button.disabled=false;}
}
async function saveDetailChange(id,change,success){
 const complaint=db.complaints.find(x=>x?.id===id);
 if(!complaint)return toast('لا توجد شكوى بهذا الرقم.','error');
 if(!uiCan('complaints.update'))
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
 if(!uiCan('complaints.assign'))return toast('لا تملك صلاحية الإسناد.','error');
 try{
  const pending=Boolean(persistTimer);
  if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
  await persistQueue;
  if(pending)await persistUiNow();
  await api('/api/complaints/'+encodeURIComponent(id),{
   method:'PATCH',headers:{'X-State-Revision':String(stateRevision)},body:JSON.stringify({owner})
  });
  await loadDb();detailModal(id);toast('تم تأكيد الإسناد في قاعدة البيانات.');
 }catch(error){toast('تعذر حفظ الإسناد: '+error.message,'error');}

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
 if(!uiCan('complaints.update'))
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
        due:dueValue,
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

function showStatusUndo(id,token,expiresAt){
 const node=document.createElement('div');node.className='toast';node.textContent='تم تغيير الحالة · ';
 const button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='تراجع';node.append(button);$('#toastRegion').append(node);
 const timer=setTimeout(()=>node.remove(),Math.max(0,expiresAt-Date.now()));
 button.addEventListener('click',async()=>{button.disabled=true;try{
  await api('/api/complaints/'+encodeURIComponent(id)+'/status/undo',{method:'POST',body:JSON.stringify({token})});
  const stored=await api('/api/state');db=stored.state;stateRevision=stored.revision;stateConflict=false;render();toast('تم التراجع وتوثيقه في سجل التدقيق.');
 }catch(error){toast(error.message,'error');}finally{clearTimeout(timer);node.remove();}});
}


function bulkEligibleComplaints(){
 return [...selectedIds].map(id=>db.complaints.find(c=>c?.id===id)).filter(c=>c&&!c.archivedAt&&!['closed','cancelled'].includes(c.status));
}
function bulkOpen(){
 const total=selectedIds.size,eligible=bulkEligibleComplaints().length;
 if(!total)return toast('حدد شكوى واحدة على الأقل أولًا.','warn');
 modal('إجراءات الشكاوى المحددة','حدد الإجراء. تُحفظ كل شكوى عبر مسار الخادم وتسجل في سجل التدقيق.','<p>المحدد: '+total+' · القابل للتعديل: '+eligible+' · المغلق أو المؤرشف لن يتغير.</p>',
  '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn" data-action="bulk-assign">إسناد المسؤول</button><button class="btn" data-action="bulk-priority">تغيير الأولوية</button><button class="btn" data-action="export-selected">تصدير المحدد</button>',true);
}
function bulkChangeModal(field){
 if(!['owner','priority'].includes(field))return;
 const eligible=bulkEligibleComplaints();
 if(!eligible.length)return toast('لا توجد شكاوى مفتوحة قابلة للتعديل ضمن التحديد.','warn');
 if(field==='owner'&&!uiCan('complaints.assign'))return toast('ليس لديك صلاحية إسناد الشكاوى.','error');
 if(field==='priority'&&!uiCan('complaints.update'))return toast('ليس لديك صلاحية تعديل الأولوية.','error');
 const options=field==='owner'?availableOwners().map(value=>({value,label:value})):db.settings.priorities.map(item=>({value:item.value,label:item.label}));
 const id=field==='owner'?'bulkOwner':'bulkPriority';
 const label=field==='owner'?'المسؤول الجديد':'الأولوية الجديدة';
 modal(field==='owner'?'إسناد المسؤول':'تغيير الأولوية','سيُطبق التغيير على '+eligible.length+' شكوى مفتوحة؛ تُعالج السجلات المغلقة أو المؤرشفة دون تغيير.',selectField(label,id,options,'',true),
  '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="bulk-apply" data-field="'+field+'">تطبيق على المحدد</button>');
}
async function applyBulkChange(field){
 if(!['owner','priority'].includes(field))return;
 const value=$('#'+(field==='owner'?'bulkOwner':'bulkPriority'))?.value;
 if(!value)return toast('اختر قيمة قبل التطبيق.','warn');
 const permission=field==='owner'?'complaints.assign':'complaints.update';
 if(!uiCan(permission))return toast('ليس لديك صلاحية تنفيذ هذا الإجراء.','error');
 const eligible=bulkEligibleComplaints();
 if(!eligible.length)return toast('لا توجد شكاوى مفتوحة قابلة للتعديل.','warn');
 const label=field==='owner'?'إسناد '+value:'تغيير الأولوية إلى '+priorityLabel(value);
 if(!confirm('تأكيد '+label+' على '+eligible.length+' شكوى مفتوحة؟'))return;
 const button=$('[data-action="bulk-apply"]');if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
 let succeeded=0;const failed=[];
 for(const complaint of eligible){
  try{
   await api('/api/complaints/'+encodeURIComponent(complaint.id),{method:'PATCH',body:JSON.stringify({[field]:value})});
   succeeded++;selectedIds.delete(complaint.id);
  }catch(error){failed.push({id:complaint.id,error:error.message});}
 }
 try{
  const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number(stored.revision)||0;stateLoaded=true;stateConflict=false;
 }catch(error){toast('حُفظ '+succeeded+' سجلًا، لكن تعذر تحديث العرض من الخادم: '+error.message,'error');}
 closeModal();render();
 if(failed.length)toast('تم حفظ '+succeeded+' من '+eligible.length+'؛ بقي '+failed.length+' دون تغيير ومحددًا للمراجعة.','warn');
 else toast('تم تحديث '+succeeded+' شكوى وتسجيل التغييرات في سجل التدقيق.');
 if(button){button.disabled=false;button.removeAttribute('aria-busy');}
}
