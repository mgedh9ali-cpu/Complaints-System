'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createSyncPackage,
  validateSyncPackage,
  stageProgramUpdate,
  verifyProgramUpdate
} = require('../../lib/offline-sync');

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

  function importPackage({ payload, userId }) {
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
      auditService.record(userId, 'sync_imported', 'sync', payload.syncId, {
        sourceInstanceId: payload.sourceInstanceId,
        complaintCount: payload.state.complaints.length,
        programUpdateStaged: Boolean(updateTrusted),
        programUpdateSignatureVerified: Boolean(updateTrusted)
      });
    })();

    return {
      ok: true,
      imported: true,
      complaintCount: payload.state.complaints.length,
      updateStaged: Boolean(updateTrusted),
      updatePath: pendingDir ? path.relative(process.cwd(), pendingDir) : null,
      warning: updateTrusted
        ? 'استوردت البيانات؛ حزمة البرنامج موقعة بمفتاح موثوق ومحفوظة للمراجعة، ولم تُشغّل تلقائيًا.'
        : 'استوردت البيانات فقط. لم تُحفظ ملفات البرنامج للتطبيق لأن التوقيع الرقمي الموثوق غير موجود أو غير صالح.'
    };
  }

  return { exportPackage, importPackage };
}

module.exports = { createSyncService };
