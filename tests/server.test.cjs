'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validComplaint } = require('../lib/validation');

test('complaint validation accepts a minimal valid complaint', () => {
  assert.equal(validComplaint({ summary: 'طلب متابعة', province: 'دمشق', category: 'خدمات عامة' }), true);
});

test('complaint validation rejects missing required fields', () => {
  assert.equal(validComplaint({ summary: 'طلب متابعة', province: 'دمشق' }), false);
  assert.equal(validComplaint(null), false);
  assert.equal(validComplaint([]), false);
});

test('complaint validation rejects excessive or malformed user input', () => {
  assert.equal(validComplaint({ summary: 'x'.repeat(181), province: 'دمشق', category: 'عام' }), false);
  assert.equal(validComplaint({ summary: 'x', province: 'دمشق', category: 'عام', details: 17 }), false);
  assert.equal(validComplaint({ summary: 'x', province: 'دمشق', category: 'عام', phone: 'x'.repeat(41) }), false);
});

test('local UI uses authenticated API and server-backed state rather than localStorage for records', () => {
  const fs = require('node:fs');
  const ui = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(ui.includes("api('/api/auth/login'"), 'login form must call the server');
  assert.ok(ui.includes("api('/api/state'"), 'dashboard persistence must use the server state API');
  assert.ok(server.includes("app.put('/api/state', requireAuth, requireRole('admin','staff')"), 'saving state must require an authenticated write role');
  assert.ok(server.includes('CREATE TABLE IF NOT EXISTS app_state'), 'persistent application state must be stored in SQLite');
});
