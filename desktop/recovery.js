'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractEncryptedBundle } = require('../lib/full-backup');
const { verifyRestoredData, readStorageKey } = require('../lib/restored-data');

function readOptions(base) {
  const file = path.join(base, 'desktop-options.json');
  if (!fs.existsSync(file)) return {};
  const options = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      (options.activeProfile && !/^recovered-[a-f0-9-]{36}$/.test(options.activeProfile)) ||
      (options.backupDirectory && (typeof options.backupDirectory !== 'string' || !path.isAbsolute(options.backupDirectory)))) {
    throw new Error('إعدادات مسار البيانات غير صالحة.');
  }
  return options;
}
function saveOptions(base, options) {
  const target = path.join(base, 'desktop-options.json');
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(options, null, 2), { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, target); } finally { fs.rmSync(temporary, { force: true }); }
}
function recoveryKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024 || /[\r\n\0]/.test(secret)) throw new Error('مفتاح الاستعادة غير صالح.');
  return { format: 'complaints-recovery-key-v1', backupSecret: secret };
}
function readRecoveryKey(file) {
  if (fs.statSync(file).size > 4096) throw new Error('ملف مفتاح الاستعادة غير صالح.');
  const key = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (key?.format !== 'complaints-recovery-key-v1') throw new Error('اختر ملف مفتاح الاستعادة الذي حفظه التطبيق.');
  return recoveryKey(key.backupSecret).backupSecret;
}
function writeRecoveryKey(file, secret) {
  const key = recoveryKey(secret);
  if (path.extname(file).toLowerCase() !== '.json') throw new Error('اختر اسمًا ينتهي بـ .json لمفتاح الاستعادة.');
  if (fs.existsSync(file)) {
    let sameKey = false;
    try { sameKey = readRecoveryKey(file) === secret; } catch (_) {}
    if (!sameKey) throw new Error('الملف موجود ويحتوي بيانات أو مفتاحًا مختلفًا؛ اختر اسمًا جديدًا.');
  }
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(key, null, 2), { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
}
function assertWritableDirectory(directory) {
  if (!path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw new Error('اختر مجلدًا موجودًا.');
  const probe = path.join(directory, '.complaints-write-' + crypto.randomUUID());
  fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
  fs.unlinkSync(probe);
}

async function prepareRestoredProfile({ base, bundlePath, secret }) {
  recoveryKey(secret);
  const profile = 'recovered-' + crypto.randomUUID();
  const profileRoot = path.join(base, profile);
  const data = path.join(profileRoot, 'data');
  fs.mkdirSync(profileRoot, { mode: 0o700 });
  try {
    const result = await extractEncryptedBundle({ bundlePath, secret, outputDir: data });
    const keyFile = path.join(data, 'storage-key');
    const storageKey = readStorageKey(data);
    const content = verifyRestoredData({ directory: data, storageKey });
    const sqlite = path.join(data, 'database.sqlite');
    fs.renameSync(sqlite, path.join(data, 'complaints.sqlite'));
    const fresh = () => crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(path.join(profileRoot, '.env'), [
      'SESSION_SECRET=' + fresh(), 'DATA_KEY="' + storageKey + '"',
      'BACKUP_SECRET="' + secret + '"', 'ADMIN_USERNAME=admin', 'ADMIN_PASSWORD=' + fresh(), ''
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(keyFile);
    return { profile, counts: result.counts, attachmentCount: result.attachmentCount, ...content };
  } catch (error) {
    fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}
module.exports = { readOptions, saveOptions, recoveryKey, readRecoveryKey, writeRecoveryKey, assertWritableDirectory, prepareRestoredProfile };
