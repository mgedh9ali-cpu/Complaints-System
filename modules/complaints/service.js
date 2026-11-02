'use strict';

const crypto = require('node:crypto');
const { createRolesService } = require('../roles/service');
const { storageFor } = require('../../lib/storage-codec');
const { diffComplaints: defaultDiff } = require('../../lib/complaint-state-diff');
const { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } = require('../../lib/default-settings');
const {dayBoundary}=require('../../lib/work-time');

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
  , 'source'
];

function emptyState() {
  return {
    complaints: [],
    notifications: [],
    templates: structuredClone(DEFAULT_TEMPLATES),
    settings: structuredClone(DEFAULT_SETTINGS)
  };
}

function createComplaintsService({ db, audit, logger, rolesService }) {
  const roles = rolesService || createRolesService({ db });
  const storage = storageFor(db);
  db.exec('CREATE TABLE IF NOT EXISTS complaint_counters(year INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
  const actorFor = userId => db.prepare('SELECT id, username, role FROM users WHERE id=?').get(userId);
  function syncAudit() { if (!db.inTransaction && typeof audit?.syncHead === 'function') audit.syncHead(); }
  function readState() {
    const row = db
      .prepare('SELECT state_json, updated_at, revision FROM app_state WHERE id = 1')
      .get();
    if (!row) {
      return { state: emptyState(), updatedAt: null, revision: 0 };
    }
    let state;
    try {
      state = storage.decodeJson(row.state_json, 'app-state');
    } catch (error) {
      throw new Error('تعذر قراءة الحالة المحفوظة؛ أُوقف الحفظ لحماية البيانات.', { cause: error });
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('الحالة المحفوظة تالفة.');
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
        state.complaints.push(storage.decodeJson(row.payload_json, 'complaint:' + complaintId));
        return state.complaints.length - 1;
      } catch (_) {
        return -1;
      }
    }
    return -1;
  }

  function persistState(state, userId, now, nextRevision, auditEvents = []) {
    const stateJson = storage.encodeJson(state, 'app-state');
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
        const payload = storage.encodeJson(c, 'complaint:' + c.id);
        const existing = db.prepare('SELECT id, payload_json FROM complaints WHERE id = ?').get(c.id);
        if (existing) {
          if (JSON.stringify(storage.decodeJson(existing.payload_json, 'complaint:' + c.id)) === JSON.stringify(c)) continue;
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
    if (auditEvents.length) syncAudit();
  }

  function saveState({ state, userId, expectedRevision, diffComplaints = defaultDiff, auditEvents = [] }) {
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
    const actor = actorFor(userId);
    if (current.revision > 0 && !roles.can(actor, 'settings.manage') &&
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
        for (const key of ['archivedAt','archivedBy','archiveReason','archiveApprovalId','duplicateOf','lastCompletionReminderAt','lastEscalationAt']) {
          if (JSON.stringify(prev[key]) !== JSON.stringify(c[key])) return {
            invalidTransition: true, error: 'الأرشفة تتطلب مسار موافقة منفصلًا.'
          };
        }
        if (prev.archivedAt && JSON.stringify(prev) !== JSON.stringify(c)) return {
          invalidTransition: true, error: 'الشكوى مؤرشفة ولا يمكن تعديلها.'
        };
        if (JSON.stringify(prev.referrals || []) !== JSON.stringify(c.referrals || [])) return {
          invalidTransition: true, error: 'تعديل الإحالات يتطلب مسار الإحالات المخصص.'
        };
        const oldTimeline = prev.timeline || [], nextTimeline = c.timeline || [];
        const appendOnly = Array.isArray(nextTimeline) && nextTimeline.length >= oldTimeline.length &&
          (JSON.stringify(nextTimeline.slice(0, oldTimeline.length)) === JSON.stringify(oldTimeline) ||
           JSON.stringify(nextTimeline.slice(nextTimeline.length - oldTimeline.length)) === JSON.stringify(oldTimeline));
        if (!appendOnly) {
          return { invalidTransition: true, error: 'لا يجوز محو سجل الإجراءات أو إعادة كتابته.' };
        }
        const appended = JSON.stringify(nextTimeline.slice(0, oldTimeline.length)) === JSON.stringify(oldTimeline)
          ? nextTimeline.slice(oldTimeline.length) : nextTimeline.slice(0, nextTimeline.length - oldTimeline.length);
        if (appended.some(event => !event || event.by !== actor?.username || typeof event.event !== 'string' ||
            typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)))) {
          return { invalidTransition: true, error: 'لا يجوز انتحال اسم مستخدم في سجل الإجراءات.' };
        }
        if ((prev.owner !== c.owner || JSON.stringify(prev.coAssistants || []) !== JSON.stringify(c.coAssistants || [])) &&
            !roles.can(actor, 'complaints.assign')) return { invalidTransition: true, error: 'ليس لديك صلاحية الإسناد.' };
        if (prev.owner !== c.owner || JSON.stringify(prev.coAssistants || []) !== JSON.stringify(c.coAssistants || [])) {
          const assignees = [c.owner, ...(c.coAssistants || [])];
          if (new Set(assignees).size !== assignees.length || assignees.some(name => {
            if (typeof name !== 'string' || !name) return true;
            const assigned = db.prepare('SELECT id,role FROM users WHERE username=? AND active=1').get(name);
            return !assigned || !roles.can(assigned, 'complaints.update');
          })) return { invalidTransition: true, error: 'يجب الإسناد إلى حسابات معالجة نشطة ومختلفة.' };
        }
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
      if (afterReply && (!['draft','review','approval','approved','sent'].includes(afterStatus) ||
          typeof afterReply.text !== 'string' || !afterReply.text.trim() || afterReply.text.length > 10000)) {
        return { invalidTransition: true, error: 'مرحلة الرد أو محتواه غير صالح.' };
      }
      const replyChanged = JSON.stringify(beforeReply) !== JSON.stringify(afterReply);
      if (replyChanged && !roles.can(actor, afterStatus === 'approved' ? 'replies.approve' :
          afterStatus === 'sent' ? 'replies.send' : 'replies.draft')) {
        return { invalidTransition: true, error: 'ليس لديك صلاحية هذا الإجراء على الرد.' };
      }
      if (beforeReply && !afterReply) return { invalidTransition: true, error: 'لا يجوز حذف الرد عبر حفظ الحالة.' };
      if (!beforeReply && afterReply && afterReply.author !== actor?.username) {
        return { invalidTransition: true, error: 'يجب أن يكون معد الرد هو المستخدم الذي أنشأه.' };
      }
      if (beforeReply && afterReply && beforeReply.author !== afterReply.author) {
        return { invalidTransition: true, error: 'لا يمكن تغيير هوية معد الرد.' };
      }
      if (afterStatus === 'approved' && beforeStatus !== 'approved') {
        if (!actor || !roles.can(actor, 'replies.approve') || !beforeReply ||
            !['review', 'approval'].includes(beforeStatus) ||
            beforeReply.author === actor.username ||
            beforeReply.lastEditedBy === actor.username ||
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
      if (replyChanged && afterReply) {
        if (!beforeReply || beforeReply.text !== afterReply.text) {
          afterReply.lastEditedBy = actor?.username;
          afterReply.lastEditedById = actor?.id;
        }
        if (afterStatus === 'approved' && beforeStatus !== 'approved') {
          afterReply.approvedBy = actor.username;
          afterReply.approvedById = actor.id;
          afterReply.approvedAt = new Date().toISOString();
        } else if (beforeReply && ['approved','sent'].includes(beforeStatus)) {
          for (const key of ['approvedBy','approvedById','approvedAt','lastEditedBy','lastEditedById']) {
            if (beforeReply[key] !== undefined) afterReply[key] = beforeReply[key];
          }
        }
        if (afterStatus === 'sent' && beforeStatus !== 'sent') {
          afterReply.sentBy = actor.username; afterReply.sentAt = new Date().toISOString();
        }
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
        throw err;
      }
    }
    const settingsEvents = JSON.stringify(current.state.settings) !== JSON.stringify(state.settings) &&
      !auditEvents.some(event => event.action === 'settings_updated') ? [{
        action: 'settings_updated', targetType: 'settings',
        details: { before: current.state.settings, after: state.settings }
      }] : [];
    persistState(state, userId, now, nextRevision, [...complaintChanges, ...settingsEvents, ...auditEvents]);
    return {
      conflict: false,
      updatedAt: now,
      revision: nextRevision,
      complaintChanges
    };
  }

  function createComplaintCore({ body, userId, username, asDraft = false }) {
    const { state, revision } = readState();
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Damascus', year: 'numeric' }).format(new Date()));
    const counter = db.prepare('SELECT value FROM complaint_counters WHERE year=?').get(year);
      let maximum = counter?.value || 0;
      for (const row of db.prepare('SELECT id FROM complaints').all()) {
        const match = row.id.match(new RegExp('^SY-' + year + '-([0-9]{4,7})$'));
        if (match) maximum = Math.max(maximum, Number(match[1]));
      }
      db.prepare('INSERT INTO complaint_counters(year,value) VALUES(?,?) ON CONFLICT(year) DO UPDATE SET value=excluded.value').run(year, maximum);
    db.prepare('UPDATE complaint_counters SET value=value+1 WHERE year=?').run(year);
    const sequence = db.prepare('SELECT value FROM complaint_counters WHERE year=?').get(year).value;
    const id = 'SY-' + year + '-' + String(sequence).padStart(6, '0');
    const now = new Date().toISOString();
    const status = asDraft ? 'draft' : 'new';
    const complaint = {
      id,
      name: body.name || '',
      phone: body.phone || '',
      source: body.source || 'phone',
      province: body.province,
      entity: body.entity || '',
      category: body.category,
      priority: body.priority || 'normal',
      status,
      owner: username || null,
      summary: body.summary || '',
      details: body.details || '',
      created: now,
      updated: now,
      due: new Date(Date.now() + (Number(state.settings.slaDays) || 7) * 86400000).toISOString(),
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
      coAssistants: [],
      statusHistory: []
    };

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

  function createComplaint(args) {
    const result = db.transaction(() => createComplaintCore(args))();
    syncAudit();
    return result;
  }

  function updateComplaint({ complaintId, body, userId, username }) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (complaint.archivedAt || complaint.status === 'closed' || complaint.status === 'cancelled') {
      return { ok: false, status: 409, error: 'لا يمكن تعديل شكوى مغلقة أو ملغاة.' };
    }
    const now = new Date().toISOString();
    const changes = [];
    const before = {};
    for (const key of EDITABLE_FIELDS) {
      if (body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
        const next = body[key];
        if (complaint[key] !== next) {
          if (key === 'owner' && !roles.can(actorFor(userId), 'complaints.assign')) return {
            ok: false, status: 403, error: 'ليس لديك صلاحية الإسناد.'
          };
          before[key] = complaint[key] ?? null;
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
      details: { fields: changes, revision: nextRevision,
        changes: Object.fromEntries(changes.map(key => [key, { before: before[key], after: complaint[key] }])) }
    }]);
    return { ok: true, complaint, revision: nextRevision, unchanged: false };
  }

  function deleteComplaint({ complaintId, userId, username }) {
    return { ok: false, status: 409, error: 'الحذف المباشر معطل. قدّم طلب أرشفة لاعتماده من مدير آخر.' };
  }

  function archiveComplaint({ complaintId, approvalId, userId }) {
    const approval = db.prepare("SELECT * FROM approval_requests WHERE id=? AND kind='complaint_archive' AND status='approved'").get(approvalId);
    if (!approval || approval.complaint_id !== complaintId || approval.requester_id === userId || approval.decided_by !== userId) {
      return { ok: false, status: 403, error: 'يلزم اعتماد مدير آخر لطلب الأرشفة.' };
    }
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = state.complaints[idx];
    if (complaint.archivedAt) return { ok: false, status: 409, error: 'الشكوى مؤرشفة بالفعل.' };
    const now = new Date().toISOString();
    const nextRevision = (Number(revision) || 0) + 1;
    const archiveReason = storage.decodeJson(approval.reason, 'approval-reason:' + approval.id);
    Object.assign(complaint, { archivedAt: now, archivedBy: userId, archiveReason, archiveApprovalId: approvalId });
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_archived', id: complaintId,
      details: { approvalId, reason: archiveReason, requesterId: approval.requester_id } }]);
    return { ok: true, revision: nextRevision, deletedId: complaintId };
  }

  function addReferral({ complaintId, entity, due, note, userId, username }) {
    const normalizedEntity = typeof entity === 'string' ? entity.trim() : '';
    const normalizedNote = typeof note === 'string' ? note.trim() : '';
    const dueMs = typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due) ? dayBoundary(due,true) : Date.parse(due);
    if (!complaintId || typeof complaintId !== 'string' || complaintId.length > 100 ||
        normalizedEntity.length < 2 || normalizedEntity.length > 200 ||
        normalizedNote.length > 4000 || typeof due !== 'string' ||
        !Number.isFinite(dueMs)) {
      return { ok: false, status: 400, error: 'بيانات الإحالة غير صالحة.' };
    }

    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (complaint.archivedAt || ['closed', 'cancelled', 'draft', 'new'].includes(complaint.status)) {
      return { ok: false, status: 409, error: 'لا يمكن إحالة شكوى مغلقة أو ملغاة.' };
    }

    const now = new Date().toISOString();
    const referral = {
      entity: normalizedEntity,
      sent: now,
      due: new Date(dueMs).toISOString(),
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

  function recordReferralResponse({ complaintId, index, response, userId, username }) {
    if (typeof response !== 'string' || response.trim().length < 3 || response.length > 10000 || !Number.isSafeInteger(index)) {
      return { ok: false, status: 400, error: 'نص رد الإحالة أو رقمها غير صالح.' };
    }
    const { state, revision } = readState();
    const c = state.complaints.find(item => item.id === complaintId);
    if (!c || !c.referrals?.[index]) return { ok: false, status: 404, error: 'الإحالة غير موجودة.' };
    if (c.archivedAt || ['closed','cancelled'].includes(c.status)) return { ok: false, status: 409, error: 'الشكوى مغلقة أو مؤرشفة.' };
    const before = c.referrals[index].response || '';
    const now = new Date().toISOString();
    Object.assign(c.referrals[index], { response: response.trim(), respondedAt: now, respondedBy: username, status: 'ورد الرد' });
    c.updated = now;
    persistState(state, userId, now, revision + 1, [{ action: 'referral_response_recorded', id: complaintId,
      details: { index, before, after: response.trim() } }]);
    return { ok: true, revision: revision + 1 };
  }

  function linkDuplicate({ complaintId, originalId, approvalId, userId }) {
    const approval = db.prepare("SELECT * FROM approval_requests WHERE id=? AND kind='complaint_duplicate' AND status='approved'").get(approvalId);
    if (!approval || approval.complaint_id !== complaintId || approval.target_id !== originalId ||
        approval.requester_id === userId || approval.decided_by !== userId) return { ok: false, status: 403, error: 'موافقة الربط غير صالحة.' };
    const { state, revision } = readState();
    const complaint = state.complaints.find(c => c.id === complaintId);
    const original = state.complaints.find(c => c.id === originalId);
    if (!complaint || !original || complaint === original || original.duplicateOf || complaint.archivedAt || original.archivedAt) {
      return { ok: false, status: 409, error: 'الربط دائري أو إحدى الشكويين غير متاحة.' };
    }
    complaint.duplicateOf = originalId;
    complaint.updated = new Date().toISOString();
    persistState(state, userId, complaint.updated, revision + 1, [{ action: 'complaint_linked_as_duplicate', id: complaintId,
      details: { originalId, approvalId, requesterId: approval.requester_id } }]);
    return { ok: true, revision: revision + 1 };
  }

  function actOnReply({ complaintId, action, text, userId, username }) {
    const actor = actorFor(userId);
    const permission = { draft: 'replies.draft', review: 'replies.draft', approve: 'replies.approve', sent: 'replies.send' }[action];
    if (!permission || !roles.can(actor, permission)) return { ok: false, status: 403, error: 'ليس لديك صلاحية إجراء الرد.' };
    const { state, revision } = readState();
    const c = state.complaints.find(item => item.id === complaintId);
    if (!c) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    if (c.archivedAt || ['closed','cancelled'].includes(c.status)) return { ok: false, status: 409, error: 'الشكوى مغلقة أو مؤرشفة.' };
    if (action === 'draft') {
      if (['approved','sent'].includes(c.reply?.status)) return { ok: false, status: 409, error: 'الرد المعتمد ثابت.' };
      if (typeof text !== 'string' || !text.trim() || text.length > 10000) return { ok: false, status: 400, error: 'نص الرد غير صالح.' };
      c.reply = { ...(c.reply || {}), author: c.reply?.author || username, text: text.trim(), status: 'draft' };
    } else {
      const required = { review: ['draft'], approve: ['review','approval'], sent: ['approved'] }[action];
      if (!c.reply || !required.includes(c.reply.status)) return { ok: false, status: 409, error: 'انتقال مرحلة الرد غير مسموح.' };
      c.reply.status = action === 'approve' ? 'approved' : action;
    }
    c.updated = new Date().toISOString();
    c.timeline ||= [];
    c.timeline.push({ event: ({ draft: 'حفظ مسودة رد', review: 'إرسال الرد للمراجعة', approve: 'اعتماد الرد', sent: 'توثيق إرسال الرد' })[action],
      by: username, at: c.updated, detail: 'تم توثيق الإجراء على الخادم.' });
    const result = saveState({ state, userId, expectedRevision: revision });
    if (result.invalidTransition || result.conflict) return { ok: false, status: 409, error: result.error || 'تعارض حفظ.' };
    return { ok: true, revision: result.revision, reply: c.reply };
  }

  function changeStatus({ complaintId, toStatus, reason, userId, username, approvalId, closureException = false }) {
    if (!complaintId || typeof complaintId !== 'string' || complaintId.length > 100) {
      return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
    }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, toStatus)) {
      return { ok: false, status: 400, error: 'حالة غير معروفة.' };
    }
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (normalizedReason.length > 2000) return { ok: false, status: 400, error: 'سبب الانتقال أطول من المسموح.' };
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
    if (fromStatus === 'draft' && toStatus === 'new' &&
        (complaint.province === 'غير محددة' || complaint.category === 'غير مصنفة' || complaint.summary === 'مسودة بانتظار الاستكمال')) {
      return { ok: false, status: 409, error: 'استكمل الموضوع والمحافظة والتصنيف قبل نشر المسودة.' };
    }
    if (complaint.archivedAt) return { ok: false, status: 409, error: 'الشكوى مؤرشفة.' };
    const officialAction = (complaint.referrals || []).length > 0 || ['approved','sent'].includes(complaint.reply?.status);
    if (toStatus === 'cancelled' && officialAction) {
      const approval = approvalId && db.prepare("SELECT * FROM approval_requests WHERE id=? AND kind='complaint_cancel' AND status='approved'").get(approvalId);
      if (!approval || approval.complaint_id !== complaintId || approval.requester_id === userId || approval.decided_by !== userId) {
        return { ok: false, status: 409, error: 'الإلغاء بعد إجراء رسمي يتطلب طلب موافقة من مستخدم آخر.', approvalRequired: true };
      }
    }
    if (toStatus === 'closed' && (complaint.referrals || []).some(r => !r.response?.trim())) {
      if (!closureException || !roles.can(actorFor(userId), 'complaints.closeException') || normalizedReason.length < 10) {
        return { ok: false, status: 409, error: 'يجب استكمال ردود الإحالات أو توثيق استثناء إغلاق من مستخدم مخول (10 أحرف على الأقل).' };
      }
    }
    if (fromStatus === toStatus) {
      return { ok: true, unchanged: true, complaint, revision };
    }
    const reopening = ['closed','cancelled'].includes(fromStatus) && toStatus === 'in_progress';
    if (reopening && (!roles.can(actorFor(userId), 'complaints.reopen') || normalizedReason.length < 3)) {
      return { ok: false, status: 403, error: 'إعادة الفتح تتطلب صلاحية مستقلة وسببًا واضحًا.' };
    }
    const allowed = reopening ? ['in_progress'] : ALLOWED_TRANSITIONS[fromStatus] || [];
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
        closureException: Boolean(closureException),
        approvalId: approvalId || null,
        revision: nextRevision
      }
    }]);
    return { ok: true, complaint, revision: nextRevision, unchanged: false };
  }

  function runReminders(now = new Date()) {
    const { state, revision } = readState();
    const admin = db.prepare("SELECT id, username FROM users WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1").get();
    if (!admin) return 0;
    const interval = Math.max(1, Math.min(720, Number(state.settings.completionReminderHours) || 24)) * 3600000;
    const events = [];
    for (const c of state.complaints) {
      if (c.archivedAt || ['closed','cancelled'].includes(c.status)) continue;
      const incomplete = c.status === 'draft' || !c.name || !c.phone || !c.details ||
        !c.province || c.province === 'غير محددة' || c.category === 'غير مصنفة';
      const late = state.settings.slaApproved === true && c.status !== 'draft' && Date.parse(c.due) < now.getTime();
      for (const [kind, needed, field] of [
        ['completion', incomplete && !c.completionReminderStopped, 'lastCompletionReminderAt'],
        ['escalation', late, 'lastEscalationAt']
      ]) {
        if (!needed || now.getTime() - Date.parse(c[field] || c.created) < interval) continue;
        c[field] = now.toISOString();
        state.notifications.unshift({ id: crypto.randomUUID(), complaintId: c.id, type: kind,
          title: kind === 'completion' ? 'استكمال بيانات مطلوب' : 'تصعيد إلى المدير: تجاوز المهلة',
          body: c.id, date: now.toISOString(), read: false, targetRole: kind === 'escalation' ? 'admin' : null });
        events.push({ action: kind === 'completion' ? 'completion_reminded' : 'complaint_escalated', id: c.id,
          details: { at: now.toISOString(), targetRole: kind === 'escalation' ? 'admin' : null } });
      }
    }
    if (events.length) persistState(state, admin.id, now.toISOString(), revision + 1, events);
    return events.length;
  }

  return {
    readState,
    saveState,
    createComplaint,
    updateComplaint,
    deleteComplaint,
    archiveComplaint,
    changeStatus,
    addReferral,
    recordReferralResponse,
    linkDuplicate,
    actOnReply,
    runReminders,
    ALLOWED_TRANSITIONS,
    REASON_REQUIRED,
    STATUS_LABELS
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
