/* Scheduled follow-up reminders — modal, polling, soft beep, toast. */

const SHOWN_REMINDER_KEY = 'complaints.shownReminderIds';
let reminderPollTimer = null;

function shownReminderIds() {
  try {
    const raw = sessionStorage.getItem(SHOWN_REMINDER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) {
    return new Set();
  }
}
function markReminderShown(id) {
  const set = shownReminderIds();
  set.add(String(id));
  try {
    sessionStorage.setItem(SHOWN_REMINDER_KEY, JSON.stringify([...set].slice(-80)));
  } catch (_) {}
}

function openReminderModal(complaintId) {
  const c = db.complaints.find((x) => x?.id === complaintId);
  if (!c) return toast('الشكوى غير موجودة.', 'error');
  if (c.archivedAt || ['closed','cancelled'].includes(c.status)) return toast('السجل مغلق أو مؤرشف.','warn');
  if (!uiCan('complaints.update')) return toast('لا تملك صلاحية ضبط تذكير.', 'error');
  const def = new Date(Date.now() + 60 * 60 * 1000);
  const local =
    def.getFullYear() +
    '-' +
    String(def.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(def.getDate()).padStart(2, '0') +
    'T' +
    String(def.getHours()).padStart(2, '0') +
    ':' +
    String(def.getMinutes()).padStart(2, '0');
  modal(
    'موعد مراجعة وتذكير',
    'سينبّهك النظام عند الموعد مع ملاحظة المراجعة المرتبطة بالسجل ' + esc(complaintId) + '.',
    '<div class="footer-actions"><button type="button" class="btn btn-sm" data-action="reminder-preset" data-days="1">غدًا</button><button type="button" class="btn btn-sm" data-action="reminder-preset" data-days="3">بعد ثلاثة أيام</button><button type="button" class="btn btn-sm" data-action="reminder-preset" data-days="7">بعد أسبوع</button></div><form id="reminderForm"><div class="form-field"><label for="alarmTime">تاريخ ووقت المنبه</label><input class="field" id="alarmTime" type="datetime-local" required value="' +
      local +
      '"></div><div class="form-field" style="margin-top:12px"><label for="alarmNote">تعليق التذكير (ماذا تريد أن تتذكر؟)</label><textarea class="textarea-field" id="alarmNote" required minlength="2" maxlength="500" placeholder="مثال: الاتصال بالجهة ومراجعة الرد">مراجعة السجل</textarea><small>سيظهر تعليقك داخل تنبيه المراجعة عند حلول الموعد.</small></div><div class="form-field" style="margin-top:12px"><label for="alarmPriority">الأولوية</label><select class="select-field" id="alarmPriority"><option value="normal">عادية</option><option value="high">مرتفعة</option><option value="urgent">عاجلة</option><option value="low">منخفضة</option></select></div></form>',
    '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-reminder" data-id="' +
      esc(complaintId) +
      '">حفظ موعد المراجعة</button>'
  );
}

async function submitReminder(complaintId) {
  const timeLocal = $('#alarmTime')?.value;
  const note = ($('#alarmNote')?.value || '').trim();
  const priority = $('#alarmPriority')?.value || 'normal';
  if (!timeLocal || !note) return toast('حدّد الوقت واكتب ملاحظة التذكير.', 'warn');
  const parsed = Date.parse(timeLocal);
  if (!Number.isFinite(parsed)) return toast('وقت التذكير غير صالح.', 'error');
  if (parsed <= Date.now()) return toast('اختر موعد مراجعة في المستقبل.', 'warn');
  const iso=new Date(parsed).toISOString();
  try {
    await api('/api/complaints/' + encodeURIComponent(complaintId) + '/reminders', {
      method: 'POST',
      body: JSON.stringify({ reminder_time: iso, note, priority })
    });
    closeModal();
    toast('تم حفظ موعد المراجعة.');
    void refreshRecordReview();
    if(typeof refreshWorkday==='function'){workdayLoadedAt=0;void refreshWorkday(true);}
  } catch (error) {
    toast(error.message || 'تعذر حفظ التذكير', 'error');
    throw error;
  }
}

function playSoftBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    osc.start();
    osc.stop(ctx.currentTime + 0.7);
    setTimeout(() => ctx.close?.(), 900);
  } catch (_) {}
}

function reminderBrief(value, limit = 100) {
  const full = String(value || '').replace(/\s+/g, ' ').trim();
  return full.length > limit ? full.slice(0, limit - 1) + '…' : full;
}

function reminderDisplay(item) {
  const c = db.complaints.find(x => x?.id === item.complaintId);
  const type = c && typeof recordTypeOf === 'function' ? recordTypeOf(c) : 'complaint';
  const label = ({ complaint:'الشكوى', inquiry:'الاستفسار', contact:'التواصل' })[type] || 'السجل';
  return { label, summary: reminderBrief(item.summary || c?.summary), note: String(item.note || '').trim() };
}

function reminderNoteHtml(note) {
  if (!note) return '';
  const short = reminderBrief(note, 120);
  return note.length > 120
    ? '<details><summary>تعليقك: ' + esc(short) + '</summary><p>' + esc(note) + '</p></details>'
    : '<p><strong>تعليقك: </strong>' + esc(note) + '</p>';
}

