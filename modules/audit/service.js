'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashAuditEvent } = require('../../lib/audit-integrity');
const { storageFor } = require('../../lib/storage-codec');
const { verifyAuditRows } = require('../../lib/audit-integrity');

function createAuditService({ db, logger, databasePath }) {
  const dbPath = databasePath || process.env.DATABASE_PATH || './data/complaints.sqlite';
  const headPath = path.join(path.dirname(path.resolve(dbPath)), 'audit-head.hash');
  const storage = storageFor(db);
  db.exec(`CREATE TABLE IF NOT EXISTS audit_head_pending (
    id INTEGER PRIMARY KEY CHECK(id=1), previous_hash TEXT, next_hash TEXT NOT NULL
  )`);

  function persistHeadHash(eventHash) {
    const temporary = headPath + '.' + crypto.randomUUID() + '.tmp';
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, eventHash + '\n'); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, headPath);
    } catch (err) {
      if (logger) logger.error('Failed to persist audit head hash', { error: err.message });
      fs.rmSync(temporary, { force: true });
      throw err;
    }
  }

  function record(actorUserId, action, targetType, targetId = null, details = {}) {
    const nested = db.inTransaction;
    let result;
    const write = () => {
    const event = {
      id: crypto.randomUUID(),
      actor_user_id: actorUserId || null,
      action,
      target_type: targetType,
      target_id: targetId,
      details_json: null,
      created_at: new Date().toISOString()
    };
    event.details_json = storage.encodeJson(details, 'audit:' + event.id);
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
    db.prepare(`INSERT INTO audit_head_pending(id,previous_hash,next_hash) VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET next_hash=excluded.next_hash`).run(previousHash,eventHash);
    result = { id: event.id, eventHash, previousHash };
    };
    if (nested) write(); else { db.transaction(write)(); syncHead(); }
    return result;
  }

  function syncHead() {
    if (db.inTransaction) throw new Error('Audit head cannot be synchronized before commit.');
    const row = db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get();
    const pending = db.prepare('SELECT * FROM audit_head_pending WHERE id=1').get();
    if (pending && pending.next_hash !== row?.event_hash) throw new Error('Pending audit head does not match the committed chain.');
    let existing = null;
    try { existing = fs.readFileSync(headPath,'utf8').trim(); } catch (_) {}
    if (pending && existing && ![pending.previous_hash,pending.next_hash].includes(existing)) throw new Error('Audit head changed outside the committed transaction.');
    if (!pending && existing && existing !== row?.event_hash) throw new Error('Audit head does not match the committed chain.');
    if (row?.event_hash) {
      persistHeadHash(row.event_hash);
      db.prepare('DELETE FROM audit_head_pending WHERE id=1').run();
    }
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
      details: storage.decodeJson(row.details_json, 'audit:' + row.id),
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
    if (previousHash && headFile !== previousHash) {
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

  const pending = db.prepare('SELECT * FROM audit_head_pending WHERE id=1').get();
  if (pending) {
    const rows = db.prepare('SELECT * FROM audit_events ORDER BY rowid').all();
    const verification = verifyAuditRows(rows);
    if (!verification.valid || verification.headHash !== pending.next_hash) throw new Error('Cannot recover an invalid pending audit chain.');
    syncHead();
    record(null,'audit_head_recovered','system',null,{previousHead:pending.previous_hash,committedHead:pending.next_hash});
    logger?.warn('Recovered committed audit head after interrupted publication');
  }
  return { record, syncHead, listEvents, verifyChain };
}

module.exports = { createAuditService };
