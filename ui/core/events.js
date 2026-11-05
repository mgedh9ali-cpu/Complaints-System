/* Events bootstrap — data-action switch and global listeners. */

async function withButtonLock(btn, fn) {
  if (!btn || btn.disabled || btn.classList.contains('is-loading')) return;
  const originalBusy = btn.getAttribute('aria-busy');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  let ok = false;
  try {
    const result = await fn();
    ok = true;
    return result;
  } finally {
    btn.classList.remove('is-loading');
    if (ok) {
      btn.classList.add('btn-success-pulse');
      btn.innerHTML = '<span class="btn-check" aria-hidden="true">✓</span> تم';
      window.setTimeout(() => {
        if (!document.contains(btn)) return;
        btn.classList.remove('btn-success-pulse');
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        if (originalBusy == null) btn.removeAttribute('aria-busy');
        else btn.setAttribute('aria-busy', originalBusy);
      }, 900);
    } else {
      btn.disabled = false;
      if (originalBusy == null) btn.removeAttribute('aria-busy');
      else btn.setAttribute('aria-busy', originalBusy);
    }
  }
}
window.withButtonLock = withButtonLock;

document.addEventListener('click',async e=>{
const destination=e.target.closest('[data-page]')||e.target.closest('[data-goto]');
if(destination){if(authenticatedUser)go(destination.dataset.page||destination.dataset.goto);return;}
const el=e.target.closest('[data-action]');
if(!el)return;
const a=el.dataset.action,id=el.dataset.id;
try{
switch(a){
case 'attachment-preview':{const url='/api/attachments/'+encodeURIComponent(el.dataset.file);modal('معاينة المرفق',esc(el.dataset.name),'<img class="attachment-viewer" src="'+url+'" alt="'+esc(el.dataset.name)+'">','<a class="btn" href="'+url+'" target="_blank" rel="noopener">فتح المرفق</a>');break;}
case 'glass-step':{const select=$('#detailStatus');if(select){select.value=el.dataset.status;updateReasonSheet();if(['closed','cancelled'].includes(select.value))$('#statusReason')?.focus();else changeStatus(currentId);}break;}
case 'referral-next':{const v=$('#refComplaint')?.value;closeModal();if(v)newReferral(v);break;}
case 'reply-next':{const v=$('#replyComplaint')?.value;closeModal();if(v)replyEditor(v);break;}
case 'bulk-assign':bulkOpen('assign');break;
case 'bulk-priority':bulkOpen('priority');break;
case 'select-all':{const checks=$$('.row-check');if(el.checked)checks.forEach(c=>selectedIds.add(c.dataset.id));else selectedIds.clear();render();break;}
case 'bulk-confirm':{const type=$('#bulkType').value,value=$('#bulkValue').value;modal('تأكيد الإجراء الجماعي','مراجعة أخيرة قبل التطبيق','<div class="risk-note">سيتم تطبيق «'+esc(type==='assign'?'تغيير المسؤول':'تغيير الأولوية')+'» على '+selectedIds.size+' سجلات. هذه العملية لا يمكن التراجع عنها تلقائيًا في النموذج.</div><p style="font-size:12px">القيمة المحددة: <strong>'+esc(value)+'</strong></p>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="bulk-apply" data-type="'+type+'" data-value="'+esc(value)+'">تأكيد التطبيق</button>');break;}
case 'bulk-apply':await applyRecoveredBulk(el.dataset.type,el.dataset.value);break;
case 'add-entity':addSetting('entities');break;
case 'archive-setting':await archiveSetting(el.dataset.type,el.dataset.value);break;
case 'edit-complaint':editComplaintModal(id);break;
case 'refresh-maintenance':refreshMaintenanceHealth();break;
case 'save-reminder-period':saveReminderPeriod();break;
case 'setup-two-factor':twoFactorPasswordModal();break;
case 'disable-two-factor':twoFactorPasswordModal(true);break;
case 'start-two-factor':startTwoFactor();break;
case 'confirm-two-factor':confirmTwoFactor();break;
case 'confirm-disable-two-factor':disableTwoFactor();break;
case 'finish-two-factor':closeModal();render();showLogin();break;
case 'refresh-audit':refreshAudit();break;
case 'verify-audit':verifyAudit();break;
case 'refresh-approvals':refreshApprovals();break;
case 'request-archive':approvalRequestModal('complaint_archive',id);break;
case 'submit-approval':submitApproval(el.dataset.kind,id,el.dataset.target,$('#approvalReason')?.value.trim());break;
case 'approval-decision':approvalDecisionModal(id,el.dataset.decision);break;
case 'save-approval-decision':saveApprovalDecision(id,el.dataset.decision);break;
case 'edit-user-permissions':editUserPermissions(id);break;
case 'save-user-permissions':saveUserPermissions(id);break;
case 'referral-response':referralResponseModal(id,Number(el.dataset.index));break;
case 'save-referral-response':saveReferralResponse(id,Number(el.dataset.index));break;
case 'propose-duplicate':duplicateProposalModal(id);break;
case 'submit-duplicate':submitApproval('complaint_duplicate',id,$('#duplicateOriginal')?.value,$('#approvalReason')?.value.trim());break;
case 'toggle-completion-reminder':saveDetailChange(id,c=>{c.completionReminderStopped=!c.completionReminderStopped;},'حُفظ إعداد تذكير الاستكمال.');break;
case 'save-collaborators':saveDetailChange(id,c=>{c.coAssistants=[...($('#coAssistants')?.selectedOptions||[])].map(o=>o.value);},'حُفظ المساعدون المشاركون.');break;
case 'create-local-user':{
  (async()=>{const username=$('#newLocalUsername')?.value.trim(),password=$('#newLocalPassword')?.value,role=$('#newLocalRole')?.value;
    if(!username||!password)return toast('أدخل اسم المستخدم وكلمة المرور.','warn');
    try{const result=await api('/api/users',{method:'POST',body:JSON.stringify({username,password,role})});$('#localUserForm')?.reset();toast('تم إنشاء الحساب '+result.user.username+'.');await refreshManagedUsers();}
    catch(error){toast(error.message,'error');}})();break;}
case 'toggle-local-user':{
  (async()=>{try{const active=el.dataset.active==='true';await api('/api/users/'+encodeURIComponent(el.dataset.userId)+'/active',{method:'PATCH',body:JSON.stringify({active})});toast(active?'تم تفعيل الحساب.':'تم تعطيل الحساب.');await refreshManagedUsers();}
    catch(error){toast(error.message,'error');}})();break;}

case 'conflict-save':resolveStateConflict();break;
case 'conflict-remote':resolveStateConflict(true);break;
case 'print-approved-reply':printApprovedReply(id);break;
case 'print-receipt':await withButtonLock(el,()=>printComplaintReceipt(id));break;
case 'print-complaint-cover':printComplaintCover(id);break;
case 'verify-document-dialog':verifyDocumentDialog();break;
case 'verify-document':await verifyDocument();break;
case 'audit-verify':await withButtonLock(el,()=>runAuditIntegrityCheck());break;
case 'database-backup':await withButtonLock(el,()=>runDatabaseBackup());break;
case 'backup-database-only':await withButtonLock(el,()=>runDatabaseOnlyBackup());break;
case 'show-update-help':showUpdateHelp();break;
case 'show-restore-guide':showRestoreGuide();break;
case 'refresh-protection-status':await withButtonLock(el,()=>refreshProtectionStatusAndRender());break;
case 'save-backup-settings':await withButtonLock(el,()=>saveBackupSettings());break;
case 'delete-backup-file':await withButtonLock(el,()=>deleteBackupFile(el.dataset.name));break;
case 'restore-wizard-start':restoreWizardStart(el.dataset.name||null);break;
case 'restore-wizard-step2':await withButtonLock(el,()=>restoreWizardStep2());break;
case 'restore-wizard-step4':restoreWizardStep4();break;
case 'restore-wizard-step5':await restoreWizardStep5();break;
case 'logout':await logout();break;
case 'read-notice':{
  const n=(db.notifications||[]).find(x=>String(x.id)===String(id));
  if(n){n.read=true;await persistUiNow();render();}
  break;
}
case 'set-reminder':openReminderModal(id);break;
case 'save-reminder':await withButtonLock(el,()=>submitReminder(id));break;
case 'alarm-dismiss':await dismissReminder(el.dataset.reminder);break;
case 'alarm-open':await dismissReminder(el.dataset.reminder);detailModal(id);break;
case 'command-open':commandPalette();break;
case 'command-page':closeModal();go(el.dataset.pageTarget);break;
case 'export-selected':exportSelected();break;
case 'close-modal':cancelPendingSyncImport?.();closeModal();break;
case 'backdrop-close':if(e.target===el){cancelPendingSyncImport?.();closeModal();}break;
case 'new-complaint':newComplaint();break;
case 'save-complaint':await withButtonLock(el,()=>createComplaint());break;
case 'save-incomplete':await withButtonLock(el,()=>createComplaint(true));break;
case 'detail':recentComplaintIds=[id,...recentComplaintIds.filter(x=>x!==id)].slice(0,8);detailModal(id);break;
case 'detail-section':{
 const section=document.getElementById(el.dataset.target||'');
 const article=$('.complaint-page');
 if(section&&article?.contains(section)){
  $$('.complaint-page-tabs button').forEach(button=>button.setAttribute('aria-pressed',String(button===el)));
  section.setAttribute('tabindex','-1');section.focus({preventScroll:true});
  section.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
 }
 break;
}
case 'detail-back':go(detailReturnPage==='complaint-detail'?'complaints':detailReturnPage);break;
case 'change-status':await withButtonLock(el,()=>changeStatus(id));break;
case 'assign-owner':await withButtonLock(el,()=>assignOwner(id));break;
case 'change-priority':changePriority(id);break;
case 'add-note':addNote(id);break;
case 'save-note':await withButtonLock(el,()=>saveNote(id));break;
case 'new-referral':newReferralGlobal();break;
case 'referral-create':newReferral(id);break;
case 'save-referral':await withButtonLock(el,()=>saveReferral(id));break;
case 'survey':surveyModal(id);break;
case 'save-survey':await withButtonLock(el,()=>saveSurvey(id));break;
case 'new-reply':newReply();break;
case 'reply-create':replyEditor(id);break;
case 'save-reply':await withButtonLock(el,()=>saveReply(id));break;
case 'reply-review':await withButtonLock(el,()=>replyAction(id,a));break;
case 'reply-approve':await withButtonLock(el,()=>replyAction(id,a));break;
case 'reply-sent':await withButtonLock(el,()=>replyAction(id,a));break;
case 'read-all':db.notifications.forEach(n=>n.read=true);await persistUiNow();render();toast('تم تحديد الإشعارات كمقروءة.');break;
case 'filter-late':quickView='late';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'filter-missing':quickView='missing';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'clear-filters':searchText='';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';dateTypeFilter='created';dateFrom='';dateTo='';quickView='all';registryPage=1;render();break;
case 'quick-filter':quickView=el.dataset.value||'all';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';render();break;
case 'my-complaints':quickView='mine';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'urgent-no-reply':quickView='urgent-no-reply';statusFilter='all';priorityFilter='all';categoryFilter='all';natureFilter='all';searchText='';go('complaints');break;
case 'bulk-open':bulkOpen();break;
case 'clear-selection':selectedIds.clear();render();break;
case 'report-period':setReportPeriod([14,30,90].includes(Number(el.dataset.days))?Number(el.dataset.days):0);break;
case 'export-csv':if(page==='reports')await withButtonLock(el,()=>exportReport('csv'));else exportCsv();break;
case 'export-xlsx':await withButtonLock(el,()=>exportXlsx());break;
case 'print-report':window.print();break;
case 'sync-import':$('#syncImportFile')?.click();break;
case 'sync-export':toast('استخدم تصدير المزامنة من لوحة الإعدادات مع عبارة مرور.','warn');break;
case 'confirm-sync-password':await confirmSyncPassword();break;
case 'restore-draft':restoreComplaintDraft(true);break;
case 'discard-draft':try{localStorage.removeItem(DRAFT_KEY);sessionStorage.removeItem(DRAFT_KEY);}catch(_){} $('#draftBanner')?.remove();toast('تم تجاهل المسودة.');break;
case 'add-setting':addSetting(el.dataset.type);break;
case 'edit-setting':addSetting(el.dataset.type,el.dataset.value);break;
case 'delete-setting':await deleteSetting(el.dataset.type,el.dataset.value);break;
case 'clear-setting-type':await clearSettingType(el.dataset.type);break;
case 'restore-settings':await restoreDefaultSettings(el.dataset.type||'all');break;
case 'save-setting':await withButtonLock(el,()=>saveSetting(el.dataset.type,el.dataset.mode,el.dataset.original));break;
case 'save-sla':await withButtonLock(el,()=>saveSlaSettings());break;
case 'add-category':addSetting('categories');break;
case 'change-password':passwordChangeModal();break;
case 'save-password-change':await withButtonLock(el,()=>savePasswordChange());break;
case 'refresh-local-users':await refreshManagedUsers();break;
case 'save-complaint-edit':await withButtonLock(el,()=>saveComplaintEdit(id));break;
case 'registry-prev':registryPage=Math.max(1,registryPage-1);render();break;
case 'registry-next':registryPage+=1;render();break;
}
}catch(error){toast('لم يُحفظ الإجراء: '+error.message,'error');}
});
document.addEventListener('submit',e=>{if(e.target.id==='reportFiltersForm'){e.preventDefault();applyReportFilters();}});
document.addEventListener('input',e=>{if(e.target.id==='commandQuery'){renderCommands(e.target.value);return;}if(e.target.id==='complaintSearch'){if(e.isComposing)return;searchText=e.target.value;registryPage=1;const start=e.target.selectionStart,end=e.target.selectionEnd;render();const input=$('#complaintSearch');if(input){input.focus({preventScroll:true});if(start!==null&&end!==null)input.setSelectionRange(start,end);}}if(['cName','cPhone','cSummary'].includes(e.target.id))duplicateCheck();if(['cName','cPhone','cSummary','cDetails'].includes(e.target.id))saveComplaintDraft();});
document.addEventListener('change',e=>{if(e.target.id==='bulkType'){updateBulkValues(e.target.value);return;}if(e.target.id==='paletteSelect'){window.setPalette?.(e.target.value);return;}if(e.target.id==='syncImportFile')return handleSyncImportChange(e.target);if(e.target.id==='assignOwner')assignOwner(currentId);if(e.target.id==='detailPriority')changePriority(currentId);if(e.target.id==='reduceTransparency')setGlassPreference(e.target.checked);if(e.target.id==='detailStatus')updateReasonSheet();if(['cProvince','cCategory','cNature','cEntity','cPriority','cOwner'].includes(e.target.id))saveComplaintDraft();if(e.target.id==='statusFilter'){statusFilter=e.target.value;registryPage=1;render();}if(e.target.id==='priorityFilter'){priorityFilter=e.target.value;registryPage=1;render();}if(e.target.id==='categoryFilter'){categoryFilter=e.target.value;registryPage=1;render();}if(e.target.id==='natureFilter'){natureFilter=e.target.value;registryPage=1;render();}if(e.target.id==='dateTypeFilter'){dateTypeFilter=e.target.value;registryPage=1;render();}if(e.target.id==='dateFrom'){dateFrom=e.target.value;registryPage=1;render();}if(e.target.id==='dateTo'){dateTo=e.target.value;registryPage=1;render();}if(e.target.classList.contains('row-check')){if(e.target.checked)selectedIds.add(e.target.dataset.id);else selectedIds.delete(e.target.dataset.id);render();}});
document.addEventListener('keydown',e=>{
  const root=$('#modalRoot');
  if(root&&root.dataset.open){
    if(e.key==='Escape'){cancelPendingSyncImport?.();closeModal();return;}
    if(e.key==='Tab'){
      const dlg=$('.modal',root);if(!dlg)return;
      const items=modalFocusables(dlg);if(!items.length){e.preventDefault();dlg.focus();return;}
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  if(!authenticatedUser)return;
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();commandPalette();return;}
  if(mod&&e.key.toLowerCase()==='n'&&authenticatedUser.role!=='reviewer'){e.preventDefault();newComplaint();return;}
  if(e.altKey&&e.key.toLowerCase()==='n'&&authenticatedUser.role!=='reviewer'){e.preventDefault();newComplaint();return;}
  if(mod&&e.key.toLowerCase()==='s'){
    const saveBtn=$('[data-action="save-complaint"]')||$('[data-action="save-reply"]')||$('[data-action="save-note"]')||$('[data-action="save-referral"]');
    if(saveBtn&&!saveBtn.disabled){e.preventDefault();saveBtn.click();}
  }
});
if($('#menuToggle'))$('#menuToggle').addEventListener('click',()=>{const open=$('#sidebar')?.classList.toggle('open');$('#menuToggle').setAttribute('aria-expanded',String(open));if($('#navBackdrop'))$('#navBackdrop').hidden=!open;});

let loginPending=false;
async function submitLogin(e){
 e?.preventDefault?.();if(loginPending)return;
 const username=$('#loginUsername')?.value?.trim(),password=$('#loginPassword')?.value||'';
 const error=$('#loginError'),button=$('#loginForm button[type="submit"]');
 if(error){error.hidden=true;error.textContent='';}
 if(!username||!password){if(error){error.textContent='أدخل اسم المستخدم وكلمة المرور.';error.hidden=false;}return;}
 loginPending=true;if(button){button.disabled=true;button.textContent='جارٍ التحقق…';}$('#loginForm')?.setAttribute('aria-busy','true');
 try{
  const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password,code:$('#loginCode')?.value.trim()||undefined,rememberMe:$('#loginRemember')?.checked===true})});
  authenticatedUser=data.user||data;await loadDb();updateSignedInUi();
  if($('#loginPassword'))$('#loginPassword').value='';
  if(typeof restoreUiRoute==='function')restoreUiRoute();render();refreshManagedUsers?.();refreshAssignees?.();refreshApprovals?.();startReminderPolling?.();toast('تم تسجيل الدخول.');
 }catch(err){if(error){error.textContent=err.message||'فشل تسجيل الدخول';error.hidden=false;}$('#loginPassword')?.focus();}
 finally{loginPending=false;if(button){button.disabled=false;button.textContent='دخول';}$('#loginForm')?.removeAttribute('aria-busy');}
}
if($('#csvExportButton'))$('#csvExportButton').addEventListener('click',()=>{if(uiCan('export.csv')){if(page==='reports')exportReport('csv').catch(error=>toast(error.message,'error'));else exportCsv();}});
if($('#loginForm'))$('#loginForm').addEventListener('submit',submitLogin);
(async()=>{try{const me=await api('/api/auth/me');authenticatedUser=me.user;await loadDb();updateSignedInUi();if(typeof restoreUiRoute==='function')restoreUiRoute();render();refreshManagedUsers?.();refreshAssignees?.();refreshApprovals?.();startReminderPolling?.();}catch(_){showLogin();}})();

})();
