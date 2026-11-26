/* Workday tools use authenticated local APIs; background reads never replace edits. */
let workdayReminders=[],workdayLoadedAt=0,workdayPending=false,workdayOwner=null;
function workdayPanel(){return '<section class="panel workday-panel"><div class="panel-header"><h2>متابعة اليوم</h2><button type="button" class="btn btn-sm" data-action="refresh-workday">تحديث</button></div><div class="panel-body" id="workdayMount" aria-label="المتابعة وحالة النسخ">جارٍ تحميل المتابعة وحالة النسخ الاحتياطي…</div></section>';}
function workdayRecords(records,reminders=[],now=Date.now()){
 const today=workDayKey(now),byId=new Map();
 const reminderIds=new Set(reminders.filter(r=>{const day=workDayKey(r.reminderTime);return day&&day<=today;}).map(r=>r.complaintId));
 for(const c of records||[]){
  if(c.archivedAt||['closed','cancelled'].includes(c.status))continue;
  const reasons=[];
  if(reminderIds.has(c.id))reasons.push('موعد متابعة');
  if(isIncomplete(c))reasons.push('استكمال بيانات');
  if(reasons.length)byId.set(c.id,{complaint:c,reasons});
 }
 return [...byId.values()].sort((a,b)=>(b.reasons.includes('موعد متابعة')?1:0)-(a.reasons.includes('موعد متابعة')?1:0));
}
async function refreshWorkday(force=false){
 if(!authenticatedUser||page!=='dashboard'||workdayPending)return;
 const user=authenticatedUser;if(workdayOwner!==user){workdayOwner=user;workdayReminders=[];workdayLoadedAt=0;}
 workdayPending=true;
 try{
  let reminderError=false;
  if(force||Date.now()-workdayLoadedAt>45000){
   try{const data=await api('/api/reminders/today');if(user!==authenticatedUser)return;workdayReminders=data.reminders||[];workdayLoadedAt=Date.now();}catch(_){reminderError=true;}
  }
  const metrics=await loadProtectionStatus(force);
  if(user!==authenticatedUser||page!=='dashboard')return;
  const mount=$('#workdayMount');if(!mount)return;
  const rows=workdayRecords(db.complaints,workdayReminders,Date.now());
  const backup=metrics?.automaticBackups,state=protectionStateLabel(backup);
  const rowHtml=rows.slice(0,15).map(({complaint:c,reasons})=>
    '<div class="workday-row" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--edge,rgba(0,0,0,.08))">'+
    '<div style="flex:1 1 220px;min-width:0"><strong style="display:block">'+esc(c.summary||c.id)+'</strong><small class="small-copy">'+esc(reasons.join(' · '))+'</small></div>'+
    '<div class="footer-actions" style="flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px">'+
    '<button type="button" class="btn btn-sm" data-action="detail" data-id="'+esc(c.id)+'">فتح السجل</button>'+
    '<button type="button" class="btn btn-sm" data-action="set-reminder" data-id="'+esc(c.id)+'">موعد متابعة</button></div></div>'
  ).join('');
  mount.innerHTML=
   '<div class="backup-home-status" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">'+
   '<div><strong>النسخ الاحتياطي: '+esc(metrics?.error?'تعذر التحقق':state.label)+'</strong><span class="small-copy" style="display:block">آخر نسخة ناجحة: '+esc(formatProtectionTime(backup?.lastSuccessfulAt))+'</span></div>'+
   '<button type="button" class="btn btn-sm" data-goto="settings">النسخ والاستعادة</button></div>'+
   (backup?.lastError?'<p class="danger-text">فشلت آخر محاولة نسخ احتياطي. افتح النسخ والاستعادة لمعالجة السبب.</p>':'')+
   (reminderError?'<p>تعذر تحميل المواعيد؛ اضغط تحديث لإعادة المحاولة.</p>':'')+
   '<p class="small-copy">'+rows.length+' سجلًا يحتاج إجراءً · تظهر أول 15 نتيجة</p>'+
   (rows.length?rowHtml:'<p class="calm-empty">لا توجد إجراءات مستحقة ضمن البيانات الحالية.</p>')+
   (rows.length?'<div style="margin-top:12px"><button type="button" class="btn btn-sm" data-action="workday-all">عرض قائمة المتابعة كاملة</button></div>':'');
 }finally{workdayPending=false;}
}
function reportInsightGroups(records,kind,now=Date.now()){
 const groups=new Map();
 for(const c of records){
  if(kind==='entity'&&['closed','cancelled','draft'].includes(c.status))continue;
  const values=kind==='entity'?[...new Set((c.referrals||[]).filter(r=>!r.response&&Number.isFinite(Date.parse(r.due))&&Date.parse(r.due)<now).map(r=>r.entity||'جهة غير مسجلة'))]:[norm(c.summary||'')];
  for(const value of values){if(!value)continue;if(!groups.has(value))groups.set(value,{value,label:kind==='entity'?value:c.summary,records:[]});groups.get(value).records.push(c);}
 }
 return [...groups.values()].filter(g=>kind==='entity'||g.records.length>1).sort((a,b)=>b.records.length-a.records.length);
}
function reportInsightPanel(records){
 return '<section class="panel"><div class="panel-body"><h2>أين تحتاج المعالجة متابعة؟</h2>'+[['entity','جهات لديها إحالات متأخرة'],['topic','ملخصات متكررة بعد توحيد الكتابة']].map(([kind,title])=>'<h3>'+title+'</h3>'+ (reportInsightGroups(records,kind).slice(0,10).map(g=>'<div class="workday-row" style="display:flex;justify-content:space-between;gap:12px;align-items:center"><span>'+esc(g.label)+' · '+g.records.length+' سجل</span><button type="button" class="btn btn-sm" data-action="report-insight" data-kind="'+kind+'" data-value="'+esc(g.value)+'">عرض السجلات</button></div>').join('')||'<p>لا توجد نتائج مطابقة.</p>')).join('')+'</div></section>';
}
let workdayListRows=[],workdayListPage=1;
function showWorkdayList(rows,title,reset=true){
 if(reset){workdayListRows=rows;workdayListPage=1;}
 const pages=Math.max(1,Math.ceil(workdayListRows.length/50));workdayListPage=Math.min(pages,Math.max(1,workdayListPage));
 modal(title||'سجلات المتابعة','صفحة '+workdayListPage+' من '+pages+' · '+workdayListRows.length+' سجل',complaintTable(workdayListRows.slice((workdayListPage-1)*50,workdayListPage*50)),
 '<button class="btn" data-action="workday-prev" '+(workdayListPage===1?'disabled':'')+'>السابق</button><button class="btn" data-action="workday-next" '+(workdayListPage===pages?'disabled':'')+'>التالي</button>',true);
}
let attachmentPreviewUrl=null;
function releaseAttachmentPreview(){if(attachmentPreviewUrl){URL.revokeObjectURL(attachmentPreviewUrl);attachmentPreviewUrl=null;}}
async function previewAttachment(file,name,mime){
 const url='/api/attachments/'+encodeURIComponent(file),user=authenticatedUser;
 if(mime==='application/pdf'){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('تعذر فتح المرفق. أعد تسجيل الدخول ثم حاول مجددًا.');
  const bytes=await response.arrayBuffer();if(String.fromCharCode(...new Uint8Array(bytes).slice(0,5))!=='%PDF-')throw new Error('المرفق ليس ملف PDF صالحًا للمعاينة.');
  if(!user||user!==authenticatedUser)return false;
  modal('معاينة PDF',esc(name),'<iframe id="pdfAttachmentPreview" class="attachment-pdf-viewer" title="معاينة ملف PDF"></iframe>', '<a class="btn" href="'+url+'" target="_blank" rel="noopener">تنزيل الملف</a>',true);
  attachmentPreviewUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));$('#pdfAttachmentPreview').src=attachmentPreviewUrl;
 }else{
  modal('معاينة المرفق',esc(name),'<img class="attachment-viewer" src="'+url+'" alt="'+esc(name)+'">','<a class="btn" href="'+url+'" target="_blank" rel="noopener">تنزيل الملف</a>');
 }
}
document.addEventListener('complaints:render',()=>{void refreshWorkday();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshWorkday();});
setInterval(()=>{if(document.visibilityState!=='hidden')void refreshWorkday();},60000);
document.addEventListener('click',async e=>{
 const button=e.target.closest?.('[data-action]');if(!button)return;
 try{
  const a=button.dataset.action;
  if(a==='refresh-workday')await withButtonLock(button,()=>refreshWorkday(true),'جارٍ التحديث…');
  if(a==='workday-all')showWorkdayList(workdayRecords(db.complaints,workdayReminders,Date.now()).map(r=>r.complaint),'متابعة اليوم');
  if(a==='workday-prev'||a==='workday-next'){workdayListPage+=a==='workday-next'?1:-1;showWorkdayList(null,null,false);}
  if(a==='report-insight'){
   const groups=reportInsightGroups(filteredReportRecords(db.complaints,reportFilters),button.dataset.kind);
   showWorkdayList(groups.find(g=>g.value===button.dataset.value)?.records||[],'السجلات وراء المؤشر');
  }
  if(a==='reminder-preset'){
   const days=Number(button.dataset.days);if(![1,3,7].includes(days))return;
   const day=workDayKey(Date.now()+days*86400000);$('#alarmTime').value=day+'T09:00';if(!$('#alarmNote').value)$('#alarmNote').value='متابعة السجل';
  }
 }catch(error){toast(error.message,'error');}
});

document.addEventListener('input',e=>{
 const form=e.target.closest?.('form');
 if(form&&['newComplaintForm','editComplaintForm','replyForm','noteForm','referralForm','surveyForm','reminderForm','settingForm'].includes(form.id))showSaveState('dirty');
});
