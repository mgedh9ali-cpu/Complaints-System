'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyRestore } = require('../scripts/verify-database-restore');

test('restore drill verifies a temporary restored copy and preserves row counts', async t => {
  const Database = require('better-sqlite3');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-restore-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backup = path.join(root, 'backup.sqlite');
  const db = new Database(backup);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE complaints (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE app_state (id INTEGER PRIMARY KEY, state_json TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO users VALUES ('u1','admin','hash','admin',1,'2026-01-01');
    INSERT INTO complaints VALUES ('c1','{}','u1','2026-01-01','2026-01-01');
    INSERT INTO app_state VALUES (1,'{}','u1','2026-01-01');
    INSERT INTO audit_events VALUES ('e1','u1','created','complaint','c1','{}','2026-01-01');
  `);
  db.close();

  const result = await verifyRestore(backup);
  assert.equal(result.verified, true);
  assert.equal(result.restoredCopyChecked, true);
  assert.deepEqual(result.counts, { users: 1, complaints: 1, app_state: 1, audit_events: 1 });
  assert.equal(fs.existsSync(backup), true, 'original backup must remain untouched');
});

test('restore drill rejects a database missing required schema', async t => {
  const Database = require('better-sqlite3');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-restore-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backup = path.join(root, 'invalid.sqlite');
  const db = new Database(backup);
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY);');
  db.close();
  await assert.rejects(verifyRestore(backup), /missing required table|missing required column/);
});
