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
