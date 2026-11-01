function changeStatus(id){const c=db.complaints.find(x=>x.id===id),next=$('#detailStatus')?.value,reason=$('#statusReason')?.value.trim();if(!c||!next)return toast('اختر حالة جديدة أولًا.','warn');const allowed={new:['in_progress','cancelled'],in_progress:['awaiting_reply','awaiting_approval','closed','cancelled'],awaiting_reply:['in_progress','awaiting_approval','closed'],awaiting_approval:['in_progress','closed'],closed:['in_progress'],cancelled:[]};if(!(allowed[c.status]||[]).includes(next))return toast('هذا الانتقال غير مسموح وفق آلة الحالات.','error');if((next==='closed'||next==='cancelled'||c.status==='closed')&&!reason)return toast('السبب إلزامي للإغلاق أو الإلغاء أو إعادة الفتح.','error');if(next==='closed'&&c.referrals.some(r=>!r.response)&&!reason)return toast('لا يمكن الإغلاق قبل استكمال الإحالات أو توثيق الاستثناء.','error');const before=statusLabel(c.status);c.status=next;logEvent(c,'تغيير الحالة',before+' ← '+statusLabel(next)+(reason?' · السبب: '+reason:''));if(next==='closed')notify('تم إغلاق السجل',c.id+' · '+reason);persist();detailModal(id);render();toast('تم تحديث حالة الشكوى.');}
function assignOwner(id){const c=db.complaints.find(x=>x.id===id),owner=$('#assignOwner')?.value;if(!c||!owner)return;c.owner=owner;logEvent(c,'تغيير المسؤول','تم إسناد السجل إلى '+owner+'.');persist();detailModal(id);render();toast('تم تحديث المسؤول.');}
function changePriority(id){const c=db.complaints.find(x=>x.id===id),p=$('#detailPriority')?.value;if(!c||!p)return;const old=priorityLabel(c.priority);c.priority=p;logEvent(c,'تغيير الأولوية',old+' ← '+priorityLabel(p));persist();detailModal(id);render();toast('تم تحديث الأولوية.');}
function addNote(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;modal('إضافة ملاحظة داخلية','لن تُرسل هذه الملاحظة إلى المشتكي','<form id="noteForm"><div class="form-field"><label for="noteText">الملاحظة</label><textarea class="textarea-field" id="noteText" required placeholder="اكتب ملاحظة داخلية للفريق"></textarea></div><p class="small-copy">الإشارة إلى زميل (@) نصية فقط في النموذج الأولي، ولا توجد إشعارات موجهة فعلية.</p></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-note" data-id="'+esc(id)+'">حفظ الملاحظة</button>');}
function saveNote(id){const c=db.complaints.find(x=>x.id===id),text=$('#noteText')?.value.trim();if(!c||!text)return toast('اكتب الملاحظة أولًا.','warn');c.notes.unshift({text,by:(authenticatedUser?.username||'النظام'),at:new Date().toISOString()});logEvent(c,'إضافة ملاحظة داخلية','تمت إضافة ملاحظة داخلية.');persist();detailModal(id);toast('تم حفظ الملاحظة.');}
function newReferral(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;modal('إضافة إحالة','تسجيل الجهة وتاريخ الإرسال والموعد المتوقع للرد','<form id="referralForm"><div class="form-grid">'+selectField('الجهة المحال إليها','rEntity',db.settings.entities,'',true)+field('موعد الرد المتوقع','rDue',new Date(Date.now()+7*86400000).toISOString().slice(0,10),'date',true)+'<div class="form-field full"><label for="rNote">ملاحظات الإحالة</label><textarea class="textarea-field" id="rNote" placeholder="ملخص الطلب المرسل"></textarea></div></div></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-referral" data-id="'+esc(id)+'">حفظ الإحالة</button>');}
async function saveReferral(id){
  const c=db.complaints.find(x=>x.id===id);
  const entity=$('#rEntity')?.value, dueValue=$('#rDue')?.value, note=$('#rNote')?.value.trim()||'';
  if(!c||!entity||!dueValue)return toast('أكمل الجهة وموعد الرد.','warn');
  const saveButton=$('[data-action="save-referral"]');
  if(saveButton)saveButton.disabled=true;
  try{
    const hadPendingSave=Boolean(persistTimer);
    if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
    await persistQueue;
    if(hadPendingSave){
      const saved=await api('/api/state',{
        method:'PUT',headers:{'X-State-Revision':String(stateRevision)},body:JSON.stringify(db)
      });
      stateRevision=saved.revision;
    }
    if(c.status==='in_progress'){
      await api('/api/complaints/'+encodeURIComponent(id)+'/status',{
        method:'PATCH',
        body:JSON.stringify({status:'awaiting_reply',reason:'إحالة إلى '+entity})
      });
    }
    const stored=await api('/api/state');
    db=stored.state||cleanState();
    stateRevision=stored.revision;
    const current=db.complaints.find(x=>x.id===id);
    if(!current)throw new Error('الشكوى غير موجودة في بيانات الخادم.');
    current.referrals ||= [];
    current.referrals.push({
      entity,
      sent:new Date().toISOString(),
      due:new Date(dueValue+'T23:59:00').toISOString(),
      status:'بانتظار الرد',
      response:'',
      note
    });
    logEvent(current,'إحالة إلى جهة','تم توثيق إحالة إلى '+entity+'.');
    notify('إحالة جديدة',id+' · إحالة إلى '+entity);
    const saved=await api('/api/state',{
      method:'PUT',
      headers:{'X-State-Revision':String(stateRevision)},
      body:JSON.stringify(db)
    });
    stateRevision=saved.revision;
    detailModal(id);render();toast('تم تسجيل الإحالة وحفظها على الخادم.');
  }catch(error){
    try{
      const stored=await api('/api/state');
      db=stored.state||cleanState();
      stateRevision=stored.revision;
      render();
    }catch(_) {}
    toast('تعذر حفظ الإحالة: '+error.message,'error');
  }finally{if(saveButton)saveButton.disabled=false;}
}
function surveyModal(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;modal('تسجيل رأي المشتكي','توثيق ما إذا أُخذ الرأي وهل عولجت الشكوى','<form id="surveyForm">'+selectField('هل عولجت الشكوى؟','surveyResolved',[{value:'yes',label:'نعم'},{value:'partly',label:'جزئيًا'},{value:'no',label:'لا'},{value:'unknown',label:'لم يحدد'}],c.survey?.resolved||'',true)+'<label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:11px"><input type="checkbox" id="surveyAsked" '+(c.survey?.asked?'checked':'')+'> تم أخذ رأي المشتكي</label></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-survey" data-id="'+esc(id)+'">حفظ</button>');}
function saveSurvey(id){const c=db.complaints.find(x=>x.id===id);if(!c||!$('#surveyResolved').value)return toast('حدد نتيجة المعالجة.','warn');c.survey={resolved:$('#surveyResolved').value,asked:$('#surveyAsked').checked,at:new Date().toISOString()};logEvent(c,'تسجيل استبيان الإغلاق','نتيجة المعالجة: '+$('#surveyResolved').selectedOptions[0].text+'؛ أخذ الرأي: '+(c.survey.asked?'نعم':'لا'));persist();detailModal(id);toast('تم توثيق رأي المشتكي.');}
