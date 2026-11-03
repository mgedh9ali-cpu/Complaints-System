document.addEventListener('click',async e=>{const nav=e.target.closest('[data-page]');if(nav){go(nav.dataset.page);return;}const goto=e.target.closest('[data-goto]');if(goto){go(goto.dataset.goto);return;}const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action,id=el.dataset.id;
try {
switch(a){
case 'close-modal':closeModal();break;
case 'new-complaint':newComplaint();break;
case 'save-complaint':createComplaint();break;
case 'save-incomplete':createComplaint(true);break;
case 'detail':recentComplaintIds=[id,...recentComplaintIds.filter(x=>x!==id)].slice(0,8);detailModal(id);break;
case 'detail-back':go(detailReturnPage==='complaint-detail'?'complaints':detailReturnPage);break;
case 'clear-filters':searchText='';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';quickView='all';render();break;
case 'filter-late':quickView='late';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'filter-missing':quickView='missing';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'my-complaints':quickView='mine';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'urgent-no-reply':quickView='urgent-no-reply';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'quick-filter':quickView=el.dataset.value||'all';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';render();break;
case 'registry-next':registryPage++;render();break;
case 'registry-prev':registryPage=Math.max(1,registryPage-1);render();break;
case 'add-setting':addSetting(validSettingType(el.dataset.type)?el.dataset.type:'categories');break;
case 'add-category':addSetting('categories');break;
case 'edit-setting':addSetting(el.dataset.type,el.dataset.value);break;
case 'delete-setting':await deleteSetting(el.dataset.type,el.dataset.value);break;
case 'clear-setting-type':await clearSettingType(el.dataset.type);break;
case 'restore-settings':await restoreDefaultSettings(el.dataset.type||'all');break;
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
  await persistUiNow();closeModal();render();toast(mode==='edit'?'تم تعديل الخيار.':'تمت إضافة الخيار إلى القائمة.');break;
}
case 'edit-complaint':editComplaintModal(id);break;
case 'save-complaint-edit':saveComplaintEdit(id);break;
case 'change-status':changeStatus(id);break;
default:break;
}
}catch(error){toast('لم يُحفظ الإجراء: '+error.message,'error');}
});
document.addEventListener('input',e=>{if(e.target.id==='complaintSearch'){if(e.isComposing)return;searchText=e.target.value;registryPage=1;render();}if(['cName','cPhone','cSummary'].includes(e.target.id))duplicateCheck();if(['cName','cPhone','cSummary','cDetails'].includes(e.target.id))saveComplaintDraft();});
document.addEventListener('change',e=>{if(['cProvince','cCategory','cNature','cEntity','cPriority','cOwner'].includes(e.target.id))saveComplaintDraft();if(e.target.id==='statusFilter'){statusFilter=e.target.value;registryPage=1;render();}if(e.target.id==='priorityFilter'){priorityFilter=e.target.value;registryPage=1;render();}if(e.target.id==='categoryFilter'){categoryFilter=e.target.value;registryPage=1;render();}if(e.target.id==='natureFilter'){natureFilter=e.target.value;registryPage=1;render();}});
})();
