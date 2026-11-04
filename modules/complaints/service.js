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
