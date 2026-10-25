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
