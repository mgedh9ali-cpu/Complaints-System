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
const EDITABLE_FIELDS = ['name','phone','province','entity','category','nature','priority','owner','summary','details','confidentiality','source'];

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

  function persistState(state, userId, now, nextRevision, auditEvents = []) {
    const stateJson = storage.encodeJson(state, 'app-state');
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO app_state(id, state_json, updated_by, updated_at, revision)\n         VALUES (1, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           state_json = excluded.state_json, updated_by = excluded.updated_by,\n           updated_at = excluded.updated_at, revision = excluded.revision`).run(stateJson, userId, now, nextRevision);
      for (const c of state.complaints || []) {
        if (!c || typeof c.id !== 'string') continue;
        const payload = storage.encodeJson(c, 'complaint:' + c.id);
        const existing = db.prepare('SELECT id, payload_json FROM complaints WHERE id = ?').get(c.id);
        if (existing) {
          try {
            if (JSON.stringify(storage.decodeJson(existing.payload_json, 'complaint:' + c.id)) === JSON.stringify(c)) continue;
          } catch (_) {}
          db.prepare('UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?').run(payload, now, c.id);
        } else {
          db.prepare('INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(c.id, payload, userId || null, c.created || now, now);
        }
      }
      for (const event of auditEvents) {
        if (typeof audit === 'function') audit(userId, event.action, event.targetType || 'complaint', event.id ?? null, event.details || {});
      }
    });
    tx();
    if (auditEvents.length) syncAudit();
  }

  function saveState({ state, userId, expectedRevision, diffComplaints = defaultDiff, auditEvents = [] }) {
    const current = readState();
    if (Number(expectedRevision) !== Number(current.revision)) return { conflict: true, currentRevision: current.revision };
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
    if (current.revision > 0 && !roles.can(actor, 'settings.manage') && JSON.stringify(current.state.settings) !== JSON.stringify(state.settings)) {
      return { invalidTransition: true, error: 'إعدادات النظام لا يغيّرها إلا المدير.' };
    }
    for (const c of state.complaints || []) {
      const prev = prevById.get(c.id);
      if (prev && prev.status !== c.status) {
        return { invalidTransition: true, error: 'تغيير الحالة غير مسموح عبر حفظ الحالة الكامل. استخدم مسار تغيير الحالة.' };
      }
      if (!prev && current.revision > 0) {
        return { invalidTransition: true, error: 'إنشاء شكوى عبر حفظ الحالة غير مسموح؛ استخدم مسار تسجيل الشكاوى.' };
      }
      if (prev && (prev.status === 'closed' || prev.status === 'cancelled' || prev.archivedAt)) {
        // Closed/cancelled records are immutable via bulk state save; use dedicated status/archive flows.
        if (JSON.stringify(prev) !== JSON.stringify(c)) {
          return { invalidTransition: true, error: 'لا يمكن تعديل شكوى مغلقة أو ملغاة عبر حفظ الحالة.' };
        }
      }
    }
    const now = new Date().toISOString();
    const nextRevision = (Number(current.revision) || 0) + 1;
    const complaintChanges = [];
    try {
      const diffs = diffComplaints(current.state.complaints || [], state.complaints || []);
      if (Array.isArray(diffs)) for (const d of diffs) complaintChanges.push({ action: d.action || 'complaint_updated', id: d.id, details: d.details || {} });
    } catch (_) {}
    persistState(state, userId, now, nextRevision, [...complaintChanges, ...auditEvents]);
    return { conflict: false, updatedAt: now, revision: nextRevision, complaintChanges };
  }

  function createComplaintCore({ body, userId, username, asDraft = false }) {
    const { state, revision } = readState();
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Damascus', year: 'numeric' }).format(new Date()));
    let counter = db.prepare('SELECT value FROM complaint_counters WHERE year=?').get(year);
    if (!counter) {
      let maximum = 0;
      for (const row of db.prepare('SELECT id FROM complaints').all()) {
        const match = String(row.id).match(new RegExp('^SY-' + year + '-([0-9]{4,7})$'));
        if (match) maximum = Math.max(maximum, Number(match[1]));
      }
      db.prepare('INSERT INTO complaint_counters(year,value) VALUES(?,?) ON CONFLICT(year) DO UPDATE SET value=excluded.value').run(year, maximum);
    }
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
    const changes = [];
    for (const key of EDITABLE_FIELDS) {
      if (body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
        const next = body[key];
        if (complaint[key] !== next) {
          if (key === 'owner' && !roles.can(actorFor(userId), 'complaints.assign')) {
            return { ok: false, status: 403, error: 'ليس لديك صلاحية الإسناد.' };
          }
          changes.push(key);
          complaint[key] = next;
        }
      }
    }
    if (!changes.length) return { ok: true, complaint, revision, unchanged: true };
    complaint.updated = now;
    complaint.timeline = Array.isArray(complaint.timeline) ? complaint.timeline.slice() : [];
    complaint.timeline.unshift({ event: 'تعديل البيانات', by: username || 'system', at: now, detail: changes.join(', ') });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_updated', id: complaintId, details: { changes } }]);
    return { ok: true, complaint, revision: nextRevision };
  }

  function changeStatus({ complaintId, toStatus, reason, userId, username, closureException }) {
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
    statusUndos.set(complaintId, { from: fromStatus, to: toStatus, at: Date.now() });
    return { ok: true, complaint, revision: nextRevision, unchanged: false };
  }

  function undoStatus({ complaintId, userId, username }) {
    const undo = statusUndos.get(complaintId);
    if (!undo || Date.now() - undo.at > 5000) return { ok: false, status: 409, error: 'لا يوجد تراجع متاح.' };
    const { state, revision } = readState();
    const idx = findIndex(state, complaintId);
    if (idx < 0) return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
    const complaint = { ...state.complaints[idx] };
    if (complaint.status !== undo.to) return { ok: false, status: 409, error: 'الحالة تغيّرت.' };
    const now = new Date().toISOString();
    complaint.status = undo.from;
    complaint.updated = now;
    complaint.statusHistory = Array.isArray(complaint.statusHistory) ? complaint.statusHistory.slice() : [];
    complaint.statusHistory.push({ from: undo.to, to: undo.from, at: now, by: username, reason: 'تراجع فوري' });
    complaint.timeline = Array.isArray(complaint.timeline) ? complaint.timeline.slice() : [];
    complaint.timeline.unshift({ event: 'تراجع عن تغيير الحالة', at: now, by: username, detail: (STATUS_LABELS[undo.to] || undo.to) + ' ← ' + (STATUS_LABELS[undo.from] || undo.from) });
    state.complaints[idx] = complaint;
    const nextRevision = (Number(revision) || 0) + 1;
    persistState(state, userId, now, nextRevision, [{ action: 'complaint_status_undo', id: complaintId, details: {} }]);
    statusUndos.delete(complaintId);
    return { ok: true, complaint, revision: nextRevision };
  }

  function deleteComplaint() { return { ok: false, status: 403, error: 'الحذف يتطلب موافقة.' }; }
  function archiveComplaint() { return { ok: false, status: 403, error: 'الأرشفة تتطلب موافقة.' }; }
  function addReferral() { return { ok: false, status: 501, error: 'غير متاح مؤقتاً.' }; }
  function recordReferralResponse() { return { ok: false, status: 501, error: 'غير متاح مؤقتاً.' }; }
  function linkDuplicate() { return { ok: false, status: 501, error: 'غير متاح مؤقتاً.' }; }
  function actOnReply() { return { ok: false, status: 501, error: 'غير متاح مؤقتاً.' }; }
  function runReminders() { return 0; }

  return {
    readState, saveState, createComplaint, updateComplaint, deleteComplaint, archiveComplaint,
    changeStatus, undoStatus, addReferral, recordReferralResponse, linkDuplicate, actOnReply, runReminders,
    ALLOWED_TRANSITIONS, REASON_REQUIRED, STATUS_LABELS
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
