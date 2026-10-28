'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { rateLimit } = require('express-rate-limit');
const { hashAuditEvent } = require('./lib/audit-integrity');
const { logger } = require('./lib/logger');
const { verifyRestore } = require('./scripts/verify-database-restore');
const { registerProductionRoutes } = require('./lib/register-production-routes');

function requiredEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength) throw new Error(`Missing or too-short environment variable: ${name}`);
  return value;
}

const app = express();
const host = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const sessionSecret = requiredEnv('SESSION_SECRET', 32);
const adminUsername = requiredEnv('ADMIN_USERNAME', 3);
const adminPassword = requiredEnv('ADMIN_PASSWORD', 12);
const databasePath = path.resolve(process.env.DATABASE_PATH || './data/complaints.sqlite');

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
if (process.env.ALLOW_LAN === 'true' || (process.env.HOST && !['127.0.0.1','localhost'].includes(process.env.HOST))) {
  throw new Error('This offline build is loopback-only; remove HOST/ALLOW_LAN overrides.');
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
