'use strict';

const path = require('node:path');
const { version } = require('../package.json');
const { isValidUsername, isValidPassword } = require('../lib/validation');

const placeholder = /^(?:replace[-_ ]with|change[-_ ]me)\b/i;

function requiredEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength || placeholder.test(value.trim())) {
    throw new Error(`Missing or too-short environment variable: ${name}`);
  }
  return value;
}

function loadEnv() {
  const host = '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }
  if (
    process.env.ALLOW_LAN === 'true' ||
    (process.env.HOST && !['127.0.0.1', 'localhost'].includes(process.env.HOST))
  ) {
    throw new Error('This offline build is loopback-only; remove HOST/ALLOW_LAN overrides.');
  }

  const databasePath = path.resolve(process.env.DATABASE_PATH || './data/complaints.sqlite');
  const dataDir = path.dirname(databasePath);

  // All three secrets must be present and independent. No fallback of DATA_KEY or
  // BACKUP_SECRET onto SESSION_SECRET — that weakened key separation.
  const sessionSecret = requiredEnv('SESSION_SECRET', 32);
  const storageKey = requiredEnv('DATA_KEY', 32);
  const backupSecret = requiredEnv('BACKUP_SECRET', 32);

  if (storageKey === sessionSecret || backupSecret === sessionSecret || storageKey === backupSecret) {
    throw new Error('SESSION_SECRET, DATA_KEY and BACKUP_SECRET must be three distinct values.');
  }

  return {
    host,
    port,
    sessionSecret,
    storageKey,
    databasePath,
    sessionsDir: path.resolve(process.env.SESSIONS_DIR || path.join(dataDir, 'sessions')),
    instanceIdPath: path.resolve(
      process.env.INSTANCE_ID_PATH || path.join(dataDir, 'instance-id')
    ),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    backupSecret,
    version
  };
}

function loadBootstrapAdmin() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!isValidUsername(ADMIN_USERNAME) || placeholder.test(ADMIN_USERNAME.trim())) {
    throw new Error('تعذر إنشاء حساب المدير الأول. اضبط ADMIN_USERNAME باسم من 3 إلى 64 حرفًا دون مسافات.');
  }
  if (!isValidPassword(ADMIN_PASSWORD) || placeholder.test(ADMIN_PASSWORD.trim())) {
    throw new Error('تعذر إنشاء حساب المدير الأول. اضبط ADMIN_PASSWORD بكلمة مرور من 12 إلى 200 حرف.');
  }
  return { username: ADMIN_USERNAME.trim(), password: ADMIN_PASSWORD };
}

module.exports = { loadEnv, loadBootstrapAdmin, requiredEnv };
