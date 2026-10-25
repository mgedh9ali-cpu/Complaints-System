'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function assertNetworkOverrideRejected(overrides, expectedMessage) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      SESSION_SECRET: 'network-boundary-test-secret-value-123456',
      ADMIN_USERNAME: 'localadmin',
      ADMIN_PASSWORD: 'network-boundary-test-password-123',
      DATABASE_PATH: path.join(os.tmpdir(), 'should-not-be-created-' + process.pid + '.sqlite'),
      PORT: '3000',
      HOST: '127.0.0.1',
      ALLOW_LAN: 'false',
      ...overrides
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Server did not reject unsafe network configuration promptly.'));
    }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.notEqual(exitCode, 0);
  assert.ok(output.includes(expectedMessage), output);
}

test('server refuses a non-loopback HOST override', { timeout: 8000 }, async () => {
  await assertNetworkOverrideRejected(
    { HOST: '0.0.0.0' },
    'This offline build is loopback-only'
  );
});

test('server refuses ALLOW_LAN=true', { timeout: 8000 }, async () => {
  await assertNetworkOverrideRejected(
    { ALLOW_LAN: 'true' },
    'This offline build is loopback-only'
  );
});
