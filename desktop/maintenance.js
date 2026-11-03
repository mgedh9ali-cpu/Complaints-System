'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readOptions, saveOptions, writeRecoveryKey, readRecoveryKey, assertWritableDirectory, prepareRestoredProfile } = require('./recovery');
const RELEASES_URL = 'https://github.com/mgedh9ali-cpu/Complaints-System/releases';

function installMaintenanceMenu({ app, Menu, dialog, shell, window, origin, paths, runtime }) {
  let busy = false;
  async function admin() {
    const response = await window.webContents.session.fetch(origin + '/api/auth/me', { credentials: 'include' });
    const body = await response.json();
    if (!response.ok || body.user?.role !== 'admin') throw new Error('سجّل الدخول بحساب المدير لتنفيذ هذه العملية.');
    return body.user;
  }
  const action = run => async () => {
    if (busy) return;
    busy = true;
    try { await run(); } catch (error) { await dialog.showMessageBox(window, {type:'error', message:'تعذر إكمال العملية', detail:error.message}); }
    finally { busy = false; }
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'النسخ والاستعادة', submenu: [
      { label: 'اختيار مجلد النسخ التلقائي…', click: action(async () => {
        await admin();
        const selection = await dialog.showOpenDialog(window, {title:'اختر مجلد النسخ المعتمد أو القرص الخارجي', properties:['openDirectory','createDirectory']});
        if (selection.canceled) return;
        const user = await admin(), directory = selection.filePaths[0];
        assertWritableDirectory(directory);
        runtime.audit(user.id, 'backup_directory_change_requested', 'system', null, {});
        const previousDirectory = runtime.backupScheduler.status().directory;
        runtime.backupScheduler.setDirectory(directory);
        try { saveOptions(paths.applicationBase, {...readOptions(paths.applicationBase), backupDirectory:directory}); }
        catch(error) { runtime.backupScheduler.setDirectory(previousDirectory); throw error; }
        process.env.BACKUP_DIR = directory;
        runtime.audit(user.id, 'backup_directory_changed', 'system', null, {});
        const ok = await runtime.backupScheduler.runOnce();
        await dialog.showMessageBox(window, {type:ok?'info':'warning', message:ok?'حُفظ المجلد وأُنشئت نسخة متحقق منها.':'حُفظ المجلد لكن النسخ لم يكتمل.', detail:ok?'سيُستخدم كل 15 دقيقة أثناء التشغيل. احتفظ بمفتاح الاستعادة منفصلًا.':runtime.backupScheduler.status().lastError});
      }) },
      { label: 'حفظ مفتاح استعادة النسخ…', click: action(async () => {
        await admin();
        const selection = await dialog.showSaveDialog(window, {title:'احتفظ بهذا المفتاح منفصلًا عن النسخ؛ يستطيع حامله فكها', defaultPath:'complaints-recovery-key.json', filters:[{name:'مفتاح الاستعادة',extensions:['json']}]});
        if (selection.canceled) return;
        const user = await admin();
        runtime.audit(user.id, 'backup_recovery_key_export_requested', 'system', null, {});
        writeRecoveryKey(selection.filePath, process.env.BACKUP_SECRET || process.env.SESSION_SECRET);
        runtime.audit(user.id, 'backup_recovery_key_exported', 'system', null, {});
        await dialog.showMessageBox(window, {type:'info',message:'حُفظ مفتاح الاستعادة.',detail:'احتفظ به في مكان خاص وآمن منفصل عن ملفات النسخ الاحتياطية.'});
      }) },
      { label: 'استعادة نسخة كاملة…', click: action(async () => {
        await admin();
        const bundle = await dialog.showOpenDialog(window, {title:'اختر النسخة الكاملة',properties:['openFile'],filters:[{name:'نسخة مشفرة',extensions:['csb']}]});
        if (bundle.canceled) return;
        const key = await dialog.showOpenDialog(window, {title:'اختر ملف مفتاح الاستعادة المحفوظ مع هذه النسخة',properties:['openFile'],filters:[{name:'مفتاح الاستعادة',extensions:['json']}]});
        if (key.canceled) return;
        const confirm = await dialog.showMessageBox(window, {type:'question',message:'استعادة البيانات من النسخة المحددة؟',detail:'ستُفحص النسخة وتُجهز في مجلد مستقل. تبقى البيانات الحالية محفوظة، ويُغلق التطبيق بعد النجاح. عند فتحه مجددًا استخدم حسابات النسخة المستعادة ورموز التحقق الخاصة بها.',buttons:['إلغاء','استعادة'],defaultId:0,cancelId:0});
        if (confirm.response !== 1) return;
        const user = await admin();
        const restored = await prepareRestoredProfile({base:paths.applicationBase,bundlePath:bundle.filePaths[0],secret:readRecoveryKey(key.filePaths[0])});
        let activated = false;
        try {
        if ((await admin()).id !== user.id) throw new Error('تغيّر الحساب أثناء تجهيز الاستعادة؛ أعد العملية.');
        runtime.audit(user.id, 'backup_restore_prepared', 'system', restored.profile, {counts:restored.counts});
        const options = readOptions(paths.applicationBase);
        saveOptions(paths.applicationBase, {...options,previousProfile:options.activeProfile || null,activeProfile:restored.profile});
        activated = true;
        } finally { if (!activated) fs.rmSync(path.join(paths.applicationBase,restored.profile),{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
        await dialog.showMessageBox(window, {type:'info',message:'نجح التحقق وتجهيز الاستعادة.',detail:'سيُغلق التطبيق الآن. افتح ملف البرنامج مجددًا للدخول إلى البيانات المستعادة؛ لم تُحذف بياناتك السابقة.'});
        app.quit();
      }) },
      { type:'separator' }, { role:'quit',label:'إغلاق التطبيق' }
    ]},
    { label:'التحديث والمساعدة',submenu:[
      { label:'تنزيل أحدث إصدار…',click:action(()=>shell.openExternal(RELEASES_URL)) },
      { label:'عن التطبيق',click:action(()=>dialog.showMessageBox(window,{type:'info',message:'نظام الاستفسارات والشكاوى '+app.getVersion(),detail:'لتحديث البرنامج: احفظ نسخة كاملة ومفتاح استعادتها، ثم أغلق التطبيق واستبدل ملف EXE بالإصدار المنشور. تبقى البيانات محفوظة خارج ملف البرنامج.'})) }
    ]}
  ]));
}
module.exports = { installMaintenanceMenu };
