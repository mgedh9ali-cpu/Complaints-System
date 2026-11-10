'use strict';

const PERMISSION = { draft: 'replies.draft', review: 'replies.draft', approved: 'replies.approve', sent: 'replies.send' };
const SERVER_FIELDS = ['authorId', 'editedById', 'approvedById', 'approvedBy', 'approvedAt', 'sentById', 'sentAt'];

// Both the dedicated reply API and legacy state saves use this boundary.
function applyReplyTransition({ previous, proposed, actor, can, now, action, singleOperator = false }) {
  const fail = (status, error) => ({ ok: false, status, error });
  if (!proposed || typeof proposed !== 'object' || Array.isArray(proposed) ||
      typeof proposed.text !== 'string' || proposed.text.length > 10000 || !PERMISSION[proposed.status]) {
    return fail(400, 'بنية الرد أو مرحلته غير صالحة.');
  }
  if (!actor || !can(actor, PERMISSION[proposed.status])) return fail(403, 'ليس لديك صلاحية تنفيذ إجراء الرد.');
  if (previous && !PERMISSION[previous.status] && !(previous.status === 'approval' && proposed.status === 'draft')) return fail(409, 'مرحلة الرد المحفوظة غير معروفة؛ يلزم مراجعتها.');
  for (const key of SERVER_FIELDS) {
    if (Object.hasOwn(proposed, key) && proposed[key] !== previous?.[key]) {
      return fail(403, 'هوية الكاتب والاعتماد وتوقيتهما تُسجل على الخادم فقط.');
    }
  }
  if (previous && !action && proposed.author !== undefined && proposed.author !== previous.author) {
    return fail(403, 'لا يجوز تغيير كاتب الرد عبر حفظ الحالة.');
  }
  if (!previous && proposed.author && proposed.author !== actor.username) return fail(403, 'لا يمكن إنشاء رد باسم مستخدم آخر.');
  const status = proposed.status;
  const textChanged = previous && proposed.text !== previous.text;
  if (previous && ['approved', 'sent'].includes(previous.status)) {
    if (textChanged || !['approved', 'sent'].includes(status) || previous.status === 'sent' && status !== 'sent') {
      return fail(409, 'لا يجوز تغيير نص الرد المعتمد أو إعادته للمراجعة.');
    }
  }
  if (status === 'approved' && previous?.status !== 'approved') {
    if (!previous?.authorId && !(typeof previous?.author === 'string' && previous.author.trim())) return fail(409, 'هوية كاتب الرد القديم غير معروفة؛ أعد صياغته ومراجعته قبل الاعتماد.');
    if (previous?.status !== 'review' || textChanged) return fail(409, 'الاعتماد يتطلب نصًا مراجعًا دون تعديله في طلب الاعتماد.');
    if (!singleOperator && (previous.authorId === actor.id || previous.editedById === actor.id || previous.author === actor.username)) {
      return fail(403, 'لا يمكن للكاتب أو آخر معدّل اعتماد الرد.');
    }
  }
  if (status === 'sent' && !['approved', 'sent'].includes(previous?.status)) return fail(409, 'الإرسال يتطلب رداً معتمداً.');
  if (status !== 'draft' && !proposed.text.trim()) return fail(400, 'لا يوجد نص للرد.');
  const reply = { ...(previous || {}), status, text: proposed.text };
  if (!previous || action === 'draft') {
    reply.author = actor.username;
    reply.authorId = actor.id;
  }
  if (!previous || textChanged || action === 'draft' || action === 'review' || status === 'review' && previous.status !== status) reply.editedById = actor.id;
  if (status === 'approved' && previous?.status !== 'approved') {
    reply.approvedById = actor.id; reply.approvedBy = actor.username; reply.approvedAt = now;
  }
  if (status === 'sent' && previous?.status !== 'sent') { reply.sentById = actor.id; reply.sentAt = now; }
  return { ok: true, reply };
}

module.exports = { applyReplyTransition };
