'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('roles and dashboard modules exist with expected exports', () => {
  const rolesServiceSrc = fs.readFileSync(path.join(root, 'modules/roles/service.js'), 'utf8');
  const rolesRoutesSrc = fs.readFileSync(path.join(root, 'modules/roles/routes.js'), 'utf8');
  const dashServiceSrc = fs.readFileSync(path.join(root, 'modules/dashboard/service.js'), 'utf8');
  const dashRoutesSrc = fs.readFileSync(path.join(root, 'modules/dashboard/routes.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

  assert.ok(rolesServiceSrc.includes('createRolesService'));
  assert.ok(rolesServiceSrc.includes('PERMISSIONS'));
  assert.ok(rolesRoutesSrc.includes('createRolesRouter'));
  assert.ok(dashServiceSrc.includes('createDashboardService'));
  assert.ok(dashServiceSrc.includes('buildSummary'));
  assert.ok(dashRoutesSrc.includes('createDashboardRouter'));
  assert.ok(server.includes("require('./modules/roles/"));
  assert.ok(server.includes("require('./modules/dashboard/"));
  assert.ok(server.includes('createRolesRouter') || server.includes('rolesService'));
  assert.ok(server.includes('createDashboardRouter') || server.includes('dashboardService'));
});

test('roles service permission matrix works', () => {
  const { createRolesService } = require('../modules/roles/service.js');
  const svc = createRolesService();
  assert.equal(svc.can('admin', 'users.manage'), true);
  assert.equal(svc.can('staff', 'users.manage'), false);
  assert.equal(svc.can('reviewer', 'export.csv'), true);
  assert.equal(svc.can('staff', 'complaints.create'), true);
  const roles = svc.listRoles();
  assert.equal(roles.length, 3);
  assert.ok(roles.every((r) => Array.isArray(r.permissions)));
});
