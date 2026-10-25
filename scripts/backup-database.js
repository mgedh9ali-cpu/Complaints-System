'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TABLES = ['users', 'complaints', 'app_state', 'audit_events'];

function assertIntegrity(db, label) {
  const result = db.pragma('integrity_check');
  if (result.length !== 1 || result[0].integrity_check !== 'ok') {
    throw new Error(label + ' failed SQLite integrity_check.');
  }
  const foreignKeys = db.pragma('foreign_key_check');
  if (foreignKeys.length) {
    throw new Error(label + ' contains foreign-key violations.');
  }
}

function counts(db) {
  return Object.fromEntries(TABLES.map(table => [
    table,
    db.prepare('SELECT COUNT(*) AS count FROM "' + table + '"').get().count
  ]));
}

async function backupDatabase(sourcePath, destinationPath) {
  const Database = require('better-sqlite3');
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination) throw new Error('Backup destination must differ from the source database.');
  if (!fs.existsSync(source)) throw new Error('Source database does not exist.');
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists; refusing to overwrite it.');

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  let backupDb;
  try {
    assertIntegrity(sourceDb, 'Source database');
    const expectedCounts = counts(sourceDb);
    await sourceDb.backup(destination);
    backupDb = new Database(destination, { readonly: true, fileMustExist: true });
    assertIntegrity(backupDb, 'Backup database');
    const actualCounts = counts(backupDb);
    if (JSON.stringify(actualCounts) !== JSON.stringify(expectedCounts)) {
      throw new Error('Backup verification failed: table row counts do not match the source.');
    }
    return { source, destination, counts: actualCounts, verified: true };
  } catch (error) {
    if (backupDb && backupDb.open) backupDb.close();
    if (sourceDb.open) sourceDb.close();
    // The destination was created by this invocation and failed verification.
    fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    if (backupDb && backupDb.open) backupDb.close();
    if (sourceDb.open) sourceDb.close();
  }
}

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination) {
    console.error('Usage: node scripts/backup-database.js <new-backup.sqlite>');
    process.exitCode = 2;
  } else {
    const source = process.env.DATABASE_PATH || './data/complaints.sqlite';
    backupDatabase(source, destination)
      .then(result => {
        console.log('Verified SQLite backup created: ' + result.destination);
        console.log(JSON.stringify(result.counts));
      })
      .catch(error => {
        console.error('Database backup failed: ' + error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = { backupDatabase };
