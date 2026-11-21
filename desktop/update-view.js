'use strict';

const byId = id => document.getElementById(id);
const progress = byId('progress');
const credentials = byId('credentials');
const token = byId('token');
const tokenError = byId('token-error');
const install = byId('install');
const close = byId('close');

window.updateStatus.subscribe(status => {
  byId('message').textContent = status.message;
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
  close.hidden = !(status.done || status.needsToken || status.canInstall);
  close.textContent = status.done ? 'إغلاق' : 'إلغاء';
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
