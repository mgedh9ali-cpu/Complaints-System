"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REQUIRED_COLUMNS = {
  users: ["id", "username", "password_hash", "role", "active", "created_at"],
  complaints: ["id", "payload_json", "created_by", "created_at", "updated_at"],
  app_state: ["id", "state_json", "updated_by", "updated_at"],
  audit_events: [
    "id",
    "actor_user_id",
    "action",
    "target_type",
    "target_id",
    "details_json",
    "created_at",
  ],
};

function validateDatabase(db, label) {
  const integrity = db.pragma("integrity_check");
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error(label + " failed SQLite integrity_check.");
  }
  const foreignKeys = db.pragma("foreign_key_check");
  if (foreignKeys.length)
    throw new Error(label + " contains foreign-key violations.");

  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  );
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tables.has(table))
      throw new Error(label + " is missing required table: " + table);
    const actual = new Set(
      db
        .prepare('PRAGMA table_info("' + table + '")')
        .all()
        .map((row) => row.name),
    );
    for (const column of columns) {
      if (!actual.has(column))
        throw new Error(
          label + " is missing required column: " + table + "." + column,
        );
    }
  }
}

function rowCounts(db) {
  return Object.fromEntries(
    Object.keys(REQUIRED_COLUMNS).map((table) => [
      table,
      db.prepare('SELECT COUNT(*) AS count FROM "' + table + '"').get().count,
    ]),
  );
}

async function verifyRestore(backupPath) {
  const Database = require("better-sqlite3");
  const backup = path.resolve(backupPath);
  if (!fs.existsSync(backup)) throw new Error("Backup file does not exist.");
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "complaints-restore-drill-"),
  );
  const restoredPath = path.join(tempDir, "restored.sqlite");
  let backupDb;
  let restoredDb;
  try {
    backupDb = new Database(backup, { readonly: true, fileMustExist: true });
    validateDatabase(backupDb, "Backup");
    const expected = rowCounts(backupDb);
    await backupDb.backup(restoredPath);
    restoredDb = new Database(restoredPath, {
      readonly: true,
      fileMustExist: true,
    });
    validateDatabase(restoredDb, "Restored copy");
    const actual = rowCounts(restoredDb);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        "Restore verification failed: core table row counts differ from the backup.",
      );
    }
    return {
      verified: true,
      backup,
      restoredCopyChecked: true,
      counts: actual,
    };
  } finally {
    if (restoredDb && restoredDb.open) restoredDb.close();
    if (backupDb && backupDb.open) backupDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const backup = process.argv[2];
  if (!backup) {
    console.error(
      "Usage: node scripts/verify-database-restore.js <backup.sqlite>",
    );
    process.exitCode = 2;
  } else {
    verifyRestore(backup)
      .then((result) => {
        console.log(
          "Restore drill passed. A temporary copy was verified and removed.",
        );
        console.log(JSON.stringify(result.counts));
      })
      .catch((error) => {
        console.error("Restore drill failed: " + error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = { verifyRestore };
