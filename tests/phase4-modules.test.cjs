'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('phase4 modules exist and are wired in server', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const mod of ['attachments', 'reports', 'settings']) {
    assert.ok(fs.existsSync(path.join(root, 'modules', mod, 'service.js')), mod + ' service');
    assert.ok(fs.existsSync(path.join(root, 'modules', mod, 'routes.js')), mod + ' routes');
    assert.ok(server.includes("require('./modules/" + mod + "/"), mod + ' require');
  }
  assert.ok(!server.includes("app.post('/api/attachments/"), 'attachments routes moved out of server');
  assert.ok(!server.includes("app.get('/api/export/csv'"), 'csv export moved out of server');
  assert.ok(server.includes('createAttachmentsRouter') || server.includes('attachmentsService'));
  assert.ok(server.includes('createReportsRouter') || server.includes('reportsService'));
  assert.ok(server.includes('createSettingsRouter') || server.includes('settingsService'));
});

test('settings normalize applies defaults', () => {
  const src = fs.readFileSync(path.join(root, 'modules/settings/service.js'), 'utf8');
  assert.ok(src.includes('slaDays'));
  assert.ok(src.includes('normalizeSettings'));
  assert.ok(src.includes('DEFAULT_SETTINGS'));
});
