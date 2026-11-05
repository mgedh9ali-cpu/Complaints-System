'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { backupDatabase } = require('../../scripts/backup-database');
const { encryptBuffer, lockDownFile } = require('../../lib/data-protection');
const { createEncryptedBundle, verifyEncryptedBundle } = require('../../lib/full-backup');

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

  async function createCompleteBackup() {
    if (!sessionSecret) throw new Error('Full backups require a protected backup secret.');
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-full-backup-'));
    try {
      const result = await createEncryptedBundle({
        databasePath, secret: sessionSecret, backupDir
      });
      const verified = await verifyEncryptedBundle({
        bundlePath: result.destination, secret: sessionSecret
      });
      if (!verified.verified || verified.attachmentCount !== result.attachmentCount) {
        throw new Error('Complete backup verification failed.');
      }
      return { ...result, verified: true };
    } catch (error) {
      fs.rmSync(backupDir, { recursive: true, force: true });
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

  async function persistCompleteBackup(prefix = 'before-import') {
    const directory = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(databasePath)), 'backups'));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    let backup;
    try {
      backup = await createCompleteBackup();
      const filename = prefix.replace(/[^a-z-]/g, '') + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csb';
      const destination = path.join(directory, filename);
      fs.copyFileSync(backup.destination, destination, fs.constants.COPYFILE_EXCL);
      lockDownFile(destination);
      return { filename, verified: true };
    } finally { if (backup) cleanupBackupDir(backup.backupDir); }
  }

  return {
    createVerifiedBackup,
    createCompleteBackup,
    persistCompleteBackup,
    cleanupBackupDir,
    listBackups(directory, limit) {
      return listStoredBackups(directory || path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(databasePath)), 'backups')), limit);
    },
    defaultBackupDirectory() {
      return path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(databasePath)), 'backups'));
    }
  };
}

function listStoredBackups(directory, limit = 50) {
  if (!directory || !fs.existsSync(directory)) return [];
  const entries = [];
  let names;
  try { names = fs.readdirSync(directory); } catch { return []; }
  for (const name of names) {
    if (name === 'backup-status.json') continue;
    if (!/\.(csb|sqlite|enc)$/i.test(name) && !name.endsWith('.sqlite.enc')) continue;
    const full = path.join(directory, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) continue;
    const kind = name.startsWith('automatic-') ? 'automatic'
      : name.startsWith('before-') ? 'pre-change'
      : /\.csb$/i.test(name) ? 'manual-complete'
      : 'database';
    entries.push({
      name,
      size: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
      kind,
      verified: kind === 'automatic' || /\.csb$/i.test(name)
    });
  }
  entries.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return entries.slice(0, Math.max(1, Math.min(100, limit | 0)));
}

module.exports = { createBackupService, listStoredBackups };
