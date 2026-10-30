'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { revokeUserSessions } = require('../../lib/session-revoke');

const ROLES = Object.freeze(['admin', 'staff', 'reviewer']);
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,64}$/u;

function createAuthService({ db, audit, logger, sessionsDir }) {
  function findByUsername(username) {
    return db.prepare(
      'SELECT id, username, password_hash, role, active FROM users WHERE username = ?'
    ).get(username);
  }

  function findById(id) {
    return db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(id);
  }

  function findByIdWithHash(id) {
    return db.prepare(
      'SELECT id, username, password_hash, role, active FROM users WHERE id = ?'
    ).get(id);
  }

  function listUsers() {
    return db.prepare(
      'SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY created_at ASC'
    ).all();
  }

  function revokeSessions(userId, keepSessionId) {
    if (!sessionsDir) return { revoked: 0 };
    try {
      return revokeUserSessions(sessionsDir, userId, { keepSessionId: keepSessionId || null });
    } catch (err) {
      if (logger) logger.warn('session revoke failed', { userId, error: err.message });
      return { revoked: 0 };
    }
  }

  function authenticate(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' ||
        username.length > 100 || password.length > 200) {
      return { ok: false, status: 400, error: 'أدخل اسم المستخدم وكلمة المرور.' };
    }
    const user = findByUsername(username.trim());
    const matches = user ? bcrypt.compareSync(password, user.password_hash) : false;
    if (!user || !matches || user.active !== 1) {
      if (user && typeof audit === 'function') audit(user.id, 'login_failed', 'user', user.id);
      return { ok: false, status: 401, error: 'بيانات الدخول غير صحيحة.' };
    }
    return {
      ok: true,
      user: { id: user.id, username: user.username, role: user.role }
    };
  }

  function createUser({ username, password, role, actorId }) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim()) ||
        typeof password !== 'string' || password.length < 12 || password.length > 200 ||
        !ROLES.includes(role)) {
      return { ok: false, status: 400, error: 'اسم المستخدم أو كلمة المرور أو الدور غير صالح.' };
    }
    const id = crypto.randomUUID();
    const normalizedUsername = username.trim();
    const passwordHash = bcrypt.hashSync(password, 12);
    try {
      db.prepare(
        'INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
      ).run(id, normalizedUsername, passwordHash, role, new Date().toISOString());
    if (typeof audit === "function") audit(id, "bootstrap_admin", "user", id);
    } catch (error) {
      if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { ok: false, status: 409, error: 'اسم المستخدم مستخدم بالفعل.' };
      }
      throw error;
    }
    if (typeof audit === 'function') {
      audit(actorId, 'user_created', 'user', id, { username: normalizedUsername, role });
    }
    if (logger) logger.info('user created', { id, username: normalizedUsername, role, actorId });
    return { ok: true, user: { id, username: normalizedUsername, role, active: 1 } };
  }

  function setActive({ targetId, active, actorId }) {
    if (typeof active !== 'boolean') {
      return { ok: false, status: 400, error: 'قيمة تفعيل الحساب غير صالحة.' };
    }
    const target = findById(targetId);
    if (!target) return { ok: false, status: 404, error: 'الحساب غير موجود.' };
    if (target.id === actorId && active === false) {
      return { ok: false, status: 409, error: 'لا يمكن للمدير تعطيل حسابه الحالي.' };
    }
    if (target.role === 'admin' && target.active === 1 && active === false) {
      const activeAdmins = db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1"
      ).get().count;
      if (activeAdmins <= 1) {
        return { ok: false, status: 409, error: 'لا يمكن تعطيل آخر حساب مدير نشط.' };
      }
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, target.id);
    let sessionsRevoked = 0;
    if (active === false) {
      sessionsRevoked = revokeSessions(target.id).revoked;
    }
    if (typeof audit === 'function') {
      audit(actorId, active ? 'user_activated' : 'user_deactivated', 'user', target.id, {
        username: target.username,
        role: target.role,
        sessionsRevoked
      });
    }
    return {
      ok: true,
      user: { id: target.id, username: target.username, role: target.role, active: active ? 1 : 0 },
      sessionsRevoked
    };
  }

  function changePassword({ userId, currentPassword, newPassword, keepSessionId }) {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return { ok: false, status: 400, error: 'أدخل كلمة المرور الحالية والجديدة.' };
    }
    if (newPassword.length < 12 || newPassword.length > 200) {
      return { ok: false, status: 400, error: 'كلمة المرور الجديدة يجب أن تكون بين 12 و 200 حرفاً.' };
    }
    if (currentPassword === newPassword) {
      return { ok: false, status: 400, error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.' };
    }
    const user = findByIdWithHash(userId);
    if (!user || user.active !== 1) {
      return { ok: false, status: 401, error: 'الحساب غير موجود أو غير فعال.' };
    }
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      if (typeof audit === 'function') {
        audit(userId, 'password_change_failed', 'user', userId, {});
      }
      return { ok: false, status: 401, error: 'كلمة المرور الحالية غير صحيحة.' };
    }
    const passwordHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    const sessionsRevoked = revokeSessions(userId, keepSessionId).revoked;
    if (typeof audit === 'function') {
      audit(userId, 'password_changed', 'user', userId, { sessionsRevoked });
    }
    if (logger) logger.info('password changed', { userId, sessionsRevoked });
    return { ok: true, sessionsRevoked };
  }

  function ensureBootstrapAdmin(adminUsername, adminPassword) {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (userCount > 0) return null;
    const passwordHash = bcrypt.hashSync(adminPassword, 12);
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, adminUsername, passwordHash, 'admin', new Date().toISOString());
    if (logger) logger.info('Created initial administrator account', { username: adminUsername });
    return id;
  }

  return {
    ROLES,
    findByUsername,
    findById,
    listUsers,
    authenticate,
    createUser,
    setActive,
    changePassword,
    revokeSessions,
    ensureBootstrapAdmin
  };
}

module.exports = { createAuthService, ROLES };
