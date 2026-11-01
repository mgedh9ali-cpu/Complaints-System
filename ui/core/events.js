document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav){go(nav.dataset.page);return;}const goto=e.target.closest('[data-goto]');if(goto){go(goto.dataset.goto);return;}const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action,id=el.dataset.id;
switch(a){
case 'database-backup':{
  (async()=>{try{
    el.disabled=true;el.textContent='جارٍ تجهيز النسخة…';
    const response=await fetch('/api/backup/complete',{credentials:'same-origin'});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'تعذر إنشاء النسخة الاحتياطية.');}
    const blob=await response.blob();if(!blob.size)throw new Error('الملف الناتج فارغ؛ لم تُنزّل نسخة احتياطية.');
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    const disposition=response.headers.get('Content-Disposition')||'';
    const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||('complaints-complete-'+new Date().toISOString().slice(0,10)+'.csb');
    link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast('تم تنزيل نسخة مشفّرة تشمل قاعدة البيانات والمرفقات. احتفظ بملف الإعدادات وسر النسخ الاحتياطي بعيداً عن النسخة.');
  }catch(error){toast(error.message,'error');}finally{el.disabled=false;el.textContent='نسخ احتياطي';}})();break;}
case 'sync-export':{
  (async()=>{try{
    const response=await fetch('/api/sync/export',{credentials:'same-origin'});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'تعذر التصدير.');}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='complaints-sync-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
    toast('تم إنشاء ملف المزامنة؛ انقله يدويًا إلى النسخة الأخرى.');
  }catch(error){toast(error.message,'error');}})();break;}
