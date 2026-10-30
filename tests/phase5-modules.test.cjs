'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('phase5 modules exist and are wired', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const mod of ['backup', 'audit', 'sync', 'health']) {
    assert.ok(fs.existsSync(path.join(root, 'modules', mod, 'service.js')), mod + ' service');
    assert.ok(fs.existsSync(path.join(root, 'modules', mod, 'routes.js')), mod + ' routes');
    assert.ok(server.includes("require('./modules/" + mod + "/"), mod + ' require');
  }
  assert.ok(!server.includes("app.get('/api/backup/database'"), 'backup route moved out');
  assert.ok(server.includes('createBackupRouter') || server.includes('backupService'));
  assert.ok(server.includes('createAuditRouter') || server.includes('auditService'));
  assert.ok(server.includes('createSyncRouter') || server.includes('syncService'));
  assert.ok(server.includes('createHealthRouter') || server.includes('healthService'));
  assert.ok(
    /APP_VERSION\s*=\s*'0\.7\.\d+'/.test(server) ||
      server.includes("version: APP_VERSION") ||
      server.includes('0.7.1') ||
      server.includes('0.7.0'),
    'server reports 0.7.x version'
  );
});
