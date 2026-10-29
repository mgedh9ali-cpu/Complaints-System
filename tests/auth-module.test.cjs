'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createAuthService } = require('../modules/auth/service.js');
const { createAuthMiddleware } = require('../modules/auth/middleware.js');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

test('auth service bootstrap, create, authenticate, deactivate', () => {
  const db = setupDb();
  const audits = [];
  const service = createAuthService({
    db,
    audit: (a, action, t, id, d) => audits.push({ action, id, d })
  });

  service.ensureBootstrapAdmin('admin', 'Admin-password-2026');
  assert.equal(service.listUsers().length, 1);

  const authOk = service.authenticate('admin', 'Admin-password-2026');
  assert.equal(authOk.ok, true);
  assert.equal(authOk.user.role, 'admin');

  const authFail = service.authenticate('admin', 'wrong');
  assert.equal(authFail.ok, false);
  assert.equal(authFail.status, 401);

  const created = service.createUser({
    username: 'staff1',
    password: 'Staff-password-2026',
    role: 'staff',
    actorId: authOk.user.id
  });
  assert.equal(created.ok, true);

  const weak = service.createUser({
    username: 'x',
    password: 'short',
    role: 'staff',
    actorId: authOk.user.id
  });
  assert.equal(weak.ok, false);

  const selfOff = service.setActive({
    targetId: authOk.user.id,
    active: false,
    actorId: authOk.user.id
  });
  assert.equal(selfOff.status, 409);

  const off = service.setActive({
    targetId: created.user.id,
    active: false,
    actorId: authOk.user.id
  });
  assert.equal(off.ok, true);
  assert.equal(off.user.active, 0);

  const middleware = createAuthMiddleware({ db });
  assert.equal(typeof middleware.requireAuth, 'function');
  assert.equal(typeof middleware.requireRole, 'function');
  assert.equal(typeof middleware.requireCsrf, 'function');

  db.close();
});
