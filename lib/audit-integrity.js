'use strict';

const crypto = require('node:crypto');

function eventPayload(row) {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id ?? null,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id ?? null,
    details_json: row.details_json,
    created_at: row.created_at
  };
}

function hashAuditEvent(row, previousHash = null) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ previousHash, event: eventPayload(row) }), 'utf8')
    .digest('hex');
}

function verifyAuditRows(rows) {
  let previousHash = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if ((row.previous_hash ?? null) !== previousHash) {
      return { valid: false, index, eventId: row.id, reason: 'previous_hash_mismatch' };
    }
    const expected = hashAuditEvent(row, previousHash);
    if (typeof row.event_hash !== 'string' || row.event_hash !== expected) {
      return { valid: false, index, eventId: row.id, reason: 'event_hash_mismatch' };
    }
    previousHash = row.event_hash;
  }
  return { valid: true, eventsChecked: rows.length, headHash: previousHash };
}

module.exports = { hashAuditEvent, verifyAuditRows };
