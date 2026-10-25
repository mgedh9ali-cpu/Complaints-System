'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const test = require('node:test');
const Database = require('better-sqlite3');
const { verifyAuditRows } = require('../lib/audit-integrity');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Server exited before becoming ready.');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready before timeout.');
}

test('server migrates legacy audit rows and appends verifiable events', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-audit-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'legacy.sqlite');
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO audit_events(id,actor_user_id,action,target_type,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('legacy-1', null, 'legacy_event', 'system', null, '{}', '2026-10-25T10:00:00.000Z');
  db.close();

  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      SESSION_SECRET: 'audit-migration-test-secret-value-123456789',
      ADMIN_USERNAME: 'auditadmin',
      ADMIN_PASSWORD: 'audit-migration-test-password-123',
      DATABASE_PATH: databasePath,
      HOST: '127.0.0.1',
      ALLOW_LAN: 'false',
      PORT: String(port)
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  });

  await waitForServer(child, baseUrl + '/api/health');
  const columnsDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  const columns = new Set(columnsDb.prepare('PRAGMA table_info(audit_events)').all().map(row => row.name));
  assert.ok(columns.has('previous_hash'));
  assert.ok(columns.has('event_hash'));
  let rows = columnsDb.prepare(`SELECT id, actor_user_id, action, target_type, target_id, details_json,
    created_at, previous_hash, event_hash FROM audit_events ORDER BY rowid ASC`).all();
  assert.equal(verifyAuditRows(rows).valid, true);
  assert.equal(rows.length, 1);
  columnsDb.close();

  const login = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'auditadmin', password: 'audit-migration-test-password-123' })
  });
  assert.equal(login.status, 200);

  const resultDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    rows = resultDb.prepare(`SELECT id, actor_user_id, action, target_type, target_id, details_json,
      created_at, previous_hash, event_hash FROM audit_events ORDER BY rowid ASC`).all();
    assert.equal(rows.length, 2);
    assert.equal(verifyAuditRows(rows).valid, true);
  } finally {
    resultDb.close();
  }
});
