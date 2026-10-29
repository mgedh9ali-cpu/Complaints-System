"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validComplaint } = require("../lib/validation");

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
  assert.equal(validComplaint({ ...base, priority: "low" }), false);
  assert.equal(validComplaint({ ...base, priority: "normal" }), true);
  assert.equal(validComplaint({ ...base, status: "done" }), false);
  assert.equal(validComplaint({ ...base, status: "new" }), true);
});
