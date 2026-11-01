'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { revokeUserSessions } = require('../lib/session-revoke.js');
const { parseStoredAttachmentName } = require('../modules/attachments/routes.js');
const { findComplaintConflicts } = require('../modules/sync/service.js');

test('revokeUserSessions removes only matching user session files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-revoke-'));
  try {
    fs.writeFileSync(
      path.join(dir, 's1.json'),
      JSON.stringify({ user: { id: 'user-a' }, cookie: {} })
    );
    fs.writeFileSync(
      path.join(dir, 's2.json'),
      JSON.stringify({ user: { id: 'user-b' }, cookie: {} })
    );
    fs.writeFileSync(
      path.join(dir, 's3.json'),
      JSON.stringify({ user: { id: 'user-a' }, cookie: {} })
    );
    const result = revokeUserSessions(dir, 'user-a');
    assert.equal(result.revoked, 2);
    assert.equal(fs.existsSync(path.join(dir, 's2.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 's1.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 's3.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseStoredAttachmentName extracts complaint id from stored name', () => {
  const parsed = parseStoredAttachmentName(
    'SY-2026-abcd1234_550e8400-e29b-41d4-a716-446655440000.pdf'
  );
  assert.ok(parsed);
  assert.equal(parsed.complaintId, 'SY-2026-abcd1234');
  assert.equal(
    parsed.storedName,
    'SY-2026-abcd1234_550e8400-e29b-41d4-a716-446655440000.pdf'
  );
  assert.equal(parseStoredAttachmentName('../evil.pdf'), null);
  assert.equal(parseStoredAttachmentName('no-uuid-here.pdf'), null);
});

test('findComplaintConflicts detects status or updated differences', () => {
  const local = [
    { id: 'c1', status: 'new', updated: '2026-01-01T00:00:00.000Z' },
    { id: 'c2', status: 'in_progress', updated: '2026-01-02T00:00:00.000Z' }
  ];
  const incoming = [
    { id: 'c1', status: 'closed', updated: '2026-01-03T00:00:00.000Z' },
    { id: 'c2', status: 'in_progress', updated: '2026-01-02T00:00:00.000Z' },
    { id: 'c3', status: 'new', updated: '2026-01-04T00:00:00.000Z' }
  ];
  const conflicts = findComplaintConflicts(local, incoming);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, 'c1');
});


test('findComplaintConflicts blocks incoming snapshots that omit a local complaint', () => {
  const local = [{ id: 'keep-me', status: 'new', updated: '2026-11-01T00:00:00Z' }];
  const incoming = [{ id: 'other', status: 'new', updated: '2026-11-01T00:00:00Z' }];
  const conflicts = findComplaintConflicts(local, incoming);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, 'keep-me');
  assert.equal(conflicts[0].kind, 'missing_from_incoming');
});

test('findComplaintConflicts detects a changed payload despite unchanged status and timestamp', () => {
  const base = { id: 'same-id', status: 'new', updated: '2026-11-01T00:00:00Z', summary: 'Original' };
  const conflicts = findComplaintConflicts([base], [{ ...base, summary: 'Tampered' }]);
  assert.equal(conflicts.length, 1);
});
