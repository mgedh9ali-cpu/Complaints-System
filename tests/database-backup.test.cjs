"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const hasBetterSqlite = (() => {
  try {
    require.resolve("better-sqlite3");
    return true;
  } catch {
    return false;
  }
})();
const { backupDatabase } = require("../scripts/backup-database");

test(
  "SQLite backup is integrity-checked and preserves critical table counts",
  {
    skip: hasBetterSqlite
      ? false
      : "better-sqlite3 is not installed in this workflow.",
  },
  async (t) => {
    const Database = require("better-sqlite3");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "complaints-backup-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "source.sqlite");
    const destination = path.join(root, "backups", "verified.sqlite");
    const db = new Database(source);
    db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE complaints (id TEXT PRIMARY KEY);
    CREATE TABLE app_state (id INTEGER PRIMARY KEY, state_json TEXT);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('user-1');
    INSERT INTO complaints VALUES ('complaint-1');
    INSERT INTO app_state VALUES (1, '{}');
    INSERT INTO audit_events VALUES ('event-1');
  `);
    db.close();

    const result = await backupDatabase(source, destination);
    assert.equal(result.verified, true);
    assert.deepEqual(result.counts, {
      users: 1,
      complaints: 1,
      app_state: 1,
      audit_events: 1,
    });
    const copy = new Database(destination, {
      readonly: true,
      fileMustExist: true,
    });
    assert.equal(copy.pragma("integrity_check")[0].integrity_check, "ok");
    copy.close();
  },
);

test(
  "SQLite backup refuses to overwrite an existing destination",
  {
    skip: hasBetterSqlite
      ? false
      : "better-sqlite3 is not installed in this workflow.",
  },
  async (t) => {
    const Database = require("better-sqlite3");
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "complaints-backup-existing-"),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "source.sqlite");
    const destination = path.join(root, "backup.sqlite");
    const db = new Database(source);
    db.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE complaints (id TEXT PRIMARY KEY); CREATE TABLE app_state (id INTEGER PRIMARY KEY, state_json TEXT); CREATE TABLE audit_events (id TEXT PRIMARY KEY);",
    );
    db.close();
    fs.writeFileSync(destination, "preserve-me");

    await assert.rejects(backupDatabase(source, destination), /already exists/);
    assert.equal(fs.readFileSync(destination, "utf8"), "preserve-me");
  },
);
