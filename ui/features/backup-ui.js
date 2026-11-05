/* مركز حماية البيانات — حالة، سجل، مراحل نسخ، دليل استعادة */

let _protectionStatus = null;
let _protectionStatusLoadedAt = 0;
let _backupHistory = null;
let _backupHistoryLoadedAt = 0;
let _backupBusy = false;

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

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return n + ' ب';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' ك.ب';
  return (n / (1024 * 1024)).toFixed(2) + ' م.ب';
}

function protectionStateLabel(status) {
  if (!status) return { key: 'unknown', label: 'غير معروف', className: 'dp-status-unknown' };
  if (status.running) return { key: 'running', label: 'جاري النسخ…', className: 'dp-status-running' };
  if (status.lastError) return { key: 'failed', label: 'فشلت آخر محاولة', className: 'dp-status-failed' };
  if (status.overdue) return { key: 'attention', label: 'يحتاج انتباه', className: 'dp-status-attention' };
  if (status.lastSuccessfulAt) return { key: 'protected', label: 'محمي', className: 'dp-status-ok' };
  return { key: 'attention', label: 'يحتاج انتباه', className: 'dp-status-attention' };
}

function backupKindLabel(kind) {
  return ({
    automatic: 'تلقائي',
    'pre-change': 'قبل تغيير',
    'manual-complete': 'يدوي كامل',
    database: 'قاعدة فقط'
  })[kind] || kind || '—';
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

async function loadBackupHistory(force) {
  const now = Date.now();
  if (!force && _backupHistory && now - _backupHistoryLoadedAt < 30000) {
    return _backupHistory;
  }
  try {
    const data = await api('/api/backup/status');
    _backupHistory = data;
    _backupHistoryLoadedAt = now;
    return data;
  } catch (err) {
    _backupHistory = { error: err.message || 'تعذر جلب سجل النسخ', backups: [] };
    _backupHistoryLoadedAt = now;
    return _backupHistory;
  }
}

function setBackupProgress(stageIndex, stages) {
  const box = document.getElementById('dpBackupProgress');
  if (!box) return;
  box.hidden = false;
  box.innerHTML =
    '<p class="dp-progress-title">مراحل العملية</p><ol class="dp-progress-list">' +
    stages
      .map((label, i) => {
        const cls = i < stageIndex ? 'is-done' : i === stageIndex ? 'is-active' : '';
        const mark = i < stageIndex ? '✓' : i === stageIndex ? '…' : '·';
        return '<li class="' + cls + '"><span class="dp-step-mark">' + mark + '</span> ' + esc(label) + '</li>';
      })
      .join('') +
    '</ol>';
}

function clearBackupProgress() {
  const box = document.getElementById('dpBackupProgress');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
}

function renderBackupHistoryTable(history) {
  const list = history?.backups || [];
  if (history?.error) {
    return '<p class="small-copy risk-note">تعذر تحميل السجل: ' + esc(history.error) + '</p>';
  }
  if (!list.length) {
    return '<p class="small-copy">لا توجد نسخ محفوظة في مجلد النسخ بعد. أنشئ نسخة كاملة أو انتظر النسخ التلقائي.</p>';
  }
  const rows = list
    .map((b) => {
      return (
        '<tr>' +
        '<td>' + esc(formatProtectionTime(b.mtime)) + '</td>' +
        '<td>' + esc(backupKindLabel(b.kind)) + '</td>' +
        '<td>' + esc(formatBytes(b.size)) + '</td>' +
        '<td dir="ltr">' + esc(b.name) + '</td>' +
        '<td>' + (b.verified ? 'متحقق' : '—') + '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<div class="dp-history-wrap"><table class="dp-history-table">' +
    '<thead><tr><th>التاريخ</th><th>النوع</th><th>الحجم</th><th>الملف</th><th>التحقق</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    (history.directory
      ? '<p class="small-copy">وجهة الحفظ: <code dir="ltr">' + esc(history.directory) + '</code></p>'
      : '')
  );
}

function renderDataProtectionCenter(metrics, history) {
  const auto = metrics?.automaticBackups || history?.automatic || null;
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
  const dirLabel = history?.directory || auto?.directory || 'المجلد الافتراضي على الجهاز';

  return (
    '<section class="panel backup-panel data-protection-center">' +
    '<div class="panel-header"><div>' +
    '<h2>مركز حماية البيانات</h2>' +
    '<p>حالة النسخ، السجل، إنشاء نسخة، ودليل الاستعادة الآمنة</p>' +
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
    '<p class="small-copy">وجهة النسخ الحالية: <code dir="ltr">' + esc(String(dirLabel)) + '</code>. على Windows يمكن تغييرها من قائمة «النسخ والاستعادة ← اختيار مجلد النسخ التلقائي».</p>' +
    '<div id="dpBackupProgress" class="dp-progress" hidden></div>' +
    '<div class="footer-actions dp-actions">' +
    '<button type="button" class="btn btn-primary btn-backup" data-action="database-backup">إنشاء نسخة كاملة الآن</button>' +
    '<button type="button" class="btn" data-action="backup-database-only">نسخة قاعدة البيانات فقط</button>' +
    '<button type="button" class="btn" data-action="show-restore-guide">دليل / معالج الاستعادة</button>' +
    '<button type="button" class="btn" data-action="show-update-help">كيفية تحديث البرنامج</button>' +
    '</div>' +
    '<h3 class="subheading" style="margin-top:18px">سجل النسخ</h3>' +
    renderBackupHistoryTable(history) +
    '<p class="small-copy">النسخة الكاملة مشفّرة وتتضمن المرفقات ورأس التدقيق. احفظ مفتاح الاستعادة من قائمة سطح المكتب في مكان منفصل عن ملفات النسخ. المجلد على الجهاز نفسه لا يكفي وحده للتعافي من فقد الجهاز.</p>' +
    '</div></section>'
  );
}

async function downloadBackup(kind) {
  if (_backupBusy) {
    toast('عملية نسخ جارية بالفعل.', 'warn');
    return;
  }
  _backupBusy = true;
  const path = kind === 'database' ? '/api/backup/database' : '/api/backup/complete';
  const label = kind === 'database' ? 'قاعدة البيانات' : 'نسخة كاملة (مع المرفقات)';
  const stages =
    kind === 'database'
      ? ['التحقق من الصلاحية', 'نسخ متسق لقاعدة البيانات', 'التشفير والتحقق', 'التنزيل']
      : ['التحقق من الصلاحية', 'نسخ متسق لقاعدة البيانات', 'جمع المرفقات ورأس التدقيق', 'التشفير والتحقق من الحزمة', 'التنزيل'];
  try {
    setBackupProgress(0, stages);
    toast('جاري تجهيز ' + label + '…');
    setBackupProgress(1, stages);
    await new Promise((r) => setTimeout(r, 120));
    setBackupProgress(2, stages);
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'تعذر إنشاء النسخة الاحتياطية');
    }
    setBackupProgress(stages.length - 2, stages);
    const blob = await res.blob();
    setBackupProgress(stages.length - 1, stages);
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
    _backupHistoryLoadedAt = 0;
    await loadBackupHistory(true);
    if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') render();
  } catch (error) {
    toast(error.message || 'فشل النسخ الاحتياطي', 'error');
    throw error;
  } finally {
    _backupBusy = false;
    setTimeout(clearBackupProgress, 1200);
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
      '<li>أنشئ نسخة كاملة واحفظ مفتاح الاستعادة منفصلًا.</li>' +
      '<li>أغلق البرنامج من أيقونة شريط المهام (إن وُجدت).</li>' +
      '<li>شغّل ملف التثبيت الجديد EXE المعتمد.</li>' +
      '<li>بياناتك محفوظة في مجلد بيانات المستخدم ولا تُمسح عند التحديث.</li>' +
      '</ol>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="database-backup">إنشاء نسخة احتياطية الآن</button>'
  );
}

