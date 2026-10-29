'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { backupDatabase } = require('../../scripts/backup-database');

function createBackupService({ databasePath }) {
  async function createVerifiedBackup() {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-database-backup-'));
    const filename =
      'complaints-database-backup-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '.sqlite';
    const destination = path.join(backupDir, filename);
    try {
      const result = await backupDatabase(databasePath, destination);
      if (!result.verified) {
        throw new Error('Backup verification did not complete.');
      }
      return {
        backupDir,
        destination,
        filename,
        counts: result.counts,
        verified: true
      };
    } catch (error) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch (_) {}
      throw error;
    }
  }

  function cleanupBackupDir(backupDir) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (_) {}
  }

  return { createVerifiedBackup, cleanupBackupDir };
}

module.exports = { createBackupService };
