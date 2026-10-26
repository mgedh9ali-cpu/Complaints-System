'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const test = require('node:test');
const { signedBytes } = require('../lib/offline-sync');
const { backupDatabase } = require('../scripts/backup-database');
const hasServerDependencies = ['express', 'helmet', 'express-session', 'bcryptjs', 'better-sqlite3', 'express-rate-limit']
  .every(name => { try { require.resolve(name); return true; } catch { return false; } });

const repoRoot = path.join(__dirname, '..');
const username = 'offline-admin';
const password = 'test-password-2026';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startInstance(root, sessionSecret = crypto.randomBytes(48).toString('hex')) {
  const port = await freePort();
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(root, 'complaints.sqlite'),
      DATA_DIR: dataDir,
      INSTANCE_ID_PATH: path.join(dataDir, 'instance-id'),
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      SESSION_SECRET: sessionSecret,
      UPDATE_PUBLIC_KEY_PATH: path.join(dataDir, 'trusted-update-public.pem')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Server exited early: ${output}`);
      try {
        const response = await fetch(baseUrl + '/api/health');
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Server did not become ready: ${output}`);
    const login = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(login.status, 200, 'test administrator should be able to log in');
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie, 'login must return a session cookie');
    return {
      baseUrl, cookie, child, output: () => output,
      close: () => new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000).unref();
      })
    };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

