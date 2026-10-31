'use strict';

function submitSurvey({ complaintsService, complaintId, rating, comment, userId, audit }) {
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
  const idx = (state.complaints || []).findIndex((c) => c && c.id === id);
  let complaint = idx >= 0 ? { ...state.complaints[idx] } : null;

  if (!complaint && complaintsService.readState) {
    // leave as is
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
    by: userId || 'public'
  };
  complaint.updated = now;
  if (!Array.isArray(complaint.timeline)) complaint.timeline = [];
  complaint.timeline.push({
    event: 'تقييم الخدمة',
    by: userId || 'public',
    at: now,
    detail: `تقييم ${rate}/5${note ? ' — ' + note : ''}`
  });

  if (idx >= 0) state.complaints[idx] = complaint;
  else state.complaints.push(complaint);

  const result = complaintsService.saveState({
    state,
    userId: userId || 'public',
    expectedRevision: revision,
    diffComplaints: null
  });
  if (result.conflict) {
    return { ok: false, status: 409, error: 'تعارض في الحفظ. أعد المحاولة.' };
  }
  if (typeof audit === 'function' && userId) {
    audit(userId, 'complaint_survey', 'complaint', id, { rating: rate });
  }
  return { ok: true, survey: complaint.survey, revision: result.revision };
}

module.exports = { submitSurvey };
