function settingsPageBase(){
  ensureManagedSettings();
  const renderMasterList=(type)=>{
    const items=db.settings[type]||[];
    const labels={categories:'التصنيف',natures:'طبيعة الشكاوي',provinces:'المحافظة',entities:'الجهة المختصة',priorities:'الأولوية'};
    const descriptionKey=type==='categories'?'categoryDescriptions':type==='natures'?'natureDescriptions':type==='entities'?'entityDescriptions':null;
    const rows=items.map(item=>{const value=type==='priorities'?item.value:item,label=type==='priorities'?item.label:item,description=descriptionKey?(db.settings[descriptionKey][value]||'لا يوجد وصف'):'قيمة متاحة لنموذج الشكوى';return '<div class="setting-row"><div><strong>'+esc(label)+'</strong><small>'+esc(description)+'</small></div><div class="footer-actions"><button class="btn btn-sm" data-action="edit-setting" data-type="'+type+'" data-value="'+esc(value)+'">تعديل</button><button class="btn btn-sm btn-danger" data-action="delete-setting" data-type="'+type+'" data-value="'+esc(value)+'">حذف</button></div></div>';}).join('');
    return '<div class="settings-list">'+(rows||'<p class="small-copy">لا توجد عناصر. أضف قيمة جديدة أو استعد القائمة الافتراضية.</p>')+'</div><button class="btn" style="margin-top:12px" data-action="add-setting" data-type="'+type+'">＋ إضافة '+(labels[type]||type)+'</button>';
  };
  const protectionSection = (typeof renderDataProtectionCenter === 'function')
    ? renderDataProtectionCenter(typeof _protectionStatus !== 'undefined' ? _protectionStatus : null, typeof _backupHistory !== 'undefined' ? _backupHistory : null)
    : '<section class="panel backup-panel"><div class="panel-header"><div><h2>النسخ الاحتياطي والتحديث</h2><p>احفظ بياناتك بوضوح قبل أي تحديث أو نقل</p></div></div><div class="panel-body"><div class="footer-actions"><button class="btn btn-primary btn-backup" data-action="database-backup">نسخة احتياطية كاملة (مع المرفقات)</button><button class="btn" data-action="backup-database-only">نسخة قاعدة البيانات فقط</button><button class="btn" data-action="show-update-help">كيفية تحديث البرنامج</button></div><p class="small-copy">النسخة الكاملة موصى بها قبل التحديث.</p></div></section>';
  if (typeof loadProtectionStatus === 'function') {
    const stale = !_protectionStatus || Date.now() - (_protectionStatusLoadedAt||0) > 60000;
    const histStale = typeof loadBackupHistory === 'function' && (!_backupHistory || Date.now() - (_backupHistoryLoadedAt||0) > 60000);
    if (stale || histStale) {
      Promise.all([
        loadProtectionStatus(false),
        typeof loadBackupHistory === 'function' ? loadBackupHistory(false) : Promise.resolve()
      ]).then(()=>{ if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') render(); }).catch(()=>{});
    }
  }
  return heading('الإعدادات','إعدادات التشغيل والنسخ الاحتياطي ومهل المتابعة.','')+
  protectionSection+
  '<section class="panel"><div class="panel-body"><h2>العرض والأداء</h2><div class="form-field"><label for="paletteSelect">اللوحة اللونية</label><select class="select-field" id="paletteSelect">'+[['emerald','زمرد'],['ocean','بحري'],['ember','عنبر']].map(([value,label])=>'<option value="'+value+'" '+((document.documentElement?.dataset.palette||'emerald')===value?'selected':'')+'>'+label+'</option>').join('')+'</select></div><button class="btn" data-action="verify-document-dialog">التحقق من مستند مطبوع</button><label><input type="checkbox" id="reduceTransparency" '+(glassPreference()?'checked':'')+'> تقليل الشفافية</label><p class="small-copy">يلغي التمويه ويستخدم أسطحاً مصمتة. يُحفظ لهذا الجهاز.</p></div></section>'+
  '<section class="panel" style="margin-bottom:16px"><div class="panel-header"><div><h2>المزامنة اليدوية بين النسختين</h2><p>نقل يدوي فقط، دون اتصال بين الجهازين</p></div></div><div class="panel-body"><p>صدّر ملفًا مشفرًا بعبارة مرور وانقله يدويًا إلى الجهاز الآخر. الاستيراد يستبدل بيانات النسخة الحالية؛ احتفظ بنسخة احتياطية أولًا.</p><div class="footer-actions"><button class="btn btn-primary" data-action="sync-export">تصدير ملف المزامنة</button><button class="btn" data-action="sync-import">استيراد ملف مزامنة</button><input id="syncImportFile" type="file" accept="application/json,.json" hidden></div><p class="small-copy">ينقل الملف بيانات العمل يدويًا. يتضمن المرفقات ضمن حد حجم الحزمة.</p></div></section>'+
  '<div class="risk-note">المهل والتصعيد التلقائي معطلان حتى تعتمد الجهة المدة الرسمية.</div>'+
  '<div class="two-col"><section class="panel"><div class="panel-header"><div><h2>مهلة المعالجة</h2><p>لا تعتمد قبل موافقة الجهة</p></div><span class="setting-value">'+(db.settings.slaApproved?'مفعلة':'غير مفعلة')+'</span></div><div class="panel-body"><div class="form-field"><label for="slaDays">عدد الأيام</label><input class="field" id="slaDays" type="number" min="1" max="365" value="'+db.settings.slaDays+'"></div><label style="display:flex;gap:9px;align-items:center;margin-top:14px;font-size:11px"><input type="checkbox" id="slaApproved" '+(db.settings.slaApproved?'checked':'')+'> تفعيل مهلة المتابعة</label><button class="btn btn-primary" style="margin-top:14px" data-action="save-sla">حفظ الإعداد</button></div></section></div>';
}

function userManagementPanel(){
  if(authenticatedUser?.role!=='admin')return '';
  const roleLabels={admin:'مدير النظام',staff:'موظف',reviewer:'مراجع'};
  return '<section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>إدارة الحسابات المحلية</h2><p>إنشاء حسابات موظفين ومراجعين وتعطيلها على هذا الجهاز</p></div><button class="btn btn-sm" data-action="refresh-local-users">تحديث القائمة</button></div><div class="panel-body"><form id="localUserForm" class="form-grid"><div class="form-field"><label for="newLocalUsername">اسم المستخدم</label><input class="field" id="newLocalUsername" required minlength="3" maxlength="64" autocomplete="off"></div><div class="form-field"><label for="newLocalPassword">كلمة مرور مؤقتة (12 محرفًا على الأقل)</label><input class="field" id="newLocalPassword" type="password" required minlength="12" maxlength="200" autocomplete="new-password"></div><div class="form-field"><label for="newLocalRole">الدور</label><select class="select-field" id="newLocalRole"><option value="staff">موظف</option><option value="reviewer">مراجع</option><option value="admin">مدير النظام</option></select></div><div class="form-field" style="align-self:end"><button class="btn btn-primary" type="button" data-action="create-local-user">إنشاء الحساب</button></div></form><div class="settings-list" style="margin-top:18px">'+(managedUsers.length?managedUsers.map(u=>'<div class="setting-row"><div><strong>'+esc(u.username)+'</strong><small>'+esc(roleLabels[u.role]||u.role)+' · '+(u.active?'نشط':'معطّل')+'</small></div>'+(u.id===authenticatedUser.id?'<span class="setting-value">حسابك الحالي</span>':'<button class="btn btn-sm" data-action="toggle-local-user" data-user-id="'+esc(u.id)+'" data-active="'+(u.active?'false':'true')+'">'+(u.active?'تعطيل':'تفعيل')+'</button>')+'</div>').join(''):'<p class="small-copy">اضغط «تحديث القائمة» لعرض الحسابات المسجلة.</p>')+'</div></div></section>';
}
function settingsPage(){return (uiCan('settings.manage')||authenticatedUser?.role==='admin'?settingsPageBase()+userManagementPanel()+permissionsPanel()+maintenancePanel():heading('طلبات العمل','مراجعة الطلبات المرتبطة بحسابك.'))+securityPanel()+approvalsPanel()+auditPanel();}
async function refreshManagedUsers(){
  if(authenticatedUser?.role!=='admin')return;
  try{const result=await api('/api/users');managedUsers=result.users||[];customizablePermissions=result.customizablePermissions||[];if(page==='settings')render();}
  catch(error){toast(error.message,'error');}
}
