'use strict';

// Usage: node scripts/bench-save.js [comma-separated archive sizes]
// Uses synthetic complaints and a temporary encrypted database, without audit logging.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const SAMPLES = 30;
const actor = { userId: 'operator', username: 'director' };

function parseSizes(input = '0,1000,5000') {
  return input.split(',').map(value => {
    const size = Number(value);
    if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(size) || size > Number.MAX_SAFE_INTEGER - SAMPLES) {
      throw new Error('Use comma-separated non-negative integer archive sizes, e.g. 0,1000,5000.');
    }
    return size;
  });
}

function sample() {
  return {
    name: 'مراجع تجريبي', phone: '0999000000', source: 'phone', province: 'دمشق', entity: 'جهة تجريبية',
    category: 'خدمات', nature: 'تأخر', priority: 'normal',
    summary: 'ملخص تجريبي للشكوى لقياس زمن الحفظ.',
    details: 'تفاصيل أطول قليلًا. '.repeat(20)
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function runFor(size, openDatabase, createComplaintsService) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-save-'));
  const databasePath = path.join(dir, 'bench.sqlite');
  let db;
  try {
    db = openDatabase(databasePath, { storageKey: crypto.randomBytes(24).toString('hex') });
    db.prepare('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES(?, ?, ?, ?, 1, ?)')
      .run(actor.userId, actor.username, 'bench-only', 'admin', new Date().toISOString());
    const service = createComplaintsService({ db, singleOperator: true });
    const createArgs = { ...actor, body: sample() };

    const seedStarted = performance.now();
    for (let i = 0; i < size; i += 1) service.createComplaint(createArgs);
    const seedMs = performance.now() - seedStarted;

    const createTimes = [];
    const updateTimes = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const createStarted = performance.now();
      const created = service.createComplaint(createArgs);
      createTimes.push(performance.now() - createStarted);

      const updateArgs = {
        ...actor,
        complaintId: created.complaint.id,
        body: { summary: 'ملخص معدّل لقياس زمن حفظ التعديل.' }
      };
      const updateStarted = performance.now();
      const updated = service.updateComplaint(updateArgs);
      updateTimes.push(performance.now() - updateStarted);
      if (!updated.ok || updated.unchanged) throw new Error(updated.error || 'The benchmark update did not save.');
    }

    // Include all committed pages, even if SQLite still has them in the WAL.
    db.pragma('wal_checkpoint(TRUNCATE)');
    return {
      createMs: median(createTimes),
      updateMs: median(updateTimes),
      dbMiB: fs.statSync(databasePath).size / 1048576,
      seedSeconds: seedMs / 1000
    };
  } finally {
    try {
      db?.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

function main() {
  const sizes = parseSizes(process.argv[2]);
  const { openDatabase } = require('../config/db');
  const { createComplaintsService } = require('../modules/complaints/service');
  console.log(`Each run starts with the given archive size and adds ${SAMPLES} create/update pairs.`);
  console.log('initial records | median create (ms) | median update (ms) | final db (MiB) | seed time (s)');
  for (const size of sizes) {
    const result = runFor(size, openDatabase, createComplaintsService);
    console.log([
      String(size).padStart(15),
      result.createMs.toFixed(2).padStart(18),
      result.updateMs.toFixed(2).padStart(18),
      result.dbMiB.toFixed(2).padStart(15),
      result.seedSeconds.toFixed(2).padStart(13)
    ].join(' | '));
  }
}

try {
  main();
} catch (error) {
  console.error('Save benchmark failed:', error.message);
  process.exitCode = 1;
}
