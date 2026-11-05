/* مركز حماية البيانات — حالة النسخ، التحميل، وإرشاد الاستعادة */

let _protectionStatus = null;
let _protectionStatusLoadedAt = 0;

function formatProtectionTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('ar-IQ', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return String(iso);
  }
}

function protectionStateLabel(status) {
  if (!status) return { key: 'unknown', label: 'غير معروف', className: 'dp-status-unknown' };
  if (status.running) return { key: 'running', label: 'جاري النسخ…', className: 'dp-status-running' };
  if (status.lastError) return { key: 'failed', label: 'فشلت آخر محاولة', className: 'dp-status-failed' };
  if (status.overdue) return { key: 'attention', label: 'يحتاج انتباه', className: 'dp-status-attention' };
  if (status.lastSuccessfulAt) return { key: 'protected', label: 'محمي', className: 'dp-status-ok' };
  return { key: 'attention', label: 'يحتاج انتباه', className: 'dp-status-attention' };
}

async function loadProtectionStatus(force) {
  const now = Date.now();
  if (!force && _protectionStatus && now - _protectionStatusLoadedAt < 45000) {
    return _protectionStatus;
  }
  try {
    const data = await api('/api/health/metrics');
    _protectionStatus = data;
    _protectionStatusLoadedAt = now;
    return data;
  } catch (err) {
    _protectionStatus = { error: err.message || 'تعذر جلب حالة الحماية' };
    _protectionStatusLoadedAt = now;
    return _protectionStatus;
  }
}

function renderDataProtectionCenter(metrics) {
  const auto = metrics?.automaticBackups || null;
  const state = protectionStateLabel(auto);
  const lastOk = formatProtectionTime(auto?.lastSuccessfulAt);
  const interval = auto?.intervalMinutes != null ? auto.intervalMinutes + ' دقيقة' : 'كل 15 دقيقة';
  const retention = auto?.retentionDays != null ? auto.retentionDays + ' يوم' : '30 يوم';
  const lastErr = auto?.lastError ? esc(auto.lastError) : '';
  const integrity = metrics?.integrity === 'ok' ? 'سليمة' : (metrics?.integrity || 'غير مفحوصة');
  const dbBytes = metrics?.databaseBytes != null
    ? (metrics.databaseBytes / (1024 * 1024)).toFixed(2) + ' م.ب'
    : '—';
  const counts = metrics?.counts || {};

  return (
    '<section class="panel backup-panel data-protection-center">' +
    '<div class="panel-header"><div>' +
    '<h2>مركز حماية البيانات</h2>' +
    '<p>حالة النسخ التلقائي، إنشاء نسخة، وإرشاد الاستعادة الآمنة</p>' +
    '</div>' +
    '<button type="button" class="btn btn-sm" data-action="refresh-protection-status">تحديث الحالة</button>' +
    '</div>' +
    '<div class="panel-body">' +
    '<div class="dp-status-grid">' +
    '<div class="dp-status-card ' + state.className + '">' +
    '<span class="dp-status-label">حالة الحماية</span>' +
    '<strong class="dp-status-value">' + esc(state.label) + '</strong>' +
    '</div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">آخر نسخة ناجحة</span>' +
    '<strong class="dp-status-value">' + esc(lastOk) + '</strong>' +
    '</div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">الجدولة</span>' +
    '<strong class="dp-status-value">' + esc(interval) + '</strong>' +
    '<small>احتفاظ ' + esc(retention) + '</small>' +
    '</div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">سلامة القاعدة</span>' +
    '<strong class="dp-status-value">' + esc(integrity) + '</strong>' +
    '<small>حجم ' + esc(dbBytes) + ' · شكاوى ' + esc(String(counts.complaints ?? '—')) + '</small>' +
    '</div>' +
    '</div>' +
    (lastErr
      ? '<div class="risk-note dp-error-note" role="alert">آخر فشل: ' + lastErr + '</div>'
      : '') +
    '<div class="footer-actions dp-actions">' +
    '<button type="button" class="btn btn-primary btn-backup" data-action="database-backup">نسخة كاملة (قاعدة + مرفقات)</button>' +
    '<button type="button" class="btn" data-action="backup-database-only">نسخة قاعدة البيانات فقط</button>' +
    '<button type="button" class="btn" data-action="show-restore-guide">دليل الاستعادة</button>' +
    '<button type="button" class="btn" data-action="show-update-help">كيفية تحديث البرنامج</button>' +
    '</div>' +
    '<p class="small-copy">النسخة الكاملة مشفّرة وتتضمن المرفقات ورأس التدقيق. احفظ مفتاح استعادة النسخ في مكان منفصل عن ملف النسخة. المجلد الافتراضي على الجهاز نفسه لا يكفي وحده للتعافي من فقد الجهاز.</p>' +
    '</div></section>'
  );
}

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
    const match = /filename=\"?([^\";]+)\"?/i.exec(cd);
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
    _protectionStatusLoadedAt = 0;
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

function showRestoreGuide() {
  modal(
    'دليل الاستعادة الآمنة',
    'اتبع الخطوات بالترتيب. لا تستبدل بيانات التشغيل قبل التحقق.',
    '<ol class="update-steps restore-steps">' +
      '<li><strong>اختر النسخة</strong> — ملف <code>.csb</code> كامل مشفّر من هذا النظام.</li>' +
      '<li><strong>تحقق من السلامة</strong> — التطبيق يفحص التشفير وقاعدة البيانات وسلسلة التدقيق والمرفقات.</li>' +
      '<li><strong>راجع الملخص</strong> — تاريخ النسخة ومحتوياتها وما سيتغيّر.</li>' +
      '<li><strong>نسخة أمان للحالة الحالية</strong> — تُنشأ تلقائياً قبل أي استبدال عند الاستعادة الرسومية.</li>' +
      '<li><strong>تأكيد وصلاحية مدير</strong> — الاستعادة تتطلب حساب مدير وملف مفتاح الاستعادة المنفصل.</li>' +
      '<li><strong>وضع يمنع تضارب الكتابة</strong> — لا تُكتب على القاعدة الحية أثناء الفحص.</li>' +
      '<li><strong>فحص بعد الاستعادة</strong> — تحقق من الشكاوى والمرفقات وتسجيل الدخول برموز النسخة المستعادة.</li>' +
      '<li><strong>تسجيل النتيجة</strong> — سجّل زمن الاستعادة ونتيجتها في سجل الجهة.</li>' +
      '</ol>' +
      '<div class="risk-note">من Windows: النسخ والاستعادة ← استعادة نسخة كاملة، ثم اختر ملف .csb وملف مفتاح الاستعادة .json. عند الفشل لا تتغيّر البيانات الحالية.</div>' +
      '<p class="small-copy">من سطر الأوامر للاختبار فقط:<br><code>node --env-file=.env scripts/extract-complete-backup.js backup.csb restored-empty-directory</code></p>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="database-backup">إنشاء نسخة قبل أي تجربة</button>'
  );
}

async function refreshProtectionStatusAndRender() {
  toast('جاري تحديث حالة الحماية…');
  await loadProtectionStatus(true);
  if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') {
    render();
  }
  toast('تم تحديث حالة الحماية.');
}
