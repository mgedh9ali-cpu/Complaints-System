'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashAuditEvent } = require('../../lib/audit-integrity');

function createAuditService({ db, logger, databasePath }) {
  const dbPath = databasePath || process.env.DATABASE_PATH || './data/complaints.sqlite';
  const headPath = path.join(path.dirname(path.resolve(dbPath)), 'audit-head.hash');

  function persistHeadHash(eventHash) {
    try {
      fs.writeFileSync(headPath, eventHash + '\n');
    } catch (err) {
      if (logger) logger.error('Failed to persist audit head hash', { error: err.message });
    }
  }

  function record(actorUserId, action, targetType, targetId = null, details = {}) {
    const event = {
      id: crypto.randomUUID(),
      actor_user_id: actorUserId || null,
      action,
      target_type: targetType,
      target_id: targetId,
      details_json: JSON.stringify(details),
      created_at: new Date().toISOString()
    };
    const previousHash =
      db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get()
        ?.event_hash ?? null;
    const eventHash = hashAuditEvent(event, previousHash);
    db.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, target_type, target_id, details_json, created_at, previous_hash, event_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.actor_user_id,
      event.action,
      event.target_type,
      event.target_id,
      event.details_json,
      event.created_at,
      previousHash,
      eventHash
    );
    // An outer SQLite transaction may still roll back. Publish the sidecar
    // hash only after that transaction commits, never during an open transaction.
    if (!db.inTransaction) persistHeadHash(eventHash);
    return { id: event.id, eventHash, previousHash };
  }

  function syncHead() {
    if (db.inTransaction) throw new Error('Audit head cannot be synchronized before commit.');
    const row = db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get();
    if (row?.event_hash) persistHeadHash(row.event_hash);
  }

  function listEvents({ limit = 500 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    const rows = db
      .prepare(
        `SELECT id, actor_user_id, action, target_type, target_id, details_json, created_at, previous_hash, event_hash
         FROM audit_events ORDER BY rowid DESC LIMIT ?`
      )
      .all(safeLimit);
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: JSON.parse(row.details_json),
      createdAt: row.created_at,
      previousHash: row.previous_hash,
      eventHash: row.event_hash
    }));
  }

  function verifyChain() {
    const rows = db
      .prepare(
        `SELECT rowid AS _rowid, id, actor_user_id, action, target_type, target_id,
                details_json, created_at, previous_hash, event_hash
         FROM audit_events ORDER BY rowid ASC`
      )
      .all();
    let previousHash = null;
    let checked = 0;
    for (const row of rows) {
      const expected = hashAuditEvent(row, previousHash);
      if (row.event_hash !== expected) {
        return {
          ok: false,
          checked,
          brokenAt: row.id,
          expected,
          actual: row.event_hash
        };
      }
      if (row.previous_hash !== previousHash) {
        return {
          ok: false,
          checked,
          brokenAt: row.id,
          reason: 'previous_hash mismatch'
        };
      }
      previousHash = row.event_hash;
      checked += 1;
    }
    let headFile = null;
    try {
      headFile = fs.readFileSync(headPath, 'utf8').trim();
    } catch (_) {}
    if (previousHash && headFile && headFile !== previousHash) {
      return {
        ok: false,
        checked,
        reason: 'audit-head.hash does not match chain tip',
        chainTip: previousHash,
        headFile
      };
    }
    return { ok: true, checked, chainTip: previousHash };
  }

  return { record, syncHead, listEvents, verifyChain };
}

module.exports = { createAuditService };
