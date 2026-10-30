'use strict';

const crypto = require('node:crypto');

const ALLOWED_TRANSITIONS = Object.freeze({
  new: ['in_progress', 'cancelled'],
  in_progress: ['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_reply: ['in_progress', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_approval: ['in_progress', 'closed', 'cancelled'],
  closed: [],
  cancelled: []
});

const STATUS_LABELS = Object.freeze({
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد الجهة',
  awaiting_approval: 'بانتظار الاعتماد',
  closed: 'مغلقة',
  cancelled: 'ملغاة'
});

/** Terminal statuses that always require a non-empty reason. */
const REASON_REQUIRED = Object.freeze(new Set(['closed', 'cancelled']));

function emptyState() {
  return {
    complaints: [],
    notifications: [],
    templates: [],
    settings: {}
  };
}

function createComplaintsService({ db, audit, logger }) {
  function readState() {
    const row = db
      .prepare('SELECT state_json, updated_at, revision FROM app_state WHERE id = 1')
      .get();
    if (!row) {
      return { state: emptyState(), updatedAt: null, revision: 0 };
    }
    let state;
    try {
      state = JSON.parse(row.state_json);
    } catch {
      state = emptyState();
    }
    if (!state || typeof state !== 'object') state = emptyState();
    if (!Array.isArray(state.complaints)) state.complaints = [];
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (!Array.isArray(state.templates)) state.templates = [];
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    return {
      state,
      updatedAt: row.updated_at || null,
      revision: Number(row.revision) || 0
    };
  }

  function syncComplaintRow(complaint, userId, now) {
    if (!complaint || typeof complaint.id !== 'string') return;
    const payload = JSON.stringify(complaint);
    const existing = db.prepare('SELECT id FROM complaints WHERE id = ?').get(complaint.id);
    if (existing) {
      db.prepare(
        'UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?'
      ).run(payload, now, complaint.id);
    } else {
      db.prepare(
        'INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(complaint.id, payload, userId || null, complaint.created || now, now);
    }
  }

  function saveState({ state, userId, expectedRevision, diffComplaints }) {
    const current = readState();
    if (Number(expectedRevision) !== Number(current.revision)) {
      return {
        conflict: true,
        currentRevision: current.revision
      };
    }

    const prevById = new Map(
      (current.state.complaints || []).map((c) => [c.id, c])
    );
    for (const c of state.complaints || []) {
      const prev = prevById.get(c.id);
      if (prev && prev.status !== c.status) {
        return {
          invalidTransition: true,
          error:
            'تغيير الحالة غير مسموح عبر حفظ الحالة الكامل. استخدم مسار تغيير الحالة PATCH /api/complaints/:id/status.'
        };
      }
    }

    const now = new Date().toISOString();
    const nextRevision = (Number(current.revision) || 0) + 1;
    const stateJson = JSON.stringify(state);

    const complaintChanges = [];
    if (typeof diffComplaints === 'function') {
      try {
        const diffs = diffComplaints(current.state.complaints || [], state.complaints || []);
        if (Array.isArray(diffs)) {
          for (const d of diffs) {
            complaintChanges.push({
              action: d.action || 'complaint_updated',
              id: d.id,
              details: d.details || {}
            });
          }
        }
      } catch (err) {
        if (logger) logger.warn('diffComplaints failed', { error: err.message });
      }
    }

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO app_state(id, state_json, updated_by, updated_at, revision)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at,
           revision = excluded.revision`
      ).run(stateJson, userId, now, nextRevision);

      for (const c of state.complaints || []) {
        syncComplaintRow(c, userId, now);
      }
    });
    tx();

    return {
      conflict: false,
      updatedAt: now,
      revision: nextRevision,
      complaintChanges
    };
  }

  /**
   * Create a complaint in both the complaints table and app_state (single transaction).
   */
  function createComplaint({ body, userId, username }) {
    const id = 'SY-' + new Date().getFullYear() + '-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const complaint = {
      id,
      name: body.name || '',
      phone: body.phone || '',
      province: body.province,
      entity: body.entity || '',
      category: body.category,
      priority: body.priority || 'normal',
      status: 'new',
      owner: body.owner || username || null,
      summary: body.summary,
      details: body.details || '',
      created: now,
      updated: now,
      due: new Date(Date.now() + 7 * 86400000).toISOString(),
      notes: [],
      timeline: [
        {
          event: 'تسجيل الشكوى',
          by: username || 'system',
          at: now,
          detail: 'تم الإنشاء عبر API.'
        }
      ],
      referrals: [],
      reply: null,
      confidentiality: 'normal',
      survey: null,
      attachments: [],
      statusHistory: []
    };

    const { state, revision } = readState();
    if ((state.complaints || []).some((c) => c && c.id === id)) {
      return { ok: false, status: 409, error: 'تعارض في معرّف الشكوى. أعد المحاولة.' };
    }

    state.complaints = Array.isArray(state.complaints) ? state.complaints.slice() : [];
    state.complaints.push(complaint);
    const nextRevision = (Number(revision) || 0) + 1;
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
      ).run(stateJson, userId, now, nextRevision);
      syncComplaintRow(complaint, userId, now);
    });
    tx();

    if (typeof audit === 'function') {
      audit(userId, 'complaint_created', 'complaint', id, {
        source: 'api',
        status: 'new',
        revision: nextRevision
      });
    }
    if (logger) logger.info('complaint created', { complaintId: id, revision: nextRevision });

    return { ok: true, complaint, revision: nextRevision };
  }

  function changeStatus({ complaintId, toStatus, reason, userId, username }) {
    if (!complaintId || typeof complaintId !== 'string' || complaintId.length > 100) {
      return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
    }
    if (toStatus === "closed" && (!reason || !String(reason).trim())) {
      return { ok: false, status: 400, error: "سبب الإغلاق مطلوب." };
    }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, toStatus)) {
      return { ok: false, status: 400, error: 'حالة غير معروفة.' };
    }

    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (REASON_REQUIRED.has(toStatus) && normalizedReason.length < 3) {
      return {
        ok: false,
        status: 400,
        error: 'يجب ذكر سبب واضح (3 أحرف على الأقل) عند الإغلاق أو الإلغاء.'
      };
    }

    const { state, revision } = readState();
    if (!Array.isArray(state.complaints)) state.complaints = [];
    let idx = state.complaints.findIndex((c) => c && c.id === complaintId);
    if (idx < 0) {
      const row = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(complaintId);
      if (row && row.payload_json) {
        try {
          state.complaints.push(JSON.parse(row.payload_json));
          idx = state.complaints.length - 1;
        } catch (_) {}
      }
    }
    if (idx < 0) {
      return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    }

    const complaint = { ...state.complaints[idx] };
    const fromStatus = complaint.status || 'new';

    if (fromStatus === toStatus) {
      return {
        ok: true,
        unchanged: true,
        complaint,
        revision
      };
    }

    const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      return {
        ok: false,
        status: 409,
        error: `لا يمكن الانتقال من «${STATUS_LABELS[fromStatus] || fromStatus}» إلى «${STATUS_LABELS[toStatus] || toStatus}».`
      };
    }

    const now = new Date().toISOString();
    complaint.status = toStatus;
    complaint.updated = now;
    if (!Array.isArray(complaint.statusHistory)) complaint.statusHistory = [];
    complaint.statusHistory.push({
      from: fromStatus,
      to: toStatus,
      at: now,
      by: username || null,
      reason: normalizedReason || null
    });
    if (!Array.isArray(complaint.timeline)) complaint.timeline = [];
    complaint.timeline.push({
      event: 'تغيير الحالة',
      by: username || 'system',
      at: now,
      detail: `من ${STATUS_LABELS[fromStatus] || fromStatus} إلى ${STATUS_LABELS[toStatus] || toStatus}${normalizedReason ? ' — ' + normalizedReason : ''}`
    });

    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
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
      ).run(stateJson, userId, now, nextRevision);
      syncComplaintRow(complaint, userId, now);
    });
    tx();

    if (typeof audit === 'function') {
      audit(userId, 'complaint_status_changed', 'complaint', complaintId, {
        from: fromStatus,
        to: toStatus,
        reason: normalizedReason || null,
        revision: nextRevision
      });
    }
    if (logger) {
      logger.info('complaint status changed', {
        complaintId,
        from: fromStatus,
        to: toStatus,
        revision: nextRevision
      });
    }

    return {
      ok: true,
      complaint,
      revision: nextRevision,
      unchanged: false
    };
  }

  return {
    readState,
    saveState,
    createComplaint,
    changeStatus,
    ALLOWED_TRANSITIONS,
    REASON_REQUIRED
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
