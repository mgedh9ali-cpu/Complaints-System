'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { requireLocalHost } = require('../lib/local-origin');
const { requiredEnv } = require('../config/env');
const { isLocalAppUrl, isPermittedExternalUrl } = require('../desktop/navigation');

const root = path.resolve(__dirname, '..');
const hasDeps = ['express', 'better-sqlite3', 'helmet'].every(name => {
  try { require.resolve(name); return true; } catch { return false; }
});

test('Host guard rejects attacker domains even when DNS resolves to loopback', () => {
  const middleware = requireLocalHost(3000);
  for (const host of ['evil.example:3000', '127.0.0.1:3000.evil.example',
    '127.0.0.1:4000', 'localhost', undefined]) {
    let accepted = false;
    let status;
    const response = {
      status(value) { status = value; return this; },
      type() { return this; },
      send() { return this; }
    };
    middleware({ headers: { host } }, response, () => { accepted = true; });
    assert.equal(accepted, false, String(host));
    assert.equal(status, 421);
  }
  for (const host of ['127.0.0.1:3000', 'localhost:3000']) {
    let allowed = false;
    middleware({ headers: { host } }, {}, () => { allowed = true; });
    assert.equal(allowed, true);
  }
});

test('unsafe external protocols and lookalike app origins are rejected', () => {
  const origin = 'http://127.0.0.1:3000';
  assert.equal(isLocalAppUrl(origin + '/index.html', origin), true);
  assert.equal(isLocalAppUrl(origin + '.evil.test/', origin), false);
  assert.equal(isPermittedExternalUrl('javascript:alert(1)', origin), false);
  assert.equal(isPermittedExternalUrl('file:///C:/Windows/system.ini', origin), false);
  assert.equal(isPermittedExternalUrl('https://example.org/', origin), true);
  assert.equal(isPermittedExternalUrl('https://user:pass@example.org/', origin), false);
});

test('example and placeholder secrets cannot be used for startup', () => {
  const prev = process.env.COMPLAINTS_TEST_SECRET;
  try {
    for (const val of ['replace-with-at-least-32-random-characters', 'change-me-to-real-secret']) {
      process.env.COMPLAINTS_TEST_SECRET = val;
      assert.throws(() => requiredEnv('COMPLAINTS_TEST_SECRET', 12));
    }
    process.env.COMPLAINTS_TEST_SECRET = 'a-real-secret-for-test';
    assert.equal(requiredEnv('COMPLAINTS_TEST_SECRET', 12), 'a-real-secret-for-test');
  } finally {
    if (prev === undefined) delete process.env.COMPLAINTS_TEST_SECRET;
    else process.env.COMPLAINTS_TEST_SECRET = prev;
  }
});

test('protected route modules refuse to run without a role service', () => {
  const services = [
    ['complaints', 'createComplaintsRouter'],
    ['attachments', 'createAttachmentsRouter'],
    ['reports', 'createReportsRouter'],
    ['backup', 'createBackupRouter'],
    ['sync', 'createSyncRouter'],
    ['dashboard', 'createDashboardRouter'],
    ['settings', 'createSettingsRouter'],
    ['audit', 'createAuditRouter']
  ];
  for (const [mod, creator] of services) {
    const fn = require('../modules/' + mod + '/routes')[creator];
    assert.throws(() => fn({ middleware: { requireAuth() {} } }), /Role enforcement service/);
  }
});

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Server exited unexpectedly');
    try { const res = await fetch(url); if (res.status === 200) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server startup timed out');
}

test('live server never serves database or source code without authentication', {
  skip: !hasDeps,
  timeout: 30000
}, async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-http-security-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const port = await freePort();
  const url = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      SESSION_SECRET: 'secure-test-session-secret-value-1234567890',
      ADMIN_USERNAME: 'testadmin',
      ADMIN_PASSWORD: 'a-secure-example-test-password',
      DATABASE_PATH: path.join(tempDir, 'complaints.sqlite'),
      INSTANCE_ID_PATH: path.join(tempDir, 'instance-id'),
      SESSIONS_DIR: path.join(tempDir, 'sessions'),
      HOST: '127.0.0.1', PORT: String(port), ALLOW_LAN: 'false'
    },
    stdio: 'ignore'
  });
  t.after(() => { child.kill('SIGTERM'); });
  await waitFor(url + '/api/health', child);

  for (const target of ['/data/complaints.sqlite', '/data/complaints.sqlite-wal',
    '/server.js', '/package.json', '/lib/validation.js', '/config/env.js',
    '/modules/auth/service.js', '/.git/config', '/.git/HEAD',
    '/app.full.js', '/fonts-src/README.md']) {
    const response = await fetch(url + target);
    assert.equal(response.status, 404, target + ' must not be publicly exposed');
  }
  assert.equal((await fetch(url + '/api/state')).status, 401);
  assert.equal((await fetch(url + '/styles.css')).status, 200);
  assert.equal((await fetch(url + '/')).status, 200);
  const rebound = await fetch(url + '/api/health', { headers: { Host: 'evil.example:3000' } });
  assert.equal(rebound.status, 421);
  const malformed = await fetch(url + '/', { headers: { Host: 'localhost.evil:3000' } });
  assert.equal(malformed.status, 421);
});
