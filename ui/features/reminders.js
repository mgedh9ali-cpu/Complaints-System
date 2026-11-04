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
    'ضبط موعد تذكير',
    'سينبّهك النظام عند الموعد مع ملاحظة المتابعة المرتبطة بالشكوى ' + esc(complaintId) + '.',
    '<form id="reminderForm"><div class="form-field"><label for="alarmTime">تاريخ ووقت المنبه</label><input class="field" id="alarmTime" type="datetime-local" required value="' +
      local +
      '"></div><div class="form-field" style="margin-top:12px"><label for="alarmNote">ملاحظة التذكير</label><textarea class="textarea-field" id="alarmNote" required maxlength="500" placeholder="مثال: الاتصال بالمشتكي بخصوص المرفقات"></textarea></div><div class="form-field" style="margin-top:12px"><label for="alarmPriority">الأولوية</label><select class="select-field" id="alarmPriority"><option value="normal">عادية</option><option value="high">مرتفعة</option><option value="urgent">عاجلة</option><option value="low">منخفضة</option></select></div></form>',
    '<button class="btn" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-reminder" data-id="' +
      esc(complaintId) +
      '">تثبيت المنبه</button>'
  );
}

async function submitReminder(complaintId) {
  const timeLocal = $('#alarmTime')?.value;
  const note = ($('#alarmNote')?.value || '').trim();
  const priority = $('#alarmPriority')?.value || 'normal';
  if (!timeLocal || !note) return toast('حدّد الوقت واكتب ملاحظة التذكير.', 'warn');
  const iso = new Date(timeLocal).toISOString();
  if (!Number.isFinite(Date.parse(iso))) return toast('وقت التذكير غير صالح.', 'error');
  try {
    await api('/api/complaints/' + encodeURIComponent(complaintId) + '/reminders', {
      method: 'POST',
      body: JSON.stringify({ reminder_time: iso, note, priority })
    });
    closeModal();
    toast('تم ضبط المنبه بنجاح.');
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

function showAlarmToast(item) {
  if (document.getElementById('alarm-toast-' + item.id)) return;
  playSoftBeep();
  const toastEl = document.createElement('div');
  toastEl.className = 'alarm-toast';
  toastEl.id = 'alarm-toast-' + item.id;
  toastEl.setAttribute('role', 'alert');
  toastEl.innerHTML =
    '<div class="alarm-toast-icon" aria-hidden="true">⏰</div><div class="alarm-toast-body"><strong>موعد متابعة · ' +
    esc(item.complaintId) +
    '</strong><p>' +
    esc(item.note || '') +
    '</p><small>' +
    esc(item.name || item.summary || '') +
    '</small></div><div class="alarm-toast-actions"><button type="button" class="btn btn-sm btn-primary" data-action="alarm-open" data-id="' +
    esc(item.complaintId) +
    '" data-reminder="' +
    esc(String(item.id)) +
    '">فتح</button><button type="button" class="btn btn-sm" data-action="alarm-dismiss" data-reminder="' +
    esc(String(item.id)) +
    '">تم</button></div>';
  document.body.appendChild(toastEl);
}

async function dismissReminder(id) {
  try {
    await api('/api/reminders/' + encodeURIComponent(id) + '/dismiss', {
      method: 'POST',
      body: JSON.stringify({})
    });
  } catch (_) {}
  document.getElementById('alarm-toast-' + id)?.remove();
  markReminderShown(id);
}

async function checkDueReminders() {
  if (!authenticatedUser) return;
  try {
    const data = await api('/api/reminders/due?limit=8');
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
  reminderPollTimer = setInterval(checkDueReminders, 60000);
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDueReminders();
  });
}
