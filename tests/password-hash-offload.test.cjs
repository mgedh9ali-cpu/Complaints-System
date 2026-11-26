'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// Instrument the worker pool before lib/passwords captures runScrypt, so the
// tests can (a) count real offloaded hashes and (b) make one hash artificially
// slow *inside the worker thread*.
const offload = require('../lib/workers/offload');
const realRunScrypt = offload.runScrypt;
let slowScryptOptions = null;
let slowRun = null;
const scryptCalls = { count: 0 };
offload.runScrypt = (password, salt, keyLen, opts) => {
  scryptCalls.count += 1;
  if (!slowScryptOptions) return realRunScrypt(password, salt, keyLen, opts);
  const run = { started: Date.now(), finished: null };
  slowRun = run;
  return realRunScrypt(password, salt, keyLen, slowScryptOptions).finally(() => {
    run.finished = Date.now();
  });
};

const { hashPassword, verifyPassword, needsUpgrade, DUMMY_HASH } = require('../lib/passwords');
const { createAuthService } = require('../modules/auth/service');
const { createAuthMiddleware } = require('../modules/auth/middleware');
const { createAuthRouter } = require('../modules/auth/routes');
const { createHealthService } = require('../modules/health/service');
const { createHealthRouter } = require('../modules/health/routes');
const { createSessionMiddleware } = require('../config/session');

const LEGACY_PASSWORD = 'Legacy-password-2026';
const LEGACY_PREPARE = crypto
  .createHash('sha256')
  .update('complaints-password-v1\0' + LEGACY_PASSWORD, 'utf8')
  .digest('base64');

function legacyHash(prefixed) {
  const bcryptHash = bcrypt.hashSync(prefixed ? LEGACY_PREPARE : LEGACY_PASSWORD, 12);
  return prefixed ? 'sha256-bcrypt-v1$' + bcryptHash : bcryptHash;
}

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

function insertUser(db, { id, username, passwordHash, role = 'admin' }) {
  db.prepare(
    'INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES(?, ?, ?, ?, 1, ?)'
  ).run(id, username, passwordHash, role, new Date().toISOString());
}

test('legacy bcrypt hashes still log in and are upgraded to sha256-scrypt-v1$', async () => {
  const db = setupDb();
  const auditActions = [];
  const auth = createAuthService({ db, audit: (_actor, action) => auditActions.push(action) });
  try {
    insertUser(db, { id: 'u1', username: 'prefixed-legacy', passwordHash: legacyHash(true) });
    insertUser(db, { id: 'u2', username: 'raw-legacy', passwordHash: legacyHash(false), role: 'staff' });

    for (const id of ['u1', 'u2']) {
      const stored = db.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(id);
      assert.equal(needsUpgrade(stored.password_hash), true);

      const rejected = await auth.authenticate(stored.username, 'wrong-password-2026');
      assert.equal(rejected.ok, false);
      assert.equal(rejected.status, 401);
      assert.equal(
        db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id).password_hash,
        stored.password_hash,
        'a failed login must not rewrite the stored hash'
      );

      const login = await auth.authenticate(stored.username, LEGACY_PASSWORD);
      assert.equal(login.ok, true, 'legacy bcrypt hash must keep authenticating');
      assert.equal(login.user.id, id);

      const upgraded = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id).password_hash;
      assert.match(upgraded, /^sha256-scrypt-v1\$/);
      assert.equal(needsUpgrade(upgraded), false);
      assert.equal(await verifyPassword(LEGACY_PASSWORD, upgraded), true);
      assert.equal(await verifyPassword(LEGACY_PASSWORD + '-other', upgraded), false);

      const again = await auth.authenticate(stored.username, LEGACY_PASSWORD);
      assert.equal(again.ok, true, 'the upgraded hash must log in again');
    }

    assert.equal(auditActions.filter((action) => action === 'password_hash_upgraded').length, 2);
  } finally {
    db.close();
  }
});

test('unknown usernames still run the dummy password verification', async () => {
  assert.match(DUMMY_HASH, /^sha256-scrypt-v1\$/);
  assert.equal(await verifyPassword('anything-at-all', null), false);

  const db = setupDb();
  try {
    const auth = createAuthService({ db, audit: () => {} });
    const before = scryptCalls.count;
    const result = await auth.authenticate('missing-account', 'Some-password-2026');
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(scryptCalls.count, before + 1, 'the dummy hash must be verified through the worker too');
  } finally {
    db.close();
  }
});

test('GET /api/health is answered while a login hash still runs in the worker thread', { timeout: 60000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-hash-offload-'));
  const db = setupDb();
  const password = 'Offload-password-2026';
  // The slow parameters are used for the seed hash too: scrypt derives a
  // different key for different N/r/p, and the test only changes the cost.
  slowScryptOptions = { N: 65536, r: 8, p: 2, maxmem: 256 * 1024 * 1024 };
  insertUser(db, { id: 'offload-user', username: 'offload-admin', passwordHash: await hashPassword(password) });

  const authService = createAuthService({ db, audit: () => {} });
  const middleware = createAuthMiddleware({ db });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createSessionMiddleware({
    sessionSecret: 'test-session-secret-at-least-32-characters',
    sessionsDir: path.join(temp, 'sessions'),
    cookieSecure: false
  }));
  app.use('/api', createHealthRouter({
    healthService: createHealthService({ db, databasePath: path.join(temp, 'complaints.sqlite'), version: 'test' }),
    middleware
  }));
  app.use('/api', createAuthRouter({
    authService,
    middleware,
    audit: () => {},
    rolesService: null,
    singleOperator: true
  }));

  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;

  try {
    slowRun = null;
    let loginSettled = false;
    const loginStarted = Date.now();
    const loginPromise = fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'offload-admin', password })
    }).then((response) => {
      loginSettled = true;
      return response;
    }, (error) => {
      loginSettled = true;
      throw error;
    });

    // Wait until the request reaches the slow hash inside the worker.
    for (let attempt = 0; attempt < 250 && !(slowRun && slowRun.finished === null); attempt += 1) {
      await delay(20);
    }
    assert.ok(slowRun, 'the login password must be verified by an offloaded scrypt job');
    assert.equal(slowRun.finished, null,
      'the login scrypt hash finished too early; the artificial slowdown did not apply');

    const healthStarted = Date.now();
    const health = await fetch(baseUrl + '/api/health', { signal: AbortSignal.timeout(20000) });
    const healthRespondedAt = Date.now();
    const healthMs = healthRespondedAt - healthStarted;
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    assert.ok(slowRun.finished === null || healthRespondedAt < slowRun.finished,
      'GET /api/health answered after the login hash finished (' + JSON.stringify({ slowRun, healthRespondedAt }) +
      '): the main thread was blocked while hashing');
    assert.equal(loginSettled, false,
      'GET /api/health must answer before the login response; the main thread is blocked otherwise');
    assert.ok(healthMs < 5000, 'health took ' + healthMs + 'ms while a login hash was running');

    const login = await loginPromise;
    const loginMs = Date.now() - loginStarted;
    assert.equal(login.status, 200);
    const body = await login.json();
    assert.equal(body.user.username, 'offload-admin');
    assert.ok(loginMs > 400, 'the artificially slow login hash should have taken a while, took ' + loginMs + 'ms');
  } finally {
    slowScryptOptions = null;
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
