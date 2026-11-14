'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { createStorageCodec } = require('./storage-codec');

function requireFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ملف غير صالح داخل النسخة المستعادة.');
  return stat;
}

function readStorageKey(directory) {
  const file = path.join(directory, 'storage-key');
  if (requireFile(file).size > 1024) throw new Error('مفتاح محتوى غير صالح.');
  const key = fs.readFileSync(file, 'utf8');
  if (key.length < 32 || key.length > 1024 || /[\r\n\0]/.test(key)) throw new Error('مفتاح محتوى غير صالح.');
  return key;
}

// Never open the application database here: openDatabase migrates and writes.
// The caller has already authenticated/extracted the archive and checked its
// SQLite integrity, file hashes and audit chain. This checks the inner layer.
function verifyRestoredData({ directory, storageKey = readStorageKey(directory) }) {
  const codec = createStorageCodec(storageKey);
  if (!codec.enabled) throw new Error('يلزم مفتاح محتوى للتحقق من النسخة.');
  const sqlite = path.join(directory, 'database.sqlite');
  requireFile(sqlite);
  // SQLite may create WAL/SHM sidecars even on a readonly connection. Keep
  // those in a disposable directory, outside the extracted source folder.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-verify-content-'));
  let db;
  const counts = { complaints: 0, appState: 0, auditEvents: 0, reminders: 0, attachments: 0, retiredAttachments: 0, attachmentMetadata: 0, approvalReasons: 0, twoFactorSecrets: 0 };
  try {
    const snapshot = path.join(scratch, 'content.sqlite');
    fs.copyFileSync(sqlite, snapshot, fs.constants.COPYFILE_EXCL);
    db = new Database(snapshot, { readonly: true, fileMustExist: true });
    const metadata = db.prepare('SELECT key_check FROM storage_metadata WHERE id=1').get();
    if (!metadata || codec.decodeJson(metadata.key_check, 'key-check') !== 'complaints-storage-v1') {
      throw new Error('فشل التحقق من مفتاح المحتوى.');
    }
    for (const row of db.prepare('SELECT id,payload_json FROM complaints').iterate()) {
      codec.decodeJson(row.payload_json, 'complaint:' + row.id);
      counts.complaints++;
    }
    for (const row of db.prepare('SELECT state_json FROM app_state').iterate()) {
      codec.decodeJson(row.state_json, 'app-state');
      counts.appState++;
    }
    for (const row of db.prepare('SELECT id,details_json FROM audit_events').iterate()) {
      codec.decodeJson(row.details_json, 'audit:' + row.id);
      counts.auditEvents++;
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='complaint_reminders'").get()) {
      const encryptedFlag = db.prepare('PRAGMA table_info(complaint_reminders)').all().some(column => column.name === 'note_encrypted');
      const rows = db.prepare('SELECT id,note,' + (encryptedFlag ? 'note_encrypted' : '0 AS note_encrypted') + ' FROM complaint_reminders');
      for (const row of rows.iterate()) {
        if (row.note_encrypted !== 1 || typeof codec.decodeJson(row.note, 'reminder:' + row.id) !== 'string') {
          throw new Error('ملاحظة تذكير غير مشفرة أو غير صالحة.');
        }
        counts.reminders++;
      }
    }
    const hasTable = name => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if (hasTable('attachment_records')) {
      for (const row of db.prepare('SELECT stored_name,metadata_json FROM attachment_records').iterate()) {
        codec.decodeJson(row.metadata_json, 'attachment-meta:' + row.stored_name);
        counts.attachmentMetadata++;
      }
    }
    if (hasTable('approval_requests')) {
      for (const row of db.prepare('SELECT id,reason,decision_reason FROM approval_requests').iterate()) {
        for (const [field, context] of [['reason','approval-reason:'], ['decision_reason','approval-decision:']]) {
          if (row[field] === null) continue;
          if (typeof codec.decodeJson(row[field], context + row.id) !== 'string') throw new Error('سبب موافقة غير صالح.');
          counts.approvalReasons++;
        }
      }
    }
    if (db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'totp_secret')) {
      for (const row of db.prepare('SELECT id,totp_secret FROM users WHERE totp_secret IS NOT NULL').iterate()) {
        if (typeof codec.decodeJson(row.totp_secret, 'totp:' + row.id) !== 'string') throw new Error('مفتاح تحقق ثنائي غير صالح.');
        counts.twoFactorSecrets++;
      }
    }
    if (!db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").get()) {
      throw new Error('النسخة لا تحتوي على حساب مدير فعال.');
    }
    // A pinned sole operator must also remain usable after restoration.
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='single_operator'").get()) {
      const pinned = db.prepare('SELECT user_id FROM single_operator WHERE id=1').get();
      if (pinned && !db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND active=1").get(pinned.user_id)) {
        throw new Error('حساب المالك المثبت في النسخة غير فعال.');
      }
    }
    db.close();
    for (const [folder, counter] of [['attachments', 'attachments'], ['retired-attachments', 'retiredAttachments']]) {
      const full = path.join(directory, folder);
      if (!fs.existsSync(full)) continue;
      const stat = fs.lstatSync(full);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('مجلد مرفقات غير صالح.');
      for (const name of fs.readdirSync(full)) {
        const file = path.join(full, name);
        requireFile(file);
        codec.open(fs.readFileSync(file), 'attachment:' + name);
        counts[counter]++;
      }
    }
    return { contentVerified: true, contentCounts: counts };
  } catch (error) {
    throw new Error('فشل التحقق من محتوى النسخة المشفر. تأكد من النسخة ومفتاح استعادتها.', { cause: error });
  } finally {
    try { if (db?.open) db.close(); }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
}

module.exports = { verifyRestoredData, readStorageKey };
