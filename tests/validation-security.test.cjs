"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validComplaint, validComplaintDraft } = require("../lib/validation");

test("validComplaint accepts a minimal well-formed complaint", () => {
  assert.equal(
    validComplaint({
      summary: "ملخص صالح",
      province: "دمشق",
      category: "استفسار",
    }),
    true,
  );
});

test("validComplaint rejects non-objects and missing required fields", () => {
  assert.equal(validComplaint(null), false);
  assert.equal(validComplaint([]), false);
  assert.equal(validComplaint({ summary: "x", province: "y" }), false);
  assert.equal(
    validComplaint({ summary: "  ", province: "دمشق", category: "عام" }),
    false,
  );
});

test("validComplaint rejects prototype pollution payloads", () => {
  const polluted = JSON.parse(
    '{"summary":"s","province":"p","category":"c","__proto__":{"polluted":true}}',
  );
  assert.equal(validComplaint(polluted), false);

  const withDangerousKey = Object.create(null);
  Object.assign(withDangerousKey, {
    summary: "s",
    province: "p",
    category: "c",
  });
  assert.equal(validComplaint(withDangerousKey), false);

  const ctorKey = {
    summary: "s",
    province: "p",
    category: "c",
    constructor: {},
  };
  assert.equal(validComplaint(ctorKey), false);
});

test("validComplaint rejects invalid priority and status", () => {
  const base = { summary: "s", province: "p", category: "c" };
  assert.equal(validComplaint({ ...base, priority: "low" }), true);
  assert.equal(validComplaint({ ...base, priority: "normal" }), true);
  assert.equal(validComplaint({ ...base, status: "done" }), false);
  assert.equal(validComplaint({ ...base, status: "new" }), true);
});


test('draft validation accepts incomplete but well-typed information', () => {
  assert.equal(validComplaintDraft({ details: 'وصف أولي للشكوى', asDraft: true }), true);
  assert.equal(validComplaintDraft({ category: 'خدمات', summary: '' }), true);
  assert.equal(validComplaintDraft({ summary: 42, details: 'نص' }), false);
  assert.equal(validComplaintDraft({ summary: '', details: '', category: '' }), false);
});

test('complaint validation rejects malformed ownership and oversized classifications', () => {
  const base = { summary: 'طلب', province: 'دمشق', category: 'خدمات' };
  assert.equal(validComplaint({ ...base, owner: { role: 'admin' } }), false);
  assert.equal(validComplaint({ ...base, province: 'x'.repeat(121) }), false);
  assert.equal(validComplaint({ ...base, category: 'x'.repeat(121) }), false);
  assert.equal(validComplaint({ ...base, priority: 'low' }), true);
});
