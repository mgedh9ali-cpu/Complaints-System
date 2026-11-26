/* Events bootstrap — data-action switch and global listeners. */

async function withButtonLock(btn, fn, loadingText = 'جارٍ التنفيذ…') {
  if (!btn || btn.disabled || btn.classList.contains('is-loading')) return false;
  const originalHtml = btn.innerHTML;
  const wasDisabled = btn.disabled;
  const originalBusy = btn.getAttribute('aria-busy');
  function restore() {
    btn.classList.remove('is-loading', 'btn-success-pulse');
    btn.innerHTML = originalHtml;
    btn.disabled = wasDisabled;
    if (originalBusy == null) btn.removeAttribute('aria-busy');
    else btn.setAttribute('aria-busy', originalBusy);
  }
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = loadingText;
  try {
    const result = await fn();
    // Validation and cancellation must not be reported as a successful save.
    if (result === false || result?.ok === false || result?.success === false) {
      restore();
      return result;
    }
    btn.disabled = true;
    btn.classList.remove('is-loading');
    btn.classList.add('btn-success-pulse');
    btn.innerHTML = '<span class="btn-check" aria-hidden="true">✓</span> تم';
    // Restore detached buttons too, so reinserting a node never leaves it locked.
    window.setTimeout(restore, 900);
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}
window.withButtonLock = withButtonLock;

document.addEventListener('click',async e=>{
const destination=e.target.closest('[data-page]')||e.target.closest('[data-goto]');
if(destination){
  e.preventDefault?.();
  if(authenticatedUser){
    const target=destination.dataset.page||destination.dataset.goto;
    try{if(target==='notifications')await loadDb();go(target);}catch(error){toast(error.message,'error');}
  }
  return;
}
const el=e.target.closest('[data-action]');
if(!el)return;
const a=el.dataset.action,id=el.dataset.id;
try{
switch(a){
case 'complaint-more':complaintActionsModal(id);break;
case 'request-complaint-delete':requestComplaintDeletion(id);break;
case 'export-complaint-pdf':await withButtonLock(el,()=>exportComplaintDocument(id,'pdf'),'جارٍ إنشاء PDF…');break;
case 'export-complaint-word':await withButtonLock(el,()=>exportComplaintDocument(id,'docx'),'جارٍ إنشاء Word…');break;
case 'attachment-preview':await withButtonLock(el,()=>previewAttachment(el.dataset.file,el.dataset.name,el.dataset.mime),'جارٍ فتح المرفق…');break;
case 'referral-next':{const v=$('#refComplaint')?.value;closeModal();if(v)newReferral(v);break;}
case 'reply-next':{const v=$('#replyComplaint')?.value;closeModal();if(v)replyEditor(v);break;}
case 'add-entity':addSetting('entities');break;
case 'archive-setting':await archiveSetting(el.dataset.type,el.dataset.value);break;
case 'edit-complaint':editComplaintModal(id);break;
case 'complete-draft':{const c=db.complaints.find(item=>item.id===id);if(c?.status==='draft')editComplaintModal(id);break;}
case 'retry-missing':await withButtonLock(el,retryIncompleteRecords);break;
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
case 'referral-response':referralResponseModal(id,Number(el.dataset.index));break;
case 'save-referral-response':saveReferralResponse(id,Number(el.dataset.index));break;
case 'propose-duplicate':duplicateProposalModal(id);break;
case 'submit-duplicate':submitApproval('complaint_duplicate',id,$('#duplicateOriginal')?.value,$('#approvalReason')?.value.trim());break;
case 'toggle-completion-reminder':saveDetailChange(id,c=>{c.completionReminderStopped=!c.completionReminderStopped;},'حُفظ إعداد تذكير الاستكمال.');break;
case 'conflict-save':resolveStateConflict();break;
case 'conflict-remote':resolveStateConflict(true);break;
case 'print-approved-reply':printApprovedReply(id);break;
case 'print-receipt':await withButtonLock(el,()=>printComplaintReceipt(id));break;
case 'print-complaint-cover':printComplaintCover(id);break;
case 'toggle-liquid-glass':if(typeof toggleLiquidGlass==='function')toggleLiquidGlass();break;
case 'toggle-theme':if(typeof toggleUiTheme==='function')toggleUiTheme();break;
case 'copy-complaint':await withButtonLock(el,()=>copyComplaint(id));break;
case 'goto-notifications':await loadDb();go('notifications');break;
case 'notification-open':await loadDb();detailModal(id);break;
case 'verify-document-dialog':verifyDocumentDialog();break;
case 'verify-document':await verifyDocument();break;
case 'diagnose-fonts':await withButtonLock(el,()=>diagnoseLocalFonts(),'جارٍ فحص الخط…');break;
case 'audit-verify':await withButtonLock(el,()=>runAuditIntegrityCheck());break;
case 'database-backup':await withButtonLock(el,()=>runDatabaseBackup(),'جارٍ إنشاء النسخة الكاملة…');break;
case 'backup-database-only':await withButtonLock(el,()=>runDatabaseOnlyBackup(),'جارٍ نسخ قاعدة البيانات…');break;
case 'desktop-maintenance':await withButtonLock(el,()=>runDesktopMaintenance(el.dataset.command));break;
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
case 'intake-settings':closeModal();go('settings');$('#recordOptions')?.scrollIntoView?.();break;
case 'save-reminder':await withButtonLock(el,()=>submitReminder(id),'جارٍ حفظ التذكير…');break;
case 'alarm-dismiss':await dismissReminder(el.dataset.reminder);break;
case 'alarm-open':await dismissReminder(el.dataset.reminder);detailModal(id);break;
case 'command-open':commandPalette();break;
case 'command-page':closeModal();go(el.dataset.pageTarget);break;
case 'export-selected':await withButtonLock(el,()=>exportSelected(),'جارٍ تجهيز التصدير…');break;
case 'export-registry-pdf':await withButtonLock(el,()=>previewRegistryExport('pdf'),'جارٍ تجهيز PDF…');break;
case 'close-modal':cancelPendingSyncImport?.();closeModal();break;
case 'backdrop-close':if(e.target===el){cancelPendingSyncImport?.();closeModal();}break;
case 'new-complaint':newComplaint();break;
case 'save-complaint':await withButtonLock(el,()=>createComplaint(),'جارٍ حفظ الشكوى…');break;
case 'save-and-new':await withButtonLock(el,()=>createComplaint(false,true),'جارٍ الحفظ وفتح سجل جديد…');break;
case 'save-incomplete':await withButtonLock(el,()=>createComplaint(true),'جارٍ حفظ المسودة…');break;
case 'detail':recentComplaintIds=[id,...recentComplaintIds.filter(x=>x!==id)].slice(0,8);detailModal(id);break;
case 'detail-back':go(detailReturnPage==='complaint-detail'?'complaints':detailReturnPage);break;
case 'detail-section':scrollComplaintSection(el.dataset.target,el);break;
case 'glass-step':await chooseWorkflowStep(el.dataset.status);break;
case 'change-status':await withButtonLock(el,()=>changeStatus(id),'جارٍ تحديث الحالة…');break;
case 'change-priority':changePriority(id);break;
case 'add-note':addNote(id);break;
case 'save-note':await withButtonLock(el,()=>saveNote(id),'جارٍ حفظ الملاحظة…');break;
case 'new-referral':newReferralGlobal();break;
case 'referral-create':newReferral(id);break;
case 'save-referral':await withButtonLock(el,()=>saveReferral(id),'جارٍ حفظ الإحالة…');break;
case 'survey':surveyModal(id);break;
case 'save-survey':await withButtonLock(el,()=>saveSurvey(id),'جارٍ حفظ النتيجة…');break;
case 'new-reply':newReply();break;
case 'reply-create':replyEditor(id);break;
case 'save-reply':await withButtonLock(el,()=>saveReply(id),'جارٍ حفظ الرد…');break;
case 'reply-review':await withButtonLock(el,()=>replyAction(id,a));break;
case 'reply-approve':await withButtonLock(el,()=>replyAction(id,a));break;
case 'reply-sent':await withButtonLock(el,()=>replyAction(id,a));break;
case 'read-all':db.notifications.forEach(n=>n.read=true);await persistUiNow();render();toast('تم تحديد الإشعارات كمقروءة.');break;
case 'filter-late':openRegistryQueue('late');break;
case 'filter-due-soon':openRegistryQueue('due-soon');break;
case 'filter-missing':openRegistryQueue('missing');break;
case 'clear-filters':resetRegistryFilters();render();break;
case 'quick-filter':openRegistryQueue(el.dataset.value||'all');break;
case 'registry-queue':openRegistryQueue(el.dataset.queue);break;
case 'remove-registry-filter':removeRegistryFilter(el.dataset.filterKey);break;
case 'urgent-no-reply':openRegistryQueue('urgent-no-reply');break;
case 'bulk-open':bulkOpen();break;
case 'bulk-priority':bulkChangeModal('priority');break;
case 'bulk-apply':await applyBulkChange(el.dataset.field);break;
case 'select-all':{
  const rows=$$('.row-check');
  rows.forEach(row=>{if(el.checked)selectedIds.add(row.dataset.id);else selectedIds.delete(row.dataset.id);});
  render();break;
}
case 'clear-selection':selectedIds.clear();render();break;
case 'report-period':setReportPeriod([14,30,90].includes(Number(el.dataset.days))?Number(el.dataset.days):0);break;
case 'export-csv':if(page==='reports')await withButtonLock(el,()=>exportReport('csv'),'جارٍ إنشاء CSV…');else await withButtonLock(el,()=>exportCsv(),'جارٍ إنشاء CSV…');break;
case 'export-xlsx':await withButtonLock(el,()=>exportXlsx(),'جارٍ إنشاء Excel…');break;
case 'print-report':window.print();break;
case 'sync-import':$('#syncImportFile')?.click();break;
case 'sync-export':await withButtonLock(el,()=>exportEncryptedSync(),'جارٍ تجهيز ملف المزامنة…');break;
case 'confirm-sync-password':await confirmSyncPassword();break;
case 'restore-draft':restoreComplaintDraft();break;
case 'discard-draft':dismissIntakeDraftOffer();break;
case 'add-setting':addSetting(el.dataset.type);break;
case 'edit-setting':addSetting(el.dataset.type,el.dataset.value);break;
case 'delete-setting':await deleteSetting(el.dataset.type,el.dataset.value);break;
case 'clear-setting-type':await clearSettingType(el.dataset.type);break;
case 'restore-settings':await restoreDefaultSettings(el.dataset.type||'all');break;
case 'save-setting':await withButtonLock(el,()=>saveSetting(el.dataset.type,el.dataset.mode,el.dataset.original));break;
case 'add-category':addSetting('categories');break;
case 'change-password':passwordChangeModal();break;
case 'save-password-change':await withButtonLock(el,()=>savePasswordChange(),'جارٍ تغيير كلمة المرور…');break;
case 'save-complaint-edit':await withButtonLock(el,()=>saveComplaintEdit(id),'جارٍ حفظ التعديلات…');break;
case 'registry-prev':registryPage=Math.max(1,registryPage-1);render();break;
case 'registry-next':registryPage+=1;render();break;
case 'registry-layout':{
  const mode=el.dataset.layout==='cards'?'cards':'table';
  if(typeof setRegistryLayoutMode==='function')setRegistryLayoutMode(mode);
  render();
  break;
}
case 'filter-record-type':{
  recordTypeFilter=el.dataset.value||'all';
  registryPage=1;
  render();
  break;
}
}
}catch(error){toast('لم يُحفظ الإجراء: '+error.message,'error');}
});
document.addEventListener('submit',e=>{if(e.target.id==='reportFiltersForm'){e.preventDefault();applyReportFilters();}});
document.addEventListener('input',e=>{if(e.target.id==='commandQuery'){renderCommands(e.target.value);return;}if(e.target.id==='complaintSearch'&&!e.isComposing)scheduleRegistrySearch(e.target);});
document.addEventListener('compositionend',e=>{if(e.target.id==='complaintSearch')scheduleRegistrySearch(e.target);});
document.addEventListener('toggle',e=>{if(e.target.id==='registryAdvanced')registryAdvancedOpen=e.target.open;},true);
document.addEventListener('change',e=>{if(e.target.id==='displayDensity')window.setDisplayPreference?.('density',e.target.value);if(e.target.id==='displayMotion')window.setDisplayPreference?.('motion',e.target.value);if(e.target.id==='bulkType'){if(typeof updateBulkValues==='function')updateBulkValues(e.target.value);return;}if(e.target.id==='paletteSelect'){window.setPalette?.(e.target.value);return;}if(e.target.id==='syncImportFile')return handleSyncImportChange(e.target);if(e.target.id==='detailPriority')changePriority(currentId);if(e.target.id==='reduceTransparency')setGlassPreference(e.target.checked);if(e.target.id==='detailStatus')updateReasonSheet();if(e.target.id==='statusFilter'){statusFilter=e.target.value;registryPage=1;render();}if(e.target.id==='priorityFilter'){priorityFilter=e.target.value;registryPage=1;render();}if(e.target.id==='categoryFilter'){categoryFilter=e.target.value;registryPage=1;render();}if(e.target.id==='natureFilter'){natureFilter=e.target.value;registryPage=1;render();}if(e.target.id==='dateTypeFilter'){dateTypeFilter=e.target.value;registryPage=1;render();}if(e.target.id==='dateFrom'){dateFrom=e.target.value;registryPage=1;render();}if(e.target.id==='dateTo'){dateTo=e.target.value;registryPage=1;render();}if(e.target.classList.contains('row-check')){if(e.target.checked)selectedIds.add(e.target.dataset.id);else selectedIds.delete(e.target.dataset.id);render();}});
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
    const saveBtn=$('[data-action="save-complaint"]')||$('[data-action="save-complaint-edit"]')||$('[data-action="save-reply"]')||$('[data-action="save-note"]')||$('[data-action="save-referral"]')||$('[data-action="save-password-change"]');
    if(saveBtn&&!saveBtn.disabled){e.preventDefault();saveBtn.click();}
    return;
  }
  if(mod&&e.key==='Enter'){
    const saveBtn=$('[data-action="save-complaint"]')||$('[data-action="save-complaint-edit"]')||$('[data-action="save-reply"]')||$('[data-action="save-note"]')||$('[data-action="save-referral"]')||$('[data-action="save-password-change"]')||$('[data-action="save-setting"]');
    if(saveBtn&&!saveBtn.disabled&&!saveBtn.classList.contains('is-loading')){e.preventDefault();saveBtn.click();}
  }
});

