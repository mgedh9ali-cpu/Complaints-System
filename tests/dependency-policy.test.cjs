'use strict';
/* The dependency policy is the offline half of the security gate. It has to
 * catch two things without asking the registry: a lockfile entry that
 * declares one version and installs another, and a resolved version inside a
 * published advisory range. The first one is how the matching engines were
 * hidden before, so it must never pass silently. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { checkLockfile, readLockfile } = require('../scripts/check-dependency-policy');

const root = path.join(__dirname, '..');

test('the locked tree satisfies the dependency policy', () => {
  assert.deepEqual(checkLockfile(readLockfile(root)), []);
});

test('a lockfile entry that installs another version than it declares is rejected', () => {
  const lock = {
    packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/glob': {
        version: '14.0.0',
        resolved: 'https://registry.npmjs.org/glob/-/glob-7.2.3.tgz',
        integrity: 'sha512-fake',
      },
    },
  };
  const violations = checkLockfile(lock);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'mismatch');
  assert.match(violations[0].detail, /declares 14\.0\.0 but installs 7\.2\.3/);
});

test('a resolved version inside a published advisory range is rejected', () => {
  const lock = {
    packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/glob': {
        version: '10.4.2',
        resolved: 'https://registry.npmjs.org/glob/-/glob-10.4.2.tgz',
        integrity: 'sha512-fake',
      },
      'node_modules/uuid': {
        version: '11.0.0',
        resolved: 'https://registry.npmjs.org/uuid/-/uuid-11.0.0.tgz',
        integrity: 'sha512-fake',
      },
    },
  };
  const violations = checkLockfile(lock);
  assert.equal(violations.length, 2);
  assert.ok(violations.every(violation => violation.kind === 'advisory'));
});

test('the aliased patched engines are accepted', () => {
  const lock = {
    packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/glob-patched': {
        name: 'glob',
        version: '14.0.4',
        resolved: 'https://registry.npmjs.org/glob/-/glob-14.0.4.tgz',
        integrity: 'sha512-fake',
      },
      'node_modules/minimatch-patched': {
        name: 'minimatch',
        version: '11.0.5',
        resolved: 'https://registry.npmjs.org/minimatch/-/minimatch-11.0.5.tgz',
        integrity: 'sha512-fake',
      },
      'node_modules/glob': { link: true, resolved: 'vendor/glob-compat' },
    },
  };
  assert.deepEqual(checkLockfile(lock), []);
});

test('every source check runs the dependency policy', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'scripts', 'check-source.js'), 'utf8');
  assert.match(source, /check-dependency-policy/);
  assert.ok(pkg.scripts['check:security'], 'the offline policy must be runnable on its own');
  assert.match(pkg.scripts['check:registry'], /npm audit --audit-level=low/);
});
