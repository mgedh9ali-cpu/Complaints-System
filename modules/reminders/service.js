'use strict';
const { storageFor } = require('../../lib/storage-codec');
const {dayBoundary,dayKey}=require('../../lib/work-time');
function createRemindersService({ db, complaintsService, audit }) {
  const storage = storageFor(db);
  function syncAudit() { if (!db.inTransaction && typeof audit?.syncHead === 'function') audit.syncHead(); }
  function complaintExists(complaintId) {
    const { state } = complaintsService.readState();
    return (state.complaints || []).some(c => c && c.id === complaintId && !c.archivedAt && !['closed','cancelled'].includes(c.status));
  }
  function createReminder({ complaintId, reminderTime, note, priority, userId }) {
    const id = String(complaintId || '').trim();
    if (!id || id.length > 100) return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
    if (!complaintExists(id)) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const when = Date.parse(String(reminderTime || '').trim());
    if (!Number.isFinite(when)) return { ok: false, status: 400, error: 'وقت التذكير غير صالح.' };
    const text = String(note || '').trim();
    if (text.length < 2 || text.length > 500) return { ok: false, status: 400, error: 'اكتب ملاحظة تذكير واضحة (2–500 حرف).' };
    const pri = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
    const iso = new Date(when).toISOString();
    const reminderId = db.transaction(() => {
      const info = db.prepare('INSERT INTO complaint_reminders (complaint_id, reminder_time, note, priority, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(id, iso, '', pri, userId || null);
      const key = info.lastInsertRowid;
      db.prepare('UPDATE complaint_reminders SET note=?, note_encrypted=? WHERE id=?')
        .run(storage.enabled ? storage.encodeJson(text, 'reminder:' + key) : text, storage.enabled ? 1 : 0, key);
      if (typeof audit === 'function') audit(userId, 'reminder_created', 'complaint', id, { reminderId: key, at: iso });
      return key;
    })();
    syncAudit();
    return { ok: true, reminder: { id: reminderId, complaintId: id, reminderTime: iso, note: text, priority: pri } };
  }
  function listForComplaint(complaintId, { includeDismissed = false } = {}) {
    const rows = db.prepare('SELECT id, complaint_id, reminder_time, note, note_encrypted, priority, is_dismissed, created_at FROM complaint_reminders WHERE complaint_id = ?' +
      (includeDismissed ? '' : ' AND is_dismissed = 0') + ' ORDER BY reminder_time ASC').all(String(complaintId || '').trim());
    return rows.map(mapRow);
  }
  function listDue({ limit = 10, today = false } = {}) {
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const until=today?new Date(dayBoundary(dayKey(new Date()),true)).toISOString():new Date().toISOString();
    const rows = db.prepare('SELECT id, complaint_id, reminder_time, note, note_encrypted, priority, is_dismissed, created_at FROM complaint_reminders WHERE is_dismissed=0 AND reminder_time<=? ORDER BY reminder_time ASC').all(until);
    const byId = new Map((complaintsService.readState().state.complaints || []).map(c => [c.id, c]));
    const active=rows.filter(row=>{const c=byId.get(row.complaint_id);return c&&!c.archivedAt&&!['closed','cancelled'].includes(c.status);}).map(row => { const c = byId.get(row.complaint_id); return { ...mapRow(row), name: c?.name || '', summary: c?.summary || '', status: c?.status || null }; });
    return today?active:active.slice(0,safe);
  }
  function dismiss(reminderId, userId) {
    const id = Number(reminderId);
    if (!Number.isInteger(id) || id < 1) return { ok: false, status: 400, error: 'معرّف التذكير غير صالح.' };
    const row = db.prepare('SELECT id, complaint_id FROM complaint_reminders WHERE id=?').get(id);
    if (!row) return { ok: false, status: 404, error: 'التذكير غير موجود.' };
    db.transaction(() => {
      db.prepare('UPDATE complaint_reminders SET is_dismissed=1 WHERE id=?').run(id);
      if (typeof audit === 'function') audit(userId, 'reminder_dismissed', 'complaint', row.complaint_id, { reminderId: id });
    })();
    syncAudit();
    return { ok: true };
  }
  function mapRow(row) {
    if (storage.enabled && row.note_encrypted !== 1) throw new Error('ملاحظة تذكير غير مشفرة؛ يلزم ترحيلها قبل القراءة.');
    return { id: row.id, complaintId: row.complaint_id, reminderTime: row.reminder_time,
      note: row.note_encrypted === 1 ? storage.decodeJson(row.note, 'reminder:' + row.id) : row.note,
      priority: row.priority, dismissed: row.is_dismissed === 1, createdAt: row.created_at };
  }
  return { createReminder, listForComplaint, listDue, dismiss };
}
module.exports = { createRemindersService };
