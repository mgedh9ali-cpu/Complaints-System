'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createStorageCodec } = require('./storage-codec');
const { hashAuditEvent, verifyAuditRows } = require('./audit-integrity');
const { encryptBuffer } = require('./data-protection');

function protectDatabase(db, databasePath, secret) {
  db.exec('CREATE TABLE IF NOT EXISTS storage_metadata(id INTEGER PRIMARY KEY CHECK(id=1), key_check TEXT NOT NULL, previous_audit_head TEXT, migration_head TEXT, cleanup_pending INTEGER NOT NULL DEFAULT 0)');
  const columns = new Set(db.prepare('PRAGMA table_info(storage_metadata)').all().map(c=>c.name));
  if (!columns.has('migration_head')) db.exec('ALTER TABLE storage_metadata ADD COLUMN migration_head TEXT');
  if (!columns.has('cleanup_pending')) db.exec('ALTER TABLE storage_metadata ADD COLUMN cleanup_pending INTEGER NOT NULL DEFAULT 0');
  const metadata = db.prepare('SELECT * FROM storage_metadata WHERE id=1').get();
  if (metadata && !secret) throw new Error('The database is encrypted; DATA_KEY is required.');
  const codec = createStorageCodec(secret);
  if (!codec.enabled) { db.storageCodec = codec; return; }
  if (metadata) {
    if (codec.decodeJson(metadata.key_check, 'key-check') !== 'complaints-storage-v1') throw new Error('Incorrect storage key.');
    if (metadata.cleanup_pending === 1) finishMigration(metadata);
    db.storageCodec = codec;
    return;
  }
  const rows = db.prepare('SELECT rowid AS _rowid, * FROM audit_events ORDER BY rowid').all();
  const chain = verifyAuditRows(rows);
  if (!chain.valid) throw new Error('Refusing encryption migration of a damaged audit log.');
  const root = path.dirname(path.resolve(databasePath));
  const headPath = path.join(root, 'audit-head.hash');
  if (chain.headHash && fs.existsSync(headPath) && fs.readFileSync(headPath, 'utf8').trim() !== chain.headHash) {
    throw new Error('Audit head mismatch before encryption migration.');
  }
  if (rows.length || db.prepare('SELECT COUNT(*) AS n FROM complaints').get().n) {
    const dir = path.join(root, 'backups');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'before-encryption-' + Date.now() + '.sqlite.enc');
    fs.writeFileSync(file, encryptBuffer(db.serialize(), secret), { flag: 'wx', mode: 0o600 });
  }
  let newHead = null;
  db.transaction(() => {
    for (const row of db.prepare('SELECT id, state_json FROM app_state').all()) {
      db.prepare('UPDATE app_state SET state_json=? WHERE id=?').run(codec.encodeJson(JSON.parse(row.state_json), 'app-state'), row.id);
    }
    for (const row of db.prepare('SELECT id, payload_json FROM complaints').all()) {
      db.prepare('UPDATE complaints SET payload_json=? WHERE id=?').run(codec.encodeJson(JSON.parse(row.payload_json), 'complaint:' + row.id), row.id);
    }
    for (const row of rows) {
      row.details_json = codec.encodeJson(JSON.parse(row.details_json), 'audit:' + row.id);
      const hash = hashAuditEvent(row, newHead);
      db.prepare('UPDATE audit_events SET details_json=?, previous_hash=?, event_hash=? WHERE id=?')
        .run(row.details_json, newHead, hash, row.id);
      newHead = hash;
    }
    db.prepare('INSERT INTO storage_metadata(id,key_check,previous_audit_head,migration_head,cleanup_pending) VALUES(1,?,?,?,1)')
      .run(codec.encodeJson('complaints-storage-v1', 'key-check'), chain.headHash, newHead);
  })();
  finishMigration({ migration_head: newHead, previous_audit_head: chain.headHash });
  db.storageCodec = codec;

  function finishMigration(record) {
    const root = path.dirname(path.resolve(databasePath));
    const head = path.join(root, 'audit-head.hash');
    const auditRows = db.prepare('SELECT * FROM audit_events ORDER BY rowid').all();
    const check = verifyAuditRows(auditRows);
    if (!check.valid || check.headHash !== record.migration_head) throw new Error('Interrupted storage migration has an invalid audit chain.');
    const existingHead = fs.existsSync(head) ? fs.readFileSync(head,'utf8').trim() : null;
    if (existingHead && ![record.migration_head,record.previous_audit_head].includes(existingHead)) throw new Error('Interrupted storage migration head mismatch.');
    if (record.migration_head) {
      fs.writeFileSync(head + '.tmp', record.migration_head + '\n', { mode: 0o600 });
      fs.renameSync(head + '.tmp', head);
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.prepare('UPDATE storage_metadata SET cleanup_pending=0 WHERE id=1').run();
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
}
module.exports = { protectDatabase };
