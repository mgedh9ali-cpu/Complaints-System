/* Document print / verify — approved replies and intake receipts with integrity codes. */

async function printApprovedReply(id){
  const c=db.complaints.find(x=>x?.id===id);
  if(!c?.reply||!['approved','sent'].includes(c.reply.status))
    return toast('يلزم رد معتمد قبل الطباعة.','warn');
  try{
    const proof=await api('/api/documents/reply/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({})});
    const w=window.open('','_blank','noopener,noreferrer');
    if(!w)return toast('اسمح بالنوافذ المنبثقة لطباعة المستند.','warn');
    const code=proof.code||proof.digest||'';
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>رد معتمد · ${esc(c.id)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:28px;color:#0F1F17;line-height:1.8}h1{color:#1E3A2E;font-size:18px;margin:0 0 8px}
.meta{color:#3D4337;font-size:12px;margin-bottom:18px}.box{border:1px solid #b8bda8;border-radius:12px;padding:16px;background:#f7f8f2;white-space:pre-wrap}
.foot{margin-top:28px;padding-top:12px;border-top:1px dashed #b8bda8;font-size:11px;color:#3D4337;word-break:break-all}
.stamp{display:inline-block;margin-top:12px;padding:6px 12px;border:2px solid #3E5A3F;color:#1E3A2E;border-radius:8px;font-weight:700}</style></head><body>
<h1>رد رسمي معتمد</h1>
<div class="meta">رقم الشكوى: <b dir="ltr">${esc(c.id)}</b> · المشتكي: ${esc(c.name||'—')} · التاريخ: ${esc(timeText(new Date().toISOString()))}</div>
<div class="box">${esc(c.reply.text||'')}</div>
<div class="stamp">معتمد · رمز تحقق</div>
<div class="foot">رمز التحقق (SHA-256): <span dir="ltr">${esc(code)}</span><br>أُصدر من نظام الشكاوى المحلي · يمكن التحقق من صفحة الإعدادات.</div>
<script>window.onload=()=>{window.print();}</script></body></html>`);
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
  }catch(error){toast(error.message,'error');}
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
    toast(audit.ok?'فحص النزاهة ناجح.':'فشل فحص النزاهة.','warn');
  }catch(error){
    if(mount)mount.innerHTML='<span style="color:#8b3a3a">'+esc(error.message)+'</span>';
    toast(error.message,'error');
  }
}
