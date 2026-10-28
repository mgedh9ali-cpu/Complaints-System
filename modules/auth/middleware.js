'use strict';

/**
 * Shared auth / CSRF middleware used by all route modules.
 */

function createAuthMiddleware({ db }) {
  function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
    const user = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || user.active !== 1) {
      return req.session.destroy(() => res.status(401).json({ error: 'الحساب غير فعال.' }));
    }
    req.user = user;
    next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
      }
      next();
    };
  }

  function requireCsrf(req, res, next) {
    const token = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ error: 'رمز CSRF غير صالح أو مفقود.' });
    }
    next();
  }

  function ensureCsrfToken(req, res, next) {
    if (!req.session.csrfToken) {
      const crypto = require('node:crypto');
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    next();
  }

  return { requireAuth, requireRole, requireCsrf, ensureCsrfToken };
}

module.exports = { createAuthMiddleware };
