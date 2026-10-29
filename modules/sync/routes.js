'use strict';

const express = require('express');

function createSyncRouter({ syncService, middleware, auditService }) {
  const router = express.Router();
  const { requireAuth, requireRole, requireCsrf } = middleware;

  router.get('/sync/export', requireAuth, requireRole('admin', 'staff'), (req, res) => {
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

  router.post('/sync/import', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
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
