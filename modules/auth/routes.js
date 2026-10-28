'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');

function createAuthRouter({ authService, middleware, audit }) {
  const router = express.Router();
  const { requireAuth, requireRole, requireCsrf } = middleware;

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'تم تجاوز عدد محاولات الدخول. حاول لاحقًا.' }
  });

  router.get('/csrf', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
    res.json({ csrfToken: req.session.csrfToken });
  });

  router.post('/auth/login', loginLimiter, (req, res, next) => {
    const { username, password } = req.body || {};
    const result = authService.authenticate(username, password);
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { id: result.user.id };
      if (typeof audit === 'function') audit(result.user.id, 'login_success', 'user', result.user.id);
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ user: result.user });
      });
    });
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    if (typeof audit === 'function') audit(req.user.id, 'logout', 'user', req.user.id);
    req.session.destroy(err => {
      if (err) return res.status(500).json({ error: 'تعذر إنهاء الجلسة.' });
      res.clearCookie('complaints.sid', { httpOnly: true, sameSite: 'strict' });
      res.status(204).end();
    });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
  });

  router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
    res.json({ users: authService.listUsers() });
  });

  router.post('/users', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
    const { username, password, role } = req.body || {};
    const result = authService.createUser({
      username,
      password,
      role,
      actorId: req.user.id
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ user: result.user });
  });

  router.patch('/users/:id/active', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
    const result = authService.setActive({
      targetId: req.params.id,
      active: req.body?.active,
      actorId: req.user.id
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ user: result.user });
  });

  return router;
}

module.exports = { createAuthRouter };
