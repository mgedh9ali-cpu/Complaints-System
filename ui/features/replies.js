function replyEditor(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;const text=c.reply?.text||'';modal('صياغة رد خارجي','المسودة منفصلة عن الملاحظات الداخلية؛ يلزم اعتماد بشري قبل توثيق الإرسال','<form id="replyForm"><div class="form-grid">'+selectField('قالب الرد','replyTemplate',[{value:'',label:'بدون قالب'},...db.templates.map((t,i)=>({value:String(i),label:t.name+' · إصدار '+t.version}))],'')+'<div class="form-field"><label for="replyText">نص الرد</label><textarea class="textarea-field" id="replyText" required style="min-height:180px">'+esc(text)+'</textarea></div></div><p class="small-copy">المتغيرات المتاحة: {{رقم_الشكوى}}، {{الجهة}}، {{التصنيف}}. بعد الاعتماد يمكن توثيق الإرسال من ملف الشكوى.</p></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-reply" data-id="'+esc(id)+'">حفظ المسودة</button>');}
async function saveReply(id){
 const c=db.complaints.find(x=>x.id===id);
 const text=$('#replyText')?.value.trim();
 if(!c||!text)return toast('اكتب نص الرد.','warn');
 if(!uiCan('replies.draft'))return toast('لا تملك صلاحية تحرير الرد.','error');
 if(['approved','sent'].includes(c.reply?.status))return toast('لا يمكن تعديل رد معتمد أو مرسل.','error');
 const original=structuredClone(db);
 const button=$('[data-action="save-reply"]');
 if(button)button.disabled=true;
 try{
  await flushUiBeforeAction();
  await api('/api/complaints/'+encodeURIComponent(id)+'/reply',{method:'PATCH',body:JSON.stringify({action:'draft',text})});
  await reloadStoredState();
  detailModal(id);toast('تم حفظ المسودة في قاعدة البيانات.');
 }catch(error){
  db=original;
  if(error.status===409||error.status===428)stateConflict=true;
  toast('تعذر حفظ الرد: '+error.message,'error');
 }finally{if(button&&document.contains(button))button.disabled=false;}
}
async function replyAction(id,action){
 const c=db.complaints.find(x=>x.id===id);
 if(!c?.reply||!authenticatedUser)return;
 if(!uiCan(action==='reply-approve'?'replies.approve':action==='reply-sent'?'replies.send':'replies.draft'))return toast('ليس لديك صلاحية تغيير مرحلة الرد.','error');
 const status=c.reply.status;
 const author=c.reply.author;
 if(action==='reply-review'&&status!=='draft')return toast('المسودة غير جاهزة للمراجعة.','error');
 if(action==='reply-approve'){
  if(!uiCan('replies.approve'))return toast('الاعتماد يتطلب صلاحية مستقلة.','error');
  if(author===authenticatedUser.username)return toast('لا يمكن لمعد الرد اعتماده.','error');
  if(!['review','approval'].includes(status))return toast('لا يمكن اعتماد الرد في مرحلته الحالية.','error');
 }
 if(action==='reply-sent'&&status!=='approved')return toast('يجب اعتماد الرد قبل توثيق الإرسال.','error');
 if(!['reply-review','reply-approve','reply-sent'].includes(action))return;
 const original=structuredClone(db);
 const button=$('[data-action="'+action+'"]');
 if(button)button.disabled=true;
 try{
  await flushUiBeforeAction();
  if(action==='reply-review'){
   c.reply.status='review';
   logEvent(c,'إرسال الرد للمراجعة','أُرسلت المسودة إلى مرحلة المراجعة.');
   db.notifications.unshift({id:Date.now(),title:'رد بانتظار المراجعة',body:c.id+' · '+c.summary,date:new Date().toISOString(),read:false});
  }else if(action==='reply-approve'){
   c.reply.status='approved';logEvent(c,'اعتماد الرد','اعتمد المدير الرد بعد مراجعة نصه.');
  }else{
   c.reply.status='sent';logEvent(c,'توثيق إرسال الرد','تم توثيق إرسال الرد.');
  }
  await api('/api/complaints/'+encodeURIComponent(id)+'/reply',{method:'PATCH',body:JSON.stringify({action:({'reply-review':'review','reply-approve':'approve','reply-sent':'sent'})[action]})});
  await reloadStoredState();
  detailModal(id);toast('تم حفظ مرحلة الرد في قاعدة البيانات.');
 }catch(error){
  db=original;
  if(error.status===409||error.status===428)stateConflict=true;
  render();
  toast('تعذر اعتماد الإجراء: '+error.message,'error');
 }finally{if(button&&document.contains(button))button.disabled=false;}
}
function newReply(){const rows=db.complaints.filter(c=>!c.reply);if(!rows.length)return toast('كل السجلات لديها رد مرتبط.','warn');modal('إنشاء رد','اختر السجل المراد إعداد رد له','<div class="form-field"><label for="replyComplaint">الشكوى</label><select class="select-field" id="replyComplaint">'+rows.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.id+' · '+c.summary)+'</option>').join('')+'</select></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="reply-next">متابعة</button>');}
function newReferralGlobal(){const rows=db.complaints.filter(c=>c.status!=='closed'&&c.status!=='cancelled');modal('إحالة جديدة','اختر الشكوى لبدء تسجيل الإحالة','<div class="form-field"><label for="refComplaint">الشكوى</label><select class="select-field" id="refComplaint">'+rows.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.id+' · '+c.summary)+'</option>').join('')+'</select></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="referral-next">متابعة</button>');}
function bulkOpen(){if(!selectedIds.size)return toast('حدد سجلًا واحدًا على الأقل من الجدول.','warn');ensureManagedSettings();modal('إجراءات جماعية','ستُطبق العملية على '+selectedIds.size+' سجلات','<div class="form-field"><label for="bulkType">نوع الإجراء</label><select class="select-field" id="bulkType"><option value="assign">تغيير المسؤول</option><option value="priority">تغيير الأولوية</option></select></div><div class="form-field" style="margin-top:12px"><label for="bulkValue">القيمة</label><select class="select-field" id="bulkValue">'+assignees.map(u=>'<option value="'+esc(u.username)+'">'+esc(u.username)+'</option>').join('')+''+db.settings.priorities.map(p=>'<option value="'+esc(p.value)+'">'+esc(p.label)+'</option>').join('')+'</select></div><div class="risk-note" style="margin-top:12px">سيظهر تأكيد إضافي قبل تطبيق الإجراء على السجلات المحددة.</div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="bulk-confirm">متابعة للتأكيد</button>');}
