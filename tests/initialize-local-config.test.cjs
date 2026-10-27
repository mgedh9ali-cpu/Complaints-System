'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { initializeLocalConfig } = require('../scripts/initialize-local-config');

test('first-run configuration creates strong local secrets and displays the initial password once', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  const messages = [];

  const result = initializeLocalConfig(envPath, message => messages.push(message));
  const config = fs.readFileSync(envPath, 'utf8');

  assert.equal(result.created, true);
  assert.match(config, /^SESSION_SECRET=[A-Za-z0-9_-]{64}$/m);
  assert.match(config, /^ADMIN_USERNAME=admin$/m);
  assert.match(config, /^ADMIN_PASSWORD=[A-Za-z0-9_-]{24}$/m);
  assert.match(config, /^HOST=127\.0\.0\.1$/m);
  assert.match(config, /^PORT=3000$/m);
  assert.match(config, /^DATABASE_PATH=\.\/data\/complaints\.sqlite$/m);
  assert.equal(result.adminPassword.length, 24);
  assert.equal(messages.length, 1);
  assert.match(messages[0], new RegExp(result.adminPassword));
  assert.doesNotMatch(messages[0], /SESSION_SECRET=/);
});

test('first-run configuration never overwrites an existing .env file or reprints credentials', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-config-existing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  const original = 'SESSION_SECRET=existing-secret-value\nADMIN_USERNAME=existing-admin\n';
  fs.writeFileSync(envPath, original, 'utf8');
  const messages = [];

  const result = initializeLocalConfig(envPath, message => messages.push(message));

  assert.equal(result.created, false);
  assert.equal(fs.readFileSync(envPath, 'utf8'), original);
  assert.deepEqual(messages, []);
});