async function request(instance, route, options = {}) {
  const response = await fetch(instance.baseUrl + route, {
    ...options,
    headers: {
      cookie: instance.cookie,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body };
}

test('SQLite-backed login session survives a local server restart', {
  timeout: 30000,
  skip: hasServerDependencies ? false : 'Server dependencies are not installed in this workflow.'
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-restart-'));
  const sessionSecret = crypto.randomBytes(48).toString('hex');
  let first;
  let second;

  t.after(async () => {
    if (first) await first.close();
    if (second) await second.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  first = await startInstance(root, sessionSecret);
  const previousCookie = first.cookie;
  const beforeRestart = await fetch(first.baseUrl + '/api/auth/me', {
    headers: { cookie: previousCookie }
  });
  assert.equal(beforeRestart.status, 200, 'session should work before restart');

  await first.close();
  first = null;

  second = await startInstance(root, sessionSecret);
  const afterRestart = await fetch(second.baseUrl + '/api/auth/me', {
    headers: { cookie: previousCookie }
  });
  assert.equal(afterRestart.status, 200, 'the same unexpired session should work after restart');
  const body = await afterRestart.json();
  assert.equal(body.user.username, username);
});

test('admin backup verification endpoint validates uploaded SQLite without replacing live data', {
  timeout: 30000,
  skip: hasServerDependencies ? false : 'Server dependencies are not installed in this workflow.'
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-verify-api-'));
  const sessionSecret = crypto.randomBytes(48).toString('hex');
  let instance;

  t.after(async () => {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  instance = await startInstance(root, sessionSecret);
  const backupPath = path.join(root, 'verified-fixture.sqlite');
  const created = await backupDatabase(path.join(root, 'complaints.sqlite'), backupPath);
  assert.equal(created.verified, true);

  const backupBytes = fs.readFileSync(backupPath);
  const unauthorized = await fetch(instance.baseUrl + '/api/backup/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.sqlite3' },
    body: backupBytes
  });
  assert.equal(unauthorized.status, 401, 'backup verification must require login');

  const verified = await fetch(instance.baseUrl + '/api/backup/verify', {
    method: 'POST',
    headers: { cookie: instance.cookie, 'content-type': 'application/vnd.sqlite3' },
    body: backupBytes
  });
  assert.equal(verified.status, 200);
  const verification = await verified.json();
  assert.equal(verification.verified, true);
  assert.ok(verification.counts.users >= 1);

  const invalid = await fetch(instance.baseUrl + '/api/backup/verify', {
    method: 'POST',
    headers: { cookie: instance.cookie, 'content-type': 'application/vnd.sqlite3' },
    body: Buffer.from('not a SQLite database')
  });
  assert.equal(invalid.status, 400, 'invalid files must be rejected');

  const stillSignedIn = await fetch(instance.baseUrl + '/api/auth/me', {
    headers: { cookie: instance.cookie }
  });
  assert.equal(stillSignedIn.status, 200, 'verification must not replace or corrupt the live database');
});

test('two isolated local instances exchange data and stage only a trusted signed program update', {
  timeout: 30000,
  skip: hasServerDependencies ? false : 'Server dependencies are not installed in this workflow.'
}, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-sync-e2e-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const destinationRoot = path.join(tempRoot, 'destination');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(destinationRoot);
  let source;
  let destination;

  t.after(async () => {
    if (source) await source.close();
    if (destination) await destination.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const keyPair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPath = path.join(destinationRoot, 'data', 'trusted-update-public.pem');
  fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });
  fs.writeFileSync(publicKeyPath, keyPair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });

  source = await startInstance(sourceRoot);
  destination = await startInstance(destinationRoot);

  const state = {
    complaints: [{ id: 'CMP-OFFLINE-001', summary: 'اختبار نقل محلي', province: 'دمشق', category: 'اختبار' }],
    notifications: [{ id: 1, title: 'اختبار', body: 'إشعار تجريبي', read: false }],
    templates: [{ name: 'قالب اختبار', version: 1, text: 'نص تجريبي' }],
    settings: { slaDays: 7, slaApproved: false, provinces: [], entities: [], categories: [] }
  };
  const initialState = await request(source, '/api/state');
  assert.equal(initialState.status, 200);
  assert.equal(initialState.body.revision, 0, 'a new database starts at revision zero');

  const missingRevision = await request(source, '/api/state', {
    method: 'PUT',
    body: JSON.stringify(state)
  });
  assert.equal(missingRevision.status, 428, 'writes without a revision precondition must be rejected');

  const saved = await request(source, '/api/state', {
    method: 'PUT',
    headers: { 'X-State-Revision': String(initialState.body.revision) },
    body: JSON.stringify(state)
  });
  assert.equal(saved.status, 200, 'source instance should save the test state');
  assert.equal(saved.body.revision, 1, 'successful saves advance the revision');

  const staleWrite = await request(source, '/api/state', {
    method: 'PUT',
    headers: { 'X-State-Revision': String(initialState.body.revision) },
    body: JSON.stringify({ ...state, notifications: [{ id: 2, title: 'stale write', body: 'must not replace state' }] })
  });
  assert.equal(staleWrite.status, 409, 'a stale state revision must not overwrite newer data');
  assert.equal(staleWrite.body.currentRevision, saved.body.revision);

  const exportedResponse = await fetch(source.baseUrl + '/api/sync/export', {
    headers: { cookie: source.cookie }
  });
  assert.equal(exportedResponse.status, 200);
  const bundle = await exportedResponse.json();
  assert.equal(bundle.sourceInstanceId.length > 0, true);

  bundle.programUpdate.signature = {
    algorithm: 'Ed25519',
    value: crypto.sign(null, signedBytes(bundle.programUpdate.files), keyPair.privateKey).toString('base64')
  };

  const imported = await request(destination, '/api/sync/import', {
    method: 'POST',
    body: JSON.stringify(bundle)
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.imported, true);
  assert.equal(imported.body.updateStaged, true);

  const restored = await request(destination, '/api/state');
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.state, state, 'destination must restore the exact exported application state');

  const pendingDir = path.resolve(repoRoot, imported.body.updatePath);
  assert.equal(fs.existsSync(path.join(pendingDir, 'manifest.json')), true, 'signed update should be staged for review');
  const manifest = JSON.parse(fs.readFileSync(path.join(pendingDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.signatureVerified, true);
  assert.equal(manifest.status, 'staged-not-applied', 'updates must never execute automatically');

  const replay = await request(destination, '/api/sync/import', {
    method: 'POST',
    body: JSON.stringify(bundle)
  });
  assert.equal(replay.status, 409, 're-importing the same sync package must be rejected');
});
