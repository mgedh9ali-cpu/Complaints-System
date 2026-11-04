/* Visible backup + desktop update helpers */

async function downloadBackup(kind) {
  const path = kind === 'database' ? '/api/backup/database' : '/api/backup/complete';
  const label = kind === 'database' ? 'قاعدة البيانات' : 'نسخة كاملة (مع المرفقات)';
  toast('جاري تجهيز ' + label + '…');
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'تعذر إنشاء النسخة الاحتياطية');
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(cd);
    const filename =
      match?.[1] ||
      (kind === 'database'
        ? 'complaints-db-' + new Date().toISOString().slice(0, 10) + '.sqlite.enc'
        : 'complaints-complete-' + new Date().toISOString().slice(0, 10) + '.csb');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('تم تنزيل النسخة الاحتياطية: ' + filename);
  } catch (error) {
    toast(error.message || 'فشل النسخ الاحتياطي', 'error');
    throw error;
  }
}

function runDatabaseBackup() {
  return downloadBackup('complete');
}

function runDatabaseOnlyBackup() {
  return downloadBackup('database');
}

function showUpdateHelp() {
  modal(
    'تحديث البرنامج',
    'التطبيق يعمل محلياً. التحديث يتم بتثبيت ملف EXE معتمد من الجهة فقط.',
    '<div class="risk-note">لا تُنزَّل تحديثات تلقائياً من الإنترنت. استخدم ملف التثبيت الرسمي الموقع رقمياً الذي تزودك به الجهة.</div>' +
      '<ol class="update-steps">' +
      '<li>أغلق البرنامج من أيقونة شريط المهام (إن وُجدت).</li>' +
      '<li>شغّل ملف التثبيت الجديد EXE المعتمد.</li>' +
      '<li>بياناتك محفوظة في مجلد بيانات المستخدم ولا تُمسح عند التحديث.</li>' +
      '<li>بعد التحديث، أنشئ نسخة احتياطية كاملة للتأكد.</li>' +
      '</ol>' +
      '<p class="small-copy">للتحقق من سلامة النظام استخدم «فحص سلامة قاعدة البيانات» في الإعدادات.</p>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="database-backup">إنشاء نسخة احتياطية الآن</button>'
  );
}
