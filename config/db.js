'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { hashAuditEvent } = require('../lib/audit-integrity');
const { lockDownDir, lockDownFile, lockDownDataTree } = require('../lib/data-protection');

function openDatabase(databasePath, { storageKey } = {}) {
  const abs = path.resolve(databasePath);
  const dataRoot = path.dirname(abs);
  lockDownDir(dataRoot);
  const db = new Database(abs);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Overwrite deleted content on disk (best-effort local privacy)
  try {
    db.pragma('secure_delete = ON');
  } catch {
    /* older SQLite builds may ignore */
  }
  try {
    db.pragma('temp_store = MEMORY');
  } catch {
    /* ignore */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff','reviewer')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      state_json TEXT NOT NULL CHECK(json_valid(state_json)),
      updated_by TEXT NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL CHECK(json_valid(details_json)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_complaints_updated ON complaints(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
  `);

  const appStateColumns = new Set(
    db.prepare('PRAGMA table_info(app_state)').all().map((row) => row.name)
  );
  if (!appStateColumns.has('revision')) {
    db.exec(
      'ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)'
    );
  }

  const auditColumns = new Set(
    db.prepare('PRAGMA table_info(audit_events)').all().map((row) => row.name)
  );
  const needsChain =
    !auditColumns.has('previous_hash') || !auditColumns.has('event_hash');
  if (!auditColumns.has('previous_hash')) {
    db.exec('ALTER TABLE audit_events ADD COLUMN previous_hash TEXT');
  }
  if (!auditColumns.has('event_hash')) {
    db.exec('ALTER TABLE audit_events ADD COLUMN event_hash TEXT');
  }
  if (needsChain) {
    const migrate = db.transaction(() => {
      let previousHash = null;
      const rows = db
        .prepare(
          `SELECT rowid AS _rowid, id, actor_user_id, action, target_type, target_id,
                  details_json, created_at FROM audit_events ORDER BY rowid ASC`
        )
        .all();
      const update = db.prepare(
        'UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE rowid = ?'
      );
      for (const row of rows) {
        const eventHash = hashAuditEvent(row, previousHash);
        update.run(previousHash, eventHash, row._rowid);
        previousHash = eventHash;
      }
    });
    migrate();
  }

  try {
    require('../lib/storage-migration').protectDatabase(db, abs, storageKey);
  } catch (error) { db.close(); throw error; }
  lockDownFile(abs);
  lockDownDataTree(dataRoot);
  return db;
}

module.exports = { openDatabase };
