'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');

function createAuthRouter({ authService, middleware, audit, rolesService }) {
  const router = express.Router();
  const { requireAuth, requireRole, requireCsrf } = middleware;

  // Local connections share one loopback IP. Avoid locking all staff out
  // when a single account has repeated incorrect credentials.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const username = typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().slice(0, 100)
        : '';
      const digest = crypto.createHash('sha256').update(username).digest('hex');
      return String(req.ip || 'loopback') + ':' + digest;
    },
    message: { error: 'تم تجاوز عدد محاولات الدخول لهذا الحساب. حاول لاحقًا.' }
  });

  router.get('/csrf', requireAuth, (req, res) => {
    res.json({ csrfToken: req.session.csrfToken });
  });

  router.post('/auth/login', loginLimiter, (req, res, next) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 200) {
      return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور.' });
    }
    const code = req.body?.code;
    if (code !== undefined && (typeof code !== 'string' || code.length > 40)) return res.status(400).json({ error:'رمز التحقق غير صالح.' });
    const result = authService.authenticate(username.trim(), password, code);
    if (!result.ok) {
      return res.status(result.status || 401).json({ error: result.error || 'بيانات الدخول غير صحيحة.' });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.user.id, version: result.user.sessionVersion || 0 };
      if (!req.session.csrfToken) {
        const crypto = require('node:crypto');
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      }
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: { ...result.user, permissions: rolesService?.effectivePermissions(result.user) } });
      });
    });
  });

  router.post('/auth/logout', requireAuth, requireCsrf, (req, res) => {
    if (audit) audit(req.user.id, 'logout', 'user', req.user.id);
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'تعذر تسجيل الخروج.' });
      res.clearCookie('complaints.sid');
      res.json({ ok: true });
    });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role,
      twoFactorEnabled: Boolean(req.user.twoFactorEnabled),
      permissions: rolesService?.effectivePermissions(req.user) } });
  });

  router.post('/auth/2fa/setup', requireAuth, requireCsrf, loginLimiter, (req,res) => {
    const result=authService.beginTwoFactor({userId:req.user.id,password:req.body?.password});
    if(!result.ok)return res.status(result.status||400).json({error:result.error});
    req.session.pendingTwoFactor=result.pending;
    res.json({secret:result.secret,uri:result.uri});
  });
  router.post('/auth/2fa/confirm', requireAuth, requireCsrf, loginLimiter, (req,res) => {
    const result=authService.confirmTwoFactor({userId:req.user.id,pending:req.session.pendingTwoFactor,code:req.body?.code});
    res.status(result.ok?200:result.status||400).json(result);
  });
  router.post('/auth/2fa/disable', requireAuth, requireCsrf, loginLimiter, (req,res) => {
    const result=authService.disableTwoFactor({userId:req.user.id,password:req.body?.password,code:req.body?.code});
    res.status(result.ok?200:result.status||400).json(result);
  });

  router.post('/auth/change-password', requireAuth, requireCsrf, (req, res, next) => {
    const body = req.body || {};
    const currentSid = req.sessionID || null;
    const result = authService.changePassword({
      userId: req.user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      keepSessionId: currentSid
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error || 'تعذر تغيير كلمة المرور.' });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: req.user.id, version: (req.user.session_version || 0) + 1 };
      const crypto = require('node:crypto');
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({
          ok: true,
          csrfToken: req.session.csrfToken,
          sessionsRevoked: result.sessionsRevoked || 0
        });
      });
    });
  });

  router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
    res.json({ users: authService.listUsers().map(user => ({ ...user,
      permissions: rolesService?.effectivePermissions(user) })),
      customizablePermissions: rolesService?.CUSTOMIZABLE || [] });
  });

  router.get('/assignees', requireAuth, (req, res) => {
    res.json({ users: authService.listUsers().filter(u => u.active === 1 &&
      (!rolesService || rolesService.can(u, 'complaints.update')))
      .map(({ id, username }) => ({ id, username })) });
  });

  router.patch('/users/:id/permissions', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
    const result = authService.setPermissions({ targetId: req.params.id,
      overrides: req.body?.overrides, actorId: req.user.id });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ user: { ...result.user, permissions: rolesService.effectivePermissions(result.user) } });
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
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'قيمة التفعيل يجب أن تكون منطقية.' });
    const result = authService.setActive({
      targetId: req.params.id,
      active,
      actorId: req.user.id
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error || 'تعذر تحديث الحالة.' });
    }
    res.json({ user: result.user, sessionsRevoked: result.sessionsRevoked || 0 });
  });

  return router;
}

module.exports = { createAuthRouter };
