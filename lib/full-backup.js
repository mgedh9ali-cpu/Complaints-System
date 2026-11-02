'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable, pipeline } = require('node:stream');
const { promisify } = require('node:util');
const { backupDatabase } = require('../scripts/backup-database');
const { verifyRestore } = require('../scripts/verify-database-restore');
const { verifyAuditRows } = require('./audit-integrity');

const pipe = promisify(pipeline);
const MAGIC = Buffer.from('COMPLBUNDLE2');
const PREFIX_SIZE = MAGIC.length + 16 + 12;
const MAX_MANIFEST_SIZE = 4 * 1024 * 1024;
const MAX_ENTRIES = 30000;

function allowedEntry(name) {
  return name === 'database.sqlite' || name === 'audit-head.hash' || name === 'storage-key' ||
    (typeof name === 'string' && /^(attachments|retired-attachments)\/[A-Za-z0-9._-]{1,180}$/.test(name) &&
      !['.','..'].includes(name.split('/').pop()));
}

function inspectAuditSnapshot(sqlite) {
  const Database = require('better-sqlite3');
  const db = new Database(sqlite, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      'SELECT id, actor_user_id, action, target_type, target_id, details_json, created_at, previous_hash, event_hash FROM audit_events ORDER BY rowid ASC'
    ).all();
    const result = verifyAuditRows(rows);
    if (!result.valid) throw new Error('SQLite backup contains a broken audit chain.');
    return result.headHash;
  } finally {
    db.close();
  }
}

function digestFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function createEncryptedBundle({ databasePath, secret, backupDir }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Backup secret must have at least 32 characters.');
  const root = path.dirname(path.resolve(databasePath));
  const destDir = backupDir || fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-complete-'));
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  const sqlite = path.join(destDir, 'database.sqlite');
  const output = path.join(destDir, 'complaints-complete-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csb');
  for (const reserved of ['database.sqlite','audit-head.hash','storage-key',path.basename(output)]) {
    if (fs.existsSync(path.join(destDir,reserved))) throw new Error('Backup destination contains an existing reserved file.');
  }
  try {
    const result = await backupDatabase(databasePath, sqlite);
    const sources = [{ name: 'database.sqlite', file: sqlite }];
    const keyDb = new (require('better-sqlite3'))(sqlite, { readonly: true });
    try {
      const encrypted = keyDb.prepare("SELECT name FROM sqlite_master WHERE name='storage_metadata'").get() &&
        keyDb.prepare('SELECT id FROM storage_metadata WHERE id=1').get();
      if (encrypted) {
        const dataKey = process.env.DATA_KEY || process.env.SESSION_SECRET;
        if (!dataKey) throw new Error('The storage recovery key is required to back up this encrypted database.');
        const codec = require('./storage-codec').createStorageCodec(dataKey);
        codec.decodeJson(keyDb.prepare('SELECT key_check FROM storage_metadata WHERE id=1').get().key_check, 'key-check');
        const keyFile = path.join(destDir, 'storage-key');
        fs.writeFileSync(keyFile, dataKey, { flag: 'wx', mode: 0o600 });
        sources.push({ name: 'storage-key', file: keyFile });
      }
    } finally { keyDb.close(); }
    // Use the verified SQLite snapshot tip, not a possibly newer live head file.
    const snapshotHead = inspectAuditSnapshot(sqlite);
    if (snapshotHead) {
      const snapshotHeadFile = path.join(destDir, 'audit-head.hash');
      fs.writeFileSync(snapshotHeadFile, snapshotHead + '\n', { mode: 0o600, flag: 'wx' });
      sources.push({ name: 'audit-head.hash', file: snapshotHeadFile });
    }
    for (const folder of ['attachments', 'retired-attachments']) {
    const attachments = path.join(root, folder);
    if (fs.existsSync(attachments)) {
      for (const entry of fs.readdirSync(attachments, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = folder + '/' + entry.name;
        if (!allowedEntry(name) || !entry.isFile() || entry.isSymbolicLink()) {
          throw new Error('Unsafe or non-file attachment encountered: ' + entry.name);
        }
        sources.push({ name, file: path.join(attachments, entry.name) });
      }
    }
    }
    if (sources.length > MAX_ENTRIES) throw new Error('Too many files for one backup.');
    const files = [];
    for (const item of sources) {
      const stat = fs.lstatSync(item.file);
      if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new Error('Invalid backup source: ' + item.name);
      files.push({ name: item.name, size: stat.size, sha256: await digestFile(item.file) });
    }
    const metadata = Buffer.from(JSON.stringify({
      format: 'complaints-complete-backup', version: 2,
      createdAt: new Date().toISOString(), files
    }), 'utf8');
    if (metadata.length > MAX_MANIFEST_SIZE) throw new Error('Backup manifest exceeds safe size.');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(metadata.length);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(secret, salt, 32);
    fs.writeFileSync(output, Buffer.concat([MAGIC, salt, iv]), { mode: 0o600, flag: 'wx' });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    async function* plaintext() {
      yield len;
      yield metadata;
      for (const item of sources) {
        for await (const chunk of fs.createReadStream(item.file)) yield chunk;
      }
    }
    await pipe(Readable.from(plaintext()), cipher, fs.createWriteStream(output, { flags: 'a', mode: 0o600 }));
    fs.appendFileSync(output, cipher.getAuthTag());
    fs.unlinkSync(sqlite);
    if (snapshotHead) fs.unlinkSync(path.join(destDir, 'audit-head.hash'));
    fs.rmSync(path.join(destDir, 'storage-key'), { force: true });
    return {
      backupDir: destDir, destination: output, filename: path.basename(output),
      encrypted: true, complete: true, verified: result.verified,
      counts: result.counts, attachmentCount: sources.filter(x => x.name.startsWith('attachments/')).length,
      retiredAttachmentCount: sources.filter(x => x.name.startsWith('retired-attachments/')).length
    };
  } catch (error) {
    fs.rmSync(output, { force: true });
    fs.rmSync(sqlite, { force: true });
    fs.rmSync(path.join(destDir, 'audit-head.hash'), { force: true });
    fs.rmSync(path.join(destDir, 'storage-key'), { force: true });
    throw error;
  }
}

function parseManifest(buf) {
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch (_) { throw new Error('Invalid backup manifest.'); }
  if (!value || value.format !== 'complaints-complete-backup' || value.version !== 2 ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_ENTRIES) {
    throw new Error('Unsupported backup manifest.');
  }
  const names = new Set();
  for (const entry of value.files) {
    if (!entry || !allowedEntry(entry.name) || names.has(entry.name) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Invalid or duplicate archive member.');
    }
    names.add(entry.name);
  }
  if (value.files[0].name !== 'database.sqlite') throw new Error('Missing primary database backup.');
  return value;
}

async function extractEncryptedBundle({ bundlePath, secret, outputDir }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Backup secret is required.');
  const file = path.resolve(bundlePath);
  const stat = fs.statSync(file);
  if (stat.size < PREFIX_SIZE + 4 + 16) throw new Error('Backup is incomplete.');
  const descriptor = fs.openSync(file, 'r');
  const prefix = Buffer.alloc(PREFIX_SIZE);
  const tag = Buffer.alloc(16);
  try {
    fs.readSync(descriptor, prefix, 0, PREFIX_SIZE, 0);
    fs.readSync(descriptor, tag, 0, 16, stat.size - 16);
  } finally { fs.closeSync(descriptor); }
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unknown complete backup format.');
  if (fs.existsSync(outputDir)) {
    if (!fs.lstatSync(outputDir).isDirectory() || fs.readdirSync(outputDir).length) {
      throw new Error('Restore destination must be an empty real directory.');
    }
  } else fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const salt = prefix.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = prefix.subarray(MAGIC.length + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(secret, salt, 32), iv);
  decipher.setAuthTag(tag);
  const stream = fs.createReadStream(file, { start: PREFIX_SIZE, end: stat.size - 17 }).pipe(decipher);
  let stage = 'length', pending = Buffer.alloc(0), manifestLength = 0, metadata, fileIndex = 0;
  let handle, remaining = 0, hash;
  async function startEntry() {
    const entry = metadata.files[fileIndex];
    if (!entry) { stage = 'done'; return; }
    const target = path.join(outputDir, ...entry.name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    handle = await fs.promises.open(target, 'wx', 0o600);
    remaining = entry.size;
    hash = crypto.createHash('sha256');
    stage = 'file';
  }
  async function finishEntry() {
    await handle.close();
    handle = undefined;
    if (hash.digest('hex') !== metadata.files[fileIndex].sha256) throw new Error('Backup file checksum mismatch.');
    fileIndex += 1;
    await startEntry();
  }
  try {
    for await (const chunk of stream) {
      let input = chunk;
      while (input.length) {
        if (stage === 'done') throw new Error('Trailing data in backup.');
        if (stage === 'length' || stage === 'manifest') {
          const needed = (stage === 'length' ? 4 : manifestLength) - pending.length;
          const take = Math.min(needed, input.length);
          pending = Buffer.concat([pending, input.subarray(0, take)]);
          input = input.subarray(take);
          if (pending.length !== (stage === 'length' ? 4 : manifestLength)) continue;
          if (stage === 'length') {
            manifestLength = pending.readUInt32BE(0);
            if (!manifestLength || manifestLength > MAX_MANIFEST_SIZE) throw new Error('Backup manifest size is invalid.');
            stage = 'manifest';
          } else {
            metadata = parseManifest(pending);
            await startEntry();
            while (stage === 'file' && remaining === 0) await finishEntry();
          }
          pending = Buffer.alloc(0);
        } else if (stage === 'file') {
          const take = Math.min(remaining, input.length);
          const data = input.subarray(0, take);
          let offset = 0;
          while (offset < data.length) {
            const { bytesWritten } = await handle.write(data, offset, data.length - offset);
            if (bytesWritten <= 0) throw new Error('Incomplete restore file write.');
            offset += bytesWritten;
          }
          hash.update(data);
          remaining -= take;
          input = input.subarray(take);
          if (remaining === 0) {
            await finishEntry();
            while (stage === 'file' && remaining === 0) await finishEntry();
          }
        }
      }
    }
    if (stage !== 'done') throw new Error('Truncated backup archive.');
    const database = path.join(outputDir, 'database.sqlite');
    const verification = await verifyRestore(database);
    const snapshotHead = inspectAuditSnapshot(database);
    const restoredHead = path.join(outputDir, 'audit-head.hash');
    if (snapshotHead) {
      if (!fs.existsSync(restoredHead) ||
          fs.readFileSync(restoredHead, 'utf8').trim() !== snapshotHead) {
        throw new Error('The restored audit head does not match the SQLite chain.');
      }
    } else if (fs.existsSync(restoredHead)) {
      throw new Error('Unexpected audit head for an empty audit log.');
    }
    return {
      verified: verification.verified, counts: verification.counts,
      attachmentCount: metadata.files.filter(x => x.name.startsWith('attachments/')).length,
      files: metadata.files.length, outputDir
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    // A failed authentication or malformed archive must not leave partial files.
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
}

async function verifyEncryptedBundle({ bundlePath, secret }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-verify-complete-'));
  try { return await extractEncryptedBundle({ bundlePath, secret, outputDir: dir }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { createEncryptedBundle, extractEncryptedBundle, verifyEncryptedBundle };
