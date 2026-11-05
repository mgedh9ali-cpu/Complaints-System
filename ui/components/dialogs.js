let modalOpener=null, syncPasswordResolve=null;
function modalFocusables(dlg){return $$('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',dlg).filter(el=>el.offsetParent!==null);}
function modal(title,subtitle,body,footer='',wide=false){if(syncPasswordResolve){const done=syncPasswordResolve;syncPasswordResolve=null;done(null);}const root=$('#modalRoot');modalOpener=document.activeElement;root.innerHTML='<div class="modal-backdrop" data-action="backdrop-close"><section class="modal '+(wide?'wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalDescription" tabindex="-1"><header class="modal-header"><div><h2 id="modalTitle">'+title+'</h2><p id="modalDescription">'+subtitle+'</p></div><button class="modal-close" data-action="close-modal" aria-label="إغلاق النافذة">×</button></header><div class="modal-body">'+body+'</div>'+(footer?'<footer class="modal-footer">'+footer+'</footer>':'')+'</section></div>';root.dataset.open='true';const dlg=$('.modal',root);const items=modalFocusables(dlg);(items[0]||dlg).focus();}
function closeModal(){$('#modalRoot')?.classList.remove('auth-recovery');if(syncPasswordResolve){const done=syncPasswordResolve;syncPasswordResolve=null;done(null);}const root=$('#modalRoot');const closing=$('.modal',root),old=root.firstElementChild;if(closing?.animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){const exit=closing.animate([{transform:'none'},{transform:'translateY(8px) scale(.98)'}],{duration:120,easing:'ease-in',fill:'forwards'});exit.onfinish=()=>{if(root.firstElementChild===old)root.innerHTML='';};}else root.innerHTML='';delete root.dataset.open;if(modalOpener&&document.contains(modalOpener))modalOpener.focus();modalOpener=null;}
function field(label,name,value='',type='text',required=false,extra=''){return '<div class="form-field"><label for="'+name+'">'+label+(required?' <span class="danger-text">*</span>':'')+'</label><input class="field" id="'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+' '+extra+'></div>';}
function selectField(label,name,items,value='',required=false){const key=({cProvince:'provinces',editProvince:'provinces',cCategory:'categories',editCategory:'categories',cNature:'natures',editNature:'natures',cEntity:'entities',editEntity:'entities',rEntity:'entities',cPriority:'priorities'})[name];if(!Array.isArray(items)||!items.length)items=key?seed.settings[key]||[]:[];return '<div class="form-field"><label for="'+name+'">'+label+(required?' <span class="danger-text">*</span>':'')+'</label><select class="select-field" id="'+name+'" name="'+name+'" '+(required?'required':'')+'><option value="">اختر...</option>'+items.map(x=>'<option value="'+esc(x.value??x)+'" '+((x.value??x)===value?'selected':'')+'>'+esc(x.label??x)+'</option>').join('')+'</select></div>';}

function askSyncPassword(confirmPassword=false){
 modal('حماية ملف المزامنة','استخدم عبارة مرور من 16 إلى 200 حرف، وشاركها مع المستلم بطريقة منفصلة.',
  field('عبارة المرور','syncPassword','','password',true,'minlength="16" maxlength="200" autocomplete="off"')+
  (confirmPassword?field('تأكيد عبارة المرور','syncPasswordConfirm','','password',true,'minlength="16" maxlength="200" autocomplete="off"'):''),
  '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="confirm-sync-password">متابعة</button>');
 $('#syncPassword')?.focus();
 return new Promise(resolve=>{syncPasswordResolve=resolve;});
}
function confirmSyncPassword(){
 const input=$('#syncPassword'), confirmation=$('#syncPasswordConfirm');
 if(!input||!input.reportValidity())return;
 if(confirmation&&confirmation.value!==input.value)return toast('عبارتا المرور غير متطابقتين.','warn');
 const password=input.value,done=syncPasswordResolve;syncPasswordResolve=null;
 input.value='';if(confirmation)confirmation.value='';closeModal();done?.(password);
}
