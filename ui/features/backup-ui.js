/* مركز حماية البيانات — حالة، سجل، إعدادات، اختبار استعادة، حذف */

let _protectionStatus = null;
let _protectionStatusLoadedAt = 0;
let _backupHistory = null;
let _backupHistoryLoadedAt = 0;
let _backupBusy = false;
let _restoreWizard = { step: 1, name: null, result: null };

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
  if (!force && _protectionStatus && now - _protectionStatusLoadedAt < 45000) return _protectionStatus;
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
  if (!force && _backupHistory && now - _backupHistoryLoadedAt < 30000) return _backupHistory;
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
  if (box) { box.hidden = true; box.innerHTML = ''; }
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
      const canVerify = /\.csb$/i.test(b.name);
      return (
        '<tr>' +
        '<td>' + esc(formatProtectionTime(b.mtime)) + '</td>' +
        '<td>' + esc(backupKindLabel(b.kind)) + '</td>' +
        '<td>' + esc(formatBytes(b.size)) + '</td>' +
        '<td dir="ltr">' + esc(b.name) + '</td>' +
        '<td>' + (b.verified ? 'متحقق' : '—') + '</td>' +
        '<td class="dp-row-actions">' +
        (canVerify
          ? '<button type="button" class="btn btn-sm" data-action="restore-wizard-start" data-name="' + esc(b.name) + '">استعادة / فحص</button>'
          : '') +
        '<button type="button" class="btn btn-sm btn-danger" data-action="delete-backup-file" data-name="' + esc(b.name) + '">حذف</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<div class="dp-history-wrap"><table class="dp-history-table">' +
    '<thead><tr><th>التاريخ</th><th>النوع</th><th>الحجم</th><th>الملف</th><th>التحقق</th><th>إجراءات</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    (history.directory
      ? '<p class="small-copy">وجهة الحفظ: <code dir="ltr">' + esc(history.directory) + '</code></p>'
      : '')
  );
}

function renderBackupSettingsForm(auto) {
  const interval = auto?.intervalMinutes != null ? auto.intervalMinutes : 15;
  const retention = auto?.retentionDays != null ? auto.retentionDays : 30;
  return (
    '<div class="dp-settings-box">' +
    '<h3 class="subheading">إعدادات النسخ التلقائي</h3>' +
    '<div class="form-grid dp-settings-grid">' +
    '<div class="form-field"><label for="dpIntervalMinutes">الفاصل (دقيقة، من 5 إلى 1440)</label>' +
    '<input class="field" id="dpIntervalMinutes" type="number" min="5" max="1440" value="' + esc(String(interval)) + '"></div>' +
    '<div class="form-field"><label for="dpRetentionDays">أيام الاحتفاظ (1–365)</label>' +
    '<input class="field" id="dpRetentionDays" type="number" min="1" max="365" value="' + esc(String(retention)) + '"></div>' +
    '</div>' +
    '<div class="footer-actions" style="margin-top:10px">' +
    '<button type="button" class="btn btn-primary" data-action="save-backup-settings">حفظ إعدادات النسخ</button>' +
    '</div>' +
    '<p class="small-copy">الجدولة تعمل أثناء تشغيل التطبيق. النسخ على الجهاز نفسه لا يغني عن وجهة خارجية.</p>' +
    '</div>'
  );
}

