'use strict';

const path = require('node:path');
const { version } = require('../package.json');
const { isValidUsername, isValidPassword } = require('../lib/validation');

function requiredEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength || /^replace[-_ ]with\b/i.test(value.trim()) || /^change[-_ ]me\b/i.test(value.trim())) {
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

  if (process.env.BACKUP_SECRET) requiredEnv('BACKUP_SECRET', 32);
  const adminUsername = requiredEnv('ADMIN_USERNAME', 3).trim();
  const adminPassword = requiredEnv('ADMIN_PASSWORD', 12);
  if (!isValidUsername(adminUsername) || !isValidPassword(adminPassword)) throw new Error('Invalid ADMIN_USERNAME or ADMIN_PASSWORD.');

  return {
    host,
    port,
    sessionSecret: requiredEnv('SESSION_SECRET', 32),
    storageKey: process.env.DATA_KEY ? requiredEnv('DATA_KEY', 32) : requiredEnv('SESSION_SECRET', 32),
    adminUsername,
    adminPassword,
    databasePath,
    sessionsDir: path.resolve(process.env.SESSIONS_DIR || path.join(dataDir, 'sessions')),
    instanceIdPath: path.resolve(
      process.env.INSTANCE_ID_PATH || path.join(dataDir, 'instance-id')
    ),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    backupSecret: process.env.BACKUP_SECRET || requiredEnv('SESSION_SECRET', 32),
    version
  };
}

module.exports = { loadEnv, requiredEnv };
