'use strict';

function createRemindersService({ db, complaintsService, audit }) {
  function complaintExists(complaintId) {
    const { state } = complaintsService.readState();
    return (state.complaints || []).some((c) => c && c.id === complaintId && !c.archivedAt);
  }

  function createReminder({ complaintId, reminderTime, note, priority, userId }) {
    const id = String(complaintId || '').trim();
    if (!id || id.length > 100) return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
    if (!complaintExists(id)) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const time = String(reminderTime || '').trim();
    const when = Date.parse(time);
    if (!Number.isFinite(when)) return { ok: false, status: 400, error: 'وقت التذكير غير صالح.' };
    const text = String(note || '').trim();
    if (text.length < 2 || text.length > 500) {
      return { ok: false, status: 400, error: 'اكتب ملاحظة تذكير واضحة (2–500 حرف).' };
    }
    const pri = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
    const iso = new Date(when).toISOString();
    const info = db
      .prepare(
        `INSERT INTO complaint_reminders (complaint_id, reminder_time, note, priority, created_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, iso, text, pri, userId || null);
    if (typeof audit === 'function') {
      audit(userId, 'reminder_created', 'complaint', id, { reminderId: info.lastInsertRowid, at: iso });
    }
    return {
      ok: true,
      reminder: {
        id: info.lastInsertRowid,
        complaintId: id,
        reminderTime: iso,
        note: text,
        priority: pri
      }
    };
  }

  function listForComplaint(complaintId, { includeDismissed = false } = {}) {
    const id = String(complaintId || '').trim();
    const rows = includeDismissed
      ? db
          .prepare(
            `SELECT id, complaint_id, reminder_time, note, priority, is_dismissed, created_at
             FROM complaint_reminders WHERE complaint_id = ? ORDER BY reminder_time ASC`
          )
          .all(id)
      : db
          .prepare(
            `SELECT id, complaint_id, reminder_time, note, priority, is_dismissed, created_at
             FROM complaint_reminders WHERE complaint_id = ? AND is_dismissed = 0
             ORDER BY reminder_time ASC`
          )
          .all(id);
    return rows.map(mapRow);
  }

  function listDue({ limit = 10 } = {}) {
    const safe = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const now = new Date().toISOString();
    const rows = db
      .prepare(
        `SELECT id, complaint_id, reminder_time, note, priority, is_dismissed, created_at
         FROM complaint_reminders
         WHERE is_dismissed = 0 AND reminder_time <= ?
         ORDER BY reminder_time ASC LIMIT ?`
      )
      .all(now, safe);
    const { state } = complaintsService.readState();
    const byId = new Map((state.complaints || []).map((c) => [c.id, c]));
    return rows.map((row) => {
      const c = byId.get(row.complaint_id);
      return {
        ...mapRow(row),
        name: c?.name || '',
        summary: c?.summary || '',
        status: c?.status || null
      };
    });
  }

  function dismiss(reminderId, userId) {
    const id = Number(reminderId);
    if (!Number.isInteger(id) || id < 1) return { ok: false, status: 400, error: 'معرّف التذكير غير صالح.' };
    const row = db.prepare('SELECT id, complaint_id FROM complaint_reminders WHERE id = ?').get(id);
    if (!row) return { ok: false, status: 404, error: 'التذكير غير موجود.' };
    db.prepare('UPDATE complaint_reminders SET is_dismissed = 1 WHERE id = ?').run(id);
    if (typeof audit === 'function') {
      audit(userId, 'reminder_dismissed', 'complaint', row.complaint_id, { reminderId: id });
    }
    return { ok: true };
  }

  function mapRow(row) {
    return {
      id: row.id,
      complaintId: row.complaint_id,
      reminderTime: row.reminder_time,
      note: row.note,
      priority: row.priority,
      dismissed: row.is_dismissed === 1,
      createdAt: row.created_at
    };
  }

  return { createReminder, listForComplaint, listDue, dismiss };
}

module.exports = { createRemindersService };
