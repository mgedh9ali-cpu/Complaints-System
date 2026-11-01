'use strict';

const express = require('express');

function createAuditRouter({ auditService, middleware, rolesService }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get('/audit', requireAuth, requirePermission('audit.read'), (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const events = auditService.listEvents({ limit });
    res.json({ events, count: events.length });
  });

  router.get('/audit/verify', requireAuth, requirePermission('audit.verify'), (req, res) => {
    const result = auditService.verifyChain();
    res.status(result.ok ? 200 : 409).json(result);
  });

  return router;
}

module.exports = { createAuditRouter };
