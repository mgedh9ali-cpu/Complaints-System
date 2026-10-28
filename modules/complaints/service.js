'use strict';

/**
 * Unified complaints / app_state service.
 * Single place for read/write so server routes stay thin and consistent.
 *
 * Source of truth today: app_state.state_json
 * Secondary mirror: complaints table (payload_json) kept in sync when possible.
 */

const ALLOWED_STATUSES = Object.freeze([
  'new',
  'in_progress',
  'awaiting_reply',
  'awaiting_approval',
  'closed',
  'cancelled'
]);

/** Allowed transitions: from → Set(to) */
const TRANSITIONS = Object.freeze({
  new: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled']),
  awaiting_reply: new Set(['in_progress', 'awaiting_approval', 'closed', 'cancelled']),
  awaiting_approval: new Set(['in_progress', 'closed', 'cancelled']),
  closed: new Set([]),
  cancelled: new Set([])
});

const STATUSES_REQUIRING_REASON = new Set(['closed', 'cancelled']);

function defaultState() {
  return {
    complaints: [],
    notifications: [],
    templates: [],
    settings: {
      slaDays: 7,
      slaApproved: false,
      provinces: [],
      entities: [],
      categories: []
    }
  };
}

function createComplaintsService({ db, audit, logger }) {
  if (!db) throw new Error('createComplaintsService requires db');

  function getStateRow() {
    return db.prepare('SELECT state_json, updated_at, revision, updated_by FROM app_state WHERE id = 1').get();
  }

  function readState() {
    const row = getStateRow();
    if (!row) {
      return { state: defaultState(), updatedAt: null, revision: 0, updatedBy: null };
    }
    let state;
    try {
      state = JSON.parse(row.state_json);
    } catch {
      state = defaultState();
    }
    if (!Array.isArray(state.complaints)) state.complaints = [];
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (!Array.isArray(state.templates)) state.templates = [];
    if (!state.settings || typeof state.settings !== 'object') state.settings = defaultState().settings;
    return {
      state,
      updatedAt: row.updated_at || null,
      revision: row.revision ?? 0,
      updatedBy: row.updated_by || null
    };
  }

  function isTransitionAllowed(from, to) {
    if (!ALLOWED_STATUSES.includes(to)) return false;
    if (from === to) return true;
    const allowed = TRANSITIONS[from];
    return Boolean(allowed && allowed.has(to));
  }

  function validateStatusTransitions(previousState, nextState) {
    const prevById = new Map(
      (previousState?.complaints || [])
        .filter(c => c && typeof c.id === 'string')
        .map(c => [c.id, c])
    );
    for (const complaint of nextState.complaints || []) {
      if (!complaint || typeof complaint.id !== 'string') continue;
      const prev = prevById.get(complaint.id);
      if (!prev) continue;
      const from = prev.status || 'new';
      const to = complaint.status || 'new';
      if (from !== to && !isTransitionAllowed(from, to)) {
        return {
          ok: false,
          error: `انتقال الحالة غير مسموح من «${from}» إلى «${to}» للشكوى ${complaint.id}. استخدم مسار تغيير الحالة.`
        };
      }
    }
    return { ok: true };
  }

  /** Mirror a single complaint into the complaints table (best-effort). */
  function upsertComplaintRow(complaint, userId, now) {
    if (!complaint || typeof complaint.id !== 'string') return;
    const payload = JSON.stringify(complaint);
    const existing = db.prepare('SELECT id FROM complaints WHERE id = ?').get(complaint.id);
    if (existing) {
      db.prepare('UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?')
        .run(payload, now, complaint.id);
    } else {
      db.prepare(
        'INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(complaint.id, payload, userId || 'system', complaint.created || now, now);
    }
  }

  function syncComplaintsTable(state, userId, now) {
    for (const complaint of state.complaints || []) {
      upsertComplaintRow(complaint, userId, now);
    }
  }

  /**
   * Persist full application state with optimistic concurrency (revision).
   * Rejects illegal status jumps (must use changeStatus).
   */
  function saveState({ state, userId, expectedRevision, diffComplaints }) {
    const stateJson = JSON.stringify(state);
    const now = new Date().toISOString();

    const result = db.transaction(() => {
      const currentRow = db.prepare('SELECT state_json, revision FROM app_state WHERE id = 1').get();
      const currentRevision = currentRow?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        return { conflict: true, currentRevision };
      }

      const previousState = currentRow ? JSON.parse(currentRow.state_json) : null;
      const transitionCheck = validateStatusTransitions(previousState, state);
      if (!transitionCheck.ok) {
        return { conflict: false, invalidTransition: true, error: transitionCheck.error };
      }

      const complaintChanges = typeof diffComplaints === 'function'
        ? diffComplaints(previousState, state)
        : [];

      const nextRevision = currentRevision + 1;
      db.prepare(
        `INSERT INTO app_state(id, state_json, updated_by, updated_at, revision)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at,
           revision = excluded.revision`
      ).run(stateJson, userId, now, nextRevision);

      syncComplaintsTable(state, userId, now);

      return {
        conflict: false,
        invalidTransition: false,
        revision: nextRevision,
        updatedAt: now,
        complaintChanges,
        previousState
      };
    })();

    return result;
  }

  /**
   * Change a single complaint status with state machine + history.
   * Updates app_state and mirrors to complaints table.
   */
  function changeStatus({ complaintId, toStatus, reason, userId, username }) {
    if (!ALLOWED_STATUSES.includes(toStatus)) {
      return { ok: false, status: 400, error: 'حالة الشكوى غير صالحة.' };
    }

    const now = new Date().toISOString();

    const result = db.transaction(() => {
      const row = db.prepare('SELECT state_json, revision FROM app_state WHERE id = 1').get();
      if (!row) {
        return { ok: false, status: 404, error: 'لا توجد حالة تطبيق محفوظة.' };
      }

      const state = JSON.parse(row.state_json);
      if (!Array.isArray(state.complaints)) state.complaints = [];

      let index = state.complaints.findIndex(c => c && c.id === complaintId);
      let complaint = index >= 0 ? state.complaints[index] : null;

      // Fallback: load from complaints table if not in app_state yet
      if (!complaint) {
        const tableRow = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(complaintId);
        if (tableRow) {
          try {
            complaint = JSON.parse(tableRow.payload_json);
            state.complaints.push(complaint);
            index = state.complaints.length - 1;
          } catch {
            complaint = null;
          }
        }
      }

      if (!complaint) {
        return { ok: false, status: 404, error: 'الشكوى غير موجودة.' };
      }

      const fromStatus = complaint.status || 'new';
      if (fromStatus === toStatus) {
        return {
          ok: true,
          status: 200,
          complaint,
          revision: row.revision,
          unchanged: true
        };
      }

      if (!isTransitionAllowed(fromStatus, toStatus)) {
        return {
          ok: false,
          status: 409,
          error: `انتقال الحالة غير مسموح من «${fromStatus}» إلى «${toStatus}».`
        };
      }

      if (STATUSES_REQUIRING_REASON.has(toStatus)) {
        if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
          return {
            ok: false,
            status: 400,
            error: 'سبب الإغلاق أو الإلغاء مطلوب (نص غير فارغ، بحد أقصى 500 حرف).'
          };
        }
      }

      const historyEntry = {
        from: fromStatus,
        to: toStatus,
        by: username || userId || 'system',
        at: now,
        reason: reason ? String(reason).trim() : null
      };

      if (!Array.isArray(complaint.statusHistory)) complaint.statusHistory = [];
      complaint.statusHistory.push(historyEntry);
      complaint.status = toStatus;
      complaint.updated = now;

      if (!Array.isArray(complaint.timeline)) complaint.timeline = [];
      complaint.timeline.push({
        event: 'تغيير الحالة',
        by: username || userId || 'system',
        at: now,
        detail: `${fromStatus} → ${toStatus}` + (reason ? ` — ${String(reason).trim()}` : '')
      });

      state.complaints[index] = complaint;

      const nextRevision = (row.revision ?? 0) + 1;
      db.prepare(
        `UPDATE app_state SET state_json = ?, updated_by = ?, updated_at = ?, revision = ? WHERE id = 1`
      ).run(JSON.stringify(state), userId, now, nextRevision);

      upsertComplaintRow(complaint, userId, now);

      return {
        ok: true,
        status: 200,
        complaint,
        revision: nextRevision,
        fromStatus,
        toStatus,
        historyEntry
      };
    })();

    if (result.ok && !result.unchanged && typeof audit === 'function') {
      audit(userId, 'complaint_status_changed', 'complaint', complaintId, {
        from: result.fromStatus,
        to: result.toStatus,
        reason: reason ? String(reason).trim() : null,
        source: 'status_endpoint'
      });
    }

    if (logger && result.ok && !result.unchanged) {
      logger.info('complaint status changed', {
        complaintId,
        from: result.fromStatus,
        to: result.toStatus,
        userId
      });
    }

    return result;
  }

  return {
    ALLOWED_STATUSES,
    TRANSITIONS,
    defaultState,
    readState,
    saveState,
    changeStatus,
    isTransitionAllowed,
    validateStatusTransitions,
    syncComplaintsTable
  };
}

module.exports = {
  createComplaintsService,
  ALLOWED_STATUSES,
  TRANSITIONS,
  defaultState
};