function renderDataProtectionCenter(metrics, history) {
  const auto = metrics?.automaticBackups || history?.automatic || null;
  const state = protectionStateLabel(auto);
  const lastOk = formatProtectionTime(auto?.lastSuccessfulAt);
  const lastRestore = formatProtectionTime(auto?.lastRestoreTestAt);
  const restoreResult = auto?.lastRestoreTestResult === 'ok'
    ? 'ناجح'
    : auto?.lastRestoreTestResult === 'failed'
      ? 'فشل'
      : 'لم يُختبر';
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
    '<p>حالة النسخ، السجل، الإعدادات، واختبار الاستعادة الآمن</p>' +
    '</div>' +
    '<button type="button" class="btn btn-sm" data-action="refresh-protection-status">تحديث الحالة</button>' +
    '</div>' +
    '<div class="panel-body">' +
    '<div class="dp-status-grid">' +
    '<div class="dp-status-card ' + state.className + '">' +
    '<span class="dp-status-label">حالة الحماية</span>' +
    '<strong class="dp-status-value">' + esc(state.label) + '</strong></div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">آخر نسخة ناجحة</span>' +
    '<strong class="dp-status-value">' + esc(lastOk) + '</strong></div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">آخر اختبار استعادة</span>' +
    '<strong class="dp-status-value">' + esc(lastRestore) + '</strong>' +
    '<small>' + esc(restoreResult) +
    (auto?.lastRestoreTestFile ? ' · ' + esc(auto.lastRestoreTestFile) : '') +
    '</small></div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">الجدولة</span>' +
    '<strong class="dp-status-value">' + esc(interval) + '</strong>' +
    '<small>احتفاظ ' + esc(retention) + '</small></div>' +
    '<div class="dp-status-card">' +
    '<span class="dp-status-label">سلامة القاعدة</span>' +
    '<strong class="dp-status-value">' + esc(integrity) + '</strong>' +
    '<small>حجم ' + esc(dbBytes) + ' · شكاوى ' + esc(String(counts.complaints ?? '—')) + '</small></div>' +
    '</div>' +
    (lastErr ? '<div class="risk-note dp-error-note" role="alert">آخر فشل: ' + lastErr + '</div>' : '') +
    '<p class="small-copy">وجهة النسخ: <code dir="ltr">' + esc(String(dirLabel)) + '</code>. على Windows يمكن تغييرها من «النسخ والاستعادة ← اختيار مجلد النسخ التلقائي».</p>' +
    '<div id="dpBackupProgress" class="dp-progress" hidden></div>' +
    '<div class="footer-actions dp-actions">' +
    '<button type="button" class="btn btn-primary btn-backup" data-action="database-backup">إنشاء نسخة كاملة الآن</button>' +
    '<button type="button" class="btn" data-action="backup-database-only">نسخة قاعدة البيانات فقط</button>' +
    '<button type="button" class="btn" data-action="restore-wizard-start">معالج الاستعادة / الفحص</button>' +
    '<button type="button" class="btn" data-action="show-restore-guide">دليل الاستعادة على Windows</button>' +
    '<button type="button" class="btn" data-action="show-update-help">كيفية تحديث البرنامج</button>' +
    '</div>' +
    renderBackupSettingsForm(auto) +
    '<h3 class="subheading" style="margin-top:18px">سجل النسخ</h3>' +
    renderBackupHistoryTable(history) +
    '<p class="small-copy">النسخة الكاملة مشفّرة. احفظ مفتاح الاستعادة من قائمة سطح المكتب في مكان منفصل. الحذف من السجل لا يؤثر على البيانات الحية.</p>' +
    '</div></section>'
  );
}

