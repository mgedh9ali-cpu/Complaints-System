'use strict';

const byId = id => document.getElementById(id);
const progress = byId('progress');
const credentials = byId('credentials');
const token = byId('token');
const tokenError = byId('token-error');
const install = byId('install');
const close = byId('close');

const mb = bytes => new Intl.NumberFormat('ar', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) + ' م.ب';
const time = date => { const d = new Date(date); return date && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : ''; };
let lastHistory;
window.updateStatus.subscribe(status => {
  byId('message').textContent = status.message;
  byId('current-version').textContent = status.currentVersion || '—';
  byId('current-build').textContent = status.currentCommit?.slice(0, 12) || '';
  byId('available-version').textContent = status.availableCommit ? status.version : '—';
  byId('available-build').textContent = status.availableCommit?.slice(0, 12) || '';
  byId('published').textContent = status.publishedAt ? 'تاريخ النشر: ' + time(status.publishedAt) + (status.total ? ' · حجم المثبّت: ' + mb(status.total) : '') : '';
  byId('published').hidden = !status.publishedAt;
  byId('download-detail').textContent = status.cancelable && Number.isFinite(status.downloaded) ? mb(status.downloaded) + ' / ' + mb(status.total) + (status.speed ? ' · ' + mb(status.speed) + '/ث' : '') : '';
  if (Array.isArray(status.history) && JSON.stringify(status.history) !== lastHistory) {
    lastHistory = JSON.stringify(status.history);
    const entries = status.history.slice(0, 30);
    byId('history-empty').hidden = entries.length > 0;
    byId('history-list').replaceChildren(...entries.map(entry => {
      const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = ({ complete: 'اكتمل', pending: 'بانتظار التأكيد', failed: 'تعذّر', cancelled: 'أُلغي', checked: 'تم الفحص' })[entry.state] || 'محاولة';
      detail.textContent = [entry.version, entry.commit?.slice(0, 12), time(entry.at), entry.message].filter(Boolean).join(' · ');
      li.append(title, detail); return li;
    }));
  }
  byId('version').textContent = status.version || '';
  byId('version').hidden = !status.version;
  byId('progress-group').hidden = !!(status.done || status.needsToken || status.canInstall);
  byId('progress-label').textContent = status.phase || 'جارٍ التحقق';
  if (typeof status.percent === 'number') progress.value = status.percent;
  else progress.removeAttribute('value');
  byId('percent').textContent = typeof status.percent === 'number' ? status.percent + '٪' : '';
  credentials.hidden = !status.needsToken;
  if (status.needsToken) token.focus();
  byId('release-notes').hidden = !status.notes;
  byId('notes').textContent = status.notes || '';
  install.hidden = !status.canInstall;
  close.hidden = !(status.done || status.needsToken || status.canInstall || status.cancelable);
  close.textContent = status.done ? 'إغلاق' : status.cancelable ? 'إلغاء التنزيل' : 'إلغاء';
});

close.addEventListener('click', () => window.close());
install.addEventListener('click', async () => {
  install.disabled = true;
  try {
    await window.updateStatus.confirmInstall();
  } catch (_) {
    byId('message').textContent = 'تعذّر بدء التنزيل. حاول مرة أخرى.';
  } finally {
    install.disabled = false;
  }
});

credentials.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = credentials.querySelector('button');
  submit.disabled = true;
  tokenError.textContent = '';
  try {
    const accepted = await window.updateStatus.submitToken(token.value.trim());
    if (accepted) token.value = '';
    else tokenError.textContent = 'أدخل رمز GitHub صالحًا يبدأ بـ github_pat_ أو ghp_.';
  } catch (_) {
    tokenError.textContent = 'تعذّر إرسال الرمز. أعد المحاولة.';
  } finally {
    submit.disabled = false;
  }
});