function showRestoreGuide() {
  modal(
    'دليل ومعالج الاستعادة الآمنة',
    'الاستعادة الرسومية الكاملة متاحة من قائمة سطح المكتب. لا تستبدل بيانات التشغيل قبل التحقق.',
    '<div class="risk-note"><strong>Windows (الطريقة المعتمدة):</strong> من شريط القوائم اختر «النسخ والاستعادة» ← «استعادة نسخة كاملة…». اختر ملف <code>.csb</code> ثم ملف مفتاح الاستعادة <code>.json</code>. تُجهَّز البيانات في مجلد مستقل <code>recovered-…</code> دون حذف بياناتك الحالية، ثم يُغلق التطبيق.</div>' +
      '<ol class="update-steps restore-steps">' +
      '<li><strong>اختر النسخة</strong> — ملف .csb صادر عن هذا النظام.</li>' +
      '<li><strong>فحص السلامة</strong> — التشفير، القاعدة، سلسلة التدقيق، المرفقات، مفتاح المحتوى.</li>' +
      '<li><strong>عرض الأثر</strong> — ستُعتمد بيانات النسخة؛ التعديلات الأحدث لن تظهر.</li>' +
      '<li><strong>حماية الحالة الحالية</strong> — البيانات الحالية تبقى في مجلدها؛ لا حذف تلقائي.</li>' +
      '<li><strong>تأكيد مدير</strong> — حساب مدير + مفتاح الاستعادة المنفصل.</li>' +
      '<li><strong>مساحة منفصلة</strong> — مجلد recovered-UUID قبل الاعتماد.</li>' +
      '<li><strong>تحقق بعد الاستعادة</strong> — افتح التطبيق، سجّل الدخول بحسابات النسخة، افتح شكوى ومرفقًا.</li>' +
      '<li><strong>تسجيل النتيجة</strong> — زمن الاستعادة ونتيجتها في سجل الجهة.</li>' +
      '</ol>' +
      '<p class="small-copy">حفظ مفتاح الاستعادة: «النسخ والاستعادة ← حفظ مفتاح استعادة النسخ…». اختبار من المصدر فقط:<br><code>node --env-file=.env scripts/extract-complete-backup.js backup.csb restored-empty-directory</code></p>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="database-backup">إنشاء نسخة قبل أي تجربة</button>'
  );
}

async function refreshProtectionStatusAndRender() {
  toast('جاري تحديث حالة الحماية والسجل…');
  await Promise.all([loadProtectionStatus(true), loadBackupHistory(true)]);
  if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') {
    render();
  }
  toast('تم تحديث حالة الحماية والسجل.');
}
