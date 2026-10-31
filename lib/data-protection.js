'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** Restrict directory to owner only (Unix). No-op on Windows ACL limits. */
function lockDownDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    if (process.platform !== 'win32') {
      fs.chmodSync(dirPath, 0o700);
    }
  } catch {
    /* ignore */
  }
}

/** Restrict a file to owner read/write. */
function lockDownFile(filePath) {
  try {
    if (process.platform !== 'win32' && fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    /* ignore */
  }
}

/** Lock data root and common children after paths are known. */
function lockDownDataTree(dataRoot) {
  lockDownDir(dataRoot);
  for (const name of ['sessions', 'attachments', 'backups']) {
    lockDownDir(path.join(dataRoot, name));
  }
  try {
    for (const name of fs.readdirSync(dataRoot)) {
      const full = path.join(dataRoot, name);
      try {
        if (fs.statSync(full).isFile()) lockDownFile(full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function deriveBackupKey(sessionSecret) {
  return crypto.createHash('sha256').update(String(sessionSecret), 'utf8').digest();
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Output format: COMPLBACKUP1 || iv(12) || tag(16) || ciphertext
 */
function encryptBuffer(plain, sessionSecret) {
  const key = deriveBackupKey(sessionSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('COMPLBACKUP1'), iv, tag, enc]);
}

function decryptBuffer(payload, sessionSecret) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < 12 + 16 + 12 || buf.subarray(0, 12).toString() !== 'COMPLBACKUP1') {
    throw new Error('صيغة النسخة الاحتياطية المشفّرة غير معروفة.');
  }
  const iv = buf.subarray(12, 24);
  const tag = buf.subarray(24, 40);
  const data = buf.subarray(40);
  const key = deriveBackupKey(sessionSecret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

module.exports = {
  lockDownDir,
  lockDownFile,
  lockDownDataTree,
  encryptBuffer,
  decryptBuffer,
  deriveBackupKey
};
