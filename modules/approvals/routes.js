'use strict';
const express = require('express');
function createApprovalsRouter({ approvalsService, middleware, rolesService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  router.get('/approvals', requireAuth, (req, res) => res.json({ requests: approvalsService.list(req.user) }));
  router.post('/approvals', requireAuth, rolesService.requirePermission('approvals.request'), requireCsrf, (req, res) => {
    const result = approvalsService.request({ kind: req.body?.kind, targetId: req.body?.targetId,
      complaintId: req.body?.complaintId, reason: req.body?.reason, userId: req.user.id });
    res.status(result.ok ? 201 : result.status || 400).json(result);
  });
  router.post('/approvals/:id/decision', requireAuth, rolesService.requirePermission('approvals.decide'), requireCsrf, (req, res) => {
    const result = approvalsService.decide({ id: req.params.id, decision: req.body?.decision,
      reason: req.body?.reason, user: req.user });
    res.status(result.ok ? 200 : result.status || 400).json(result);
  });
  return router;
}
module.exports = { createApprovalsRouter };
