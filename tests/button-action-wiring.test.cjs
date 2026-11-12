'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assembleUiBundle } = require('../lib/ui-bundle');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('bulk actions keep the server-backed dialog and do not leave a dead confirm button', () => {
  const bundle = assembleUiBundle(root);
  const matches = bundle.match(/function bulkOpen\(/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one bulkOpen in assembled UI bundle');
  assert.equal(bundle.includes('data-action="bulk-confirm"'), false);
  assert.match(read('ui/features/complaint-actions.js'), /data-action="bulk-apply"/);
  assert.match(read('ui/pages/registry.js'), /'bulk-open'/);
  assert.match(read('ui/core/events.js'), /case 'bulk-open'/) ;
});

test('settings sync export downloads an encrypted package instead of a dead-end notice', () => {
  const events = read('ui/core/events.js');
  const settings = read('ui/features/settings-actions.js');
  assert.match(events, /exportEncryptedSync\(\)/);
  assert.equal(events.includes('استخدم تصدير المزامنة من لوحة الإعدادات'), false);
  assert.match(settings, /\/api\/sync\/export/);
  assert.match(settings, /syncPasswordResolve/);
  assert.match(read('ui/pages/settings.js'), /uiCan\('sync\.export'\)/);
  assert.match(read('ui/pages/settings.js'), /uiCan\('sync\.import'\)/);
});
