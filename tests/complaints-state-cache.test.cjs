'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { openDatabase } = require('../config/db');
const { validComplaint } = require('../lib/validation');
const { createComplaintsService } = require('../modules/complaints/service');
const { createComplaintsRouter } = require('../modules/complaints/routes');

const KEY = 'synthetic-state-cache-storage-key-32-characters';
const ARCHIVE_SIZE = 40;
const TARGET = 'CACHE-0002';

function record(id) {
  const now = new Date().toISOString();
  return {
    id, name: 'اسم وهمي', phone: '0912345678', source: 'phone', province: 'دمشق',
    entity: '', category: 'خدمات', nature: '', priority: 'normal', status: 'new',
    summary: 'أرشيف اختباري رقم ' + id, details: 'تفاصيل اختبارية', created: now, updated: now,
    timeline: [], notes: [], referrals: [], attachments: [], statusHistory: []
  };
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-state-cache-'));
  const db = openDatabase(path.join(dir, 'cache.sqlite'), { storageKey: KEY });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  db.prepare("INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES('operator', 'director', 'test-only', 'admin', 1, ?)")
    .run(new Date().toISOString());
  const service = createComplaintsService({ db, audit: () => {}, logger: null });
  const complaints = Array.from({ length: ARCHIVE_SIZE }, (_, i) => record('CACHE-' + String(i + 1).padStart(4, '0')));
  const seeded = service.saveState({
    state: { complaints, notifications: [], templates: [], settings: {} },
    userId: 'operator',
    expectedRevision: 0
  });
  assert.equal(seeded.conflict, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n, ARCHIVE_SIZE);
  return { db, service };
}
function routerFor(service, db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'operator', username: 'director' }; next(); });
  app.use('/api', createComplaintsRouter({
    complaintsService: service,
    middleware: { requireAuth: (_req, _res, next) => next(), requireCsrf: (_req, _res, next) => next() },
    rolesService: { requirePermission: () => (_req, _res, next) => next() },
    validComplaint,
    db
  }));
  return app;
}
// Spy on the same codec object the service captured, so both route and service calls are counted.
function spyCodec(db) {
  const codec = db.storageCodec;
  assert.equal(codec.enabled, true, 'the fixture must run with an encrypted storage codec');
  const calls = [];
  const encode = codec.encodeJson.bind(codec), decode = codec.decodeJson.bind(codec);
  codec.encodeJson = (value, context) => { calls.push({ kind: 'encode', context }); return encode(value, context); };
  codec.decodeJson = (value, context) => { calls.push({ kind: 'decode', context }); return decode(value, context); };
  return {
    calls,
    stateDecodes: () => calls.filter(c => c.kind === 'decode' && c.context === 'app-state').length,
    stateEncodes: () => calls.filter(c => c.kind === 'encode' && c.context === 'app-state').length,
    complaintEncodes: () => calls.filter(c => c.kind === 'encode' && String(c.context).startsWith('complaint:')).map(c => c.context)
  };
}

test('PATCH /api/complaints/:id decodes and encodes the state once and rewrites only the changed row', async t => {
  const { db, service } = fixture(t);
  // Read the revision straight from the row so the request below starts with an empty cache and
  // the decode that follows is the one and only state read of the action.
  const revision = Number(db.prepare('SELECT revision FROM app_state WHERE id = 1').get().revision);
  const before = db.prepare('SELECT id, payload_json, updated_at FROM complaints ORDER BY id').all();
  const app = routerFor(service, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const spy = spyCodec(db);
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/complaints/' + TARGET, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-State-Revision': String(revision) },
    body: JSON.stringify({ details: 'تعديل واحد على سجل واحد' })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.unchanged, false);
  assert.equal(body.complaint.id, TARGET);
  assert.equal(body.complaint.details, 'تعديل واحد على سجل واحد');
  assert.equal(body.revision, revision + 1);

  assert.equal(spy.stateDecodes(), 1, 'the request must decode the stored state exactly once, not once per layer');
  assert.equal(spy.stateEncodes(), 1, 'the request must encode the stored state exactly once');
  assert.deepEqual(spy.complaintEncodes(), ['complaint:' + TARGET], 'only the edited complaint may be re-encoded');

  const after = db.prepare('SELECT id, payload_json, updated_at FROM complaints ORDER BY id').all();
  const beforeById = new Map(before.map(row => [row.id, row]));
  for (const row of after) {
    if (row.id === TARGET) continue;
    assert.equal(row.payload_json, beforeById.get(row.id).payload_json, 'unchanged complaint row was rewritten: ' + row.id);
    assert.equal(row.updated_at, beforeById.get(row.id).updated_at, 'unchanged complaint timestamp moved: ' + row.id);
  }
  assert.notEqual(after.find(row => row.id === TARGET).payload_json, beforeById.get(TARGET).payload_json);
  const stored = db.prepare('SELECT revision FROM app_state WHERE id = 1').get();
  assert.equal(stored.revision, revision + 1);
  assert.equal(service.readState().state.complaints.find(c => c.id === TARGET).details, 'تعديل واحد على سجل واحد');

  // Failure path the user sees: a stale header is refused and writes nothing.
  const stale = await fetch('http://127.0.0.1:' + server.address().port + '/api/complaints/' + TARGET, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-State-Revision': String(revision) },
    body: JSON.stringify({ details: 'تعديل بمراجعة قديمة' })
  });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /تغيرت البيانات/);
  assert.equal(spy.stateEncodes(), 1, 'a refused action must not encode the state');
  assert.equal(service.readState().state.complaints.find(c => c.id === TARGET).details, 'تعديل واحد على سجل واحد');
});

test('a no-op reminder cycle reuses the decoded state instead of decrypting it again', t => {
  const { db, service } = fixture(t);
  const spy = spyCodec(db);
  assert.equal(service.runReminders(new Date()), 0, 'nothing is due in a fresh archive');
  assert.equal(spy.stateDecodes(), 1, 'the first reminder cycle decodes the state once');
  assert.equal(spy.stateEncodes(), 0, 'a cycle with no reminder must not write the state');
  assert.equal(service.runReminders(new Date()), 0);
  assert.equal(spy.stateDecodes(), 1, 'a second cycle with no changes must not decode the state again');
  // A real write invalidates the cache, so the next cycle reads the committed state again.
  assert.equal(service.updateComplaint({ complaintId: TARGET, body: { details: 'تعديل بعد التذكير' }, userId: 'operator', username: 'director' }).ok, true);
  assert.equal(service.runReminders(new Date()), 0);
  assert.equal(spy.stateDecodes(), 2, 'a write invalidates the cache and the next read decodes the new revision');
});
