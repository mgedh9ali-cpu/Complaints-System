'use strict';

const crypto = require('node:crypto');
const { storageFor } = require('../../lib/storage-codec');
const fingerprint = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value || null)).digest('hex');

const KINDS = new Set(['complaint_archive', 'complaint_cancel', 'attachment_delete', 'complaint_duplicate']);

function createApprovalsService({ db, audit, complaintsService, attachmentsService }) {
  const storage = storageFor(db);
  db.exec(`CREATE TABLE IF NOT EXISTS approval_requests(
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    complaint_id TEXT,
    target_id TEXT,
    target_hash TEXT,
    reason TEXT,
    requester_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_reason TEXT
  )`);

  const current = (id) => {
    if (!id) return null;
    const state = complaintsService.readState().state;
    return (state.complaints || []).find((c) => c && c.id === id) || null;
  };

  function request({ kind, complaintId, targetId, reason, userId }) {
    if (!KINDS.has(kind)) return { ok: false, status: 400, error: 'نوع طلب غير معروف.' };
    if (!userId) return { ok: false, status: 401, error: 'مطلوب تسجيل الدخول.' };
    if (!reason || !String(reason).trim()) return { ok: false, status: 400, error: 'سبب الطلب مطلوب.' };
    if (kind === 'complaint_duplicate' && (targetId === complaintId || !current(targetId) || current(targetId).duplicateOf)) {
      return { ok: false, status: 400, error: 'ربط التكرار غير صالح.' };
    }
    if (!['attachment_delete', 'complaint_duplicate'].includes(kind) && targetId !== complaintId) {
      targetId = complaintId;
    }
    const complaint = current(complaintId);
    if (!complaint && kind !== 'attachment_delete') return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const targetHash = fingerprint(complaint);
    db.prepare(
      `INSERT INTO approval_requests(id,kind,complaint_id,target_id,target_hash,reason,requester_id,status,created_at)
       VALUES(?,?,?,?,?,?,?,'pending',?)`
    ).run(
      id,
      kind,
      complaintId || null,
      targetId || null,
      targetHash,
      storage.encodeJson(String(reason).trim(), 'approval-reason:' + id),
      userId,
      now
    );
    if (typeof audit === 'function') {
      audit(userId, 'approval_requested', 'approval', id, { kind, complaintId, targetId });
    }
    return { ok: true, id };
  }

  function list({ status } = {}) {
    const rows = status
      ? db.prepare('SELECT * FROM approval_requests WHERE status=? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM approval_requests ORDER BY created_at DESC').all();
    return rows.map((row) => {
      try {
        row.reason = storage.decodeJson(row.reason, 'approval-reason:' + row.id);
      } catch (_) {}
      try {
        if (row.decision_reason) row.decision_reason = storage.decodeJson(row.decision_reason, 'approval-decision:' + row.id);
      } catch (_) {}
      return row;
    });
  }

  function decide({ id, decision, reason, user }) {
    if (!user || !user.id) return { ok: false, status: 401, error: 'مطلوب تسجيل الدخول.' };
    if (!['approved', 'rejected'].includes(decision)) return { ok: false, status: 400, error: 'قرار غير صالح.' };
    const normalized = reason == null ? '' : String(reason).trim();
    if (!normalized) return { ok: false, status: 400, error: 'سبب القرار مطلوب.' };
    const row = db.prepare('SELECT * FROM approval_requests WHERE id=?').get(id);
    if (!row) return { ok: false, status: 404, error: 'الطلب غير موجود.' };
    try {
      row.reason = storage.decodeJson(row.reason, 'approval-reason:' + row.id);
    } catch (_) {
      row.reason = row.reason;
    }
    if (row.requester_id === user.id) return { ok: false, status: 403, error: 'لا يجوز اعتماد طلبك الشخصي.' };
    if (row.status !== 'pending') return { ok: false, status: 409, error: 'سبق اتخاذ قرار بهذا الطلب.' };
    if (Date.now() - Date.parse(row.created_at) > 7 * 86400000) {
      return { ok: false, status: 409, error: 'انتهت مهلة الطلب؛ سجّل طلبًا جديدًا.' };
    }
    const complaint = current(row.complaint_id);
    if (decision === 'approved' && (!complaint || fingerprint(complaint) !== row.target_hash)) {
      return { ok: false, status: 409, error: 'تغيرت الشكوى بعد الطلب. ارفض الطلب ثم سجّل طلبًا جديدًا.' };
    }
    let archivedFile;
    try {
      db.transaction(() => {
        db.prepare(
          'UPDATE approval_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE id=?'
        ).run(
          decision,
          user.id,
          new Date().toISOString(),
          storage.encodeJson(normalized, 'approval-decision:' + id),
          id
        );
        if (decision === 'approved') {
          if (row.kind === 'attachment_delete') {
            archivedFile = attachmentsService.archive(row.target_id);
            audit(user.id, 'attachment_deleted', 'attachment', row.target_id, {
              approvalId: id,
              requesterId: row.requester_id,
              reason: row.reason,
              retainedInArchive: true
            });
          } else {
            const reasonText =
              typeof row.reason === 'string'
                ? row.reason
                : (row.reason && row.reason.text) || 'طلب حفظ في الأرشيف';
            const result =
              row.kind === 'complaint_duplicate'
                ? complaintsService.linkDuplicate({
                    complaintId: row.complaint_id,
                    originalId: row.target_id,
                    approvalId: id,
                    userId: user.id
                  })
                : row.kind === 'complaint_archive'
                  ? complaintsService.archiveComplaint({
                      complaintId: row.complaint_id,
                      approvalId: id,
                      userId: user.id,
                      reason: reasonText
                    })
                  : complaintsService.changeStatus({
                      complaintId: row.complaint_id,
                      toStatus: 'cancelled',
                      reason: reasonText,
                      userId: user.id,
                      username: user.username,
                      approvalId: id
                    });
            if (!result.ok) throw new Error(result.error);
          }
        }
        audit(user.id, 'approval_decided', 'approval', id, {
          decision,
          reason: normalized,
          requesterId: row.requester_id,
          kind: row.kind,
          targetId: row.target_id
        });
      })();
    } catch (error) {
      if (archivedFile) attachmentsService.restoreArchived(archivedFile);
      throw error;
    }
    audit.syncHead?.();
    return { ok: true, decision };
  }

  return { request, list, decide };
}

module.exports = { createApprovalsService };
