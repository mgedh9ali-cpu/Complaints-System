'use strict';

const express = require('express');
const {sealPackage,openPackage}=require('../../lib/sync-envelope');

function createSyncRouter({ syncService, middleware, auditService, rolesService, backupService, complaintsService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.post('/sync/export', requireAuth, requirePermission('sync.export'), requireCsrf, (req, res) => {
    try {
    const bundle = syncService.exportPackage();
    const sealed = sealPackage(bundle, req.body?.password);
    if (auditService) {
      auditService.record(req.user.id, 'sync_exported', 'sync', bundle.syncId, {
        complaintCount: Array.isArray(bundle.state?.complaints) ? bundle.state.complaints.length : 0
      });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="complaints-sync-' + new Date().toISOString().slice(0, 10) + '.json"'
    );
    res.setHeader('Cache-Control','private, no-store');
    res.send(JSON.stringify(sealed));
    }catch(error){res.status(400).json({error:error.message});}
  });

  router.post('/sync/preview', requireAuth, requirePermission('sync.import'), requireCsrf, (req, res) => {
    try {
    const result = syncService.previewPackage(openPackage(req.body?.package,req.body?.password));
    res.status(result.ok ? 200 : 400).json(result);
    }catch(error){res.status(400).json({error:error.message});}
  });

  router.post('/sync/import', requireAuth, requirePermission('sync.import'), requireCsrf, async (req, res) => {
    try {
      const forceReplace =
        req.body &&
        (req.body.forceReplace === true ||
          req.body.forceReplace === 1 ||
          req.body.forceReplace === '1' ||
          req.body.forceReplace === 'true');
      const payload = openPackage(req.body?.package,req.body?.password);
      const preview = syncService.previewPackage(payload);
      if (!preview.ok) return res.status(preview.status || 400).json({ error: preview.error });
      if (!Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision !== preview.revision) {
        return res.status(409).json({ error: 'تغيرت البيانات منذ المعاينة. أعد المعاينة قبل تأكيد الاستيراد.' });
      }
      if (preview.conflicts.length && !forceReplace) return res.status(409).json({
        error: 'توجد تعارضات؛ راجع المعاينة قبل تأكيد الاستبدال.', conflicts: preview.conflicts, conflictCount: preview.conflicts.length
      });
      if (!backupService) throw new Error('Verified pre-import backup service is unavailable.');
      const safetyBackup = await backupService.persistCompleteBackup();
      if (complaintsService.readState().revision !== preview.revision) {
        return res.status(409).json({ error: 'تغيرت البيانات أثناء النسخ الاحتياطي. أعد المعاينة والاستيراد.' });
      }
      const result = syncService.importPackage({
        payload,
        userId: req.user.id,
        forceReplace
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({
          error: result.error,
          ...(result.conflicts ? { conflicts: result.conflicts, conflictCount: result.conflictCount } : {})
        });
      }
      res.json({
        imported: true,
        complaintCount: result.complaintCount,
        updateStaged: result.updateStaged,
        ...(result.updatePath ? { updatePath: result.updatePath } : {}),
        conflictsResolvedByForce: result.conflictsResolvedByForce || 0,
        warning: result.warning
        , safetyBackup: safetyBackup.verified
      });
    } catch (error) {
      console.error('Offline sync import failed:', error.message);
      res.status(400).json({ error: 'تعذر التحقق من الحزمة أو استيرادها بأمان.' });
    }
  });

  return router;
}

module.exports = { createSyncRouter };
