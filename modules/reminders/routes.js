'use strict';

const express = require('express');

function createRemindersRouter({ remindersService, middleware, rolesService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get('/reminders/due', requireAuth, requirePermission('complaints.read'), (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    res.json({ reminders: remindersService.listDue({ limit }) });
  });

  router.post(
    '/reminders/:id/dismiss',
    requireAuth,
    requirePermission('complaints.update'),
    requireCsrf,
    (req, res) => {
      const result = remindersService.dismiss(req.params.id, req.user.id);
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json({ ok: true });
    }
  );

  router.get(
    '/complaints/:id/reminders',
    requireAuth,
    requirePermission('complaints.read'),
    (req, res) => {
      res.json({ reminders: remindersService.listForComplaint(req.params.id) });
    }
  );

  router.post(
    '/complaints/:id/reminders',
    requireAuth,
    requirePermission('complaints.update'),
    requireCsrf,
    (req, res) => {
      const result = remindersService.createReminder({
        complaintId: req.params.id,
        reminderTime: req.body?.reminder_time || req.body?.reminderTime,
        note: req.body?.note,
        priority: req.body?.priority,
        userId: req.user.id
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.status(201).json(result);
    }
  );

  return router;
}

module.exports = { createRemindersRouter };
