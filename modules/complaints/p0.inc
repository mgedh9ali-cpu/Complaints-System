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
  'nature',
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
  const statusUndos = new Map();
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
      if (!prev && current.revision > 0) {
        return {
          invalidTransition: true,
          error: 'إنشاء شكوى عبر حفظ الحالة غير مسموح؛ استخدم مسار تسجيل الشكاوى.'
        };
      }
      if (prev) {
        for (const key of ['archivedAt','archivedBy','archiveReason','archiveApprovalId','duplicateOf','lastCompletionReminderAt','lastEscalationAt']) {
