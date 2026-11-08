'use strict';
/* Field acceptance for the local complaints release.
 *
 * Issue #25 asks for a field acceptance pass before the release is trusted
 * with real data. The parts that can be decided by the machine are
 * executed here so they stay repeatable in every CI run: the listener is
 * proven to be loopback-only, a restored copy is proven to run the
 * application with its data, a tampered audit chain is proven to fail, and
 * the server is proven to hold no outbound network client.
 *
 * The items that still need a physical Windows device, and the exact
 * commands for them, are listed in docs/ACCEPTANCE_MATRIX.md. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ACCEPTANCE_DATA_KEY = 'acceptance-only-data-key-of-at-least-32-characters';
process.env.DATA_KEY = ACCEPTANCE_DATA_KEY;

const { verifyLoopbackListener } = require('../scripts/verify-loopback-listener');
const { backupDatabase } = require('../scripts/backup-database');
const { verifyRestore } = require('../scripts/verify-database-restore');
const { verifyAuditDatabase } = require('../scripts/verify-audit-log');
const { openDatabase } = require('../config/db');
const bcrypt = require('bcryptjs');

const ACCEPTANCE_PASSWORD = 'acceptance-only-password-long-enough';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, child, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('the server stopped before it became healthy');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('the server did not become healthy in time');
}

function startServer({ databasePath, port, adminPassword = 'acceptance-only-password-long-enough' }) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      SESSION_SECRET: 'acceptance-only-session-secret-at-least-32-chars',
      DATA_KEY: ACCEPTANCE_DATA_KEY,
      BACKUP_SECRET: 'acceptance-only-backup-secret-at-least-32-chars',
      ADMIN_USERNAME: 'acceptance-admin',
      ADMIN_PASSWORD: adminPassword,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: databasePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function stopServer(child) {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    child.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

test('the complaints server answers on the loopback interface only', async () => {
  const result = await verifyLoopbackListener();
  assert.equal(result.localReachable, true, 'the server must answer on 127.0.0.1');
  assert.deepEqual(result.externallyReachable, [], 'the server must not answer on any other address');
  assert.ok(['127.0.0.1', 'localhost'].includes(result.announcedHost || '127.0.0.1'),
    'the server must announce the loopback host, found: ' + result.announcedHost);
});

test('a restored copy runs the application and keeps its data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const livePath = path.join(directory, 'live.sqlite');
  const database = openDatabase(livePath);
  database.prepare(
    'INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)',
  ).run('u-accept', 'acceptance-admin', bcrypt.hashSync(ACCEPTANCE_PASSWORD, 10), 'admin', new Date().toISOString());
  const { createAuditService } = require('../modules/audit/service');
  const { createComplaintsService } = require('../modules/complaints/service');
  const auditService = createAuditService({ db: database, databasePath: livePath });
  const service = createComplaintsService({ db: database, audit: auditService });
  const saved = service.saveState({
    state: {
      complaints: [{
        id: 'SY-ACCEPT-0001',
        name: 'اختبار القبول',
        summary: 'شكوى اصطناعية لقبول الميدان',
        status: 'new',
        category: 'خدمات عامة',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        timeline: [],
        notes: [],
        referrals: [],
      }],
      notifications: [],
      templates: [],
      settings: {},
    },
    userId: 'u-accept',
    expectedRevision: 0,
  });
  assert.equal(saved.conflict, false, 'the acceptance complaint must be stored');
  database.close();

  const backupPath = path.join(directory, 'acceptance.sqlite');
  const backup = await backupDatabase(livePath, backupPath);
  assert.equal(backup.verified, true);

  const restoredPath = path.join(directory, 'restored', 'complaints.sqlite');
  fs.mkdirSync(path.dirname(restoredPath), { recursive: true });
  fs.copyFileSync(backupPath, restoredPath);
  const restore = await verifyRestore(restoredPath);
  assert.equal(restore.verified, true, 'the restored copy must verify');
  assert.equal(restore.restoredCopyChecked, true);

  const port = await freePort();
  const child = startServer({ databasePath: restoredPath, port });
  t.after(() => stopServer(child));
  const health = await waitForHealth(port, child);
  assert.equal(health.status, 'ok');

  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'acceptance-admin', password: ACCEPTANCE_PASSWORD }),
  });
  assert.equal(login.status, 200, 'the restored database must still authenticate its administrator');
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const state = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(state.status, 200);
  const payload = await state.json();
  const ids = (payload.state?.complaints || []).map(entry => entry.id);
  assert.ok(ids.includes('SY-ACCEPT-0001'), 'the restored copy must serve the backed-up complaint');
});

test('a tampered audit chain is rejected and an intact chain passes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-audit-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const livePath = path.join(directory, 'audit.sqlite');
  const database = openDatabase(livePath);
  database.prepare(
    'INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)',
  ).run('u-audit', 'auditor', bcrypt.hashSync(ACCEPTANCE_PASSWORD, 10), 'admin', new Date().toISOString());
  const { createAuditService } = require('../modules/audit/service');
  const auditService = createAuditService({ db: database, databasePath: livePath });
  auditService.record('u-audit', 'login', 'user', 'u-audit', {});
  auditService.record('u-audit', 'complaint_created', 'complaint', 'SY-ACCEPT-0002', { digest: 'abc' });
  database.close();

  const intact = verifyAuditDatabase(livePath);
  assert.equal(intact.valid, true, 'an untouched chain must verify');
  assert.ok(intact.eventsChecked >= 2);

  const tamperedPath = path.join(directory, 'tampered.sqlite');
  fs.copyFileSync(livePath, tamperedPath);
  const tampered = openDatabase(tamperedPath);
  tampered.prepare("UPDATE audit_events SET details_json = '{\"digest\":\"tampered\"}' WHERE rowid = 1").run();
  tampered.close();
  const broken = verifyAuditDatabase(tamperedPath);
  assert.equal(broken.valid, false, 'a tampered chain must fail the verification');
});

test('the server holds no outbound network client', () => {
  const directories = ['modules', 'lib', 'config', 'scripts'];
  const files = ['server.js', 'app.js', 'desktop/main.js'];
  for (const directory of directories) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      files.push(path.join(directory, entry.name));
    }
  }
  const forbidden = [
    /https?\.request\s*\(/,
    /https?\.get\s*\(/,
    /require\(['"]node:https?['"]\)/,
    /require\(['"](?:axios|node-fetch|got|undici|superagent)['"]\)/,
    /\bfetch\s*\(\s*['"`]https?:\/\/(?!127\.0\.0\.1|localhost)/,
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, file + ' must not open an outbound connection');
    }
  }
});

test('the page, the worker and the release keep every resource local', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /https?:\/\//i, 'the page must not reference a remote resource');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.doesNotMatch(worker, /https?:\/\//i, 'the worker must not reference a remote resource');
  const security = fs.readFileSync(path.join(root, 'config/security.js'), 'utf8');
  assert.match(security, /connectSrc:\s*\[["']'self'["']\]/, 'the page may only talk to the local server');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('!data/**/*'), 'the release must exclude the live database');
  assert.ok(pkg.build.files.includes('!.env'), 'the release must exclude the local secrets');
  assert.ok(pkg.build.files.includes('!backups/**/*'), 'the release must exclude local backups');
  assert.ok(pkg.build.files.includes('!sessions/**/*') || !pkg.build.files.some(entry => entry.includes('sessions/')),
    'the release must exclude session files');
});

test('the acceptance evidence is documented for the release review', () => {
  const matrix = fs.readFileSync(path.join(root, 'docs/ACCEPTANCE_MATRIX.md'), 'utf8');
  for (const item of ['الاستماع', 'الاستعادة', 'التدقيق', 'إنترنت', 'المزامنة', 'مثبّت', 'إصدار']) {
    assert.ok(matrix.includes(item), 'the acceptance matrix must cover: ' + item);
  }
  assert.ok(fs.existsSync(path.join(root, 'docs/RELEASE_DECISION.md')), 'the release decision must be recorded');
});
