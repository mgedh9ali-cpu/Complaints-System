  (async()=>{try{const active=el.dataset.active==='true';await api('/api/users/'+encodeURIComponent(el.dataset.userId)+'/active',{method:'PATCH',body:JSON.stringify({active})});toast(active?'تم تفعيل الحساب.':'تم تعطيل الحساب.');await refreshManagedUsers();}
    catch(error){toast(error.message,'error');}})();break;}
case 'export-csv':exportCsv();break;
case 'print-report':window.print();break;
}
});
document.addEventListener('input',e=>{if(e.target.id==='complaintSearch'){searchText=e.target.value;const pos=e.target.selectionStart;render();const input=$('#complaintSearch');input.focus();input.setSelectionRange(pos,pos);}if(['cPhone','cSummary'].includes(e.target.id))duplicateCheck();if(e.target.id==='cPhone'){const cleaned=e.target.value.replace(/[^\d+ ()-]/g,'');if(cleaned!==e.target.value)e.target.value=cleaned;}if(['cName','cPhone','cSummary','cDetails'].includes(e.target.id))saveComplaintDraft();}
);
document.addEventListener('change',e=>{if(['cProvince','cCategory','cEntity','cPriority','cOwner'].includes(e.target.id))saveComplaintDraft();if(e.target.id==='statusFilter'){statusFilter=e.target.value;render();}if(e.target.id==='priorityFilter'){priorityFilter=e.target.value;render();}if(e.target.classList.contains('row-check')){if(e.target.checked)selectedIds.add(e.target.dataset.id);else selectedIds.delete(e.target.dataset.id);render();}if(e.target.id==='replyTemplate'){const i=e.target.value;if(i==='')return;const t=db.templates[Number(i)];if(t){const c=db.complaints.find(x=>x.id===currentId);$('#replyText').value=t.text.replaceAll('{{رقم_الشكوى}}',c?.id||'').replaceAll('{{الجهة}}',c?.entity||'الجهة المختصة').replaceAll('{{التصنيف}}',c?.category||'التصنيف');}}if(e.target.id==='bulkType'){const v=$('#bulkValue');if(v){v.innerHTML=(e.target.value==='assign'?['مها العلي','خالد منصور','سليم عمر','وسيم صالح','مستخدم تجريبي']:['urgent','high','normal']).map(x=>'<option value="'+x+'">'+(e.target.value==='assign'?x:priorityLabel(x))+'</option>').join('');}}});
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
api('/api/auth/me').then(async result=>{authenticatedUser=result.user;const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;stateConflict=false;stateLoaded=true;updateSignedInUi();render();refreshManagedUsers();}).catch(()=>{showLogin();});
})();
