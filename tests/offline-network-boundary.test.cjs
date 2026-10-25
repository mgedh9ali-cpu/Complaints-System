'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const hasServerDependencies = ['express', 'helmet', 'express-session', 'bcryptjs', 'better-sqlite3', 'express-rate-limit']
  .every(name => { try { require.resolve(name); return true; } catch { return false; } });

test('browser assets do not depend on remote URLs or externally hosted resources', () => {
  for (const name of ['index.html', 'app.js', 'styles.css']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, name + ' must not contain absolute HTTP(S) URLs');
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']\/\//i, name + ' must not reference protocol-relative resources');
    assert.doesNotMatch(source, /url\(\s*["']?\/\//i, name + ' must not load protocol-relative CSS resources');
  }
});

test('server rejects attempts to bind beyond loopback', {
  skip: hasServerDependencies ? false : 'Server dependencies are not installed in this workflow.'
}, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-loopback-'));
  try {
    const commonEnv = {
      ...process.env,
      SESSION_SECRET: 'test-only-session-secret-at-least-32-characters',
      ADMIN_USERNAME: 'test-admin',
      ADMIN_PASSWORD: 'test-only-password-long-enough',
      DATABASE_PATH: path.join(tempDir, 'should-not-be-created.sqlite'),
      PORT: '34567'
    };

    const hostOverride = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...commonEnv, HOST: '0.0.0.0', ALLOW_LAN: 'false' },
      encoding: 'utf8',
      timeout: 5000
    });
    assert.notEqual(hostOverride.status, 0, 'non-loopback HOST must fail closed');
    assert.match(hostOverride.stderr + hostOverride.stdout, /loopback-only/i);

    const lanOverride = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...commonEnv, HOST: '127.0.0.1', ALLOW_LAN: 'true' },
      encoding: 'utf8',
      timeout: 5000
    });
    assert.notEqual(lanOverride.status, 0, 'ALLOW_LAN=true must fail closed');
    assert.match(lanOverride.stderr + lanOverride.stdout, /loopback-only/i);

    assert.equal(
      fs.existsSync(commonEnv.DATABASE_PATH),
      false,
      'rejected network overrides must fail before creating the database'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


test('server configures a restrictive same-origin Content Security Policy', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /contentSecurityPolicy:\s*\{/);
  assert.match(source, /defaultSrc:\s*\[["']'self'["']\]/);
  assert.match(source, /scriptSrc:\s*\[["']'self'["']\]/);
  assert.match(source, /connectSrc:\s*\[["']'self'["']\]/);
  assert.match(source, /objectSrc:\s*\[["']'none'["']\]/);
  assert.match(source, /frameAncestors:\s*\[["']'none'["']\]/);
  assert.doesNotMatch(source, /contentSecurityPolicy:\s*false/);
});
