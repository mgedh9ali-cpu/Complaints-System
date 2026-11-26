function availableReplyTemplates(){
 const custom=db.templates||[];
 const builtins=[{name:'متابعة رد الجهة',version:1,text:'إلى {{الجهة}}: يرجى تزويدنا بآخر إجراءات الشكوى رقم {{رقم_الشكوى}} المتعلقة بـ {{التصنيف}}. تاريخ المتابعة: {{التاريخ}}.'},
 {name:'إفادة بإتمام المعالجة',version:1,text:'بخصوص الشكوى رقم {{رقم_الشكوى}}: تمت مراجعة المعالجة لدى {{الجهة}} بتاريخ {{التاريخ}}. أضف نتيجة المعالجة قبل اعتماد الرد.'}];
 return [...custom,...builtins.filter(t=>!custom.some(c=>c.name===t.name))];
}
function replyTemplatePlaceholders(c){
  const phone=c.phone||'';
  const province=c.province||'';
  const nature=c.nature||'';
  const priority=typeof priorityLabel==='function'?priorityLabel(c.priority): (c.priority||'');
  return {
    '{{رقم_الشكوى}}': c.id||'',
    '{{الجهة}}': c.entity||'',
    '{{التصنيف}}': c.category||'',
    '{{اسم_المشتكي}}': c.name||'',
    '{{الهاتف}}': phone,
    '{{المحافظة}}': province,
    '{{الطبيعة}}': nature,
    '{{الأولوية}}': priority,
    '{{التاريخ}}': typeof dateText==='function'?dateText(new Date().toISOString()): new Date().toLocaleDateString('ar')
  };
}

function fillReplyTemplateText(templateText,c){
  let filled=String(templateText||'');
  const map=replyTemplatePlaceholders(c);
  filled=filled.replace(/\{\{[^{}]+\}\}/g,key=>Object.hasOwn(map,key)?String(map[key]):key);
  return filled;
}

function replyEditor(id){
  const c=db.complaints.find(x=>x.id===id);
  if(!c)return;
  const text=c.reply?.text||'';
  const templateOptions=[{value:'',label:'بدون قالب'},...availableReplyTemplates().map((t,i)=>({value:String(i),label:(t.name||('قالب '+(i+1)))+' · إصدار '+(t.version||1)}))];
  modal(
    'صياغة رد خارجي',
    'المسودة منفصلة عن الملاحظات الداخلية؛ يمكن اعتماد الرد ثم توثيق الإرسال',
    '<form id="replyForm"><div class="form-grid">'+
      selectField('قالب الرد','replyTemplate',templateOptions,'')+
      '<div class="form-field full"><label for="replyText">نص الرد</label>'+
      '<textarea class="textarea-field" id="replyText" required style="min-height:180px">'+esc(text)+'</textarea></div>'+
      '</div>'+
      '<p class="small-copy">المتغيرات: {{رقم_الشكوى}}، {{اسم_المشتكي}}، {{الهاتف}}، {{المحافظة}}، {{التصنيف}}، {{الطبيعة}}، {{الجهة}}، {{الأولوية}}، {{التاريخ}}.</p>'+
      '<p class="small-copy">اختيار قالب يملأ النص تلقائيًا. إن وُجد نص سابق سيُطلب تأكيد الاستبدال.</p></form>',
    '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-reply" data-id="'+esc(id)+'">حفظ المسودة</button>'
  );
  const sel=$('#replyTemplate');
  if(sel)sel.addEventListener('change',()=>{applyReplyTemplate(id).catch(()=>{});});
}

async function applyReplyTemplate(id){
  const c=db.complaints.find(x=>x.id===id);
  const idx=$('#replyTemplate')?.value;
  const ta=$('#replyText');
  if(!c||!ta||idx===''||idx==null)return;
  const t=availableReplyTemplates()[Number(idx)];
  if(!t)return;
  const filled=fillReplyTemplateText(t.text,c);
  const existing=(ta.value||'').trim();
  if(existing && existing!==filled){
    const ok=typeof confirmDialog==='function'
      ? await confirmDialog({
          title:'استبدال نص الرد؟',
          message:'يوجد نص في مربع الرد. استبداله بنص القالب «'+(t.name||'')+'»؟',
          detail:'يمكنك الإلغاء والاحتفاظ بالنص الحالي.',
          confirmLabel:'استبدال بالقالب',
          danger:false
        })
      : true;
    if(!ok){
      // reset select to empty so user can pick again later
      if($('#replyTemplate')) $('#replyTemplate').value='';
      return;
    }
  }
  ta.value=filled;
  ta.focus();
  toast('تم إدراج القالب مع تعبئة المتغيرات.');
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
  if (page === 'replies') { closeModal(); render(); }
  else detailModal(id);
  toast('تم حفظ المسودة في قاعدة البيانات.');
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
  if (page === 'replies') { closeModal(); render(); }
  else detailModal(id);
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
