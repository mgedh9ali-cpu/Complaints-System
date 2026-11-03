
async function refreshMaintenanceHealth(){if(authenticatedUser?.role!=='admin')return;try{maintenanceHealth=await api('/api/health/metrics');if(page==='settings')render();}catch(error){toast(error.message,'error');}}
function maintenancePanel(){if(authenticatedUser?.role!=='admin')return '';return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>صحة النظام</h2></div><div class="panel-body"><p class="small-copy">لوحة الصيانة متاحة للمدير.</p><button class="btn btn-sm" data-action="refresh-maintenance">تحديث</button></div></section>';}
function securityPanel(){return '<section class="panel" style="margin-top:16px"><div class="panel-header"><h2>الأمان</h2></div><div class="panel-body"><button class="btn btn-sm" data-action="change-password">تغيير كلمة المرور</button></div></section>';}
function passwordChangeModal(){modal('تغيير كلمة المرور','أدخل كلمة المرور الحالية والجديدة.','<div class="form-field"><label for="currentPassword">الحالية</label><input class="field" id="currentPassword" type="password"></div><div class="form-field"><label for="newPassword">الجديدة</label><input class="field" id="newPassword" type="password" minlength="12"></div>','<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-password-change">حفظ</button>');}
async function savePasswordChange(){try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#currentPassword')?.value,newPassword:$('#newPassword')?.value})});closeModal();toast('تم تغيير كلمة المرور.');}catch(e){toast(e.message,'error');}}
function auditPanel(){return '';}
async function refreshAudit(){}
async function verifyAudit(){}
