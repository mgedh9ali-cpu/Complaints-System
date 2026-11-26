function desktopMaintenancePanel(){
  if(!window.complaintsDesktop?.runMaintenance)return '';
  const button=(command,label)=>'<button type="button" class="btn" data-action="desktop-maintenance" data-command="'+command+'">'+label+'</button>';
  return '<section class="panel"><div class="panel-header"><h2>النسخ والاستعادة</h2></div><div class="panel-body footer-actions">'+
    button('choose-backup-directory','اختيار مجلد النسخ التلقائي')+
    button('save-recovery-key','حفظ مفتاح استعادة النسخ')+
    button('restore-complete','استعادة نسخة كاملة')+
    '</div></section><section class="panel"><div class="panel-header"><h2>التحديث والمساعدة</h2></div><div class="panel-body footer-actions">'+
    button('download-update','التحقق من التحديثات')+button('about','عن التطبيق')+button('quit','إغلاق التطبيق')+'</div></section>';
}
async function runDesktopMaintenance(command){
  try{
    if(!window.complaintsDesktop?.runMaintenance)return;
    if(command==='download-update')await flushUiBeforeAction();
    await window.complaintsDesktop.runMaintenance(command);
    if(command==='choose-backup-directory'){
      _protectionStatusLoadedAt=0;_backupHistoryLoadedAt=0;
      if(page==='settings')render();
    }
  }catch(error){toast(error.message,'error');}
}
function settingsPageBase(){
  ensureManagedSettings();
  const renderMasterList=(type)=>{
    const items=db.settings[type]||[];
    const labels={categories:'التصنيف',natures:'طبيعة الشكاوي',provinces:'المحافظة',entities:'الجهة المختصة',priorities:'الأولوية'};
    const descriptionKey=type==='categories'?'categoryDescriptions':type==='natures'?'natureDescriptions':type==='entities'?'entityDescriptions':null;
    const rows=items.map(item=>{const value=type==='priorities'?item.value:item,label=type==='priorities'?item.label:item,description=descriptionKey?(db.settings[descriptionKey][value]||'لا يوجد وصف'):'قيمة متاحة لنموذج الشكوى';return '<div class="setting-row"><div><strong>'+esc(label)+'</strong><small>'+esc(description)+'</small></div><div class="footer-actions"><button class="btn btn-sm" data-action="edit-setting" data-type="'+type+'" data-value="'+esc(value)+'">تعديل</button><button class="btn btn-sm btn-danger" data-action="delete-setting" data-type="'+type+'" data-value="'+esc(value)+'">حذف</button></div></div>';}).join('');
    return '<div class="settings-list">'+(rows||'<p class="small-copy">لا توجد عناصر. أضف قيمة جديدة أو استعد القائمة الافتراضية.</p>')+'</div><button class="btn" style="margin-top:12px" data-action="add-setting" data-type="'+type+'">＋ إضافة '+(labels[type]||type)+'</button>';
  };
  const optionsSection = uiCan('settings.manage') ? '<section class="panel" id="recordOptions"><div class="panel-header"><h2>خيارات تسجيل السجل</h2></div><div class="panel-body">'+[['categories','التصنيفات'],['natures','طبيعة السجل'],['provinces','المحافظات'],['entities','الجهات المختصة'],['priorities','الأولويات']].map(([type,label])=>'<details'+(settingsOptionGroup===type?' open':'')+'><summary>'+label+'</summary>'+renderMasterList(type)+'</details>').join('')+'</div></section>' : '';
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
  return heading('الإعدادات','إعدادات التشغيل والنسخ الاحتياطي.','')+
  optionsSection+protectionSection+desktopMaintenancePanel()+
  '<section class="panel"><div class="panel-body"><h2>العرض والأداء</h2><div class="form-field"><label for="paletteSelect">اللوحة اللونية</label><select class="select-field" id="paletteSelect">'+[['emerald','زمرد'],['ocean','بحري'],['ember','عنبر']].map(([value,label])=>'<option value="'+value+'" '+((document.documentElement?.dataset.palette||'emerald')===value?'selected':'')+'>'+label+'</option>').join('')+'</select></div><div class="form-field"><label for="displayDensity">كثافة العرض</label><select class="select-field" id="displayDensity"><option value="comfortable" '+(document.documentElement?.dataset.density!=='compact'?'selected':'')+'>مريح</option><option value="compact" '+(document.documentElement?.dataset.density==='compact'?'selected':'')+'>مضغوط</option></select></div><div class="form-field"><label for="displayMotion">حركة الواجهة</label><select class="select-field" id="displayMotion"><option value="light" '+(document.documentElement?.dataset.motion!=='off'?'selected':'')+'>خفيفة</option><option value="off" '+(document.documentElement?.dataset.motion==='off'?'selected':'')+'>متوقفة</option></select></div><p class="small-copy">تُحفظ تفضيلات العرض لهذا الجهاز، مع احترام إعداد تقليل الحركة في النظام.</p><div class="form-field"><label for="sessionIdleMinutes">القفل بعد الخمول</label><select class="select-field" id="sessionIdleMinutes">'+[15,30,60].map(n=>'<option value="'+n+'" '+(Number(window.sessionIdleMinutes?.()||30)===n?'selected':'')+'>'+n+' دقيقة</option>').join('')+'</select></div><button class="btn" data-action="verify-document-dialog">التحقق من مستند مطبوع</button><label><input type="checkbox" id="reduceTransparency" '+(glassPreference()?'checked':'')+'> تقليل الشفافية</label><p class="small-copy">يلغي التمويه ويستخدم أسطحاً مصمتة. يُحفظ لهذا الجهاز.</p></div></section>'+
  '<section class="panel" style="margin-bottom:16px"><div class="panel-header"><div><h2>المزامنة اليدوية بين النسختين</h2><p>نقل يدوي فقط، دون اتصال بين الجهازين</p></div></div><div class="panel-body"><p>صدّر ملفًا مشفرًا بعبارة مرور وانقله يدويًا إلى الجهاز الآخر. الاستيراد يستبدل بيانات النسخة الحالية؛ احتفظ بنسخة احتياطية أولًا.</p><div class="footer-actions">'+(uiCan('sync.export')?'<button class="btn btn-primary" data-action="sync-export">تصدير ملف المزامنة</button>':'')+(uiCan('sync.import')?'<button class="btn" data-action="sync-import">استيراد ملف مزامنة</button>':'')+'<input id="syncImportFile" type="file" accept="application/json,.json" hidden></div><p class="small-copy">ينقل الملف بيانات العمل يدويًا. يتضمن المرفقات ضمن حد حجم الحزمة.</p></div></section>'+
  '';
}

function settingsPage(){return settingsPageBase()+maintenancePanel()+securityPanel()+auditPanel();}

