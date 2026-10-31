'use strict';

function submitSurvey({ db, complaintsService, complaintId, rating, comment, actorLabel, audit, userId }) {
  const id = String(complaintId || '').trim();
  const rate = Number(rating);
  if (!id || id.length > 100) {
    return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
  }
  if (!Number.isInteger(rate) || rate < 1 || rate > 5) {
    return { ok: false, status: 400, error: 'التقييم يجب أن يكون عدداً من 1 إلى 5.' };
  }
  const note = typeof comment === 'string' ? comment.trim().slice(0, 1000) : '';

  const { state, revision } = complaintsService.readState();
  if (!Array.isArray(state.complaints)) state.complaints = [];
  let idx = state.complaints.findIndex((c) => c && c.id === id);
  let complaint = idx >= 0 ? { ...state.complaints[idx] } : null;

  if (!complaint && db) {
    try {
      const row = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(id);
      if (row && row.payload_json) {
        complaint = JSON.parse(row.payload_json);
        state.complaints.push(complaint);
        idx = state.complaints.length - 1;
      }
    } catch (_) {
      complaint = null;
    }
  }

  if (!complaint) {
    return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
  }
  if (complaint.status !== 'closed' && complaint.status !== 'cancelled') {
    return { ok: false, status: 409, error: 'التقييم متاح فقط بعد إغلاق الشكوى أو إلغائها.' };
  }
  if (complaint.survey && complaint.survey.rating) {
    return { ok: false, status: 409, error: 'تم تسجيل تقييم مسبقاً لهذه الشكوى.' };
  }

  const now = new Date().toISOString();
  complaint.survey = {
    rating: rate,
    comment: note || null,
    at: now,
    by: actorLabel || 'public'
  };
  complaint.updated = now;
  if (!Array.isArray(complaint.timeline)) complaint.timeline = [];
  complaint.timeline.push({
    event: 'تقييم الخدمة',
    by: actorLabel || 'public',
    at: now,
    detail: `تقييم ${rate}/5${note ? ' — ' + note : ''}`
  });
  state.complaints[idx] = complaint;

  const currentRow = db.prepare('SELECT updated_by, revision FROM app_state WHERE id = 1').get();
  const updater = userId || currentRow?.updated_by;
  if (!updater) {
    return { ok: false, status: 500, error: 'تعذر تحديد مستخدم الحفظ.' };
  }
  const nextRevision = (Number(currentRow?.revision) || Number(revision) || 0) + 1;
  const stateJson = JSON.stringify(state);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO app_state(id, state_json, updated_by, updated_at, revision)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at,
         revision = excluded.revision`
    ).run(stateJson, updater, now, nextRevision);
    db.prepare(
      'UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(complaint), now, id);
  });
  tx();

  if (typeof audit === 'function' && userId) {
    audit(userId, 'complaint_survey', 'complaint', id, { rating: rate });
  }

  return { ok: true, survey: complaint.survey, revision: nextRevision };
}

module.exports = { submitSurvey };
