"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { hashAuditEvent, verifyAuditRows } = require("../lib/audit-integrity");

function makeRows(events) {
  let previousHash = null;
  return events.map((event) => {
    const row = { ...event, previous_hash: previousHash };
    row.event_hash = hashAuditEvent(row, previousHash);
    previousHash = row.event_hash;
    return row;
  });
}

test("audit hash chain verifies a valid ordered sequence", () => {
  const rows = makeRows([
    {
      id: "1",
      actor_user_id: "u1",
      action: "login",
      target_type: "user",
      target_id: "u1",
      details_json: "{}",
      created_at: "2026-10-25T10:00:00.000Z",
    },
    {
      id: "2",
      actor_user_id: "u1",
      action: "complaint_created",
      target_type: "complaint",
      target_id: "c1",
      details_json: '{"status":"new"}',
      created_at: "2026-10-25T10:01:00.000Z",
    },
  ]);
  assert.deepEqual(verifyAuditRows(rows), {
    valid: true,
    eventsChecked: 2,
    headHash: rows[1].event_hash,
  });
});

test("audit hash chain detects event content tampering", () => {
  const rows = makeRows([
    {
      id: "1",
      actor_user_id: "u1",
      action: "login",
      target_type: "user",
      target_id: "u1",
      details_json: "{}",
      created_at: "2026-10-25T10:00:00.000Z",
    },
    {
      id: "2",
      actor_user_id: "u1",
      action: "complaint_created",
      target_type: "complaint",
      target_id: "c1",
      details_json: '{"status":"new"}',
      created_at: "2026-10-25T10:01:00.000Z",
    },
  ]);
  rows[0].details_json = '{"status":"changed"}';
  assert.equal(verifyAuditRows(rows).valid, false);
});

test("audit hash chain detects removed or reordered events", () => {
  const rows = makeRows([
    {
      id: "1",
      actor_user_id: "u1",
      action: "login",
      target_type: "user",
      target_id: "u1",
      details_json: "{}",
      created_at: "2026-10-25T10:00:00.000Z",
    },
    {
      id: "2",
      actor_user_id: "u1",
      action: "complaint_created",
      target_type: "complaint",
      target_id: "c1",
      details_json: '{"status":"new"}',
      created_at: "2026-10-25T10:01:00.000Z",
    },
  ]);
  assert.equal(verifyAuditRows([rows[1]]).valid, false);
  assert.equal(verifyAuditRows([...rows].reverse()).valid, false);
});

test("empty audit chain is valid", () => {
  assert.deepEqual(verifyAuditRows([]), {
    valid: true,
    eventsChecked: 0,
    headHash: null,
  });
});
