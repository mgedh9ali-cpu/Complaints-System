'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { backupDatabase } = require('../scripts/backup-database');
const { verifyRestore } = require('../scripts/verify-database-restore');

function createFixtureDatabase(filePath) {
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff','reviewer')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE complaints (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE app_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      state_json TEXT NOT NULL CHECK(json_valid(state_json)),
      updated_by TEXT NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL CHECK(json_valid(details_json)),
      created_at TEXT NOT NULL
    );
  `);
  const now = '2026-10-25T10:00:00.000Z';
  db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?)')
    .run('u1', 'admin', 'test-hash', 'admin', 1, now);
  db.prepare('INSERT INTO complaints(id,payload_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run('c1', JSON.stringify({ summary: 'fixture complaint', status: 'new' }), 'u1', now, now);
  db.prepare('INSERT INTO app_state(id,state_json,updated_by,updated_at) VALUES (1,?,?,?)')
    .run(JSON.stringify({ complaints: [{ id: 'c1' }], notifications: [], templates: [], settings: {} }), 'u1', now);
  db.prepare('INSERT INTO audit_events(id,actor_user_id,action,target_type,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('a1', 'u1', 'complaint_created', 'complaint', 'c1', JSON.stringify({ status: 'new' }), now);
  db.close();
}

test('backup and restore drill preserves all core SQLite tables', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-backup-restore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.sqlite');
  const backup = path.join(root, 'backup.sqlite');
  createFixtureDatabase(source);

  const result = await backupDatabase(source, backup);
  assert.equal(result.verified, true);
  assert.deepEqual(result.counts, { users: 1, complaints: 1, app_state: 1, audit_events: 1 });

  const restoreResult = await verifyRestore(backup);
  assert.equal(restoreResult.verified, true);
  assert.equal(restoreResult.restoredCopyChecked, true);
  assert.deepEqual(restoreResult.counts, result.counts);
});

test('backup refuses to overwrite an existing destination', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-backup-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.sqlite');
  const destination = path.join(root, 'backup.sqlite');
  createFixtureDatabase(source);
  fs.writeFileSync(destination, 'do not overwrite');
  await assert.rejects(backupDatabase(source, destination), /already exists/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'do not overwrite');
});

test('restore verification rejects a database missing required tables', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-restore-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const invalid = path.join(root, 'incomplete.sqlite');
  const db = new Database(invalid);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  db.close();
  await assert.rejects(verifyRestore(invalid), /missing required table/);
});