async function downloadBackup(kind) {
  if (_backupBusy) { toast('عملية نسخ جارية بالفعل.', 'warn'); return; }
  _backupBusy = true;
  const path = kind === 'database' ? '/api/backup/database' : '/api/backup/complete';
  const label = kind === 'database' ? 'قاعدة البيانات' : 'نسخة كاملة (مع المرفقات)';
  const stages = kind === 'database'
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
    const filename = match?.[1] ||
      (kind === 'database'
        ? 'complaints-db-' + new Date().toISOString().slice(0, 10) + '.sqlite.enc'
        : 'complaints-complete-' + new Date().toISOString().slice(0, 10) + '.csb');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('تم تنزيل النسخة الاحتياطية: ' + filename);
    _protectionStatusLoadedAt = 0; _backupHistoryLoadedAt = 0;
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

function runDatabaseBackup() { return downloadBackup('complete'); }
function runDatabaseOnlyBackup() { return downloadBackup('database'); }

async function saveBackupSettings() {
  const intervalMinutes = Number($('#dpIntervalMinutes')?.value);
  const retentionDays = Number($('#dpRetentionDays')?.value);
  const data = await api('/api/backup/settings', {
    method: 'PATCH',
    body: JSON.stringify({ intervalMinutes, retentionDays })
  });
  toast('تم حفظ إعدادات النسخ التلقائي.');
  _protectionStatusLoadedAt = 0; _backupHistoryLoadedAt = 0;
  if (data?.automatic && _backupHistory) _backupHistory.automatic = data.automatic;
  await Promise.all([loadProtectionStatus(true), loadBackupHistory(true)]);
  if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') render();
}

async function deleteBackupFile(name) {
  if (!name) return;
  const ok = window.confirm(
    'حذف ملف النسخة التالي نهائيًا من مجلد النسخ؟\n' + name + '\n\nهذا لا يمس البيانات الحية. لا يمكن التراجع.'
  );
  if (!ok) return;
  await api('/api/backup/file', { method: 'DELETE', body: JSON.stringify({ name }) });
  toast('تم حذف ملف النسخة.');
  _backupHistoryLoadedAt = 0;
  await loadBackupHistory(true);
  if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') render();
}

function showUpdateHelp() {
  modal(
    'تحديث البرنامج',
    'التطبيق يعمل محلياً. التحديث يتم بتثبيت ملف EXE معتمد من الجهة فقط.',
    '<div class="risk-note">لا تُنزَّل تحديثات تلقائياً من الإنترنت.</div>' +
      '<ol class="update-steps">' +
      '<li>أنشئ نسخة كاملة واحفظ مفتاح الاستعادة منفصلًا.</li>' +
      '<li>أغلق البرنامج من أيقونة شريط المهام.</li>' +
      '<li>شغّل ملف التثبيت الجديد EXE المعتمد.</li>' +
      '<li>البيانات محفوظة في مجلد بيانات المستخدم.</li></ol>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="database-backup">إنشاء نسخة الآن</button>'
  );
}

function showRestoreGuide() {
  modal(
    'دليل الاستعادة على Windows',
    'الاستبدال الكامل للبيانات الحية يتم من قائمة سطح المكتب فقط.',
    '<div class="risk-note"><strong>المسار المعتمد:</strong> «النسخ والاستعادة» ← «استعادة نسخة كاملة…» ← ملف .csb + مفتاح .json. تُجهَّز في recovered-UUID دون حذف البيانات الحالية.</div>' +
      '<p class="small-copy">من الواجهة يمكن تشغيل <strong>معالج الفحص / اختبار الاستعادة</strong> على نسخة محفوظة دون استبدال البيانات الحية.</p>',
    '<button class="btn" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="restore-wizard-start">فتح معالج الفحص</button>'
  );
}

function restoreWizardStart(name) {
  const list = (_backupHistory?.backups || []).filter((b) => /\.csb$/i.test(b.name));
  _restoreWizard = { step: 1, name: name || null, result: null };
  const options = list.length
    ? list
        .map(
          (b) =>
            '<option value="' +
            esc(b.name) +
            '"' +
            (name === b.name ? ' selected' : '') +
            '>' +
            esc(formatProtectionTime(b.mtime) + ' — ' + backupKindLabel(b.kind) + ' — ' + b.name) +
            '</option>'
        )
        .join('')
    : '<option value="">لا توجد نسخ .csb في المجلد</option>';
  modal(
    'معالج الاستعادة الآمنة — الخطوة 1/5',
    'اختر نسخة كاملة محفوظة للفحص. لا تُستبدل البيانات الحية من هذا المعالج.',
    '<ol class="update-steps restore-steps">' +
      '<li class="is-active"><strong>1. اختيار النسخة</strong></li>' +
      '<li>2. فحص السلامة</li>' +
      '<li>3. عرض الأثر</li>' +
      '<li>4. حماية الحالة الحالية</li>' +
      '<li>5. التحقق والإكمال</li></ol>' +
      '<div class="form-field"><label for="restorePick">النسخة</label>' +
      '<select class="select-field" id="restorePick">' + options + '</select></div>' +
      '<div class="risk-note">هذا المعالج يفك النسخة في مساحة مؤقتة ويتحقق منها ثم يسجّل «اختبار استعادة». الاستبدال الكامل للتشغيل يتم من قائمة Windows.</div>',
    '<button class="btn" data-action="close-modal">إلغاء</button>' +
      '<button class="btn btn-primary" data-action="restore-wizard-step2">التالي: الفحص</button>'
  );
}

async function restoreWizardStep2() {
  const name = $('#restorePick')?.value || _restoreWizard.name;
  if (!name) { toast('اختر نسخة كاملة (.csb).', 'warn'); return; }
  _restoreWizard = { step: 2, name, result: null };
  modal(
    'معالج الاستعادة — الخطوة 2/5',
    'جاري فحص السلامة…',
    '<p class="small-copy">فك التشفير، مطابقة البصمات، سلامة القاعدة، سلسلة التدقيق، وعيّنة المرفقات.</p>' +
      '<p dir="ltr">' + esc(name) + '</p>',
    '<button class="btn" data-action="close-modal">إلغاء</button>'
  );
  try {
    const result = await api('/api/backup/verify', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    _restoreWizard = { step: 3, name, result };
    restoreWizardStep3();
  } catch (error) {
    _restoreWizard = { step: 2, name, result: { ok: false, error: error.message } };
    modal(
      'فشل فحص النسخة',
      error.message || 'تعذر التحقق',
      '<div class="risk-note">لم تُغيَّر البيانات الحية. سُجّل فشل اختبار الاستعادة.</div>',
      '<button class="btn" data-action="close-modal">إغلاق</button>' +
        '<button class="btn" data-action="restore-wizard-start">اختيار نسخة أخرى</button>'
    );
    _protectionStatusLoadedAt = 0;
    await loadProtectionStatus(true);
  }
}

function restoreWizardStep3() {
  const r = _restoreWizard.result || {};
  const counts = r.counts || {};
  modal(
    'معالج الاستعادة — الخطوة 3/5',
    'عرض الأثر — النسخة سليمة للفحص',
    '<div class="risk-note">لو اعتمدت الاستبدال لاحقًا من Windows، ستُستبدل الشكاوى والمرفقات بمحتوى هذه النسخة؛ التعديلات الأحدث لن تظهر.</div>' +
      '<ul class="update-steps">' +
      '<li>الملف: <code dir="ltr">' + esc(_restoreWizard.name || '') + '</code></li>' +
      '<li>شكاوى في النسخة: ' + esc(String(counts.complaints ?? '—')) + '</li>' +
      '<li>مستخدمون: ' + esc(String(counts.users ?? '—')) + '</li>' +
      '<li>مرفقات: ' + esc(String(r.attachmentCount ?? '—')) + '</li>' +
      '<li>ملفات في الحزمة: ' + esc(String(r.files ?? '—')) + '</li></ul>',
    '<button class="btn" data-action="close-modal">إلغاء</button>' +
      '<button class="btn btn-primary" data-action="restore-wizard-step4">التالي</button>'
  );
}

function restoreWizardStep4() {
  modal(
    'معالج الاستعادة — الخطوة 4/5',
    'حماية الحالة الحالية',
    '<ol class="update-steps">' +
      '<li>البيانات الحية <strong>لم تُمس</strong> في هذا المعالج.</li>' +
      '<li>عند الاستبدال من Windows تبقى المجلدات الحالية؛ الاعتماد على profile مستقل recovered-UUID.</li>' +
      '<li>يُفضّل إنشاء نسخة كاملة الآن قبل أي استبدال حقيقي.</li></ol>',
    '<button class="btn" data-action="database-backup">إنشاء نسخة أمان الآن</button>' +
      '<button class="btn btn-primary" data-action="restore-wizard-step5">التالي: الإكمال</button>'
  );
}

async function restoreWizardStep5() {
  _protectionStatusLoadedAt = 0;
  _backupHistoryLoadedAt = 0;
  await Promise.all([loadProtectionStatus(true), loadBackupHistory(true)]);
  modal(
    'معالج الاستعادة — الخطوة 5/5',
    'اكتمل اختبار الاستعادة',
    '<div class="risk-note">نتيجة الفحص: <strong>ناجحة</strong>. سُجّل «آخر اختبار استعادة» في مركز الحماية.</div>' +
      '<p class="small-copy">للاستبدال الكامل: من Windows «النسخ والاستعادة ← استعادة نسخة كاملة…» مع ملف المفتاح المنفصل، ثم أعد فتح التطبيق وسجّل الدخول بحسابات النسخة.</p>',
    '<button class="btn btn-primary" data-action="close-modal">إغلاق</button>'
  );
  if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') render();
}

async function refreshProtectionStatusAndRender() {
  toast('جاري تحديث حالة الحماية والسجل…');
  await Promise.all([loadProtectionStatus(true), loadBackupHistory(true)]);
  if (typeof page !== 'undefined' && page === 'settings' && typeof render === 'function') render();
  toast('تم تحديث حالة الحماية والسجل.');
}
