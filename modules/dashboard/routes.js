'use strict';

const express = require('express');

function createDashboardRouter({ dashboardService, middleware, rolesService }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  const requirePermission =
    rolesService && typeof rolesService.requirePermission === 'function'
      ? (action) => rolesService.requirePermission(action)
      : () => (req, res, next) => next();

  router.get('/dashboard/summary', requireAuth, requirePermission('dashboard.view'), (req, res) => {
    const recentLimit = req.query.recent ? Number(req.query.recent) : undefined;
    const summary = dashboardService.buildSummary({ recentLimit });
    res.json(summary);
  });

  return router;
}

module.exports = { createDashboardRouter };
