'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createComplaintsService } = require('../modules/complaints/service.js');

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
  `);
  db.prepare(
    "INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES ('u1','admin','x','admin',1,'2026-01-01')"
  ).run();
  return db;
}

test('changeStatus applies allowed transition and records history', () => {
  const db = setupDb();
  const audits = [];
  const service = createComplaintsService({
    db,
    audit: (a, action, t, id, details) => audits.push({ action, id, details })
  });

  const initial = service.defaultState();
  initial.complaints.push({
    id: 'SY-2026-T1',
    status: 'new',
    summary: 'test',
    timeline: [],
    statusHistory: []
  });

  const saved = service.saveState({
    state: initial,
    userId: 'u1',
    expectedRevision: 0,
    diffComplaints: () => []
  });
  assert.equal(saved.conflict, false);
  assert.equal(saved.revision, 1);

  const start = service.changeStatus({
    complaintId: 'SY-2026-T1',
    toStatus: 'in_progress',
    userId: 'u1',
    username: 'admin'
  });
  assert.equal(start.ok, true);
  assert.equal(start.complaint.status, 'in_progress');
  assert.equal(start.complaint.statusHistory.length, 1);
  assert.equal(start.complaint.statusHistory[0].from, 'new');

  const illegal = service.changeStatus({
    complaintId: 'SY-2026-T1',
    toStatus: 'closed',
    reason: 'skip',
    userId: 'u1',
    username: 'admin'
  });
  // in_progress → closed is allowed in our machine
  assert.equal(illegal.ok, true);

  const again = service.changeStatus({
    complaintId: 'SY-2026-T1',
    toStatus: 'in_progress',
    userId: 'u1',
    username: 'admin'
  });
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);

  db.close();
});

test('saveState rejects illegal status jump via full state put', () => {
  const db = setupDb();
  const service = createComplaintsService({ db, audit: () => {} });

  const initial = service.defaultState();
  initial.complaints.push({ id: 'SY-1', status: 'new', summary: 'x' });
  service.saveState({ state: initial, userId: 'u1', expectedRevision: 0, diffComplaints: () => [] });

  const jumped = structuredClone(initial);
  jumped.complaints[0].status = 'closed';
  const result = service.saveState({
    state: jumped,
    userId: 'u1',
    expectedRevision: 1,
    diffComplaints: () => []
  });
  assert.equal(result.invalidTransition, true);
  assert.ok(result.error);

  db.close();
});

test('closed requires a reason', () => {
  const db = setupDb();
  const service = createComplaintsService({ db, audit: () => {} });
  const initial = service.defaultState();
  initial.complaints.push({ id: 'SY-2', status: 'in_progress', summary: 'x', statusHistory: [] });
  service.saveState({ state: initial, userId: 'u1', expectedRevision: 0, diffComplaints: () => [] });

  const noReason = service.changeStatus({
    complaintId: 'SY-2',
    toStatus: 'closed',
    userId: 'u1',
    username: 'admin'
  });
  assert.equal(noReason.ok, false);
  assert.equal(noReason.status, 400);

  const withReason = service.changeStatus({
    complaintId: 'SY-2',
    toStatus: 'closed',
    reason: 'اكتملت المعالجة',
    userId: 'u1',
    username: 'admin'
  });
  assert.equal(withReason.ok, true);
  assert.equal(withReason.complaint.status, 'closed');

  db.close();
});
