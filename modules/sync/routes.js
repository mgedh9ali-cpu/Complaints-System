'use strict';

const express = require('express');

function createSyncRouter({ syncService, middleware, auditService, rolesService, backupService, complaintsService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get('/sync/export', requireAuth, requirePermission('sync.export'), (req, res) => {
    const bundle = syncService.exportPackage();
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
    res.send(JSON.stringify(bundle));
  });

  router.post('/sync/preview', requireAuth, requirePermission('sync.import'), requireCsrf, (req, res) => {
    const result = syncService.previewPackage(req.body?.package || req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post('/sync/import', requireAuth, requirePermission('sync.import'), requireCsrf, async (req, res) => {
    try {
      const forceReplace =
        req.body &&
        (req.body.forceReplace === true ||
          req.body.forceReplace === 1 ||
          req.body.forceReplace === '1' ||
          req.body.forceReplace === 'true');
      // Allow either raw package body or { package, forceReplace }
      const payload =
        req.body && req.body.package && typeof req.body.package === 'object'
          ? req.body.package
          : req.body;
      const preview = syncService.previewPackage(payload);
      if (!preview.ok) return res.status(400).json({ error: preview.error });
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
      res.status(500).json({ error: 'تعذر إكمال الاستيراد. راجع سجل الخادم.' });
    }
  });

  return router;
}

module.exports = { createSyncRouter };
