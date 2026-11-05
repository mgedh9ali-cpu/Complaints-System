'use strict';

/**
 * Sequential application schema migrations for SQLite.
 * Uses a dedicated schema_migrations table (not SQLite's schema_version pragma).
 */

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT,
      applied_at TEXT NOT NULL,
      application_version TEXT
    );
  `);
}

function appliedIds(db) {
  ensureMigrationsTable(db);
  return new Set(
    db.prepare('SELECT migration_id FROM schema_migrations ORDER BY migration_id').all()
      .map((r) => r.migration_id)
  );
}

/** Built-in migrations that are safe on the JSON-payload architecture. */
const BUILTIN = [
  {
    id: '001_schema_migrations_bootstrap',
    up(db) {
      ensureMigrationsTable(db);
    }
  },
  {
    id: '002_complaint_search_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at DESC);
      `);
    }
  },
  {
    id: '003_data_root_marker_note',
    up(db) {
      // Marks that data-root protocol is supported at app layer.
    }
  }
];

function runMigrations(db, { appVersion = null, extra = [] } = {}) {
  ensureMigrationsTable(db);
  const done = appliedIds(db);
  const list = [...BUILTIN, ...extra].sort((a, b) => a.id.localeCompare(b.id));
  const applied = [];
  const insert = db.prepare(
    'INSERT INTO schema_migrations (migration_id, checksum, applied_at, application_version) VALUES (?, ?, ?, ?)'
  );
  const run = db.transaction(() => {
    for (const m of list) {
      if (done.has(m.id)) continue;
      if (typeof m.up !== 'function') throw new Error('Migration missing up(): ' + m.id);
      m.up(db);
      insert.run(m.id, m.checksum || null, new Date().toISOString(), appVersion);
      applied.push(m.id);
      done.add(m.id);
    }
  });
  run();
  return { applied, current: [...done].sort() };
}

function currentSchemaVersion(db) {
  const ids = [...appliedIds(db)].sort();
  return ids[ids.length - 1] || null;
}

module.exports = { runMigrations, currentSchemaVersion, ensureMigrationsTable, BUILTIN };
