'use strict';
window.updateStatus.subscribe(status => {
  document.getElementById('message').textContent = status.message;
  document.getElementById('version').textContent = status.version ? 'الإصدار ' + status.version : '';
  const progress = document.getElementById('progress');
  progress.hidden = !!status.done;
  document.getElementById('credentials').hidden = !status.needsToken;
  if (typeof status.percent === 'number') progress.value = status.percent;
  else progress.removeAttribute('value');
  document.getElementById('percent').textContent = typeof status.percent === 'number' ? status.percent + '٪' : '';
  document.getElementById('notes').hidden = !status.notes;
  document.getElementById('notes').textContent = status.notes || '';
  document.getElementById('close').hidden = !status.done;
});
document.getElementById('close').addEventListener('click', () => window.close());
document.getElementById('credentials').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.getElementById('token');
  const token = input.value; input.value = '';
  const accepted = await window.updateStatus.submitToken(token);
  if (!accepted) document.getElementById('message').textContent = 'صيغة رمز GitHub غير صالحة. أدخل رمزًا يبدأ بـ github_pat_ أو ghp_.';
});