let loginPending=false;
function setLoginPasswordVisibility(visible){
 const input=$('#loginPassword'),toggle=$('#loginPasswordToggle');
 if(!input||!toggle)return;
 input.type=visible?'text':'password';
 toggle.setAttribute('aria-pressed',String(visible));
 toggle.setAttribute('aria-label',visible?'إخفاء كلمة المرور':'إظهار كلمة المرور');
}
if($('#loginPasswordToggle'))$('#loginPasswordToggle').addEventListener('click',()=>{
 const input=$('#loginPassword');if(input)setLoginPasswordVisibility(input.type!=='text');
});
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
  if($('#loginPassword'))$('#loginPassword').value='';setLoginPasswordVisibility(false);
  if(typeof restoreUiRoute==='function')restoreUiRoute();render();refreshApprovals?.();startReminderPolling?.();toast('تم تسجيل الدخول.');
 }catch(err){if(error){error.textContent=err.message||'فشل تسجيل الدخول';error.hidden=false;}$('#loginPassword')?.focus();}
 finally{loginPending=false;if(button){button.disabled=false;button.textContent='دخول';}$('#loginForm')?.removeAttribute('aria-busy');}
}
if($('#csvExportButton'))$('#csvExportButton').addEventListener('click',async e=>{if(uiCan('export.csv'))try{await withButtonLock(e.currentTarget,()=>page==='reports'?exportReport('csv'):exportCsv());}catch(error){toast(error.message,'error');}});
if($('#loginForm'))$('#loginForm').addEventListener('submit',submitLogin);
window.addEventListener('online',()=>toast('عاد الاتصال. يمكن مزامنة البيانات.','info'));
window.addEventListener('offline',()=>toast('انقطع الاتصال. العمل محلياً حتى عودته.','warn'));
(async function bootstrap(){try{const me=await api('/api/auth/me');authenticatedUser=me.user||me;await loadDb();updateSignedInUi();if(typeof restoreUiRoute==='function')restoreUiRoute();render();refreshApprovals?.();startReminderPolling?.();}catch(_){showLogin();}})();

})();
