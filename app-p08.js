document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav){go(nav.dataset.page);return;}const goto=e.target.closest('[data-goto]');if(goto){go(goto.dataset.goto);return;}const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action,id=el.dataset.id;
switch(a){
case 'database-backup':{
  (async()=>{try{
    el.disabled=true;el.textContent='جارٍ تجهيز النسخة…';
    const response=await fetch('/api/backup/database',{credentials:'same-origin'});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'تعذر إنشاء النسخة الاحتياطية.');}
    const blob=await response.blob();if(!blob.size)throw new Error('الملف الناتج فارغ؛ لم تُنزّل نسخة احتياطية.');
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    const disposition=response.headers.get('Content-Disposition')||'';
    const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||('complaints-database-backup-'+new Date().toISOString().slice(0,10)+'.sqlite');
    link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast('تم تنزيل نسخة احتياطية كاملة من قاعدة البيانات. احتفظ بها في مكان آمن.');
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
case 'detail':closeModal();detailModal(id);break;
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
case 'filter-late':statusFilter='all';searchText='';go('complaints');searchText='';const lateIds=lateComplaints().map(c=>c.id);$('#complaintSearch').value='';$$('tbody tr').forEach(tr=>{const t=tr.textContent;tr.style.display=lateIds.some(x=>t.includes(x))?'':'none';});toast('عُرضت السجلات المتأخرة في هذه الجلسة.');break;
case 'filter-missing':go('complaints');toast('راجع الحقول الأساسية في تفاصيل السجلات.');break;
case 'clear-filters':searchText='';statusFilter='all';priorityFilter='all';render();break;
case 'quick-filter':statusFilter=el.dataset.value||'all';searchText='';render();break;
case 'my-complaints':searchText='';statusFilter='all';render();$$('tbody tr').forEach(tr=>{tr.style.display=tr.textContent.includes('مستخدم تجريبي')?'':'none';});break;
case 'urgent-no-reply':searchText='';statusFilter='all';priorityFilter='urgent';render();$$('tbody tr').forEach(tr=>{const rowId=tr.querySelector('.ticket-id')?.textContent;const c=db.complaints.find(x=>x.id===rowId);tr.style.display=c&&c.priority==='urgent'&&!c.reply?'':'none';});break;
case 'bulk-open':bulkOpen();break;
case 'bulk-assign':bulkOpen();if($('#bulkType')){$('#bulkType').value='assign';$('#bulkType').dispatchEvent(new Event('change',{bubbles:true}));}break;
case 'bulk-priority':bulkOpen();if($('#bulkType')){$('#bulkType').value='priority';$('#bulkType').dispatchEvent(new Event('change',{bubbles:true}));}break;
case 'clear-selection':selectedIds.clear();render();break;
case 'select-all':{const checks=$$('.row-check');if(el.checked)checks.forEach(c=>selectedIds.add(c.dataset.id));else selectedIds.clear();render();break;}
case 'bulk-confirm':{const type=$('#bulkType').value,value=$('#bulkValue').value;modal('تأكيد الإجراء الجماعي','مراجعة أخيرة قبل التطبيق','<div class="risk-note">سيتم تطبيق «'+esc(type==='assign'?'تغيير المسؤول':'تغيير الأولوية')+'» على '+selectedIds.size+' سجلات. هذه العملية لا يمكن التراجع عنها تلقائيًا في النموذج.</div><p style="font-size:12px">القيمة المحددة: <strong>'+esc(value)+'</strong></p>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="bulk-apply" data-type="'+type+'" data-value="'+esc(value)+'">تأكيد التطبيق</button>');break;}
case 'bulk-apply':{const type=el.dataset.type,value=el.dataset.value;if(!confirm('تأكيد نهائي لتطبيق الإجراء على '+selectedIds.size+' سجلات؟'))return;for(const cid of selectedIds){const c=db.complaints.find(x=>x.id===cid);if(!c)continue;if(type==='assign'){c.owner=value;logEvent(c,'إسناد جماعي','تم إسناد السجل إلى '+value+'.');}else{c.priority=value;logEvent(c,'تغيير أولوية جماعي','تم تغيير الأولوية إلى '+priorityLabel(value)+'.');}}selectedIds.clear();persist();closeModal();render();toast('تم تطبيق الإجراء الجماعي تجريبيًا.');break;}
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
case 'save-sla':{const days=Number($('#slaDays').value);if(!Number.isInteger(days)||days<1||days>365)return toast('أدخل مدة بين يوم و365 يومًا.','warn');db.settings.slaDays=days;db.settings.slaApproved=$('#slaApproved').checked;persist();render();toast(db.settings.slaApproved?'فُعّلت المهلة في النموذج التجريبي فقط.':'حُفظت المدة دون تفعيل مؤشر التأخير.','warn');break;}
case 'refresh-local-users':refreshManagedUsers();break;
case 'create-local-user':{
  (async()=>{const username=$('#newLocalUsername')?.value.trim(),password=$('#newLocalPassword')?.value,role=$('#newLocalRole')?.value;
    if(!username||!password)return toast('أدخل اسم المستخدم وكلمة المرور.','warn');
    try{const result=await api('/api/users',{method:'POST',body:JSON.stringify({username,password,role})});$('#localUserForm')?.reset();toast('تم إنشاء الحساب '+result.user.username+'.');await refreshManagedUsers();}
    catch(error){toast(error.message,'error');}})();break;}
case 'toggle-local-user':{
