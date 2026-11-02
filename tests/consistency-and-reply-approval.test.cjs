'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../config/db');
const { createComplaintsService } = require('../modules/complaints/service');
const { createAuditService } = require('../modules/audit/service');
const { createSettingsService } = require('../modules/settings/service');
const { createSyncService } = require('../modules/sync/service');
const { createSyncPackage } = require('../lib/offline-sync');

function fixture(t, audit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-consistency-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  t.after(() => db.close());
  const insertUser = db.prepare(
    'INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  );
  insertUser.run('admin-id', 'manager', 'test-only', 'admin', new Date().toISOString());
  insertUser.run('staff-id', 'author', 'test-only', 'staff', new Date().toISOString());
  const service = createComplaintsService({ db, audit, logger: null });
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
  const result = sync.importPackage({ payload, userId: 'admin-id', forceReplace: true });
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


test('offline import refuses to remove a local complaint without explicit forceReplace', t => {
  const { db, service } = fixture(t);
  const seeded = service.saveState({
    state: stateFor('SY-2026-KEEP'), userId: 'admin-id', expectedRevision: 0
  });
  assert.equal(seeded.conflict, false);
  const incoming = stateFor('SY-2026-OTHER');
  const payload = createSyncPackage(incoming, path.resolve(__dirname, '..'), 'other-device');
  const sync = createSyncService({
    complaintsService: service, auditService: { record() {} },
    db, sourceInstanceId: 'receiver-device', rootDir: path.resolve(__dirname, '..')
  });
  const result = sync.importPackage({ payload, userId: 'admin-id' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.conflicts[0].kind, 'missing_from_incoming');
  assert.deepEqual(service.readState().state.complaints.map(c => c.id), ['SY-2026-KEEP']);
});


test('staff cannot change protected settings through the general state endpoint', t => {
  const { service } = fixture(t);
  const original = stateFor('SY-2026-SECURE');
  original.settings = { slaDays: 7, provinces: ['دمشق'] };
  const first = service.saveState({ state: original, userId: 'admin-id', expectedRevision: 0 });
  assert.equal(first.conflict, false);
  const tampered = structuredClone(original);
  tampered.settings.slaDays = 365;
  const result = service.saveState({
    state: tampered, userId: 'staff-id', expectedRevision: first.revision
  });
  assert.equal(result.invalidTransition, true);
  assert.equal(service.readState().state.settings.slaDays, 7);
});

test('reply author cannot be forged or rewritten through state saving', t => {
  const { service } = fixture(t);
  const original = stateFor('SY-2026-AUTHOR');
  const first = service.saveState({ state: original, userId: 'staff-id', expectedRevision: 0 });
  const tampered = structuredClone(original);
  tampered.complaints[0].reply = {
    status: 'draft', author: 'manager', text: 'نص رد مزور'
  };
  const denial = service.saveState({
    state: tampered, userId: 'staff-id', expectedRevision: first.revision
  });
  assert.equal(denial.invalidTransition, true);
  assert.equal(service.readState().state.complaints[0].reply, null);
});

test('complaint creation rolls back when audit recording fails', t => {
  const { db, service } = fixture(t, () => { throw new Error('intentional audit failure'); });
  assert.throws(() => service.createComplaint({
    body: { province: 'دمشق', category: 'خدمات', summary: 'اختبار التراجع' },
    userId: 'staff-id', username: 'author'
  }), /intentional audit failure/);
  assert.equal(service.readState().revision, 0);
  assert.deepEqual(service.readState().state.complaints, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n, 0);
});

test('audit callback executes while the SQLite complaint transaction is open', t => {
  let auditedInTransaction = false;
  let dbRef = null;
  const fixtureResult = fixture(t, () => {
    auditedInTransaction = Boolean(dbRef?.inTransaction);
  });
  dbRef = fixtureResult.db;
  const result = fixtureResult.service.createComplaint({
    body: { province: 'دمشق', category: 'خدمات', summary: 'تسجيل موحد' },
    userId: 'staff-id', username: 'author'
  });
  assert.equal(result.ok, true);
  assert.equal(auditedInTransaction, true);
});


test('referral and status transition are stored together', t => {
  const { service } = fixture(t);
  const original = stateFor('SY-2026-REFERRAL');
  original.complaints[0].status = 'in_progress';
  const initialized = service.saveState({
    state: original, userId: 'admin-id', expectedRevision: 0
  });
  assert.equal(initialized.conflict, false);
  const result = service.addReferral({
    complaintId: 'SY-2026-REFERRAL',
    entity: 'مديرية الخدمات',
    due: '2026-11-10T23:59:00.000Z',
    note: 'مراجعة المستندات',
    userId: 'staff-id',
    username: 'author'
  });
  assert.equal(result.ok, true);
  const saved = service.readState();
  assert.equal(saved.revision, initialized.revision + 1);
  assert.equal(saved.state.complaints[0].status, 'awaiting_reply');
  assert.equal(saved.state.complaints[0].referrals.length, 1);
  assert.equal(saved.state.complaints[0].statusHistory.length, 1);
  assert.equal(saved.state.complaints[0].referrals[0].entity, 'مديرية الخدمات');
});

test('referral and status stay unchanged if any audit event fails', t => {
  let audits = 0, testingReferral = false;
  const { service, db } = fixture(t, () => {
    if (!testingReferral) return;
    audits += 1;
    if (audits === 2) throw new Error('audit entry rejected');
  });
  const original = stateFor('SY-2026-REFERRAL-ROLLBACK');
  original.complaints[0].status = 'in_progress';
  const initial = service.saveState({ state: original, userId: 'admin-id', expectedRevision: 0 });
  assert.equal(initial.conflict, false);
  testingReferral = true;
  assert.throws(() => service.addReferral({
    complaintId: 'SY-2026-REFERRAL-ROLLBACK',
    entity: 'مديرية الخدمات',
    due: '2026-11-10T23:59:00.000Z',
    note: '',
    userId: 'staff-id',
    username: 'author'
  }), /audit entry rejected/);
  const after = service.readState();
  assert.equal(after.revision, initial.revision);
  assert.equal(after.state.complaints[0].status, 'in_progress');
  assert.equal((after.state.complaints[0].referrals || []).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n, 1);
});


test('rolled back referral does not publish an invalid audit sidecar hash', t => {
  const { db, dir } = fixture(t);
  const auditService = createAuditService({
    db, logger: null, databasePath: path.join(dir, 'test.sqlite')
  });
  let calls = 0;
  const audit = (...args) => {
    calls += 1;
    if (calls === 4) throw new Error('reject second referral audit event');
    return auditService.record(...args);
  };
  audit.syncHead = () => auditService.syncHead();
  const service = createComplaintsService({ db, audit, logger: null });
  const created = service.createComplaint({
    body: { province: 'دمشق', category: 'خدمات', summary: 'اختبار بصمة التدقيق' },
    userId: 'staff-id', username: 'author'
  });
  const started = service.changeStatus({
    complaintId: created.complaint.id,
    toStatus: 'in_progress',
    userId: 'staff-id', username: 'author'
  });
  assert.equal(started.ok, true);
  const head = path.join(dir, 'audit-head.hash');
  const headBefore = fs.readFileSync(head, 'utf8');
  assert.throws(() => service.addReferral({
    complaintId: created.complaint.id,
    entity: 'مديرية الخدمات',
    due: '2026-11-10T23:59:00.000Z',
    userId: 'staff-id', username: 'author'
  }), /reject second referral audit event/);
  assert.equal(fs.readFileSync(head, 'utf8'), headBefore);
  assert.equal(auditService.verifyChain().ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 2);
  const after = service.readState().state.complaints[0];
  assert.equal(after.status, 'in_progress');
  assert.equal(after.referrals.length, 0);
});


test('settings changes commit with their audit event or roll back together', t => {
  const { db } = fixture(t);
  let calls = 0;
  const audit = () => { calls += 1; throw new Error('audit failed'); };
  const service = createComplaintsService({ db, audit, logger: null });
  const settings = createSettingsService({ complaintsService: service });
  const initialSettings = structuredClone(service.readState().state.settings);
  assert.throws(() => settings.updateSettings({
    settings: { slaDays: 30, slaApproved: true },
    userId: 'admin-id', expectedRevision: 0
  }), /audit failed/);
  assert.equal(calls, 1);
  assert.equal(service.readState().revision, 0);
  assert.deepEqual(service.readState().state.settings, initialSettings);
});
