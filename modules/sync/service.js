'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createSyncPackage,
  validateSyncPackage,
  stageProgramUpdate,
  verifyProgramUpdate
} = require('../../lib/offline-sync');

function findComplaintConflicts(localComplaints, incomingComplaints) {
  const localById = new Map(
    (localComplaints || []).filter((c) => c && c.id).map((c) => [c.id, c])
  );
  const incomingIds = new Set(
    (incomingComplaints || []).filter((c) => c && c.id).map((c) => c.id)
  );
  const conflicts = [];
  for (const incoming of incomingComplaints || []) {
    if (!incoming || !incoming.id) continue;
    const local = localById.get(incoming.id);
    if (!local) continue;
    const localUpdated = local.updated || local.created || '';
    const incomingUpdated = incoming.updated || incoming.created || '';
    const localStatus = local.status || '';
    const incomingStatus = incoming.status || '';
    if (localUpdated !== incomingUpdated || localStatus !== incomingStatus ||
        JSON.stringify(local) !== JSON.stringify(incoming)) {
      conflicts.push({
        id: incoming.id,
        local: { status: localStatus, updated: localUpdated },
        incoming: { status: incomingStatus, updated: incomingUpdated }
      });
    }
  }
  // An imported snapshot must not erase locally recorded complaints silently.
  for (const [id, local] of localById) {
    if (incomingIds.has(id)) continue;
    conflicts.push({
      id,
      kind: 'missing_from_incoming',
      local: { status: local.status || '', updated: local.updated || local.created || '' },
      incoming: null
    });
  }
  return conflicts;
}

function createSyncService({
  complaintsService,
  auditService,
  db,
  sourceInstanceId,
  rootDir
}) {
  function exportPackage() {
    const { state } = complaintsService.readState();
    const safeState = state && typeof state === 'object'
      ? state
      : {
          complaints: [],
          notifications: [],
          templates: [],
          settings: { slaDays: 7, slaApproved: false, provinces: [], entities: [], categories: [] }
        };
    return createSyncPackage(safeState, rootDir, sourceInstanceId);
  }

  function importPackage({ payload, userId, forceReplace = false }) {
    const validation = validateSyncPackage(payload);
    if (!validation.ok) {
      return { ok: false, status: 400, error: validation.error };
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 950 * 1024) {
      return { ok: false, status: 413, error: 'ملف المزامنة أكبر من الحد المسموح.' };
    }
    if (payload.sourceInstanceId === sourceInstanceId) {
      return { ok: false, status: 400, error: 'هذا الملف صادر من النسخة الحالية.' };
    }
    const already = db
      .prepare("SELECT id FROM audit_events WHERE action='sync_imported' AND target_id=?")
      .get(payload.syncId);
    if (already) {
      return { ok: false, status: 409, error: 'سبق استيراد ملف المزامنة هذا.' };
    }

    const { state: localState } = complaintsService.readState();
    const conflicts = findComplaintConflicts(
      localState.complaints || [],
      payload.state.complaints || []
    );
    if (conflicts.length > 0 && !forceReplace) {
      return {
        ok: false,
        status: 409,
        error:
          'هناك تعارضات في شكاوى موجودة محلياً. راجع قائمة التعارضات أو أعد الاستيراد مع forceReplace=true بعد الموافقة.',
        conflicts,
        conflictCount: conflicts.length
      };
    }

    const publicKeyPath = path.resolve(
      process.env.UPDATE_PUBLIC_KEY_PATH || './data/trusted-update-public.pem'
    );
    let updateTrusted = false;
    let trustedPublicKey = null;
    if (fs.existsSync(publicKeyPath)) {
      try {
        trustedPublicKey = fs.readFileSync(publicKeyPath, 'utf8');
        updateTrusted = verifyProgramUpdate(payload, trustedPublicKey);
      } catch {
        trustedPublicKey = null;
        updateTrusted = false;
      }
    }

    let pendingDir = null;
    if (updateTrusted) {
      pendingDir = stageProgramUpdate(
        payload,
        path.resolve(process.env.DATA_DIR || './data'),
        trustedPublicKey
      );
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      const currentRow = db.prepare('SELECT revision FROM app_state WHERE id=1').get();
      const nextRevision = (currentRow?.revision ?? 0) + 1;
      db.prepare(
        `INSERT INTO app_state(id,state_json,updated_by,updated_at,revision)
         VALUES(1,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           state_json=excluded.state_json,
           updated_by=excluded.updated_by,
           updated_at=excluded.updated_at,
           revision=excluded.revision`
      ).run(JSON.stringify(payload.state), userId, now, nextRevision);
      // app_state and complaints must represent the same imported snapshot.
      // Replacing app_state alone leaves stale complaints visible to API lookups.
      db.prepare('DELETE FROM complaints').run();
      const insertComplaint = db.prepare(
        'INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      const seen = new Set();
      for (const complaint of payload.state.complaints) {
        if (!complaint || typeof complaint !== 'object' ||
            typeof complaint.id !== 'string' || !complaint.id.trim() ||
            complaint.id.length > 100 || seen.has(complaint.id)) {
          throw new Error('Invalid or duplicated imported complaint identifier.');
        }
        seen.add(complaint.id);
        insertComplaint.run(
          complaint.id,
          JSON.stringify(complaint),
          userId,
          typeof complaint.created === 'string' ? complaint.created : now,
          typeof complaint.updated === 'string' ? complaint.updated : now
        );
      }
      auditService.record(userId, 'sync_imported', 'sync', payload.syncId, {
        sourceInstanceId: payload.sourceInstanceId,
        complaintCount: payload.state.complaints.length,
        programUpdateStaged: Boolean(updateTrusted),
        programUpdateSignatureVerified: Boolean(updateTrusted),
        forceReplace: Boolean(forceReplace),
        conflictCount: conflicts.length
      });
    })();
    if (typeof auditService.syncHead === 'function') auditService.syncHead();

    return {
      ok: true,
      imported: true,
      complaintCount: payload.state.complaints.length,
      updateStaged: Boolean(updateTrusted),
      updatePath: pendingDir ? path.relative(process.cwd(), pendingDir) : null,
      conflictsResolvedByForce: forceReplace ? conflicts.length : 0,
      warning: updateTrusted
        ? 'استوردت البيانات؛ حزمة البرنامج موقعة بمفتاح موثوق ومحفوظة للمراجعة، ولم تُشغّل تلقائيًا.'
        : 'استوردت البيانات فقط. لم تُحفظ ملفات البرنامج للتطبيق لأن التوقيع الرقمي الموثوق غير موجود أو غير صالح.'
    };
  }

  return { exportPackage, importPackage, findComplaintConflicts };
}

module.exports = { createSyncService, findComplaintConflicts };
