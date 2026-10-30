'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createAuthService } = require('../modules/auth/service.js');
const { createComplaintsService } = require('../modules/complaints/service.js');

function setupDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-auth-create-'));
  const dbPath = path.join(dir, 't.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE complaints (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE app_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      state_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      previous_hash TEXT,
      event_hash TEXT
    );
  `);
  return { db, dir };
}

test('changePassword rejects wrong current password and accepts valid change', () => {
  const { db, dir } = setupDb();
  try {
    const auth = createAuthService({ db, audit: () => {}, logger: null });
    auth.ensureBootstrapAdmin('adminuser', 'Old-password-12chars');
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('adminuser');
    const bad = auth.changePassword({
      userId: user.id,
      currentPassword: 'wrong-password-xx',
      newPassword: 'New-password-12chars'
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 401);

    const good = auth.changePassword({
      userId: user.id,
      currentPassword: 'Old-password-12chars',
      newPassword: 'New-password-12chars'
    });
    assert.equal(good.ok, true);

    const login = auth.authenticate('adminuser', 'New-password-12chars');
    assert.equal(login.ok, true);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createComplaint writes both app_state and complaints table', () => {
  const { db, dir } = setupDb();
  try {
    const auth = createAuthService({ db, audit: () => {}, logger: null });
    auth.ensureBootstrapAdmin('adminuser', 'Admin-password-12');
    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get('adminuser');
    const complaints = createComplaintsService({ db, audit: () => {}, logger: null });

    const result = complaints.createComplaint({
      body: {
        summary: 'اختبار اتساق الإنشاء',
        province: 'دمشق',
        category: 'استفسار عام'
      },
      userId: user.id,
      username: user.username
    });
    assert.equal(result.ok, true);
    assert.ok(result.complaint.id.startsWith('SY-'));

    const row = db.prepare('SELECT id FROM complaints WHERE id = ?').get(result.complaint.id);
    assert.ok(row, 'row must exist in complaints table');

    const { state, revision } = complaints.readState();
    assert.equal(revision, result.revision);
    assert.ok(state.complaints.some((c) => c.id === result.complaint.id));

    const status = complaints.changeStatus({
      complaintId: result.complaint.id,
      toStatus: 'in_progress',
      userId: user.id,
      username: user.username
    });
    assert.equal(status.ok, true);
    assert.equal(status.complaint.status, 'in_progress');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('changeStatus requires reason for closed and cancelled', () => {
  const { db, dir } = setupDb();
  try {
    const auth = createAuthService({ db, audit: () => {}, logger: null });
    auth.ensureBootstrapAdmin('adminuser', 'Admin-password-12');
    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get('adminuser');
    const complaints = createComplaintsService({ db, audit: () => {}, logger: null });
    const created = complaints.createComplaint({
      body: { summary: 'سبب مطلوب', province: 'دمشق', category: 'استفسار عام' },
      userId: user.id,
      username: user.username
    });
    complaints.changeStatus({
      complaintId: created.complaint.id,
      toStatus: 'in_progress',
      userId: user.id,
      username: user.username
    });
    const noReason = complaints.changeStatus({
      complaintId: created.complaint.id,
      toStatus: 'closed',
      reason: '',
      userId: user.id,
      username: user.username
    });
    assert.equal(noReason.ok, false);
    assert.equal(noReason.status, 400);

    const withReason = complaints.changeStatus({
      complaintId: created.complaint.id,
      toStatus: 'closed',
      reason: 'اكتملت المعالجة',
      userId: user.id,
      username: user.username
    });
    assert.equal(withReason.ok, true);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
