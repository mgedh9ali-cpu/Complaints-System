'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function createHealthService({ db, databasePath, version, backupScheduler }) {
  function basic() {
    return {
      status: 'ok',
      database: 'sqlite',
      mode: 'local',
      version: version || '0.7.0',
      time: new Date().toISOString()
    };
  }

  function detailed() {
    const info = basic();
    let integrity = 'unknown';
    let foreignKeys = 0;
    let counts = {};
    try {
      const check = db.pragma('integrity_check');
      integrity =
        check.length === 1 && check[0].integrity_check === 'ok' ? 'ok' : 'fail';
      foreignKeys = db.pragma('foreign_key_check').length;
      counts = {
        users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
        complaints: db.prepare('SELECT COUNT(*) AS c FROM complaints').get().c,
        audit_events: db.prepare('SELECT COUNT(*) AS c FROM audit_events').get().c
      };
    } catch (err) {
      integrity = 'error:' + err.message;
    }

    let dbSize = null;
    try {
      dbSize = fs.statSync(databasePath).size;
    } catch (_) {}

    return {
      ...info,
      integrity,
      foreignKeyViolations: foreignKeys,
      counts,
      contentEncryptionEnabled: Boolean(db.storageCodec?.enabled),
      automaticBackups: backupScheduler?.status() || null,
      databasePath: path.basename(databasePath),
      databaseBytes: dbSize,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed
      },
      platform: process.platform,
      node: process.version,
      hostname: os.hostname()
    };
  }

  return { basic, detailed };
}

module.exports = { createHealthService };
