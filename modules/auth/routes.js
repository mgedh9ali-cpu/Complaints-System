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

  router.get('/csrf', requireAuth, (req, res) => {
    res.json({ csrfToken: req.session.csrfToken });
  });

  router.post('/auth/login', loginLimiter, (req, res, next) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 200) {
      return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور.' });
    }
    const result = authService.authenticate(username.trim(), password);
    if (!result.ok) {
      return res.status(result.status || 401).json({ error: result.error || 'بيانات الدخول غير صحيحة.' });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.user.id };
      if (!req.session.csrfToken) {
        const crypto = require('node:crypto');
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      }
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: { id: result.user.id, username: result.user.username, role: result.user.role } });
      });
    });
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    if (audit) audit(req.user.id, 'logout', 'user', req.user.id);
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'تعذر تسجيل الخروج.' });
      res.clearCookie('complaints.sid');
      res.json({ ok: true });
    });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
  });

  router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
    res.json({ users: authService.listUsers() });
  });

  router.post('/users', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
    const body = req.body || {};
    const result = authService.createUser({
      username: body.username,
      password: body.password,
      role: body.role,
      actorId: req.user.id
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error || 'تعذر إنشاء المستخدم.' });
    }
    res.status(201).json({ user: result.user });
  });

  router.patch('/users/:id/active', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
    const active = req.body && req.body.active;
    const result = authService.setActive({
      targetId: req.params.id,
      active: active === true || active === 1 || active === '1',
      actorId: req.user.id
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error || 'تعذر تحديث الحالة.' });
    }
    res.json({ user: result.user });
  });

  return router;
}

module.exports = { createAuthRouter };
