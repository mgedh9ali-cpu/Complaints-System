'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function lockDownDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    if (process.platform !== 'win32') {
      fs.chmodSync(dirPath, 0o700);
    } else {
      try {
        spawnSync(
          'icacls',
          [dirPath, '/inheritance:d', '/grant:r', process.env.USERNAME + ':(OI)(CI)F'],
          { windowsHide: true, stdio: 'ignore' }
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function lockDownFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    if (process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    /* ignore */
  }
}

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

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

function encryptBuffer(plain, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('COMPLBACKUP1'), iv, tag, enc]);
}

function decryptBuffer(payload, secret) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < 40 || buf.subarray(0, 12).toString() !== 'COMPLBACKUP1') {
    throw new Error('صيغة النسخة الاحتياطية المشفّرة غير معروفة.');
  }
  const iv = buf.subarray(12, 24);
  const tag = buf.subarray(24, 40);
  const data = buf.subarray(40);
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

module.exports = {
  lockDownDir,
  lockDownFile,
  lockDownDataTree,
  encryptBuffer,
  decryptBuffer
};
