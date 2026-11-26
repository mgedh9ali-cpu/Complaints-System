/* Document print / verify — approved replies, intake receipts, complaint cover. */

async function printApprovedReply(id){
  const c=db.complaints.find(x=>x?.id===id);
  if(!c?.reply||!['approved','sent'].includes(c.reply.status))
    return toast('يلزم رد معتمد قبل الطباعة.','warn');
  try{
    const proof=await api('/api/documents/reply/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({})});
    const w=window.open('','_blank');
    if(!w)return toast('اسمح بالنوافذ المنبثقة لطباعة المستند.','warn');
    w.opener=null;
    w.onload=()=>w.print();
    const code=proof.code||proof.digest||'';
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>رد معتمد · ${esc(c.id)}</title>
<style>body{font-family:"Thmanyah Sans","ThmanyahSans","Cairo","Noto Sans Arabic",Tahoma,Arial,sans-serif;padding:28px;color:#0F1F17;line-height:1.8}h1{color:#1E3A2E;font-size:18px;margin:0 0 8px}
.meta{color:#3D4337;font-size:12px;margin-bottom:18px}.box{border:1px solid #b8bda8;border-radius:12px;padding:16px;background:#f7f8f2;white-space:pre-wrap}
.foot{margin-top:28px;padding-top:12px;border-top:1px dashed #b8bda8;font-size:11px;color:#3D4337;word-break:break-all}
.stamp{display:inline-block;margin-top:12px;padding:6px 12px;border:2px solid #3E5A3F;color:#1E3A2E;border-radius:8px;font-weight:700}</style></head><body>
<h1>رد رسمي معتمد</h1>
<div class="meta">رقم الشكوى: <b dir="ltr">${esc(c.id)}</b> · المشتكي: ${esc(c.name||'—')} · التاريخ: ${esc(timeText(new Date().toISOString()))}</div>
<div class="box">${esc(c.reply.text||'')}</div>
<div class="stamp">معتمد · رمز تحقق</div>
<div class="foot">رمز التحقق (SHA-256): <span dir="ltr">${esc(code)}</span><br>أُصدر من نظام الشكاوى المحلي · يمكن التحقق من صفحة الإعدادات.</div>
</body></html>`);
    w.document.close();
    toast('تم إصدار مستند الرد مع رمز تحقق.');
  }catch(error){toast(error.message||'تعذر إصدار المستند','error');}
}

async function printComplaintReceipt(id){
  const c=db.complaints.find(x=>x?.id===id);
  if(!c)return toast('الشكوى غير موجودة.','error');
  try{
    const res=await fetch('/api/export/pdf/'+encodeURIComponent(id)+'?kind=receipt',{credentials:'same-origin'});
    if(!res.ok){
      let msg='تعذر إنشاء الإيصال';
      try{const j=await res.json();if(j.error)msg=j.error;}catch(_){}
      throw new Error(msg);
    }
    const blob=await res.blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='ايصال-'+id+'.pdf';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    toast('تم تنزيل إيصال الاستلام PDF.');
  }catch(error){return toast(error.message,'error');}
}

function verifyDocumentDialog(){
  modal('التحقق من مستند مطبوع','أدخل رمز التحقق المطبوع أسفل الرد المعتمد.','<div class="form-field"><label for="verifyCode">رمز التحقق (64 محرفاً)</label><input class="field" id="verifyCode" dir="ltr" autocomplete="off" maxlength="64" placeholder="sha256…"></div><div id="verifyResult" class="small-copy" style="margin-top:12px"></div>','<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="verify-document">تحقق الآن</button>');
}

async function verifyDocument(){
  const code=($('#verifyCode')?.value||'').trim().toLowerCase();
  const mount=$('#verifyResult');
  if(!/^[a-f0-9]{64}$/.test(code)){if(mount)mount.innerHTML='<span style="color:#8b3a3a">رمز غير صالح — يلزم 64 محرفاً سداسياً.</span>';return;}
  try{
    const result=await api('/api/documents/verify/'+encodeURIComponent(code));
    if(mount){
      mount.innerHTML=result.valid
        ?'<div class="risk-note" style="border-color:#3E5A3F;background:#e8ebe0"><strong>✓ المستند سليم</strong><br>الشكوى: <b dir="ltr">'+esc(result.id||'')+'</b><br>تاريخ الإصدار: '+esc(timeText(result.issuedAt))+'<br>سلسلة التدقيق: '+(result.chainValid?'سليمة':'تحذير')+'</div>'
        :'<div class="risk-note"><strong>✗ المستند غير مطابق أو سلسلة التدقيق مكسورة</strong></div>';
    }
    toast(result.valid?'التحقق ناجح.':'فشل التحقق.','warn');
  }catch(error){
    if(mount)mount.innerHTML='<span style="color:#8b3a3a">'+esc(error.message)+'</span>';
    toast(error.message,'error');
  }
}

async function runAuditIntegrityCheck(){
  const mount=$('#integrityCert');
  if(mount)mount.innerHTML='<p class="small-copy">جاري الفحص…</p>';
  try{
    const [audit,health]=await Promise.all([
      api('/api/audit/verify'),
      api('/api/health/metrics').catch(()=>({status:'partial'}))
    ]);
    if(mount){
      const ok=audit.ok===true;
      mount.innerHTML='<div class="risk-note" style="'+(ok?'border-color:#3E5A3F;background:#e8ebe0':'')+'">'
        +'<strong>'+(ok?'✓ شهادة نزاهة: سلسلة التدقيق سليمة 100%':'✗ تحذير: خلل في سلسلة التدقيق')+'</strong>'
        +'<br>أحداث مفحوصة: '+(audit.checked??'—')
        +'<br>رأس السلسلة: <span dir="ltr">'+esc((audit.chainTip||'').slice(0,16))+(audit.chainTip?'…':'—')+'</span>'
        +(health.integrity?'<br>سلامة SQLite: '+esc(health.integrity):'')
        +(health.counts?'<br>شكاوى: '+health.counts.complaints+' · أحداث تدقيق: '+health.counts.audit_events:'')
        +'</div>';
    }
    toast(audit.ok?'فحص النزاهة ناجح.':'فشل فحص النزاهة.',audit.ok?'':'error');
    return audit;
  }catch(error){
    if(mount)mount.innerHTML='<span style="color:#8b3a3a">'+esc(error.message)+'</span>';
    return toast(error.message,'error');
  }
}

function printComplaintCover(id){
  const c=db.complaints.find(x=>x?.id===id);
  if(!c)return toast('الشكوى غير موجودة.','error');
  const w=window.open('','_blank');
  if(!w)return toast('اسمح بالنوافذ المنبثقة.','warn');
  w.opener=null;
  w.onload=()=>w.print();
  const refs=(c.referrals||[]).map(r=>esc(r.entity||r.to||'—')).join('، ')||'—';
  const att=(c.attachments||[]).length;
  const st=typeof statusLabel==='function'?statusLabel(c.status):c.status;
  const pr=typeof priorityLabel==='function'?priorityLabel(c.priority):c.priority||'—';
  const dt=typeof dateText==='function'?dateText(c.created):c.created||'—';
  w.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>غلاف · '+esc(c.id)+'</title>'+
  '<style>@page{size:A4;margin:16mm}body{font-family:"Thmanyah Sans","ThmanyahSans","Cairo","Noto Sans Arabic",Tahoma,Arial,sans-serif;color:#0F1F17;line-height:1.75}'+
  '.header{text-align:center;margin-bottom:24px}.header h1{font-size:20px;margin:0;color:#1E3A2E}'+
  '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;margin:20px 0}'+
  '.label{font-size:11px;color:#3D4337}.value{font-size:14px;font-weight:700}'+
  '.subject{margin:18px 0;padding:14px;border:1px solid #b8bda8;border-radius:10px;background:#f7f8f2}'+
  '.foot{margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#3D4337}'+
  '.sig{margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:24px}'+
  '.sig div{border-top:1px solid #b8bda8;padding-top:8px;text-align:center}</style></head><body>'+
  '<div class="header"><h1>ملف شكوى</h1><p>نظام إدارة الشكاوى والاستفسارات</p></div>'+
  '<div class="grid">'+
  '<div><div class="label">رقم الشكوى</div><div class="value" dir="ltr">'+esc(c.id)+'</div></div>'+
  '<div><div class="label">الحالة</div><div class="value">'+esc(st)+'</div></div>'+
  '<div><div class="label">تاريخ التسجيل</div><div class="value">'+esc(dt)+'</div></div>'+
  '<div><div class="label">الأولوية</div><div class="value">'+esc(pr)+'</div></div>'+
  '<div><div class="label">صاحب الشكوى</div><div class="value">'+esc(c.name||'—')+'</div></div>'+
  '<div><div class="label">الجهة المختصة</div><div class="value">'+esc(c.entity||'—')+'</div></div>'+
  '<div><div class="label">التصنيف / الطبيعة</div><div class="value">'+esc((c.category||'—')+' / '+(c.nature||'—'))+'</div></div>'+
  '</div>'+
  '<div class="subject"><div class="label">الموضوع</div><div class="value">'+esc(c.summary||'—')+'</div>'+
  '<p style="margin:10px 0 0;font-size:13px;font-weight:400">'+esc((c.details||'').slice(0,800))+'</p></div>'+
  '<div class="grid"><div><div class="label">الإحالات</div><div class="value">'+refs+'</div></div>'+
  '<div><div class="label">عدد المرفقات</div><div class="value">'+att+'</div></div></div>'+
  '<div class="sig"><div>توقيع المستلم</div><div>التوقيع</div></div>'+
  '<div class="foot"><span>تاريخ الطباعة: '+esc(new Date().toLocaleString('ar-IQ'))+'</span><span dir="ltr">'+esc(c.id)+'</span></div>'+
  '</body></html>');
  w.document.close();
  toast('تم فتح غلاف الشكوى للطباعة.');
}

function complaintRecordActions(c,withView=true){
 const action=(label,name,extra='')=>'<button type="button" class="btn btn-sm '+extra+'" data-action="'+name+'" data-id="'+esc(c.id)+'">'+label+'</button>';
 let html=withView?action('عرض','detail'):'';
 if(uiCan('complaints.update')&&!c.archivedAt&&!['closed','cancelled'].includes(c.status))html+=action('تعديل','edit-complaint');
 if(withView)html+=action('طباعة','print-complaint-cover','btn-print');
 return html+action('المزيد','complaint-more');
}
function complaintActionsModal(id){
 const c=db.complaints.find(item=>item.id===id);if(!c)return;
 const action=(label,name,kind='')=>'<button type="button" class="btn '+kind+'" data-action="'+name+'" data-id="'+esc(c.id)+'">'+label+'</button>';
 let body='<section class="record-action-group"><h3>إدارة السجل</h3><div class="record-action-buttons">'+(uiCan('complaints.create')?action('تسجيل سجل جديد','new-complaint'):'')+(uiCan('complaints.update')&&!c.archivedAt?action('تعديل السجل','edit-complaint')+action('موعد مراجعة وتذكير','set-reminder'):'')+(uiCan('settings.manage')?action('تعديل خيارات التسجيل','intake-settings'):'')+'</div></section>';
 body+='<section class="record-action-group"><h3>الطباعة والتصدير</h3><div class="record-action-buttons">'+action('طباعة الشكوى','print-complaint-cover','btn-print');
 if(uiCan('export.xlsx')&&!c.archivedAt)body+=action('تصدير PDF','export-complaint-pdf')+action('تصدير Word','export-complaint-word');
 body+='</div></section>';
 if(uiCan('complaints.create')||uiCan('complaints.update'))body+='<section class="record-action-group"><h3>إنشاء نسخة</h3><div class="record-action-buttons">'+action('نسخ إلى شكوى جديدة','copy-complaint','btn-copy')+'</div></section>';
 if(uiCan('approvals.request')&&!c.archivedAt)body+='<section class="record-action-group"><h3>الأرشفة</h3><p class="small-copy">يحتاج الحذف من السجل النشط إلى تأكيدك مع توثيق السبب.</p><div class="record-action-buttons">'+action('حذف من السجل النشط','request-complaint-delete','btn-danger')+'</div></section>';
 modal('إجراءات السجل',esc(c.id)+' · '+esc(c.summary||''),body,'<button type="button" class="btn" data-action="close-modal">إغلاق</button>');
}
function requestComplaintDeletion(id){
 const c=db.complaints.find(item=>item.id===id);
 if(!c||c.archivedAt||!uiCan('approvals.request'))return toast('لا تملك صلاحية طلب حذف هذه الشكوى.','error');
 approvalRequestModal('complaint_archive',id);
 const description=$('#modalDescription');if(description)description.textContent='حذف الشكوى من السجل النشط يتطلب تأكيدك مع توثيق السبب، مع الاحتفاظ بالأدلة في الأرشيف.';
}
async function exportComplaintDocument(id,format){
 if(!uiCan('export.xlsx'))return toast('لا تملك صلاحية تصدير هذه الشكوى.','error');
 if(!['pdf','docx'].includes(format))return;
 try{
  await flushUiBeforeAction();
  const response=await fetch('/api/export/'+format+'/'+encodeURIComponent(id),{credentials:'same-origin'});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'تعذر إنشاء الملف.');}
  const blob=await response.blob();if(!blob.size)throw new Error('الملف الناتج فارغ.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='شكوى-'+id+'.'+format;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);toast('تم تصدير الشكوى '+(format==='docx'?'Word':'PDF')+'.');
 }catch(error){return toast(error.message||'تعذر تصدير الشكوى.','error');}
}

async function copyComplaint(id){
  const c=db.complaints.find(x=>x?.id===id);
  if(!c)return toast('الشكوى غير موجودة.','error');
  if(!uiCan('complaints.create')&&!uiCan('complaints.update'))
    return toast('لا تملك صلاحية إنشاء شكوى.','error');
  const body={
    name:c.name||'',
    firstContactDate:c.firstContactDate||null,
    phone:c.phone||'',
    province:c.province||'غير محددة',
    category:c.category||'غير مصنفة',
    nature:c.nature||'',
    entity:c.entity||'',
    priority:c.priority||'normal',
    summary:(c.summary||'')+(c.summary&&!String(c.summary).includes('(نسخة)')?' (نسخة)':''),
    details:c.details||'',
    source:c.source||'phone',
    recordType:recordTypeOf(c),
    relatedToCurrent:c.relatedToCurrent,
    asDraft:true
  };
  try{
    if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
    await persistQueue;
    const response=await api('/api/complaints',{method:'POST',body:JSON.stringify(body)});
    const stored=await api('/api/state');
    db=stored.state||cleanState();
    stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:(response.revision||stateRevision);
    stateConflict=false;stateLoaded=true;
    const newId=response.id||response.complaint?.id||(db.complaints[0]&&db.complaints[0].id);
    toast('تم إنشاء نسخة مسودة من الشكوى.');
    if(newId) detailModal(newId);
    else {page='complaints';render();}
  }catch(error){
    return toast(error.message||'تعذر نسخ الشكوى.','error');
  }
}

// Freeze the exact filtered population reviewed by the user, including all pages.
let registryExportSnapshot = null;
async function previewRegistryExport(format, ids){
  if(!['csv','xlsx','pdf'].includes(format)||!uiCan(format==='csv'?'export.csv':'export.xlsx'))
    return toast('لا تملك صلاحية تصدير هذا النوع.','error');
  const visible=page==='complaints'?filteredComplaints():db.complaints.filter(c=>!c.archivedAt);
  const rows=Array.isArray(ids)?visible.filter(c=>ids.includes(c.id)):visible;
  if(!rows.length){toast('لا توجد سجلات ضمن النطاق المطلوب للتصدير.','warn');return false;}
  if(rows.length>5000){toast('ضيّق المرشحات إلى 5000 سجل أو أقل ثم أعد التصدير.','warn');return false;}
  const snapshot={format,ids:rows.map(c=>c.id),includeArchived:rows.some(c=>c.archivedAt)};
  registryExportSnapshot=snapshot;
  const ok=await confirmDialog({title:'مراجعة التصدير '+format.toUpperCase(),
    message:'سيُصدّر '+rows.length+' سجلًا '+(Array.isArray(ids)?'من المحدد المطابق للمرشحات.':'وفق المرشحات الحالية، من جميع الصفحات.'),
    records:rows.slice(0,5).map(c=>({id:c.id,summary:c.summary})),
    detail:'يتضمن الملف بيانات التواصل. احفظه في مكان خاص. المعاينة تعرض أول خمسة سجلات.',confirmLabel:'إنشاء الملف'});
  // The dialog stays readable with long Arabic subjects and mixed-direction IDs.
  if(!ok||registryExportSnapshot!==snapshot){if(registryExportSnapshot===snapshot)registryExportSnapshot=null;return false;}
  registryExportSnapshot=null;
  await flushUiBeforeAction();
  const response=await fetch('/api/export/'+format+'/selection',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-CSRF-Token':await getWriteCsrf()},
    body:JSON.stringify({ids:snapshot.ids,includeArchived:snapshot.includeArchived})});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'تعذر إنشاء الملف. أعد المحاولة.');}
  const blob=await response.blob();if(!blob.size)throw new Error('ملف التصدير فارغ. أعد المحاولة.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='complaints-registry-'+workDayKey(Date.now())+'.'+format;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);toast('تم تصدير السجلات التي راجعتها.');
}
