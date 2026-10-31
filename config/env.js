'use strict';

const path = require('node:path');

function requiredEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
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

  return {
    host,
    port,
    sessionSecret: requiredEnv('SESSION_SECRET', 32),
    adminUsername: requiredEnv('ADMIN_USERNAME', 3),
    adminPassword: requiredEnv('ADMIN_PASSWORD', 12),
    databasePath: path.resolve(process.env.DATABASE_PATH || './data/complaints.sqlite'),
    sessionsDir: path.resolve('./data/sessions'),
    instanceIdPath: path.resolve(process.env.INSTANCE_ID_PATH || './data/instance-id'),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    version: '0.7.5'
  };
}

module.exports = { loadEnv, requiredEnv };
