'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null) throw new Error('Test server exited before becoming healthy.');
    try {
      const response = await fetch(baseUrl + '/api/health');
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Test server did not become healthy in time.');
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'login should set a session cookie');
  return value.split(';', 1)[0];
}

test('local account management enforces administrator-only access and safe deactivation', async t => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-users-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      SESSION_SECRET: 'test-session-secret-at-least-32-characters',
      ADMIN_USERNAME: 'localadmin',
      ADMIN_PASSWORD: 'Test-admin-password-2026',
      DATABASE_PATH: path.join(temp, 'complaints.sqlite'),
      INSTANCE_ID_PATH: path.join(temp, 'instance-id'),
      DATA_DIR: path.join(temp, 'data'),
      UPDATE_PUBLIC_KEY_PATH: path.join(temp, 'trusted-update-public.pem'),
      PORT: String(port),
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        delay(2000)
      ]);
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const baseUrl = 'http://127.0.0.1:' + port;
  await waitForHealth(baseUrl, child);

  const adminLogin = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'localadmin', password: 'Test-admin-password-2026' })
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = cookieFrom(adminLogin);
  const adminFetch = (url, options = {}) => fetch(baseUrl + url, {
    ...options,
    headers: { cookie: adminCookie, ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
  });

  const initial = await adminFetch('/api/users');
  assert.equal(initial.status, 200);
  const initialBody = await initial.json();
  assert.equal(initialBody.users.length, 1);
  assert.equal(initialBody.users[0].username, 'localadmin');
  assert.equal('password_hash' in initialBody.users[0], false);

  const createdResponse = await adminFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'reviewer1', password: 'Review-password-2026', role: 'reviewer' })
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).user;
  assert.equal(created.role, 'reviewer');
  assert.equal(created.active, 1);

  const duplicate = await adminFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'reviewer1', password: 'Another-password-2026', role: 'staff' })
  });
  assert.equal(duplicate.status, 409);

  const weakPassword = await adminFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'weakuser', password: 'short', role: 'staff' })
  });
  assert.equal(weakPassword.status, 400);

  const selfDeactivate = await adminFetch('/api/users/' + initialBody.users[0].id + '/active', {
    method: 'PATCH',
    body: JSON.stringify({ active: false })
  });
  assert.equal(selfDeactivate.status, 409);

  const reviewerLogin = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'reviewer1', password: 'Review-password-2026' })
  });
  assert.equal(reviewerLogin.status, 200);
  const reviewerCookie = cookieFrom(reviewerLogin);
  const reviewerUsers = await fetch(baseUrl + '/api/users', { headers: { cookie: reviewerCookie } });
  assert.equal(reviewerUsers.status, 403);
  const reviewerStatusChange = await fetch(baseUrl + '/api/complaints/CMP-NONEXISTENT/status', {
    method: 'PATCH',
    headers: { cookie: reviewerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'closed' })
  });
  assert.equal(reviewerStatusChange.status, 403);

  const deactivate = await adminFetch('/api/users/' + created.id + '/active', {
    method: 'PATCH',
    body: JSON.stringify({ active: false })
  });
  assert.equal(deactivate.status, 200);
  assert.equal((await deactivate.json()).user.active, 0);

  const audit = await adminFetch('/api/audit');
  assert.equal(audit.status, 200);
  const events = (await audit.json()).events;
  assert.ok(events.some(event => event.action === 'user_created' && event.targetId === created.id));
  assert.ok(events.some(event => event.action === 'user_deactivated' && event.targetId === created.id));
});
