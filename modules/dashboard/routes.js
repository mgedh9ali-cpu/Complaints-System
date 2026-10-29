'use strict';

const express = require('express');

function createDashboardRouter({ dashboardService, middleware }) {
  const router = express.Router();
  const { requireAuth } = middleware;

  router.get('/dashboard/summary', requireAuth, (req, res) => {
    const recentLimit = req.query.recent ? Number(req.query.recent) : undefined;
    const summary = dashboardService.buildSummary({ recentLimit });
    res.json(summary);
  });

  return router;
}

module.exports = { createDashboardRouter };
