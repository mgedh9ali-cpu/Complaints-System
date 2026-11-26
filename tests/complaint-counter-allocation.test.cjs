'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { openDatabase } = require('../config/db');
const { storageFor } = require('../lib/storage-codec');
const { createSyncPackage } = require('../lib/offline-sync');
const { validComplaint } = require('../lib/validation');
const { createComplaintsService } = require('../modules/complaints/service');
const { createComplaintsRouter } = require('../modules/complaints/routes');
const { createSyncService } = require('../modules/sync/service');

function currentYear() {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Damascus', year: 'numeric' }).format(new Date()));
}
function serial(year, sequence) {
  return 'SY-' + year + '-' + String(sequence).padStart(6, '0');
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaint-counter-'));
  const db = openDatabase(path.join(dir, 'counter.sqlite'));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  db.prepare('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES(?, ?, ?, ?, 1, ?)')
    .run('operator', 'director', 'test-only', 'admin', new Date().toISOString());
  return { db };
}
function record(id, summary) {
  const now = new Date().toISOString();
  return {
    id, summary: summary || 'أرشيف اختباري', status: 'new', province: 'دمشق', category: 'خدمات',
    created: now, updated: now, timeline: [], statusHistory: []
  };
}
// Simulates an archive that reached the database outside the live create path (import/restore).
function seedArchive(db, ids) {
  const storage = storageFor(db);
  const complaints = ids.map(id => record(id));
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES(?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const complaint of complaints) {
      insert.run(complaint.id, storage.encodeJson(complaint, 'complaint:' + complaint.id), 'operator', now, now);
    }
    db.prepare('INSERT INTO app_state(id, state_json, updated_by, updated_at, revision) VALUES(1, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json')
      .run(storage.encodeJson({ complaints, notifications: [], templates: [], settings: {} }, 'app-state'), 'operator', now);
  })();
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

test('POST /api/complaints takes the next serial from complaint_counters without reading the archive', async t => {
  const { db } = fixture(t);
  const year = currentYear();
  const archiveIds = [];
  for (let sequence = 1; sequence <= 2000; sequence++) archiveIds.push(serial(year, sequence));
  archiveIds.push(serial(year - 1, 900));
  seedArchive(db, archiveIds);
  const service = createComplaintsService({ db, audit: () => {}, logger: null });
  assert.equal(db.prepare('SELECT value FROM complaint_counters WHERE year = ?').get(year).value, 2000);

  // Spy only on the request path, after start-up reconciliation already ran.
  const statements = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { statements.push(String(sql)); return prepare(sql); };

  const app = routerFor(service, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/complaints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: 'شكوى جديدة على أرشيف كبير', province: 'دمشق', category: 'استفسار' })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.complaint.id, serial(year, 2001));

  const archiveReads = statements.filter(sql =>
    /from\s+complaints\b/i.test(sql) && !/\bwhere\s+id\s*=\s*\?/i.test(sql)
  );
  assert.deepEqual(archiveReads, [], 'creation must not scan the complaints archive');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n, archiveIds.length + 1);
});

test('start-up reconciliation raises counters to the archived maximum and numbering continues after it', t => {
  const { db } = fixture(t);
  const year = currentYear();
  seedArchive(db, [serial(year, 7), serial(year, 42), serial(year - 1, 300)]);

  // A restore/import leaves the counters behind the archive; start-up must repair them once.
  db.exec('CREATE TABLE complaint_counters(year INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
  const setCounter = db.prepare('INSERT INTO complaint_counters(year, value) VALUES(?, ?)');
  setCounter.run(year, 5);
  setCounter.run(year - 1, 900);

  const service = createComplaintsService({ db, audit: () => {}, logger: null });
  assert.equal(db.prepare('SELECT value FROM complaint_counters WHERE year = ?').get(year).value, 42);
  assert.equal(db.prepare('SELECT value FROM complaint_counters WHERE year = ?').get(year - 1).value, 900);

  const created = service.createComplaint({ body: { summary: 'سجل بعد الاستعادة' }, userId: 'operator', username: 'director' });
  assert.equal(created.complaint.id, serial(year, 43));
});

test('a first snapshot stored through the state endpoint re-aligns the counters', t => {
  const { db } = fixture(t);
  const year = currentYear();
  const service = createComplaintsService({ db, audit: () => {}, logger: null });
  const saved = service.saveState({
    state: { complaints: [record(serial(year, 500))], notifications: [], templates: [], settings: {} },
    userId: 'operator',
    expectedRevision: 0
  });
  assert.equal(saved.conflict, false);
  const created = service.createComplaint({ body: { summary: 'سجل بعد استعادة اللقطة' }, userId: 'operator', username: 'director' });
  assert.equal(created.complaint.id, serial(year, 501));
});

test('an imported archive re-aligns the counters so the next creation continues after it', t => {
  const { db } = fixture(t);
  const year = currentYear();
  const service = createComplaintsService({ db, audit: () => {}, logger: null });
  assert.equal(
    service.createComplaint({ body: { summary: 'سجل محلي قبل الاستيراد' }, userId: 'operator', username: 'director' }).complaint.id,
    serial(year, 1)
  );

  const rootDir = path.resolve(__dirname, '..');
  const incoming = {
    complaints: [record(serial(year, 350), 'سجل مستورد'), record(serial(year, 351), 'سجل مستورد')],
    notifications: [], templates: [], settings: {}
  };
  const payload = createSyncPackage(incoming, rootDir, 'device-source');
  const sync = createSyncService({
    complaintsService: service, auditService: { record() {} },
    db, sourceInstanceId: 'device-receiver', rootDir
  });
  const imported = sync.importPackage({ payload, userId: 'operator', forceReplace: true });
  assert.equal(imported.ok, true);
  assert.equal(db.prepare('SELECT value FROM complaint_counters WHERE year = ?').get(year).value, 351);

  const next = service.createComplaint({ body: { summary: 'سجل بعد الاستيراد' }, userId: 'operator', username: 'director' });
  assert.equal(next.complaint.id, serial(year, 352));
});