function showAlarmToast(item) {
  if (!authenticatedUser || document.visibilityState === 'hidden' || document.getElementById('alarm-toast-' + item.id)) return;
  const info = reminderDisplay(item);
  playSoftBeep();
  const toastEl = document.createElement('div');
  toastEl.className = 'alarm-toast';
  toastEl.id = 'alarm-toast-' + item.id;
  toastEl.setAttribute('role', 'alert');
  toastEl.innerHTML =
    '<div class="alarm-toast-icon" aria-hidden="true">⏰</div><div class="alarm-toast-body"><strong>حان موعد مراجعة ' + esc(info.label) + '</strong>' +
    '<small><bdi>' + esc(String(item.complaintId)) + '</bdi> · ' + esc(timeText(item.reminderTime)) + '</small>' +
    (info.summary ? '<p>' + esc(info.summary) + '</p>' : '') + reminderNoteHtml(info.note) +
    '</div><div class="alarm-toast-actions"><button type="button" class="btn btn-sm btn-primary" data-action="detail" data-id="' +
    esc(item.complaintId) +
    '" data-reminder="' +
    esc(String(item.id)) +
    '">فتح</button><button type="button" class="btn btn-sm" data-action="alarm-dismiss" data-reminder="' +
    esc(String(item.id)) +
    '">تم</button></div>';
  toastEl.dataset.reminderId = String(item.id);
  (document.getElementById('appShell') || document.body).appendChild(toastEl);
}

async function dismissReminder(id) {
  try {
    await api('/api/reminders/' + encodeURIComponent(id) + '/dismiss', {
      method: 'POST',
      body: JSON.stringify({})
    });
  } catch (error) {
    toast(error.message || 'تعذّر إنهاء التذكير.', 'error');
    return;
  }
  document.getElementById('alarm-toast-' + id)?.remove();
  markReminderShown(id);
  void refreshRecordReview();
  if (typeof refreshNotificationReminders === 'function') void refreshNotificationReminders();
  if(typeof refreshWorkday==='function'){workdayLoadedAt=0;void refreshWorkday(true);}
}

async function checkDueReminders() {
  if (!authenticatedUser || document.visibilityState === 'hidden' || (typeof document.hasFocus === 'function' && !document.hasFocus())) return;
  const reminderUser = authenticatedUser;
  try {
    const data = await api('/api/reminders/due?limit=8');
    if (reminderUser !== authenticatedUser || document.visibilityState === 'hidden' || (typeof document.hasFocus === 'function' && !document.hasFocus())) return;
    const list = data.reminders || [];
    const shown = shownReminderIds();
    for (const item of list) {
      if (shown.has(String(item.id))) continue;
      showAlarmToast(item);
      markReminderShown(item.id);
    }
  } catch (_) {}
}

function startReminderPolling() {
  if (reminderPollTimer) return;
  checkDueReminders();
  reminderPollTimer = setInterval(() => {
    void checkDueReminders();
    if (typeof refreshNotificationReminders === 'function') void refreshNotificationReminders();
  }, 60000);
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDueReminders();
    else clearVisibleReminderAlerts();
  });
}

async function refreshRecordReview() {
  const mount = $('#recordReviewTimer');
  if (page !== 'complaint-detail' || !mount || !authenticatedUser) return;
  const owner = authenticatedUser, id = currentId;
  try {
    const result = await api('/api/complaints/' + encodeURIComponent(id) + '/reminders');
    if (owner !== authenticatedUser || id !== currentId || $('#recordReviewTimer') !== mount) return;
    const next = (result.reminders || []).find(item => Number.isFinite(Date.parse(item.reminderTime)));
    mount.textContent = next ? timeText(next.reminderTime) : 'لا يوجد موعد مراجعة محفوظ.';
    mount.dataset.reviewTime = next?.reminderTime || '';
    mount.dataset.reviewNote = next?.note || '';
    paintRecordReview();
  } catch (_) {
    if ($('#recordReviewTimer') === mount) mount.textContent = 'تعذّر تحميل موعد المراجعة.';
  }
}

function paintRecordReview() {
  const mount = $('#recordReviewTimer');
  if (!mount?.dataset.reviewTime) return;
  const time = mount.dataset.reviewTime;
  const minutes = Math.ceil((Date.parse(time) - Date.now()) / 60000);
  const countdown = minutes <= 0 ? 'حان موعد المراجعة' :
    'متبقٍ ' + (minutes >= 60 ? Math.floor(minutes / 60) + ' س و' : '') + minutes % 60 + ' د';
  mount.textContent = timeText(time) + ' · ' + countdown + (mount.dataset.reviewNote ? ' · تعليقك: ' + mount.dataset.reviewNote : '');
}

function clearVisibleReminderAlerts() {
  const shown = shownReminderIds();
  document.querySelectorAll('.alarm-toast[data-reminder-id]').forEach(node => {
    shown.delete(node.dataset.reminderId);
    node.remove();
  });
  try { sessionStorage.setItem(SHOWN_REMINDER_KEY, JSON.stringify([...shown])); } catch (_) {}
}
document.addEventListener('complaints:render', () => {
  if (!authenticatedUser) clearVisibleReminderAlerts();
  void refreshRecordReview();
});
window.addEventListener('blur', clearVisibleReminderAlerts);
window.addEventListener('focus', () => { if (authenticatedUser) void checkDueReminders(); });
setInterval(paintRecordReview, 30000);
