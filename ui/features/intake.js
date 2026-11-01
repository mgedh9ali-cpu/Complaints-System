function newComplaint(){if(!authenticatedUser||authenticatedUser.role==='reviewer')return toast('لا تملك صلاحية إنشاء شكوى.','error');ensureManagedSettings();modal('تسجيل شكوى جديدة','نموذج سريع لتسجيل الشكوى أثناء المكالمة','<form id="newComplaintForm"><div class="risk-note">سيُنشأ رقم مرجعي عند الحفظ، وتُحفظ المسودة المؤقتة داخل جلسة العمل حتى إتمام التسجيل.</div><div class="form-grid">'+field('اسم المشتكي','cName','','text',false,'autocomplete="off"')+field('رقم الهاتف','cPhone','','tel',false,'autocomplete="off"')+selectField('المحافظة','cProvince',db.settings.provinces,'',true)+selectField('التصنيف','cCategory',db.settings.categories,'',true)+selectField('الجهة المختصة','cEntity',db.settings.entities,'',false)+selectField('الأولوية','cPriority',db.settings.priorities,'normal',true)+field('المسؤول الرئيسي','cOwner',authenticatedUser?.username||'')+'<div class="form-field full"><label for="cSummary">موضوع الشكوى</label><input class="field" id="cSummary" required maxlength="180" placeholder="ملخص واضح ومختصر"></div><div class="form-field full"><label for="cDetails">التفاصيل</label><textarea class="textarea-field" id="cDetails" placeholder="ملخص ما ذكره المتصل وما يلزم متابعته"></textarea></div><div class="form-field full" id="duplicateMount"></div></div></form>','<span class="small-copy">الحقول المطلوبة: المحافظة، التصنيف، موضوع الشكوى، الأولوية.</span><div class="right-actions"><button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-complaint">حفظ الشكوى</button></div>');restoreComplaintDraft();}
function saveComplaintDraft(){const form=$('#newComplaintForm');if(!form)return;const draft={};['cName','cPhone','cProvince','cCategory','cEntity','cPriority','cOwner','cSummary','cDetails'].forEach(id=>{const el=$('#'+id);if(el)draft[id]=el.value;});try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify(draft));}catch(e){}}
function restoreComplaintDraft(){try{const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null');if(!draft)return;Object.entries(draft).forEach(([id,value])=>{const el=$('#'+id);if(el&&typeof value==='string')el.value=value;});duplicateCheck();}catch(e){}}
function duplicateCheck(){const phone=phoneNorm($('#cPhone')?.value||''),text=norm($('#cSummary')?.value||'');const matches=db.complaints.filter(c=>(phone&&phone.length>=7&&phoneNorm(c.phone)===phone)||(text.length>=9&&norm(c.summary).includes(text)));const mount=$('#duplicateMount');if(!mount)return;mount.innerHTML=matches.length?'<div class="risk-note"><strong>احتمال تكرار:</strong> عُثر على '+matches.length+' سجل مشابه. راجع السجل قبل إنشاء شكوى جديدة.<div style="margin-top:8px">'+matches.slice(0,4).map(c=>'<button class="btn btn-sm" type="button" data-action="detail" data-id="'+esc(c.id)+'">'+esc(c.id)+' · '+esc(c.summary)+'</button>').join(' ')+'</div></div>':'';}
async function createComplaint(){
  const form=$('#newComplaintForm');
  if(!form||!form.reportValidity())return;
  const body={
    name:$('#cName').value.trim(),
    phone:phoneNorm($('#cPhone').value),
    province:$('#cProvince').value,
    category:$('#cCategory').value,
    entity:$('#cEntity').value,
    priority:$('#cPriority').value,
    owner:$('#cOwner').value.trim(),
    summary:$('#cSummary').value.trim(),
    details:$('#cDetails').value.trim()
  };
  const saveButton=$('[data-action="save-complaint"]');
  if(saveButton)saveButton.disabled=true;
  try{
    // Do not allow a queued snapshot to overwrite the newly created complaint.
    const hadPendingSave=Boolean(persistTimer);
    if(persistTimer){clearTimeout(persistTimer);persistTimer=null;}
    await persistQueue;
    if(hadPendingSave){
      const saved=await api('/api/state',{
        method:'PUT',
        headers:{'X-State-Revision':String(stateRevision)},
        body:JSON.stringify(db)
      });
      stateRevision=saved.revision;
    }
    const response=await api('/api/complaints',{
      method:'POST',
      body:JSON.stringify(body)
    });
    // Authoritative server state (including generated complaint ID and revision).
    const stored=await api('/api/state');
    db=stored.state||cleanState();
    stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:response.revision;
    stateConflict=false;
    stateLoaded=true;
    try{sessionStorage.removeItem(DRAFT_KEY);}catch(e){}
    closeModal();page='complaints';history.replaceState({view:'complaints'},'','#complaints');render();
    window.dispatchEvent(new CustomEvent('complaints:created',{
      detail:{id:response.complaint.id}
    }));
    toast('تم حفظ السجل '+response.complaint.id);
    if(!body.details||!body.name||!body.phone){
      notify('استكمال بيانات مطلوب',response.complaint.id+' · بعض بيانات السجل غير مكتملة.');
    }
  }catch(error){
    toast('تعذر حفظ الشكوى: '+error.message,'error');
  }finally{
    if(saveButton)saveButton.disabled=false;
  }
}
