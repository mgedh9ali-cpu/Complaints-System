'use strict';

const crypto = require('node:crypto');
const { storageFor } = require('../../lib/storage-codec');
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const KINDS = new Set(['complaint_archive', 'complaint_cancel', 'attachment_delete', 'complaint_duplicate']);

function createApprovalsService({ db, audit, complaintsService, attachmentsService }) {
  const storage = storageFor(db);
  db.exec(`CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL,
    complaint_id TEXT NOT NULL, target_hash TEXT NOT NULL,
    requester_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired')),
    created_at TEXT NOT NULL, decided_by TEXT REFERENCES users(id),
    decided_at TEXT, decision_reason TEXT
  )`);
  function current(id) {
    return complaintsService.readState().state.complaints.find(c => c.id === id);
  }
  function request({ kind, targetId, complaintId, reason, userId }) {
    const normalized = typeof reason === 'string' ? reason.trim() : '';
    if (!KINDS.has(kind) || typeof targetId !== 'string' || targetId.length > 180 ||
        normalized.length < 3 || normalized.length > 500) {
      return { ok: false, status: 400, error: 'نوع الطلب أو سبب الإجراء غير صالح.' };
    }
    const complaint = current(complaintId);
    if (!complaint || complaint.archivedAt) return { ok: false, status: 404, error: 'الشكوى غير موجودة أو مؤرشفة.' };
    if (kind === 'complaint_duplicate' && (targetId === complaintId || !current(targetId) || current(targetId).duplicateOf)) {
      return { ok: false, status: 400, error: 'الشكوى الأصلية غير صالحة للربط.' };
    }
    if (!['attachment_delete','complaint_duplicate'].includes(kind) && targetId !== complaintId) {
      return { ok: false, status: 400, error: 'الهدف لا يطابق الشكوى.' };
    }
    if (kind === 'attachment_delete' && !attachmentsService.listByComplaint(complaintId).some(a => a.storedName === targetId)) {
      return { ok: false, status: 404, error: 'المرفق غير موجود.' };
    }
    const pending = db.prepare("SELECT id,created_at FROM approval_requests WHERE kind=? AND complaint_id=? AND status='pending'").get(kind, complaintId);
    if (pending && Date.now() - Date.parse(pending.created_at) > 7 * 86400000) {
      db.transaction(() => {
        db.prepare("UPDATE approval_requests SET status='expired' WHERE id=?").run(pending.id);
        audit(userId, 'approval_expired', 'approval', pending.id, {});
      })();
      audit.syncHead?.();
    } else if (pending) {
      return { ok: false, status: 409, error: 'يوجد طلب معلّق لهذا الإجراء.' };
    }
    const id = crypto.randomUUID(), now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`INSERT INTO approval_requests
        (id,kind,target_id,complaint_id,target_hash,requester_id,reason,status,created_at)
        VALUES(?,?,?,?,?,?,?,'pending',?)`)
        .run(id, kind, targetId, complaintId, fingerprint(complaint), userId, storage.encodeJson(normalized, 'approval-reason:' + id), now);
      audit(userId, 'approval_requested', 'approval', id, { kind, targetId, complaintId, reason: normalized });
    })();
    audit.syncHead?.();
    return { ok: true, id };
  }
  function list(user) {
    return db.prepare(`SELECT a.*, u.username AS requester, d.username AS approver
      FROM approval_requests a JOIN users u ON a.requester_id=u.id
      LEFT JOIN users d ON a.decided_by=d.id
      ${user.role === 'admin' ? '' : 'WHERE a.requester_id=?'}
      ORDER BY a.created_at DESC LIMIT 1000`).all(...(user.role === 'admin' ? [] : [user.id])).map(row => ({ ...row,
        reason: storage.decodeJson(row.reason, 'approval-reason:' + row.id),
        decision_reason: row.decision_reason ? storage.decodeJson(row.decision_reason, 'approval-decision:' + row.id) : null }));
  }
  function decide({ id, decision, reason, user }) {
    const normalized = typeof reason === 'string' ? reason.trim() : '';
    if (!['approved', 'rejected'].includes(decision) || normalized.length < 3 || normalized.length > 500) {
      return { ok: false, status: 400, error: 'يلزم قرار وسبب واضح من 3 إلى 500 حرف.' };
    }
    if (user.role !== 'admin') return { ok: false, status: 403, error: 'القرار للمدير فقط.' };
    const row = db.prepare('SELECT * FROM approval_requests WHERE id=?').get(id);
    if (!row) return { ok: false, status: 404, error: 'الطلب غير موجود.' };
    row.reason = storage.decodeJson(row.reason, 'approval-reason:' + row.id);
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
        db.prepare('UPDATE approval_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE id=?')
          .run(decision, user.id, new Date().toISOString(), storage.encodeJson(normalized, 'approval-decision:' + id), id);
        if (decision === 'approved') {
          if (row.kind === 'attachment_delete') {
            archivedFile = attachmentsService.archive(row.target_id);
            audit(user.id, 'attachment_deleted', 'attachment', row.target_id,
              { approvalId: id, requesterId: row.requester_id, reason: row.reason, retainedInArchive: true });
          } else {
            const result = row.kind === 'complaint_duplicate'
              ? complaintsService.linkDuplicate({ complaintId: row.complaint_id, originalId: row.target_id, approvalId: id, userId: user.id })
              : row.kind === 'complaint_archive'
              ? complaintsService.archiveComplaint({ complaintId: row.complaint_id, approvalId: id, userId: user.id })
              : complaintsService.changeStatus({ complaintId: row.complaint_id, toStatus: 'cancelled',
                reason: row.reason, userId: user.id, username: user.username, approvalId: id });
            if (!result.ok) throw new Error(result.error);
          }
        }
        audit(user.id, 'approval_decided', 'approval', id,
          { decision, reason: normalized, requesterId: row.requester_id, kind: row.kind, targetId: row.target_id });
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
