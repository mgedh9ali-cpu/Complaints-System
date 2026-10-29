'use strict';

const express = require('express');

function createHealthRouter({ healthService, middleware }) {
  const router = express.Router();
  const { requireAuth, requireRole } = middleware;

  router.get('/health', (req, res) => {
    res.json(healthService.basic());
  });

  router.get('/health/metrics', requireAuth, requireRole('admin'), (req, res) => {
    res.json(healthService.detailed());
  });

  return router;
}

module.exports = { createHealthRouter };
