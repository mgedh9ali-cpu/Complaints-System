'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../config/db');
const { createComplaintsService } = require('../modules/complaints/service');
const { createSyncService } = require('../modules/sync/service');
const { createSyncPackage } = require('../lib/offline-sync');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-consistency-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  t.after(() => db.close());
  const insertUser = db.prepare(
    'INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  );
  insertUser.run('admin-id', 'manager', 'test-only', 'admin', new Date().toISOString());
  insertUser.run('staff-id', 'author', 'test-only', 'staff', new Date().toISOString());
  const service = createComplaintsService({ db, audit: () => {}, logger: null });
  return { dir, db, service };
}
function stateFor(id, reply = null) {
  return {
    complaints: [{
      id, summary: 'اختبار حالة البيانات', category: 'خدمات',
      province: 'دمشق', status: 'new', reply,
      created: new Date().toISOString(), updated: new Date().toISOString()
    }],
    notifications: [], templates: [], settings: {}
  };
}

test('offline import replaces app_state and indexed complaint rows together', t => {
  const { db, service } = fixture(t);
  const seeded = service.saveState({
    state: stateFor('SY-2026-OLD'),
    userId: 'admin-id', expectedRevision: 0
  });
  assert.equal(seeded.conflict, false);
  const incoming = stateFor('SY-2026-NEW');
  const sourceRoot = path.resolve(__dirname, '..');
  const payload = createSyncPackage(incoming, sourceRoot, 'device-source');
  const sync = createSyncService({
    complaintsService: service, auditService: { record() {} },
    db, sourceInstanceId: 'device-receiver', rootDir: sourceRoot
  });
  const result = sync.importPackage({ payload, userId: 'admin-id' });
  assert.equal(result.ok, true);
  assert.deepEqual(service.readState().state.complaints.map(c => c.id), ['SY-2026-NEW']);
  assert.deepEqual(
    db.prepare('SELECT id FROM complaints ORDER BY id').all().map(row => row.id),
    ['SY-2026-NEW']
  );
});

test('reply approval requires a different manager and an existing review', t => {
  const { service } = fixture(t);
  const draft = stateFor('SY-2026-REPLY', {
    author: 'author', text: 'رد رسمي تجريبي', status: 'review'
  });
  const initial = service.saveState({
    state: draft, userId: 'staff-id', expectedRevision: 0
  });
  assert.equal(initial.conflict, false);
  const attempted = structuredClone(draft);
  attempted.complaints[0].reply.status = 'approved';
  const denied = service.saveState({
    state: attempted, userId: 'staff-id', expectedRevision: initial.revision
  });
  assert.equal(denied.invalidTransition, true);
  const allowed = service.saveState({
    state: attempted, userId: 'admin-id', expectedRevision: initial.revision
  });
  assert.equal(allowed.conflict, false);
  assert.equal(allowed.invalidTransition, undefined);
  assert.equal(service.readState().state.complaints[0].reply.status, 'approved');
});
