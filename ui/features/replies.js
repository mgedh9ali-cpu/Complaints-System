function replyEditor(id){const c=db.complaints.find(x=>x.id===id);if(!c)return;const text=c.reply?.text||'';modal('صياغة رد خارجي','المسودة منفصلة عن الملاحظات الداخلية؛ يمكن اعتماد الرد ثم توثيق الإرسال','<form id="replyForm"><div class="form-grid">'+selectField('قالب الرد','replyTemplate',[{value:'',label:'بدون قالب'},...db.templates.map((t,i)=>({value:String(i),label:t.name+' · إصدار '+t.version}))],'')+'<div class="form-field"><label for="replyText">نص الرد</label><textarea class="textarea-field" id="replyText" required style="min-height:180px">'+esc(text)+'</textarea></div></div><p class="small-copy">المتغيرات المتاحة: {{رقم_الشكوى}}، {{الجهة}}، {{التصنيف}}، {{اسم_المشتكي}}. يمكن اعتماد الرد من أي مستخدم بصلاحية الاعتماد، ثم توثيق الإرسال من ملف الشكوى.</p></form>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-reply" data-id="'+esc(id)+'">حفظ المسودة</button>');
  const sel=$('#replyTemplate');
  if(sel)sel.addEventListener('change',()=>applyReplyTemplate(id));
}
function applyReplyTemplate(id){
  const c=db.complaints.find(x=>x.id===id);
  const idx=$('#replyTemplate')?.value;
  const ta=$('#replyText');
  if(!c||!ta||idx===''||idx==null)return;
  const t=db.templates[Number(idx)];
  if(!t)return;
  const filled=String(t.text||'')
    .replaceAll('{{رقم_الشكوى}}',c.id||'')
    .replaceAll('{{الجهة}}',c.entity||'')
    .replaceAll('{{التصنيف}}',c.category||'')
    .replaceAll('{{اسم_المشتكي}}',c.name||'');
  ta.value=filled;
  toast('تم إدراج القالب.');
}
async function saveReply(id){
 const c=db.complaints.find(x=>x.id===id);
 const text=$('#replyText')?.value.trim();
 if(!c||!text)return toast('اكتب نص الرد.','warn');
 if(!uiCan('replies.draft'))return toast('لا تملك صلاحية تحرير الرد.','error');
 if(['approved','sent'].includes(c.reply?.status))return toast('لا يمكن تعديل رد معتمد أو مرسل.','error');
 const original=structuredClone(db);
 try{
  await flushUiBeforeAction();
  await api('/api/complaints/'+encodeURIComponent(id)+'/reply',{method:'PATCH',body:JSON.stringify({action:'draft',text})});
  await reloadStoredState();
  detailModal(id);toast('تم حفظ المسودة في قاعدة البيانات.');
 }catch(error){
  db=original;
  if(error.status===409||error.status===428)stateConflict=true;
  toast('تعذر حفظ الرد: '+error.message,'error');
  throw error;
 }
}
async function replyAction(id,action){
 const c=db.complaints.find(x=>x.id===id);
 if(!c?.reply||!authenticatedUser)return;
 if(!uiCan(action==='reply-approve'?'replies.approve':action==='reply-sent'?'replies.send':'replies.draft'))return toast('ليس لديك صلاحية تغيير مرحلة الرد.','error');
 const status=c.reply.status;
 if(action==='reply-review'&&status!=='draft')return toast('المسودة غير جاهزة للمراجعة.','error');
 if(action==='reply-approve'){
  if(!uiCan('replies.approve'))return toast('الاعتماد يتطلب صلاحية مستقلة.','error');
  if(!['draft','review','approval'].includes(status))return toast('لا يمكن اعتماد الرد في مرحلته الحالية.','error');
 }
 if(action==='reply-sent'&&status!=='approved')return toast('يجب اعتماد الرد قبل توثيق الإرسال.','error');
 if(!['reply-review','reply-approve','reply-sent'].includes(action))return;
 const original=structuredClone(db);
 try{
  await flushUiBeforeAction();
  if(action==='reply-review'){
   c.reply.status='review';
   logEvent(c,'إرسال الرد للمراجعة','أُرسلت المسودة إلى مرحلة المراجعة.');
   db.notifications.unshift({id:Date.now(),title:'رد بانتظار المراجعة',body:c.id+' · '+c.summary,date:new Date().toISOString(),read:false});
  }else if(action==='reply-approve'){
   c.reply.status='approved';logEvent(c,'اعتماد الرد','اعتمد المدير الرد بعد مراجعة نصه.');
   c.reply.approvedAt=new Date().toISOString();c.reply.approvedBy=authenticatedUser.username;
   db.notifications.unshift({id:Date.now(),title:'تم اعتماد رد',body:c.id+' · '+c.summary,date:new Date().toISOString(),read:false});
  }else if(action==='reply-sent'){
   c.reply.status='sent';logEvent(c,'توثيق إرسال الرد','تم توثيق إرسال الرد.');
  }
  await api('/api/complaints/'+encodeURIComponent(id)+'/reply',{method:'PATCH',body:JSON.stringify({action:({'reply-review':'review','reply-approve':'approve','reply-sent':'sent'})[action]})});
  await reloadStoredState();
  detailModal(id);
  toast(action==='reply-review'?'أُرسل للمراجعة.':action==='reply-approve'?'تم اعتماد الرد.':'تم توثيق الإرسال.');
 }catch(error){
  db=original;
  if(error.status===409||error.status===428)stateConflict=true;
  toast('تعذر تحديث مرحلة الرد: '+error.message,'error');
  throw error;
 }
}
function replyStatusPill(status){
 const map={draft:['مسودة','pill new'],review:['مراجعة','pill progressing'],approval:['بانتظار اعتماد','pill progressing'],approved:['معتمد','pill done'],sent:['مُرسل','pill done']};
 const [label,cls]=map[status]||[status||'—','pill'];
 return '<span class="'+cls+'">'+esc(label)+'</span>';
}
