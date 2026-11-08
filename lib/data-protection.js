'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const securedWindowsDirectories = new Map();

function lockDownDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    if (process.platform !== 'win32') {
      fs.chmodSync(dirPath, 0o700);
    } else {
      try {
        const directory = path.resolve(dirPath);
        const account = process.env.USERNAME;
        const before = fs.statSync(directory);
        const identity = stat => JSON.stringify([stat.dev, stat.ino, stat.birthtimeMs, stat.ctimeMs, account]);
        // Reapplying the same ACL launches another Windows process. Reuse only
        // a successful result while the directory and its metadata are unchanged.
        if (securedWindowsDirectories.get(directory) === identity(before)) return;
        const result = spawnSync(
          'icacls',
          [directory, '/inheritance:d', '/grant:r', account + ':(OI)(CI)F'],
          { windowsHide: true, stdio: 'ignore', timeout: 5000 }
        );
        if (result.status === 0 && !result.error) {
          const after = fs.statSync(directory);
          if (before.dev === after.dev && before.ino === after.ino && before.birthtimeMs === after.birthtimeMs && account === process.env.USERNAME) {
            securedWindowsDirectories.set(directory, identity(after));
          }
        }
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
