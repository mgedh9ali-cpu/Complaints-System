'use strict';

const express = require('express');

function createAuditRouter({ auditService, middleware }) {
  const router = express.Router();
  const { requireAuth, requireRole } = middleware;

  router.get('/audit', requireAuth, requireRole('admin', 'reviewer'), (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const events = auditService.listEvents({ limit });
    res.json({ events, count: events.length });
  });

  router.get('/audit/verify', requireAuth, requireRole('admin'), (req, res) => {
    const result = auditService.verifyChain();
    res.status(result.ok ? 200 : 409).json(result);
  });

  return router;
}

module.exports = { createAuditRouter };
