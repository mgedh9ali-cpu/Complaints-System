'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRolesService, PERMISSIONS } = require('../modules/roles/service.js');

test('PERMISSIONS matrix denies staff from admin-only actions', () => {
  const svc = createRolesService();
  assert.equal(svc.can('staff', 'users.manage'), false);
  assert.equal(svc.can('staff', 'backup.database'), false);
  assert.equal(svc.can('staff', 'settings.manage'), false);
  assert.equal(svc.can('staff', 'sync.import'), false);
  assert.equal(svc.can('staff', 'audit.verify'), false);
  assert.equal(svc.can('staff', 'attachments.delete'), false);
  assert.equal(svc.can('reviewer', 'attachments.delete'), false);
  assert.equal(svc.can('admin', 'attachments.delete'), true);
});

test('PERMISSIONS matrix allows expected staff and reviewer actions', () => {
  const svc = createRolesService();
  assert.equal(svc.can('staff', 'complaints.create'), true);
  assert.equal(svc.can('staff', 'attachments.upload'), true);
  assert.equal(svc.can('staff', 'sync.export'), true);
  assert.equal(svc.can('reviewer', 'complaints.read'), true);
  assert.equal(svc.can('reviewer', 'export.csv'), true);
  assert.equal(svc.can('reviewer', 'attachments.read'), true);
  assert.equal(svc.can('reviewer', 'audit.read'), true);
  assert.equal(svc.can('reviewer', 'complaints.create'), false);
  assert.equal(svc.can('reviewer', 'attachments.upload'), false);
});

test('requirePermission middleware returns 403 when role lacks action', () => {
  const svc = createRolesService();
  const mw = svc.requirePermission('backup.database');
  let status = null;
  let body = null;
  const req = { user: { id: 'u1', role: 'staff' } };
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(status, 403);
  assert.ok(body && body.error);
});

test('requirePermission middleware allows matching role', () => {
  const svc = createRolesService();
  const mw = svc.requirePermission('backup.database');
  let nextCalled = false;
  mw({ user: { id: 'a1', role: 'admin' } }, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('every permission action lists only known roles', () => {
  const known = new Set(['admin', 'staff', 'reviewer']);
  for (const [action, roles] of Object.entries(PERMISSIONS)) {
    assert.ok(Array.isArray(roles), action);
    for (const role of roles) {
      assert.ok(known.has(role), `${action} has unknown role ${role}`);
    }
  }
});


test('attachment removal requires manager permission before the route handler', () => {
  const svc = createRolesService();
  const guard = svc.requirePermission('attachments.delete');
  for (const role of ['staff', 'reviewer']) {
    let status = null;
    let nextCalled = false;
    guard({ user: { id: 'limited-user', role } }, {
      status(code) { status = code; return this; },
      json() { return this; }
    }, () => { nextCalled = true; });
    assert.equal(status, 403, role);
    assert.equal(nextCalled, false, role);
  }
  let adminAllowed = false;
  guard({ user: { id: 'admin-user', role: 'admin' } }, {}, () => {
    adminAllowed = true;
  });
  assert.equal(adminAllowed, true);
});

test('attachment removal endpoint retains CSRF and documented reason validation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'attachments', 'routes.js'), 'utf8');
  const block = src.slice(src.indexOf('router.delete('));
  assert.match(block, /requirePermission\('attachments.delete'\)/);
  assert.match(block, /requireCsrf/);
  assert.match(block, /reason.length < 3 \|\| reason.length > 500/);
  assert.match(block, /attachment_deleted/);
});