case 'sync-import':$('#syncImportFile')?.click();break;
case 'close-modal':closeModal();break;
case 'backdrop-close':if(e.target===el)closeModal();break;
case 'new-complaint':newComplaint();break;
case 'save-complaint':createComplaint();break;
case 'detail':detailModal(id);break;
case 'detail-back':go(detailReturnPage==='complaint-detail'?'complaints':detailReturnPage);break;
case 'detail-section':{
 const target=document.getElementById(el.dataset.target);
 if(target){target.scrollIntoView({behavior:'smooth',block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
 break;
}
case 'change-status':changeStatus(id);break;
case 'assign-owner':assignOwner(id);break;
case 'change-priority':changePriority(id);break;
case 'add-note':addNote(id);break;
case 'save-note':saveNote(id);break;
case 'new-referral':newReferralGlobal();break;
case 'referral-create':newReferral(id);break;
case 'save-referral':saveReferral(id);break;
case 'referral-next':{const v=$('#refComplaint')?.value;closeModal();if(v)newReferral(v);break;}
case 'survey':surveyModal(id);break;
case 'save-survey':saveSurvey(id);break;
case 'new-reply':newReply();break;
case 'reply-create':replyEditor(id);break;
case 'reply-next':{const v=$('#replyComplaint')?.value;closeModal();if(v)replyEditor(v);break;}
case 'save-reply':saveReply(id);break;
case 'reply-review':replyAction(id,a);render();break;
case 'reply-approve':replyAction(id,a);render();break;
case 'reply-sent':replyAction(id,a);render();break;
case 'read-all':db.notifications.forEach(n=>n.read=true);persist();render();toast('تم تحديد الإشعارات كمقروءة.');break;
case 'read-notice':{const n=db.notifications.find(n=>String(n.id)===String(id));if(n)n.read=true;persist();render();break;}
case 'filter-late':quickView='late';statusFilter='all';priorityFilter='all';searchText='';go('complaints');break;
case 'filter-missing':quickView='missing';statusFilter='all';priorityFilter='all';searchText='';go('complaints');break;
case 'clear-filters':searchText='';statusFilter='all';priorityFilter='all';quickView='all';render();break;
case 'quick-filter':quickView='all';statusFilter=el.dataset.value||'all';searchText='';render();break;
case 'my-complaints':quickView='mine';statusFilter='all';priorityFilter='all';searchText='';go('complaints');break;
case 'urgent-no-reply':quickView='urgent-no-reply';statusFilter='all';priorityFilter='all';searchText='';go('complaints');break;
case 'bulk-open':bulkOpen();break;
case 'bulk-assign':bulkOpen();if($('#bulkType')){$('#bulkType').value='assign';$('#bulkType').dispatchEvent(new Event('change',{bubbles:true}));}break;
case 'bulk-priority':bulkOpen();if($('#bulkType')){$('#bulkType').value='priority';$('#bulkType').dispatchEvent(new Event('change',{bubbles:true}));}break;
case 'clear-selection':selectedIds.clear();render();break;
case 'select-all':{const checks=$$('.row-check');if(el.checked)checks.forEach(c=>selectedIds.add(c.dataset.id));else selectedIds.clear();render();break;}
case 'bulk-confirm':{const type=$('#bulkType').value,value=$('#bulkValue').value;modal('تأكيد الإجراء الجماعي','مراجعة أخيرة قبل التطبيق','<div class="risk-note">سيتم تطبيق «'+esc(type==='assign'?'تغيير المسؤول':'تغيير الأولوية')+'» على '+selectedIds.size+' سجلات. هذه العملية لا يمكن التراجع عنها تلقائيًا في النموذج.</div><p style="font-size:12px">القيمة المحددة: <strong>'+esc(value)+'</strong></p>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="bulk-apply" data-type="'+type+'" data-value="'+esc(value)+'">تأكيد التطبيق</button>');break;}
case 'bulk-apply':{const type=el.dataset.type,value=el.dataset.value;if(!confirm('تأكيد نهائي لتطبيق الإجراء على '+selectedIds.size+' سجلات؟'))return;for(const cid of selectedIds){const c=db.complaints.find(x=>x.id===cid);if(!c)continue;if(type==='assign'){c.owner=value;logEvent(c,'إسناد جماعي','تم إسناد السجل إلى '+value+'.');}else{c.priority=value;logEvent(c,'تغيير أولوية جماعي','تم تغيير الأولوية إلى '+priorityLabel(value)+'.');}}selectedIds.clear();persist();closeModal();render();toast('تم تطبيق الإجراء الجماعي.');break;}
case 'add-setting':addSetting(validSettingType(el.dataset.type)?el.dataset.type:'categories');break;
case 'add-category':addSetting('categories');break;
case 'add-entity':addSetting('entities');break;
case 'edit-setting':addSetting(el.dataset.type,el.dataset.value);break;
case 'delete-setting':deleteSetting(el.dataset.type,el.dataset.value);break;
case 'clear-setting-type':clearSettingType(el.dataset.type);break;
case 'restore-settings':restoreDefaultSettings(el.dataset.type||'all');break;
case 'save-setting':{
  const type=el.dataset.type,mode=el.dataset.mode||'create',value=$('#settingValue')?.value.trim(),description=$('#settingDescription')?.value.trim()||'';
  if(!validSettingType(type))return toast('نوع القائمة غير صالح.','error');ensureManagedSettings();if(!value)return toast('أدخل الاسم أولًا.','warn');
  const original=el.dataset.original||'',entries=settingEntries(type);
  if(entries.some(item=>item.label.toLocaleLowerCase()===value.toLocaleLowerCase()&&!(mode==='edit'&&item.value===original)))return toast('هذا الاسم موجود بالفعل في القائمة.','warn');
  if(type==='priorities'){
    if(mode==='edit'){const entry=db.settings.priorities.find(x=>x.value===original);if(!entry)return toast('تعذر العثور على الأولوية.','error');entry.label=value;}
    else db.settings.priorities.push({value:'custom-'+Date.now().toString(36),label:value});
  }else{
    const key=settingDescriptionKey(type);if(key)db.settings[key] ||= {};
    if(mode==='edit'){const index=db.settings[type].indexOf(original);if(index<0)return toast('تعذر العثور على القيمة المراد تعديلها.','error');db.settings[type][index]=value;if(key)delete db.settings[key][original];}
    else db.settings[type].push(value);
    if(key){if(description)db.settings[key][value]=description;else delete db.settings[key][value];}
  }
  persist();closeModal();render();toast(mode==='edit'?'تم تعديل الخيار.':'تمت إضافة الخيار إلى القائمة.');break;
}
case 'archive-setting':archiveSetting(el.dataset.type,el.dataset.value);break;
case 'save-sla':{const days=Number($('#slaDays').value);if(!Number.isInteger(days)||days<1||days>365)return toast('أدخل مدة بين يوم و365 يومًا.','warn');db.settings.slaDays=days;db.settings.slaApproved=$('#slaApproved').checked;persist();render();toast(db.settings.slaApproved?'تم تفعيل مهلة المتابعة.':'حُفظت المدة دون تفعيل مؤشر التأخير.','warn');break;}
case 'refresh-local-users':refreshManagedUsers();break;
case 'create-local-user':{
  (async()=>{const username=$('#newLocalUsername')?.value.trim(),password=$('#newLocalPassword')?.value,role=$('#newLocalRole')?.value;
    if(!username||!password)return toast('أدخل اسم المستخدم وكلمة المرور.','warn');
    try{const result=await api('/api/users',{method:'POST',body:JSON.stringify({username,password,role})});$('#localUserForm')?.reset();toast('تم إنشاء الحساب '+result.user.username+'.');await refreshManagedUsers();}
    catch(error){toast(error.message,'error');}})();break;}
case 'toggle-local-user':{
  (async()=>{try{const active=el.dataset.active==='true';await api('/api/users/'+encodeURIComponent(el.dataset.userId)+'/active',{method:'PATCH',body:JSON.stringify({active})});toast(active?'تم تفعيل الحساب.':'تم تعطيل الحساب.');await refreshManagedUsers();}
    catch(error){toast(error.message,'error');}})();break;}
case 'export-csv':exportCsv();break;
case 'print-report':window.print();break;
}
});
document.addEventListener('input',e=>{if(e.target.id==='complaintSearch'){if(e.isComposing)return;searchText=e.target.value;const start=e.target.selectionStart,end=e.target.selectionEnd;render();const input=$('#complaintSearch');if(input){input.focus({preventScroll:true});if(start!==null&&end!==null)input.setSelectionRange(start,end);}}if(['cPhone','cSummary'].includes(e.target.id))duplicateCheck();if(e.target.id==='cPhone'){const cleaned=e.target.value.replace(/[^\d+ ()-]/g,'');if(cleaned!==e.target.value)e.target.value=cleaned;}if(['cName','cPhone','cSummary','cDetails'].includes(e.target.id))saveComplaintDraft();}
);
document.addEventListener('compositionend',e=>{if(e.target.id==='complaintSearch')e.target.dispatchEvent(new Event('input',{bubbles:true}));});
document.addEventListener('change',e=>{if(['cProvince','cCategory','cEntity','cPriority','cOwner'].includes(e.target.id))saveComplaintDraft();if(e.target.id==='statusFilter'){statusFilter=e.target.value;render();}if(e.target.id==='priorityFilter'){priorityFilter=e.target.value;render();}if(e.target.classList.contains('row-check')){if(e.target.checked)selectedIds.add(e.target.dataset.id);else selectedIds.delete(e.target.dataset.id);render();}if(e.target.id==='replyTemplate'){const i=e.target.value;if(i==='')return;const t=db.templates[Number(i)];if(t){const c=db.complaints.find(x=>x.id===currentId);$('#replyText').value=t.text.replaceAll('{{رقم_الشكوى}}',c?.id||'').replaceAll('{{الجهة}}',c?.entity||'الجهة المختصة').replaceAll('{{التصنيف}}',c?.category||'التصنيف');}}if(e.target.id==='bulkType'){const v=$('#bulkValue');if(v){v.innerHTML=(e.target.value==='assign'?['مها العلي','خالد منصور','سليم عمر','وسيم صالح',authenticatedUser?.username].filter(Boolean).filter((n,i,a)=>a.indexOf(n)===i):['urgent','high','normal']).map(x=>'<option value="'+x+'">'+(e.target.value==='assign'?x:priorityLabel(x))+'</option>').join('');}}});
document.addEventListener('keydown',e=>{const root=$('#modalRoot');if(root.dataset.open&&e.key==='Tab'){const dlg=$('.modal',root);const items=modalFocusables(dlg);if(!items.length){e.preventDefault();dlg.focus();return;}const first=items[0],last=items[items.length-1];if(e.shiftKey&&(document.activeElement===first||!dlg.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dlg.contains(document.activeElement))){e.preventDefault();first.focus();}}if(e.key==='Escape'&&root.dataset.open){closeModal();return;}if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();go('complaints');setTimeout(()=>$('#complaintSearch')?.focus(),0);}if(e.altKey&&e.key.toLowerCase()==='n'){e.preventDefault();newComplaint();}});
$('#menuToggle').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open');$('#menuToggle').setAttribute('aria-expanded',String(open));});
$('#syncImportFile')?.addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>950*1024)throw new Error('حجم الملف يتجاوز الحد المسموح.');
    const payload=JSON.parse(await file.text());
    if(!confirm('سيستبدل الاستيراد بيانات الشكاوى الحالية. هل أخذت نسخة احتياطية وتريد المتابعة؟'))return;
    const result=await api('/api/sync/import',{method:'POST',body:JSON.stringify(payload)});
    const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;stateConflict=false;stateLoaded=true;render();
    toast(result.updateStaged
      ? 'استوردت البيانات؛ حزمة البرنامج الموقعة محفوظة للمراجعة ولم تُطبّق تلقائيًا.'
      : 'استوردت البيانات فقط؛ لم تُحفظ ملفات البرنامج لأن التوقيع الموثوق غير صالح أو غير موجود.',
      'warn');
  }catch(error){toast(error.message,'error');}finally{event.target.value='';}
});
$('#logoutButton')?.addEventListener('click',logout);
updateSignedInUi();
render();
api('/api/auth/me').then(async result=>{authenticatedUser=result.user;const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;stateConflict=false;stateLoaded=true;updateSignedInUi();restoreUiRoute();render();refreshManagedUsers();}).catch(()=>{showLogin();});
})();
