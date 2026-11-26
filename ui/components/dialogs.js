let modalOpener=null, syncPasswordResolve=null, confirmDialogResolve=null;
function modalFocusables(dlg){return $$('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',dlg).filter(el=>el.offsetParent!==null);}
function modal(title,subtitle,body,footer='',wide=false){
  if(typeof releaseAttachmentPreview==='function')releaseAttachmentPreview();
  if(typeof preserveIntakeDraft==='function')preserveIntakeDraft();
  if(syncPasswordResolve){const done=syncPasswordResolve;syncPasswordResolve=null;done(null);}
  if(confirmDialogResolve){const done=confirmDialogResolve;confirmDialogResolve=null;done(false);}
  const root=$('#modalRoot');
  if(root.dataset.open!=='true')modalOpener=document.activeElement;
  root.innerHTML='<div class="modal-backdrop" data-action="backdrop-close"><section class="modal '+(wide?'wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalDescription" tabindex="-1"><header class="modal-header"><div><h2 id="modalTitle">'+esc(title)+'</h2><p id="modalDescription">'+subtitle+'</p></div><button class="modal-close" data-action="close-modal" aria-label="إغلاق النافذة">×</button></header><div class="modal-body">'+body+'</div>'+(footer?'<footer class="modal-footer">'+footer+'</footer>':'')+'</section></div>';
  root.dataset.open='true';
  const shell=$('#appShell');if(shell)shell.inert=true;
  const dlg=$('.modal',root);
  const items=modalFocusables(dlg);
  (items[0]||dlg).focus();
  document.dispatchEvent?.(new CustomEvent('complaints:modal'));
}
function closeModal(){
  if(typeof pendingWrites!=='undefined'&&!pendingWrites&&!persistTimer&&!writeFailed)showSaveState('saved');
  if(typeof releaseAttachmentPreview==='function')releaseAttachmentPreview();
  if(typeof preserveIntakeDraft==='function')preserveIntakeDraft();
  $('#modalRoot')?.classList.remove('auth-recovery');
  if(syncPasswordResolve){const done=syncPasswordResolve;syncPasswordResolve=null;done(null);}
  if(confirmDialogResolve){const done=confirmDialogResolve;confirmDialogResolve=null;done(false);}
  const root=$('#modalRoot');
  const closing=$('.modal',root),old=root.firstElementChild;
  if(document.documentElement?.dataset.motion!=='off'&&closing?.animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
    const exit=closing.animate([{transform:'none'},{transform:'translateY(8px) scale(.98)'}],{duration:120,easing:'ease-in',fill:'forwards'});
    exit.onfinish=()=>{if(root.firstElementChild===old)root.innerHTML='';};
  }else root.innerHTML='';
  delete root.dataset.open;
  const shell=$('#appShell');if(shell)shell.inert=false;
  if(modalOpener&&document.contains(modalOpener))modalOpener.focus();
  modalOpener=null;
}
function field(label,name,value='',type='text',required=false,extra=''){return '<div class="form-field"><label for="'+name+'">'+label+(required?' <span class="danger-text">*</span>':'')+'</label><input class="field" id="'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+' '+extra+'></div>';}
function selectField(label,name,items,value='',required=false){const key=({cProvince:'provinces',editProvince:'provinces',cCategory:'categories',editCategory:'categories',cNature:'natures',editNature:'natures',cEntity:'entities',editEntity:'entities',rEntity:'entities',cPriority:'priorities'})[name];items=key?recordOptions(key,items):Array.isArray(items)?items:[];return '<div class="form-field"><label for="'+name+'">'+label+(required?' <span class="danger-text">*</span>':'')+'</label><select class="select-field" id="'+name+'" name="'+name+'" '+(required?'required':'')+'><option value="">اختر...</option>'+items.map(x=>'<option value="'+esc(x.value??x)+'" '+((x.value??x)===value?'selected':'')+'>'+esc(x.label??x)+'</option>').join('')+'</select></div>';}

/** App-styled confirmation (replaces window.confirm for destructive flows). */
function confirmDialog(opts={}){
  const title=opts.title||'تأكيد الإجراء';
  const message=opts.message||'هل تريد المتابعة؟';
  const confirmLabel=opts.confirmLabel||'تأكيد';
  const cancelLabel=opts.cancelLabel||'إلغاء';
  const danger=Boolean(opts.danger);
  const detail=opts.detail?('<p class="confirm-detail small-copy">'+esc(opts.detail)+'</p>'):'';
  const body='<div class="confirm-dialog'+(danger?' is-danger':'')+'">'+ 
    '<p class="confirm-message">'+esc(message)+'</p>'+detail+(Array.isArray(opts.records)?'<ul class="export-preview">'+opts.records.slice(0,5).map(c=>'<li><bdi>'+esc(c.id)+'</bdi> — '+esc(c.summary||'بدون موضوع')+'</li>').join('')+'</ul>':'')+'</div>';
  const footer='<button type="button" class="btn" data-action="confirm-dialog-cancel">'+esc(cancelLabel)+'</button>'+
    '<button type="button" class="btn '+(danger?'btn-danger':'btn-primary')+'" data-action="confirm-dialog-ok">'+esc(confirmLabel)+'</button>';
  return new Promise(resolve=>{
    modal(title, danger?'هذا الإجراء يحتاج مراجعة قبل التنفيذ.':'راجع التفاصيل ثم أكّد أو ألغِ.', body, footer);
    confirmDialogResolve=resolve;
    const okBtn=$(danger?'[data-action="confirm-dialog-cancel"]':'[data-action="confirm-dialog-ok"]');
    if(okBtn) okBtn.focus();
  });
}
function resolveConfirmDialog(ok){
  const done=confirmDialogResolve;
  confirmDialogResolve=null;
  closeModal();
  if(typeof done==='function') done(Boolean(ok));
}

/* Capture-phase so confirm buttons resolve even if events.js has no case. */
document.addEventListener('click',function(e){
  const el=e.target&&e.target.closest&&e.target.closest('[data-action="confirm-dialog-ok"],[data-action="confirm-dialog-cancel"]');
  if(!el||!confirmDialogResolve) return;
  e.preventDefault();
  e.stopPropagation();
  resolveConfirmDialog(el.getAttribute('data-action')==='confirm-dialog-ok');
},true);

function askSyncPassword(confirmPassword=false){
 modal('حماية ملف المزامنة','استخدم عبارة مرور من 16 إلى 200 حرف، وشاركها مع المستلم بطريقة منفصلة.',
  field('عبارة المرور','syncPassword','','password',true,'minlength="16" maxlength="200" autocomplete="off"')+
  (confirmPassword?field('تأكيد عبارة المرور','syncPasswordConfirm','','password',true,'minlength="16" maxlength="200" autocomplete="off"'):''),
  '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="confirm-sync-password">متابعة</button>');
 $('#syncPassword')?.focus();
 return new Promise(resolve=>{syncPasswordResolve=resolve;});
}
function confirmExportSyncPassword(){
 const input=$('#syncPassword'), confirmation=$('#syncPasswordConfirm');
 if(!input||!input.reportValidity())return;
 if(confirmation&&confirmation.value!==input.value)return toast('عبارتا المرور غير متطابقتين.','warn');
 const password=input.value,done=syncPasswordResolve;syncPasswordResolve=null;
 input.value='';if(confirmation)confirmation.value='';closeModal();done?.(password);
}

