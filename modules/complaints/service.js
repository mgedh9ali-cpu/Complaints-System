'use strict';

const crypto = require('node:crypto');

const ALLOWED_TRANSITIONS = Object.freeze({
  draft: ['new', 'cancelled'],
  new: ['in_progress', 'cancelled', 'draft'],
  in_progress: ['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_reply: ['in_progress', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_approval: ['in_progress', 'closed', 'cancelled'],
  closed: [],
  cancelled: []
});

const STATUS_LABELS = Object.freeze({
  draft: 'مسودة',
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد الجهة',
  awaiting_approval: 'بانتظار الاعتماد',
  closed: 'مغلقة',
  cancelled: 'ملغاة'
});

const REASON_REQUIRED = Object.freeze(new Set(['closed', 'cancelled']));

const EDITABLE_FIELDS = [
  'name',
  'phone',
  'province',
  'entity',
  'category',
  'priority',
  'owner',
  'summary',
  'details',
  'confidentiality'
];

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

  function findIndex(state, complaintId) {
    let idx = (state.complaints || []).findIndex((c) => c && c.id === complaintId);
    if (idx >= 0) return idx;
    const row = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(complaintId);
    if (row && row.payload_json) {
      try {
        state.complaints.push(JSON.parse(row.payload_json));
        return state.complaints.length - 1;
      } catch (_) {
        return -1;
      }
    }
    return -1;
  }

  function persistState(state, userId, now, nextRevision, auditEvents = []) {
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
      for (const c of state.complaints || []) {
        if (!c || typeof c.id !== 'string') continue;
        const payload = JSON.stringify(c);
        const existing = db.prepare('SELECT id FROM complaints WHERE id = ?').get(c.id);
        if (existing) {
          db.prepare('UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?').run(
            payload,
            now,
            c.id
          );
        } else {
          db.prepare(
            'INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(c.id, payload, userId || null, c.created || now, now);
        }
      }
      // The complaint records and their immutable audit trail commit as one SQLite transaction.
      for (const event of auditEvents) {
        if (typeof audit === 'function') {
          audit(userId, event.action, event.targetType || 'complaint', event.id ?? null, event.details || {});
        }
      }
    });
    tx();
    if (auditEvents.length && typeof audit?.syncHead === 'function') audit.syncHead();
  }

  function saveState({ state, userId, expectedRevision, diffComplaints, auditEvents = [] }) {
    const current = readState();
    if (Number(expectedRevision) !== Number(current.revision)) {
      return { conflict: true, currentRevision: current.revision };
    }
    const prevById = new Map((current.state.complaints || []).map((c) => [c.id, c]));
    const ids = new Set();
    for (const complaint of state.complaints || []) {
      if (!complaint || typeof complaint.id !== 'string' ||
          !complaint.id.trim() || complaint.id.length > 100 ||
          ids.has(complaint.id)) {
        return { invalidTransition: true, error: 'معرّف الشكوى غير صالح أو مكرر.' };
      }
      ids.add(complaint.id);
    }
    // The generic state endpoint must never be a backdoor for deleting records.
    // Explicit deletion is audited and restricted to the manager-only API.
    if ([...prevById.keys()].some(id => !ids.has(id))) {
      return {
        invalidTransition: true,
        error: 'حذف الشكاوى غير مسموح عبر حفظ الحالة؛ استخدم إجراء الحذف المعتمد.'
      };
    }
    const actor = db.prepare('SELECT username, role FROM users WHERE id = ?').get(userId);
    if (current.revision > 0 && actor?.role !== 'admin' &&
        JSON.stringify(current.state.settings) !== JSON.stringify(state.settings)) {
      return { invalidTransition: true, error: 'إعدادات النظام لا يغيّرها إلا المدير.' };
    }
    for (const c of state.complaints || []) {
      const prev = prevById.get(c.id);
      if (prev && prev.status !== c.status) {
        return {
          invalidTransition: true,
          error: 'تغيير الحالة غير مسموح عبر حفظ الحالة الكامل. استخدم مسار تغيير الحالة.'
        };
      }
      // The state endpoint can update working notes and assignments, but it is not
      // authorized to mint official complaint numbers or rewrite their history.
      // An initial local import through the legacy empty-state bootstrap remains
      // supported for compatibility; subsequent creation uses POST /complaints.
      if (!prev && current.revision > 0) {
        return {
          invalidTransition: true,
          error: 'إنشاء شكوى عبر حفظ الحالة غير مسموح؛ استخدم مسار تسجيل الشكاوى.'
        };
      }
      if (prev) {
        if (prev.created !== c.created) {
          return {
            invalidTransition: true,
            error: 'تاريخ إنشاء الشكوى ثابت ولا يمكن تعديله.'
          };
        }
        if (JSON.stringify(prev.statusHistory || []) !==
            JSON.stringify(c.statusHistory || [])) {
          return {
            invalidTransition: true,
            error: 'سجل انتقالات الحالة لا يُعدّل عبر حفظ الحالة الكامل.'
          };
        }
        if (['closed', 'cancelled'].includes(prev.status) &&
            JSON.stringify(prev) !== JSON.stringify(c)) {
          return {
            invalidTransition: true,
            error: 'لا يمكن تعديل شكوى مغلقة أو ملغاة عبر حفظ الحالة.'
          };
        }
        if (prev.reply && ['approved', 'sent'].includes(prev.reply.status)) {
          const before = prev.reply;
          const after = c.reply;
          const allowedStatus = before.status === 'approved'
            ? ['approved', 'sent']
            : ['sent'];
          if (!after || !allowedStatus.includes(after.status) ||
              before.author !== after.author || before.text !== after.text) {
            return {
              invalidTransition: true,
              error: 'لا يجوز تغيير نص الرد المعتمد أو مؤلفه أو إرجاع مرحلته.'
            };
          }
        }
      }
      const beforeReply = prev?.reply;
      const afterReply = c?.reply;
      const beforeStatus = beforeReply?.status || null;
      const afterStatus = afterReply?.status || null;
      if (!beforeReply && afterReply && afterReply.author !== actor?.username) {
        return { invalidTransition: true, error: 'يجب أن يكون معد الرد هو المستخدم الذي أنشأه.' };
      }
      if (beforeReply && afterReply && beforeReply.author !== afterReply.author) {
        return { invalidTransition: true, error: 'لا يمكن تغيير هوية معد الرد.' };
      }
      if (afterStatus === 'approved' && beforeStatus !== 'approved') {
        if (!actor || actor.role !== 'admin' || !beforeReply ||
            !['review', 'approval'].includes(beforeStatus) ||
            beforeReply.author === actor.username ||
            beforeReply.author !== afterReply.author ||
            beforeReply.text !== afterReply.text) {
          return {
            invalidTransition: true,
            error: 'اعتماد الرد يتطلب مديراً مختلفاً عن معد الرد ومسودة مراجعة ثابتة.'
          };
        }
      }
      if (afterStatus === 'sent' && beforeStatus !== 'sent' &&
          (beforeStatus !== 'approved' || !beforeReply ||
           beforeReply.author !== afterReply.author ||
           beforeReply.text !== afterReply.text)) {
        return {
          invalidTransition: true,
          error: 'لا يمكن توثيق إرسال رد قبل اعتماده.'
        };
      }
    }
    const now = new Date().toISOString();
    const nextRevision = (Number(current.revision) || 0) + 1;
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
    persistState(state, userId, now, nextRevision, [...complaintChanges, ...auditEvents]);
    return {
      conflict: false,
      updatedAt: now,
      revision: nextRevision,
      complaintChanges
    };
  }

  function createComplaint({ body, userId, username, asDraft = false }) {
    const id = 'SY-' + new Date().getFullYear() + '-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const status = asDraft ? 'draft' : 'new';
    const complaint = {
      id,
      name: body.name || '',
      phone: body.phone || '',
      province: body.province,
      entity: body.entity || '',
      category: body.category,
      priority: body.priority || 'normal',
      status,
      owner: body.owner || username || null,
      summary: body.summary || '',
      details: body.details || '',
      created: now,
      updated: now,
      due: new Date(Date.now() + 7 * 86400000).toISOString(),
      notes: [],
      timeline: [
        {
          event: asDraft ? 'حفظ مسودة' : 'تسجيل الشكوى',
          by: username || 'system',
          at: now,
          detail: asDraft ? 'مسودة غير منشورة.' : 'تم الإنشاء عبر API.'
        }
      ],
      referrals: [],
      reply: null,
      confidentiality: body.confidentiality || 'normal',
      attachments: [],
      statusHistory: []
    };

    const { state, revision } = readState();
    state.complaints = Array.isArray(state.complaints) ? state.complaints.slice() : [];
    state.complaints.push(complaint);
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{
      action: asDraft ? 'complaint_draft_saved' : 'complaint_created',
      id,
      details: { status, revision: nextRevision }
    }]);
    return { ok: true, complaint, revision: nextRevision };
  }

  function updateComplaint({ complaintId, body, userId, username }) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (complaint.status === 'closed' || complaint.status === 'cancelled') {
      return { ok: false, status: 409, error: 'لا يمكن تعديل شكوى مغلقة أو ملغاة.' };
    }
    const now = new Date().toISOString();
    const changes = [];
    for (const key of EDITABLE_FIELDS) {
      if (body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
        const next = body[key];
        if (complaint[key] !== next) {
          changes.push(key);
          complaint[key] = next;
        }
      }
    }
    if (!changes.length) {
      return { ok: true, unchanged: true, complaint, revision };
    }
    complaint.updated = now;
    if (!Array.isArray(complaint.timeline)) complaint.timeline = [];
    complaint.timeline.push({
      event: 'تعديل الشكوى',
      by: username || 'system',
      at: now,
      detail: 'حقول: ' + changes.join(', ')
    });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{
      action: 'complaint_updated',
      id: complaintId,
      details: { fields: changes, revision: nextRevision }
    }]);
    return { ok: true, complaint, revision: nextRevision, unchanged: false };
  }

  function deleteComplaint({ complaintId, userId, username }) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = state.complaints[idx];
    if (complaint.status !== 'draft' && complaint.status !== 'new' && complaint.status !== 'cancelled') {
      return {
        ok: false,
        status: 409,
        error: 'يُسمح بالحذف للمسودات والجديدة والملغاة فقط. أغلق أو ألغِ الحالات الأخرى أولاً.'
      };
    }
    state.complaints.splice(idx, 1);
    const now = new Date().toISOString();
    const nextRevision = (Number(revision) || 0) + 1;
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO app_state(id, state_json, updated_by, updated_at, revision)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at,
           revision = excluded.revision`
      ).run(JSON.stringify(state), userId, now, nextRevision);
      db.prepare('DELETE FROM complaints WHERE id = ?').run(complaintId);
      if (typeof audit === 'function') {
        audit(userId, 'complaint_deleted', 'complaint', complaintId, {
          by: username || null,
          revision: nextRevision
        });
      }
    });
    tx();
    if (typeof audit?.syncHead === 'function') audit.syncHead();
    return { ok: true, revision: nextRevision, deletedId: complaintId };
  }

  function addReferral({ complaintId, entity, due, note, userId, username }) {
    const normalizedEntity = typeof entity === 'string' ? entity.trim() : '';
    const normalizedNote = typeof note === 'string' ? note.trim() : '';
    if (!complaintId || typeof complaintId !== 'string' || complaintId.length > 100 ||
        normalizedEntity.length < 2 || normalizedEntity.length > 200 ||
        normalizedNote.length > 4000 || typeof due !== 'string' ||
        !Number.isFinite(Date.parse(due))) {
      return { ok: false, status: 400, error: 'بيانات الإحالة غير صالحة.' };
    }

    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (['closed', 'cancelled'].includes(complaint.status)) {
      return { ok: false, status: 409, error: 'لا يمكن إحالة شكوى مغلقة أو ملغاة.' };
    }

    const now = new Date().toISOString();
    const referral = {
      entity: normalizedEntity,
      sent: now,
      due: new Date(due).toISOString(),
      status: 'بانتظار الرد',
      response: '',
      note: normalizedNote
    };
    complaint.referrals = Array.isArray(complaint.referrals) ? complaint.referrals.slice() : [];
    complaint.referrals.push(referral);
    complaint.timeline = Array.isArray(complaint.timeline) ? complaint.timeline.slice() : [];
    complaint.timeline.push({
      event: 'إحالة إلى جهة',
      by: username || 'system',
      at: now,
      detail: 'تم توثيق إحالة إلى ' + normalizedEntity + '.'
    });
    const events = [{
      action: 'complaint_referred',
      id: complaintId,
      details: { entity: normalizedEntity, due: referral.due }
    }];
    if (complaint.status === 'in_progress') {
      complaint.status = 'awaiting_reply';
      complaint.statusHistory = Array.isArray(complaint.statusHistory)
        ? complaint.statusHistory.slice() : [];
      complaint.statusHistory.push({
        from: 'in_progress', to: 'awaiting_reply', at: now,
        by: username || null, reason: 'إحالة إلى ' + normalizedEntity
      });
      events.push({
        action: 'complaint_status_changed',
        id: complaintId,
        details: {
          from: 'in_progress', to: 'awaiting_reply',
          reason: 'إحالة إلى ' + normalizedEntity
        }
      });
    }
    complaint.updated = now;
    state.complaints[idx] = complaint;
    state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
    state.notifications.unshift({
      id: crypto.randomUUID(),
      title: 'إحالة جديدة',
      body: complaintId + ' · إحالة إلى ' + normalizedEntity,
      date: now,
      read: false
    });
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, events);
    return { ok: true, complaint, referral, revision: nextRevision };
  }

  function changeStatus({ complaintId, toStatus, reason, userId, username }) {
    if (!complaintId || typeof complaintId !== 'string' || complaintId.length > 100) {
      return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
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
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };

    const complaint = { ...state.complaints[idx] };
    const fromStatus = complaint.status || 'new';
    if (fromStatus === toStatus) {
      return { ok: true, unchanged: true, complaint, revision };
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
    persistState(state, userId, now, nextRevision, [{
      action: 'complaint_status_changed',
      id: complaintId,
      details: {
        from: fromStatus,
        to: toStatus,
        reason: normalizedReason || null,
        revision: nextRevision
      }
    }]);
    return { ok: true, complaint, revision: nextRevision, unchanged: false };
  }

  return {
    readState,
    saveState,
    createComplaint,
    updateComplaint,
    deleteComplaint,
    changeStatus,
    addReferral,
    ALLOWED_TRANSITIONS,
    REASON_REQUIRED,
    STATUS_LABELS
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
