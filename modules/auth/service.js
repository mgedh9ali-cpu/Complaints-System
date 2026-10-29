'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const ROLES = Object.freeze(['admin', 'staff', 'reviewer']);
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,64}$/u;

function createAuthService({ db, audit, logger }) {
  function findByUsername(username) {
    return db.prepare(
      'SELECT id, username, password_hash, role, active FROM users WHERE username = ?'
    ).get(username);
  }

  function findById(id) {
    return db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(id);
  }

  function listUsers() {
    return db.prepare(
      'SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY created_at ASC'
    ).all();
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
    if (typeof audit === 'function') {
      audit(actorId, active ? 'user_activated' : 'user_deactivated', 'user', target.id, {
        username: target.username,
        role: target.role
      });
    }
    return {
      ok: true,
      user: { id: target.id, username: target.username, role: target.role, active: active ? 1 : 0 }
    };
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
    ensureBootstrapAdmin
  };
}

module.exports = { createAuthService, ROLES };
