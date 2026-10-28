'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('modular auth and complaints files exist and export expected APIs', () => {
  const authService = fs.readFileSync(path.join(root, 'modules/auth/service.js'), 'utf8');
  const authRoutes = fs.readFileSync(path.join(root, 'modules/auth/routes.js'), 'utf8');
  const authMw = fs.readFileSync(path.join(root, 'modules/auth/middleware.js'), 'utf8');
  const complaintsRoutes = fs.readFileSync(path.join(root, 'modules/complaints/routes.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

  assert.ok(authService.includes('createAuthService'));
  assert.ok(authRoutes.includes('createAuthRouter'));
  assert.ok(authMw.includes('createAuthMiddleware'));
  assert.ok(complaintsRoutes.includes('createComplaintsRouter'));
  assert.ok(server.includes('createAuthRouter'));
  assert.ok(server.includes('createComplaintsRouter'));
  assert.ok(!server.includes("app.post('/api/auth/login'"), 'login should live in auth module');
  assert.ok(!server.includes("app.get('/api/users'"), 'users list should live in auth module');
  assert.ok(server.includes("app.use('/api'"), 'API routers should be mounted under /api');
});
