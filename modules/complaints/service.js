'use strict';
const crypto = require('node:crypto');
const { createRolesService } = require('../roles/service');
const { storageFor } = require('../../lib/storage-codec');
const { diffComplaints: defaultDiff } = require('../../lib/complaint-state-diff');
const { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } = require('../../lib/default-settings');
const { dayBoundary } = require('../../lib/work-time');

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
  draft: 'مسودة', new: 'جديدة', in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد الجهة', awaiting_approval: 'بانتظار الاعتماد',
  closed: 'مغلقة', cancelled: 'ملغاة'
});
const REASON_REQUIRED = Object.freeze(new Set(['closed', 'cancelled']));
const EDITABLE_FIELDS = ['name','phone','province','entity','category','nature','priority','owner','summary','details','confidentiality','source','firstContactDate'];

function emptyState() {
  return { complaints: [], notifications: [], templates: structuredClone(DEFAULT_TEMPLATES), settings: structuredClone(DEFAULT_SETTINGS) };
}

function createComplaintsService({ db, audit, logger, rolesService }) {
  const roles = rolesService || createRolesService({ db });
  const storage = storageFor(db);
  db.exec('CREATE TABLE IF NOT EXISTS complaint_counters(year INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
  const actorFor = userId => db.prepare('SELECT id, username, role FROM users WHERE id=?').get(userId);
  function syncAudit() { if (!db.inTransaction && typeof audit?.syncHead === 'function') audit.syncHead(); }
  const statusUndos = new Map();

  function readState() {
    const row = db.prepare('SELECT state_json, updated_at, revision FROM app_state WHERE id = 1').get();
    if (!row) return { state: emptyState(), updatedAt: null, revision: 0 };
    let state;
    try { state = storage.decodeJson(row.state_json, 'app-state'); }
    catch (error) { throw new Error('تعذر قراءة الحالة المحفوظة؛ أُوقف الحفظ لحماية البيانات.', { cause: error }); }
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('الحالة المحفوظة تالفة.');
    if (!Array.isArray(state.complaints)) state.complaints = [];
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (!Array.isArray(state.templates)) state.templates = [];
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    return { state, updatedAt: row.updated_at || null, revision: Number(row.revision) || 0 };
  }

  function findIndex(state, complaintId) {
    let idx = (state.complaints || []).findIndex((c) => c && c.id === complaintId);
    if (idx >= 0) return idx;
    const row = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(complaintId);
    if (row && row.payload_json) {
      try { state.complaints.push(storage.decodeJson(row.payload_json, 'complaint:' + complaintId)); return state.complaints.length - 1; }
      catch (_) { return -1; }
    }
    return -1;
  }

  function persistState(state, userId, now, nextRevision, auditEvents = [], expectedCurrentRevision = null) {
    const stateJson = storage.encodeJson(state, 'app-state');
    const actorId = userId || (db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get() || {}).id || null;
    if (!actorId) throw new Error('لا يوجد مستخدم لتسجيل تحديث الحالة.');
    const revisionToWrite = Number(nextRevision);
    if (!Number.isSafeInteger(revisionToWrite) || revisionToWrite < 1) {
      throw new Error('رقم مراجعة الحالة غير صالح.');
    }
    let conflict = false;
    const tx = db.transaction(() => {
      const existing = db.prepare('SELECT id, revision FROM app_state WHERE id = 1').get();
      if (existing) {
        if (expectedCurrentRevision !== null && expectedCurrentRevision !== undefined) {
          const cas = db.prepare(
            'UPDATE app_state SET state_json = ?, updated_by = ?, updated_at = ?, revision = ? WHERE id = 1 AND revision = ?'
          ).run(stateJson, actorId, now, revisionToWrite, Number(expectedCurrentRevision));
          if (cas.changes !== 1) {
            conflict = true;
            return;
          }
        } else {
          db.prepare(
            'UPDATE app_state SET state_json = ?, updated_by = ?, updated_at = ?, revision = ? WHERE id = 1'
          ).run(stateJson, actorId, now, revisionToWrite);
        }
      } else {
        if (expectedCurrentRevision !== null && expectedCurrentRevision !== undefined && Number(expectedCurrentRevision) !== 0) {
          conflict = true;
          return;
        }
        db.prepare(
          'INSERT INTO app_state(id, state_json, updated_by, updated_at, revision) VALUES (1, ?, ?, ?, ?)'
        ).run(stateJson, actorId, now, revisionToWrite);
      }
      if (conflict) return;
      const written = db.prepare('SELECT revision FROM app_state WHERE id = 1').get();
      if (!written || Number(written.revision) !== revisionToWrite) {
        throw new Error('فشل تثبيت رقم مراجعة الحالة.');
      }
      for (const c of state.complaints || []) {
        if (!c || typeof c.id !== 'string') continue;
        const payload = storage.encodeJson(c, 'complaint:' + c.id);
        const row = db.prepare('SELECT id, payload_json FROM complaints WHERE id = ?').get(c.id);
        if (row) {
          try {
            if (JSON.stringify(storage.decodeJson(row.payload_json, 'complaint:' + c.id)) === JSON.stringify(c)) continue;
          } catch (_) {}
          db.prepare('UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?').run(payload, now, c.id);
        } else {
          db.prepare(
            'INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(c.id, payload, actorId, c.created || now, now);
        }
      }
      for (const event of auditEvents) {
        if (typeof audit === 'function') {
          audit(actorId, event.action, event.targetType || 'complaint', event.id ?? null, event.details || {});
        }
      }
    });
    tx();
    if (conflict) return { conflict: true };
    if (auditEvents.length) syncAudit();
    return { conflict: false, revision: revisionToWrite };
  }

  function saveState({ state, userId, expectedRevision, diffComplaints = defaultDiff, auditEvents = [] }) {
    const current = readState();
    const currentRevision = Number(current.revision) || 0;
    if (expectedRevision === undefined || expectedRevision === null || Number.isNaN(Number(expectedRevision))) {
      return { conflict: true, currentRevision };
    }
    if (Number(expectedRevision) !== currentRevision) {
      return { conflict: true, currentRevision };
    }
    const prevById = new Map((current.state.complaints || []).map((c) => [c.id, c]));
    const ids = new Set();
    for (const complaint of state.complaints || []) {
      if (!complaint || typeof complaint.id !== 'string' || !complaint.id.trim() || complaint.id.length > 100 || ids.has(complaint.id)) {
        return { invalidTransition: true, error: 'معرّف الشكوى غير صالح أو مكرر.' };
      }
      ids.add(complaint.id);
    }
    if ([...prevById.keys()].some(id => !ids.has(id))) {
      return { invalidTransition: true, error: 'حذف الشكاوى غير مسموح عبر حفظ الحالة؛ استخدم إجراء الحذف المعتمد.' };
    }
    const actor = actorFor(userId);
    if (currentRevision > 0 && !roles.can(actor, 'settings.manage') && JSON.stringify(current.state.settings) !== JSON.stringify(state.settings)) {
      return { invalidTransition: true, error: 'إعدادات النظام لا يغيّرها إلا المدير.' };
    }
    for (const c of state.complaints || []) {
      const prev = prevById.get(c.id);
      if (prev && prev.status !== c.status) {
        return { invalidTransition: true, error: 'تغيير الحالة غير مسموح عبر حفظ الحالة الكامل. استخدم مسار تغيير الحالة.' };
      }
      if (!prev && currentRevision > 0) {
        return { invalidTransition: true, error: 'إنشاء شكوى عبر حفظ الحالة غير مسموح؛ استخدم مسار تسجيل الشكاوى.' };
      }
      if (!prev) continue;
      if (prev.created && c.created !== prev.created) {
        return { invalidTransition: true, error: 'لا يمكن تغيير تاريخ إنشاء الشكوى.' };
      }
      if (JSON.stringify(prev.statusHistory || []) !== JSON.stringify(c.statusHistory || [])) {
        return { invalidTransition: true, error: 'سجل الحالة يُحدَّث عبر مسار تغيير الحالة فقط.' };
      }
      // Assignment must use PATCH /complaints/:id (release-http forbids forged owner via state).
      if ((prev.owner || null) !== (c.owner || null)) {
        return { invalidTransition: true, error: 'تغيير المسؤول يتم عبر مسار الإسناد فقط.' };
      }
      if (prev.status === 'closed' || prev.status === 'cancelled' || prev.archivedAt) {
        if (JSON.stringify(prev) !== JSON.stringify(c)) {
          return { invalidTransition: true, error: 'لا يمكن تعديل شكوى مغلقة أو ملغاة عبر حفظ الحالة.' };
        }
      }
      const prevReply = prev.reply || null;
      const nextReply = c.reply || null;
      if (!prevReply && nextReply) {
        const actorName = actor?.username || '';
        if (nextReply.author && actorName && nextReply.author !== actorName) {
          return { invalidTransition: true, error: 'لا يمكن إنشاء رد باسم مستخدم آخر عبر حفظ الحالة.' };
        }
        if (['approved', 'sent'].includes(nextReply.status)) {
          return { invalidTransition: true, error: 'اعتماد الرد يتطلب مساراً مختلفاً أو صلاحية المدير.' };
        }
      }
      if (prevReply && nextReply) {
        if (prevReply.author !== nextReply.author) {
          return { invalidTransition: true, error: 'لا يجوز تغيير كاتب الرد عبر حفظ الحالة.' };
        }
        if (prevReply.status !== nextReply.status) {
          if (nextReply.status === 'approved') {
            if (prevReply.status !== 'review') {
              return { invalidTransition: true, error: 'الاعتماد يتطلب حالة مراجعة قائمة.' };
            }
            if (!roles.can(actor, 'replies.approve') && actor?.role !== 'admin') {
              return { invalidTransition: true, error: 'اعتماد الرد يتطلب مديراً مختلفاً.' };
            }
          } else if (['approved', 'sent'].includes(prevReply.status) && !['approved', 'sent'].includes(nextReply.status)) {
            return { invalidTransition: true, error: 'الرد المعتمد لا يُعاد إلى مسودة.' };
          } else if (prevReply.status === 'sent' && nextReply.status !== 'sent') {
            return { invalidTransition: true, error: 'لا يمكن التراجع عن إرسال الرد المعتمد.' };
          }
        }
        if (['approved', 'sent'].includes(prevReply.status)) {
          if (nextReply.text !== prevReply.text || nextReply.author !== prevReply.author) {
            return { invalidTransition: true, error: 'لا يجوز تغيير نص الرد المعتمد.' };
          }
        }
      }
      if (prevReply && !nextReply) {
        return { invalidTransition: true, error: 'لا يمكن حذف الرد عبر حفظ الحالة.' };
      }
      const prevTl = Array.isArray(prev.timeline) ? prev.timeline : [];
      const nextTl = Array.isArray(c.timeline) ? c.timeline : [];
      if (nextTl.length > prevTl.length) {
        const actorName = actor?.username || '';
        for (let i = 0; i < nextTl.length - prevTl.length; i++) {
          const entry = nextTl[i];
          if (entry && entry.by && actorName && entry.by !== actorName && entry.by !== 'system' && entry.by !== 'النظام') {
            return { invalidTransition: true, error: 'لا يمكن إضافة أحداث باسم مستخدم آخر عبر حفظ الحالة.' };
          }
        }
      }
      if (JSON.stringify(prev.notes || []) !== JSON.stringify(c.notes || [])) {
        const prevNotes = Array.isArray(prev.notes) ? prev.notes : [];
        const nextNotes = Array.isArray(c.notes) ? c.notes : [];
        if (nextNotes.length < prevNotes.length) {
          return { invalidTransition: true, error: 'حذف الملاحظات غير مسموح عبر حفظ الحالة.' };
        }
        const actorName = actor?.username || '';
        for (let i = prevNotes.length; i < nextNotes.length; i++) {
          const note = nextNotes[i];
          if (note && note.by && actorName && note.by !== actorName) {
            return { invalidTransition: true, error: 'لا يمكن إضافة ملاحظة باسم مستخدم آخر.' };
          }
        }
      }
    }
    const now = new Date().toISOString();
    const nextRevision = currentRevision + 1;
    const complaintChanges = [];
    try {
      const diffs = diffComplaints(current.state.complaints || [], state.complaints || []);
      if (Array.isArray(diffs)) for (const d of diffs) complaintChanges.push({ action: d.action || 'complaint_updated', id: d.id, details: d.details || {} });
    } catch (_) {}
    for (const c of state.complaints || []) {
      const prev = prevById.get(c.id);
      if (!prev) continue;
      if (JSON.stringify(prev.notes || []) !== JSON.stringify(c.notes || [])) {
        complaintChanges.push({ action: 'complaint_updated', id: c.id, details: { changes: { notes: { before: prev.notes || [], after: c.notes || [] } } } });
      }
    }
    if (JSON.stringify(current.state.settings || {}) !== JSON.stringify(state.settings || {})) {
      complaintChanges.push({ action: 'settings_updated', id: null, details: { before: current.state.settings || {}, after: state.settings || {} } });
    }
    const persisted = persistState(state, userId, now, nextRevision, [...complaintChanges, ...auditEvents], currentRevision);
    if (persisted && persisted.conflict) {
      return { conflict: true, currentRevision: readState().revision };
    }
    return { conflict: false, updatedAt: now, revision: nextRevision, complaintChanges };
  }

  function createComplaintCore({ body, userId, username, asDraft = false }) {
    const { state, revision } = readState();
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Damascus', year: 'numeric' }).format(new Date()));
    let maximum = 0;
    for (const row of db.prepare('SELECT id FROM complaints').all()) {
      const match = String(row.id).match(new RegExp('^SY-' + year + '-([0-9]{4,7})$'));
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
    for (const c of state.complaints || []) {
      const match = String(c && c.id || '').match(new RegExp('^SY-' + year + '-([0-9]{4,7})$'));
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
    const existing = db.prepare('SELECT value FROM complaint_counters WHERE year=?').get(year);
    const base = Math.max(maximum, existing ? Number(existing.value) : 0);
    db.prepare('INSERT INTO complaint_counters(year,value) VALUES(?,?) ON CONFLICT(year) DO UPDATE SET value=excluded.value').run(year, base);
    db.prepare('UPDATE complaint_counters SET value=value+1 WHERE year=?').run(year);
    const sequence = db.prepare('SELECT value FROM complaint_counters WHERE year=?').get(year).value;
    const id = 'SY-' + year + '-' + String(sequence).padStart(6, '0');
    const now = new Date().toISOString();
    const status = asDraft ? 'draft' : 'new';
    const complaint = {
      id, name: body.name || '', phone: body.phone || '', source: body.source || 'phone',
      province: body.province, entity: body.entity || '', category: body.category,
      nature: body.nature || '', priority: body.priority || 'normal', status,
      owner: username || null, summary: body.summary || '', details: body.details || '',
      firstContactDate: body.firstContactDate || null,
      created: now, updated: now,
      due: new Date(Date.now() + (Number(state.settings.slaDays) || 7) * 86400000).toISOString(),
      notes: [], timeline: [{ event: asDraft ? 'حفظ مسودة' : 'تسجيل الشكوى', by: username || 'system', at: now, detail: asDraft ? 'مسودة غير منشورة.' : 'تم الإنشاء عبر API.' }],
      referrals: [], reply: null, confidentiality: body.confidentiality || 'normal',
      attachments: [], coAssistants: [], statusHistory: []
    };
    state.complaints = Array.isArray(state.complaints) ? state.complaints.slice() : [];
    state.complaints.push(complaint);
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: asDraft ? 'complaint_draft_saved' : 'complaint_created', id, details: { status, revision: nextRevision } }]);
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
    const changes = {};
    for (const key of EDITABLE_FIELDS) {
      if (body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
        const next = body[key];
        if (complaint[key] !== next) {
          if (key === 'owner' && !roles.can(actorFor(userId), 'complaints.assign')) {
            return { ok: false, status: 403, error: 'ليس لديك صلاحية الإسناد.' };
          }
          changes[key] = { before: complaint[key], after: next };
          complaint[key] = next;
        }
      }
    }
    if (!Object.keys(changes).length) return { ok: true, complaint, revision, unchanged: true };
    complaint.updated = now;
    complaint.timeline = Array.isArray(complaint.timeline) ? complaint.timeline.slice() : [];
    complaint.timeline.unshift({ event: 'تعديل البيانات', by: username || 'system', at: now, detail: Object.keys(changes).join(', ') });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_updated', id: complaintId, details: { changes } }]);
    return { ok: true, complaint, revision: nextRevision };
  }

  function changeStatus({ complaintId, toStatus, reason, userId, username, closureException, approvalId }) {
    if (!complaintId || typeof complaintId !== 'string') return { ok: false, status: 400, error: 'معرّف الشكوى غير صالح.' };
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, toStatus)) return { ok: false, status: 400, error: 'حالة غير معروفة.' };
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    const fromStatus = complaint.status || 'new';
    if (fromStatus === toStatus) return { ok: true, unchanged: true, complaint, revision };
    const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus) && !(toStatus === 'in_progress' && ['closed','cancelled'].includes(fromStatus))) {
      return { ok: false, status: 409, error: `لا يمكن الانتقال من «${STATUS_LABELS[fromStatus] || fromStatus}» إلى «${STATUS_LABELS[toStatus] || toStatus}».` };
    }
    if (toStatus === 'in_progress' && ['closed','cancelled'].includes(fromStatus)) {
      const actor = actorFor(userId);
      if (!roles.can(actor, 'complaints.reopen') && actor?.role !== 'admin') {
        return { ok: false, status: 403, error: 'إعادة الفتح تتطلب صلاحية خاصة.' };
      }
      if (!reason || !String(reason).trim()) {
        return { ok: false, status: 400, error: 'سبب إعادة الفتح مطلوب.' };
      }
    }
    if (toStatus === 'closed') {
      const openRefs = (complaint.referrals || []).filter((r) => r && !r.response);
      if (openRefs.length) return { ok: false, status: 409, error: 'لا يمكن الإغلاق قبل استلام ردود الإحالات.' };
    }
    if (toStatus === 'cancelled') {
      const hasOfficial = (complaint.referrals || []).some((r) => r && r.entity);
      if (hasOfficial && !approvalId) {
        return { ok: false, status: 409, approvalRequired: true, error: 'الإلغاء بعد إحالة رسمية يتطلب موافقة ثانية.' };
      }
    }
    if (REASON_REQUIRED.has(toStatus) && (!reason || !String(reason).trim())) {
      return { ok: false, status: 400, error: 'سبب الانتقال مطلوب للإغلاق أو الإلغاء.' };
    }
    const now = new Date().toISOString();
    complaint.status = toStatus;
    complaint.updated = now;
    complaint.statusHistory = Array.isArray(complaint.statusHistory) ? complaint.statusHistory.slice() : [];
    complaint.statusHistory.push({ from: fromStatus, to: toStatus, at: now, by: username || null, reason: reason || null });
    complaint.timeline = Array.isArray(complaint.timeline) ? complaint.timeline.slice() : [];
    complaint.timeline.unshift({ event: 'تغيير الحالة', by: username || 'system', at: now, detail: `من ${STATUS_LABELS[fromStatus] || fromStatus} إلى ${STATUS_LABELS[toStatus] || toStatus}${reason ? ' — ' + reason : ''}` });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_status_changed', id: complaintId, details: { from: fromStatus, to: toStatus, reason: reason || null } }]);
    const undoToken = crypto.randomUUID();
    const undoExpiresAt = Date.now() + 60000;
    statusUndos.set(undoToken, {
      complaintId,
      from: fromStatus,
      to: toStatus,
      userId,
      revision: nextRevision,
      expiresAt: undoExpiresAt
    });
    return { ok: true, complaint, revision: nextRevision, unchanged: false, undoToken, undoExpiresAt };
  }

  function undoStatus({ complaintId, token, userId, username }) {
    if (!token || !statusUndos.has(token)) {
      return { ok: false, status: 409, error: 'رمز التراجع غير صالح.' };
    }
    const record = statusUndos.get(token);
    if (record.userId !== userId) {
      return { ok: false, status: 403, error: 'غير مصرح بالتراجع.' };
    }
    if (record.complaintId && complaintId && record.complaintId !== complaintId) {
      return { ok: false, status: 409, error: 'رمز التراجع لا يطابق الشكوى.' };
    }
    if (Date.now() > record.expiresAt) {
      statusUndos.delete(token);
      return { ok: false, status: 409, error: 'انتهت صلاحية التراجع.' };
    }
    const { state, revision } = readState();
    if (Number(revision) !== Number(record.revision)) {
      statusUndos.delete(token);
      return { ok: false, status: 409, error: 'تغيرت مراجعة الحالة.' };
    }
    const idx = findIndex(state, record.complaintId || complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (complaint.status !== record.to) {
      statusUndos.delete(token);
      return { ok: false, status: 409, error: 'الحالة تغيّرت.' };
    }
    const now = new Date().toISOString();
    complaint.status = record.from;
    complaint.updated = now;
    complaint.statusHistory = Array.isArray(complaint.statusHistory) ? complaint.statusHistory.slice() : [];
    complaint.statusHistory.push({
      from: record.to,
      to: record.from,
      at: now,
      by: username || null,
      reason: 'تراجع فوري'
    });
    complaint.timeline = Array.isArray(complaint.timeline) ? complaint.timeline.slice() : [];
    complaint.timeline.unshift({
      event: 'تراجع عن تغيير الحالة',
      at: now,
      by: username || 'system',
      detail: (STATUS_LABELS[record.to] || record.to) + ' ← ' + (STATUS_LABELS[record.from] || record.from)
    });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    statusUndos.delete(token);
    persistState(state, userId, now, nextRevision, [{
      action: 'complaint_status_undone',
      id: record.complaintId || complaintId,
      details: { from: record.to, to: record.from }
    }]);
    return { ok: true, complaint, revision: nextRevision };
  }

  function deleteComplaint({ complaintId, userId } = {}) {
    return { ok: false, status: 409, error: 'الحذف يتطلب موافقة.' };
  }
  function archiveComplaint({ complaintId, userId, reason, approvalId } = {}) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (complaint.archivedAt) return { ok: true, unchanged: true, complaint, revision };
    const now = new Date().toISOString();
    complaint.archivedAt = now;
    complaint.archiveReason = reason || null;
    complaint.updated = now;
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_archived', id: complaintId, details: { reason: reason || null } }]);
    return { ok: true, complaint, revision: nextRevision };
  }
  function addReferral({ complaintId, entity, due, note, userId, username } = {}) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const prev = state.complaints[idx];
    if (['closed', 'cancelled'].includes(prev.status) || prev.archivedAt) return { ok: false, status: 409, error: 'لا يمكن إحالة شكوى مغلقة.' };
    const fromStatus = prev.status || 'new';
    const now = new Date().toISOString();
    const referral = {
      entity: entity || '',
      due: due || null,
      note: note || '',
      at: now,
      by: username || null,
      response: null
    };
    const complaint = { ...prev };
    complaint.referrals = Array.isArray(prev.referrals) ? prev.referrals.slice() : [];
    complaint.referrals.push(referral);
    complaint.status = 'awaiting_reply';
    complaint.updated = now;
    complaint.statusHistory = Array.isArray(prev.statusHistory) ? prev.statusHistory.slice() : [];
    complaint.statusHistory.push({
      from: fromStatus,
      to: 'awaiting_reply',
      at: now,
      by: username || null,
      reason: note || null
    });
    complaint.timeline = Array.isArray(prev.timeline) ? prev.timeline.slice() : [];
    complaint.timeline.unshift({
      event: 'إحالة',
      by: username || 'system',
      at: now,
      detail: entity || ''
    });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [
      { action: 'complaint_referred', id: complaintId, details: { entity, due: due || null } },
      { action: 'complaint_status_changed', id: complaintId, details: { from: fromStatus, to: 'awaiting_reply' } }
    ]);
    return { ok: true, complaint, revision: nextRevision };
  }
  function recordReferralResponse({ complaintId, index, response, userId, username } = {}) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    const referrals = Array.isArray(complaint.referrals) ? complaint.referrals.slice() : [];
    if (index < 0 || index >= referrals.length) return { ok: false, status: 400, error: 'إحالة غير موجودة.' };
    const now = new Date().toISOString();
    referrals[index] = { ...referrals[index], response: response || '', respondedAt: now, respondedBy: username || null };
    complaint.referrals = referrals;
    complaint.updated = now;
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'referral_response', id: complaintId, details: { index } }]);
    return { ok: true, complaint, revision: nextRevision };
  }
  function linkDuplicate({ complaintId, targetId, originalId, userId, username } = {}) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    targetId = targetId || originalId;
    const targetIdx = findIndex(state, targetId);
    if (idx < 0 || targetIdx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    if (complaintId === targetId) return { ok: false, status: 400, error: 'لا يمكن ربط الشكوى بنفسها.' };
    const target = state.complaints[targetIdx];
    if (target.duplicateOf === complaintId) return { ok: false, status: 400, error: 'ربط دائري غير مسموح.' };
    const complaint = { ...state.complaints[idx] };
    const now = new Date().toISOString();
    complaint.duplicateOf = targetId;
    complaint.updated = now;
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_linked_duplicate', id: complaintId, details: { targetId } }]);
    return { ok: true, complaint, revision: nextRevision };
  }
  function actOnReply({ complaintId, action, userId, username, text } = {}) {
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    const reply = complaint.reply ? { ...complaint.reply } : { status: 'draft', author: username, text: '' };
    const now = new Date().toISOString();
    if (action === 'draft') {
      if (reply.status === 'approved' || reply.status === 'sent') return { ok: false, status: 409, error: 'لا يجوز تغيير نص الرد المعتمد.' };
      reply.text = text != null ? text : reply.text;
      reply.author = username || reply.author;
      reply.authorId = userId;
      reply.status = 'draft';
      reply.editedById = userId;
    } else if (action === 'review') {
      if (!reply.text) return { ok: false, status: 400, error: 'لا يوجد نص للرد.' };
      reply.status = 'review';
      reply.editedById = userId;
    } else if (action === 'approve') {
      if (!roles.can(actorFor(userId), 'replies.approve')) return { ok: false, status: 403, error: 'اعتماد الرد يتطلب صلاحية مستقلة.' };
      if (reply.status !== 'review') return { ok: false, status: 409, error: 'الاعتماد يتطلب حالة مراجعة.' };
      if (reply.authorId === userId || reply.editedById === userId || reply.author === username) {
        return { ok: false, status: 403, error: 'لا يمكن للكاتب أو آخر معدّل اعتماد الرد.' };
      }
      reply.status = 'approved';
      reply.approvedById = userId;
      reply.approvedAt = now;
    } else if (action === 'sent') {
      if (reply.status !== 'approved' && reply.status !== 'sent') return { ok: false, status: 409, error: 'الإرسال يتطلب رداً معتمداً.' };
      reply.status = 'sent';
      reply.sentAt = now;
    } else {
      return { ok: false, status: 400, error: 'إجراء رد غير معروف.' };
    }
    complaint.reply = reply;
    complaint.updated = now;
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'reply_' + action, id: complaintId, details: { status: reply.status } }]);
    return { ok: true, complaint, revision: nextRevision };
  }
  function runReminders(asOf = new Date()) {
    const { state, revision } = readState();
    const now = asOf instanceof Date ? asOf : new Date(asOf);
    let sent = 0;
    const events = [];
    const nextComplaints = (state.complaints || []).map((c) => {
      if (!c || c.archivedAt || ['closed', 'cancelled'].includes(c.status)) return c;
      if (c.completionReminderStopped) return c;
      const incomplete = !c.name || !c.phone || !c.details;
      if (!incomplete) return c;
      const created = Date.parse(c.created);
      if (!Number.isFinite(created)) return c;
      const hours = (now.getTime() - created) / 3600000;
      if (hours < 24) return c;
      const last = c.lastCompletionReminderAt ? Date.parse(c.lastCompletionReminderAt) : 0;
      if (last && (now.getTime() - last) < 24 * 3600000) return c;
      sent += 1;
      events.push({ action: 'completion_reminded', id: c.id, details: {} });
      return { ...c, lastCompletionReminderAt: now.toISOString() };
    });
    if (!sent) return 0;
    state.complaints = nextComplaints;
    const nextRevision = (Number(revision) || 0) + 1;
    const systemUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    const safeSystemId = systemUser ? systemUser.id : null;
    persistState(state, safeSystemId, now.toISOString(), nextRevision, events);
    return sent;
  }

  return {
    readState, saveState, createComplaint, updateComplaint, deleteComplaint, archiveComplaint,
    changeStatus, undoStatus, addReferral, recordReferralResponse, linkDuplicate, actOnReply, runReminders,
    ALLOWED_TRANSITIONS, REASON_REQUIRED, STATUS_LABELS
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
