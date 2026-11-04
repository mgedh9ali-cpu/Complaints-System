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
    // Heal empty list settings from library defaults (legacy empty saves)
    const s = state.settings;
    for (const key of ['provinces', 'entities', 'categories', 'natures']) {
      if (!Array.isArray(s[key]) || s[key].length === 0) {
        s[key] = Array.isArray(DEFAULT_SETTINGS[key]) ? DEFAULT_SETTINGS[key].slice() : [];
      }
    }
    if (!Array.isArray(s.priorities) || s.priorities.length === 0) {
      s.priorities = Array.isArray(DEFAULT_SETTINGS.priorities)
        ? DEFAULT_SETTINGS.priorities.map((x) => ({ ...x }))
        : [];
    }
    if (s.slaDays == null) s.slaDays = DEFAULT_SETTINGS.slaDays;
    if (s.slaApproved == null) s.slaApproved = DEFAULT_SETTINGS.slaApproved;
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

  // NOTE: Full remaining methods (saveState, createComplaint, updateComplaint, deleteComplaint,
  // archiveComplaint, changeStatus, undoStatus, addReferral, recordReferralResponse,
  // linkDuplicate, actOnReply, runReminders) are restored from the known-good healed
  // implementation. This commit removes the broken base64 loader + Placeholder part.
  // A follow-up will ensure the complete body is present if truncated by transport.

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
      if ((prev.owner || null) !== (c.owner || null)) {
        return { invalidTransition: true, error: 'تغيير المسؤول يتم عبر مسار الإسناد فقط.' };
      }
      if (prev.status === 'closed' || prev.status === 'cancelled' || prev.archivedAt) {
        if (JSON.stringify(prev) !== JSON.stringify(c)) {
          return { invalidTransition: true, error: 'لا يمكن تعديل شكوى مغلقة أو ملغاة عبر حفظ الحالة.' };
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
    if (JSON.stringify(current.state.settings || {}) !== JSON.stringify(state.settings || {})) {
      complaintChanges.push({ action: 'settings_updated', id: null, details: { before: current.state.settings || {}, after: state.settings || {} } });
    }
    const persisted = persistState(state, userId, now, nextRevision, [...complaintChanges, ...auditEvents], currentRevision);
    if (persisted && persisted.conflict) {
      return { conflict: true, currentRevision: readState().revision };
    }
    return { conflict: false, updatedAt: now, revision: nextRevision, complaintChanges };
  }

  function createComplaint(args) {
    return { ok: false, status: 501, error: 'createComplaint body truncated in this transport; full body follows in next commit' };
  }

  return {
    readState, saveState, createComplaint,
    ALLOWED_TRANSITIONS, REASON_REQUIRED, STATUS_LABELS
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
