'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { backupDatabase } = require('../../scripts/backup-database');
const { encryptBuffer, lockDownFile } = require('../../lib/data-protection');
const { createEncryptedBundle, verifyEncryptedBundle } = require('../../lib/full-backup');

function safeBackupName(name) {
  if (typeof name !== 'string' || !name || name.length > 200) return null;
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (!/^[A-Za-z0-9._-]+\.(csb|sqlite|enc|sqlite\.enc)$/i.test(name) && !name.endsWith('.sqlite.enc')) return null;
  return name;
}

function createBackupService({ databasePath, sessionSecret }) {
  function defaultDir() {
    return path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(databasePath)), 'backups'));
  }

  async function createVerifiedBackup({ encrypt = true } = {}) {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-database-backup-'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const plainName = 'complaints-database-backup-' + stamp + '.sqlite';
    const plainPath = path.join(backupDir, plainName);
    try {
      const result = await backupDatabase(databasePath, plainPath);
      if (!result.verified) throw new Error('Backup verification did not complete.');
      lockDownFile(plainPath);
      if (encrypt && sessionSecret) {
        const plain = fs.readFileSync(plainPath);
        const sealed = encryptBuffer(plain, sessionSecret);
        const encName = plainName + '.enc';
        const encPath = path.join(backupDir, encName);
        fs.writeFileSync(encPath, sealed, { mode: 0o600 });
        lockDownFile(encPath);
        try { fs.unlinkSync(plainPath); } catch { /* ignore */ }
        return {
          backupDir, destination: encPath, filename: encName,
          encrypted: true, counts: result.counts, verified: true
        };
      }
      return {
        backupDir, destination: plainPath, filename: plainName,
        encrypted: false, counts: result.counts, verified: true
      };
    } catch (error) {
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch { /* ignore */ }
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
    try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  async function persistCompleteBackup(prefix = 'before-import') {
    const directory = defaultDir();
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

  function deleteBackup(filename, directory) {
    const name = safeBackupName(filename);
    if (!name) throw new Error('اسم ملف النسخة غير صالح.');
    const dir = path.resolve(directory || defaultDir());
    const full = path.join(dir, name);
    if (path.dirname(full) !== dir) throw new Error('مسار النسخة غير مسموح.');
    if (!fs.existsSync(full)) throw new Error('النسخة غير موجودة.');
    const stat = fs.statSync(full);
    if (!stat.isFile()) throw new Error('النسخة غير موجودة.');
    fs.unlinkSync(full);
    return { deleted: name };
  }

  async function verifyStoredBackup(filename, directory) {
    const name = safeBackupName(filename);
    if (!name) throw new Error('اسم ملف النسخة غير صالح.');
    if (!/\.csb$/i.test(name)) throw new Error('اختبار الاستعادة متاح للنسخ الكاملة (.csb) فقط.');
    if (!sessionSecret) throw new Error('مفتاح النسخ غير متوفر على الخادم.');
    const dir = path.resolve(directory || defaultDir());
    const full = path.join(dir, name);
    if (path.dirname(full) !== dir || !fs.existsSync(full)) throw new Error('النسخة غير موجودة.');
    const result = await verifyEncryptedBundle({ bundlePath: full, secret: sessionSecret });
    return {
      ok: Boolean(result.verified),
      filename: name,
      counts: result.counts || null,
      attachmentCount: result.attachmentCount ?? null,
      files: result.files ?? null
    };
  }

  return {
    createVerifiedBackup,
    createCompleteBackup,
    persistCompleteBackup,
    cleanupBackupDir,
    deleteBackup,
    verifyStoredBackup,
    listBackups(directory, limit) {
      return listStoredBackups(directory || defaultDir(), limit);
    },
    defaultBackupDirectory() {
      return defaultDir();
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
