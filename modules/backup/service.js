'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { backupDatabase } = require('../../scripts/backup-database');
const { encryptBuffer, lockDownFile } = require('../../lib/data-protection');

function createBackupService({ databasePath, sessionSecret }) {
  async function createVerifiedBackup({ encrypt = true } = {}) {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-database-backup-'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const plainName = 'complaints-database-backup-' + stamp + '.sqlite';
    const plainPath = path.join(backupDir, plainName);
    try {
      const result = await backupDatabase(databasePath, plainPath);
      if (!result.verified) {
        throw new Error('Backup verification did not complete.');
      }
      lockDownFile(plainPath);

      if (encrypt && sessionSecret) {
        const plain = fs.readFileSync(plainPath);
        const sealed = encryptBuffer(plain, sessionSecret);
        const encName = plainName + '.enc';
        const encPath = path.join(backupDir, encName);
        fs.writeFileSync(encPath, sealed, { mode: 0o600 });
        lockDownFile(encPath);
        try {
          fs.unlinkSync(plainPath);
        } catch {
          /* ignore */
        }
        return {
          backupDir,
          destination: encPath,
          filename: encName,
          encrypted: true,
          counts: result.counts,
          verified: true
        };
      }

      return {
        backupDir,
        destination: plainPath,
        filename: plainName,
        encrypted: false,
        counts: result.counts,
        verified: true
      };
    } catch (error) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  function cleanupBackupDir(backupDir) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return { createVerifiedBackup, cleanupBackupDir };
}

module.exports = { createBackupService };
