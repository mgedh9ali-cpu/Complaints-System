'use strict';

const express = require('express');

function createSyncRouter({ syncService, middleware, auditService, rolesService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  const requirePermission =
    rolesService && typeof rolesService.requirePermission === 'function'
      ? (action) => rolesService.requirePermission(action)
      : () => (req, res, next) => next();

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

  router.post('/sync/import', requireAuth, requirePermission('sync.import'), requireCsrf, (req, res) => {
    try {
      const result = syncService.importPackage({
        payload: req.body,
        userId: req.user.id
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json({
        imported: true,
        complaintCount: result.complaintCount,
        updateStaged: result.updateStaged,
        ...(result.updatePath ? { updatePath: result.updatePath } : {}),
        warning: result.warning
      });
    } catch (error) {
      console.error('Offline sync import failed:', error.message);
      res.status(500).json({ error: 'تعذر إكمال الاستيراد. راجع سجل الخادم.' });
    }
  });

  return router;
}

module.exports = { createSyncRouter };
