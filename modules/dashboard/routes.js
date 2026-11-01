'use strict';

const express = require('express');

function createDashboardRouter({ dashboardService, middleware, rolesService }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get('/dashboard/summary', requireAuth, requirePermission('dashboard.view'), (req, res) => {
    const recentLimit = req.query.recent ? Number(req.query.recent) : undefined;
    const summary = dashboardService.buildSummary({ recentLimit });
    res.json(summary);
  });

  return router;
}

module.exports = { createDashboardRouter };
