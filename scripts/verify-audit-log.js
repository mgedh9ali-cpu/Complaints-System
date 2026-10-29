"use strict";

const path = require("node:path");
const Database = require("better-sqlite3");
const { verifyAuditRows } = require("../lib/audit-integrity");

function verifyAuditDatabase(databasePath) {
  const absolutePath = path.resolve(databasePath);
  const db = new Database(absolutePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(audit_events)")
        .all()
        .map((row) => row.name),
    );
    if (!columns.has("previous_hash") || !columns.has("event_hash")) {
      return {
        valid: false,
        reason: "audit_chain_not_initialized",
        eventsChecked: 0,
      };
    }
    const rows = db
      .prepare(
        `SELECT id, actor_user_id, action, target_type, target_id, details_json,
      created_at, previous_hash, event_hash FROM audit_events ORDER BY rowid ASC`,
      )
      .all();
    return verifyAuditRows(rows);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const databasePath =
    process.argv[2] || process.env.DATABASE_PATH || "./data/complaints.sqlite";
  try {
    const result = verifyAuditDatabase(databasePath);
    if (!result.valid) {
      console.error(
        "Audit integrity check failed: " +
          result.reason +
          (result.eventId ? " at event " + result.eventId : "") +
          ".",
      );
      process.exitCode = 1;
    } else {
      console.log(
        "Audit hash chain verified: " + result.eventsChecked + " events.",
      );
      console.log("Chain head: " + (result.headHash || "(empty)"));
    }
  } catch (error) {
    console.error("Audit integrity check failed: " + error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyAuditDatabase };
