'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {exportFiles,prepareFiles,validateFiles}=require('../../lib/sync-attachments');
const { storageFor } = require('../../lib/storage-codec');
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
  rootDir,
  dataDir,
  attachmentsService
}) {
  const storage = storageFor(db);
  function exportReminders(ids) {
    return db.prepare('SELECT * FROM complaint_reminders ORDER BY id').all().filter(r=>ids.has(r.complaint_id)).map(r=>({
      complaintId:r.complaint_id, reminderTime:r.reminder_time, priority:r.priority, dismissed:r.is_dismissed===1,
      note:r.note_encrypted===1?storage.decodeJson(r.note,'reminder:'+r.id):r.note
    }));
  }
  function validateReminders(payload) {
    const rows=payload.reminders===undefined?[]:payload.reminders;
    const ids=new Set(payload.state.complaints.map(c=>c.id));
    if(!Array.isArray(rows)||rows.length>50000||rows.some(r=>!r||!ids.has(r.complaintId)||typeof r.reminderTime!=='string'||!Number.isFinite(Date.parse(r.reminderTime))||typeof r.note!=='string'||r.note.length<2||r.note.length>500||!['low','normal','high','urgent'].includes(r.priority)||typeof r.dismissed!=='boolean'))throw new Error('بيانات التذكيرات في ملف المزامنة غير صالحة.');
    return rows;
  }
  function mergeReminders(rows, accepted, userId) {
    if(!rows.length)return;
    const identity=r=>JSON.stringify([r.complaintId,new Date(r.reminderTime).toISOString(),r.note,r.priority]);
    const known=new Map();
    for(const r of db.prepare('SELECT * FROM complaint_reminders').all()){
      const item={complaintId:r.complaint_id,reminderTime:r.reminder_time,note:r.note_encrypted===1?storage.decodeJson(r.note,'reminder:'+r.id):r.note,priority:r.priority};
      if(Number.isFinite(Date.parse(item.reminderTime)))known.set(identity(item),r);
    }
    const add=db.prepare('INSERT INTO complaint_reminders(complaint_id,reminder_time,note,priority,is_dismissed,created_by) VALUES(?,?,?,?,?,?)');
    const encrypt=db.prepare('UPDATE complaint_reminders SET note=?,note_encrypted=? WHERE id=?');
    const dismiss=db.prepare('UPDATE complaint_reminders SET is_dismissed=1 WHERE id=?');
    for(const r of rows){
      if(!accepted.has(r.complaintId))continue;
      const key=identity(r), existing=known.get(key);
      if(existing){if(r.dismissed&&!existing.is_dismissed){dismiss.run(existing.id);existing.is_dismissed=1;}continue;}
      const id=add.run(r.complaintId,new Date(r.reminderTime).toISOString(),'',r.priority,r.dismissed?1:0,userId).lastInsertRowid;
      encrypt.run(storage.enabled?storage.encodeJson(r.note,'reminder:'+id):r.note,storage.enabled?1:0,id);
      known.set(key,{id,is_dismissed:r.dismissed?1:0});
    }
  }
  function previewPackage(payload) {
    const validation = validateSyncPackage(payload);
    if (!validation.ok) return validation;
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 64 * 1024 * 1024) return { ok: false, error: 'ملف المزامنة أكبر من الحد المسموح.' };
    if (payload.sourceInstanceId === sourceInstanceId) return { ok: false, error: 'هذا الملف صادر من النسخة الحالية.' };
    if (db.prepare("SELECT id FROM audit_events WHERE action='sync_imported' AND target_id=?").get(payload.syncId)) return { ok: false, status: 409, error: 'سبق استيراد ملف المزامنة هذا.' };
    try { validateReminders(payload); validateFiles(payload,{db,dataDir}); } catch(error) { return {ok:false,error:error.message}; }
    const { state, revision } = complaintsService.readState();
    const localIds = new Set(state.complaints.map(c => c.id));
    const incomingIds = new Set(payload.state.complaints.map(c => c.id));
    return { ok: true, revision, incomingCount: incomingIds.size, localCount: localIds.size,
      added: [...incomingIds].filter(id => !localIds.has(id)).length,
      removed: [...localIds].filter(id => !incomingIds.has(id)).length,
      conflicts: findComplaintConflicts(state.complaints, payload.state.complaints) };
  }
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
    const bundle=createSyncPackage(safeState, rootDir, sourceInstanceId);
    bundle.attachmentFiles=exportFiles(safeState,attachmentsService);
    bundle.reminders=exportReminders(new Set(safeState.complaints.map(c=>c.id)));
    return bundle;
  }

  function importPackage({ payload, userId, forceReplace = false, merge = false }) {
    const validation = validateSyncPackage(payload);
    if (!validation.ok) {
      return { ok: false, status: 400, error: validation.error };
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 64 * 1024 * 1024) {
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
    if (conflicts.length > 0 && !forceReplace && !merge) {
      return {
        ok: false,
        status: 409,
        error:
          'هناك تعارضات في شكاوى موجودة محلياً. راجع قائمة التعارضات أو أعد الاستيراد مع forceReplace=true بعد الموافقة.',
        conflicts,
        conflictCount: conflicts.length
      };
    }

    const incomingReminders=validateReminders(payload);
    const blocked=new Set(merge?conflicts.filter(c=>c.kind!=='missing_from_incoming').map(c=>c.id):[]);
    const accepted=new Set(payload.state.complaints.filter(c=>!blocked.has(c.id)).map(c=>c.id));
    if(merge){
      const localById=new Map(localState.complaints.map(c=>[c.id,c]));
      for(const c of payload.state.complaints)if(!localById.has(c.id))localById.set(c.id,c);
      // Preserve local settings/notifications/templates unless the local office has no records.
      const base=localState.complaints.length?localState:payload.state;
      payload={...payload,state:{...base,complaints:[...localById.values()]},attachmentFiles:(payload.attachmentFiles||[]).filter(a=>accepted.has(a.complaintId))};
      if(!validateSyncPackage(payload).ok)return {ok:false,status:400,error:'تجاوز الدمج حدود البيانات المسموح بها.'};
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
    const files=prepareFiles(payload,{db,dataDir});
    try {
    if (updateTrusted) {
      pendingDir = stageProgramUpdate(
        payload,
        path.resolve(dataDir || process.env.DATA_DIR || './data'),
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
      ).run(storage.encodeJson(payload.state, 'app-state'), userId, now, nextRevision);
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
          storage.encodeJson(complaint, 'complaint:' + complaint.id),
          userId,
          typeof complaint.created === 'string' ? complaint.created : now,
          typeof complaint.updated === 'string' ? complaint.updated : now
        );
      }
      files.commitMetadata();
      mergeReminders(incomingReminders,accepted,userId);
      auditService.record(userId, 'sync_imported', 'sync', payload.syncId, {
        sourceInstanceId: payload.sourceInstanceId,
        complaintCount: payload.state.complaints.length,
        programUpdateStaged: Boolean(updateTrusted),
        programUpdateSignatureVerified: Boolean(updateTrusted),
        forceReplace: Boolean(forceReplace), merge: Boolean(merge), preservedConflicts: blocked.size,
        conflictCount: conflicts.length
      });
    })(); }catch(error){files.rollback();if(pendingDir)fs.rmSync(pendingDir,{recursive:true,force:true});throw error;}
    if (typeof auditService.syncHead === 'function') auditService.syncHead();

    return {
      ok: true,
      imported: true,
      complaintCount: payload.state.complaints.length,
      updateStaged: Boolean(updateTrusted),
      updatePath: pendingDir ? path.relative(process.cwd(), pendingDir) : null,
      preservedConflicts: blocked.size,
      conflictsResolvedByForce: forceReplace && !merge ? conflicts.length : 0,
      warning: updateTrusted
        ? 'استوردت البيانات؛ حزمة البرنامج موقعة بمفتاح موثوق ومحفوظة للمراجعة، ولم تُشغّل تلقائيًا.'
        : 'استوردت البيانات فقط. لم تُحفظ ملفات البرنامج للتطبيق لأن التوقيع الرقمي الموثوق غير موجود أو غير صالح.'
    };
  }

  return { exportPackage, importPackage, previewPackage, findComplaintConflicts };
}

module.exports = { createSyncService, findComplaintConflicts };
