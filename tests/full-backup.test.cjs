'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../config/db');
const { createEncryptedBundle, extractEncryptedBundle, verifyEncryptedBundle } = require('../lib/full-backup');

const SECRET = 'test-only-long-and-random-enough-secret-2026-11-01';

test('full backup archives SQLite, attachments and audit integrity head with authenticated encryption', {
  timeout: 30000
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-full-backup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataDir, 'attachments'), { recursive: true });
  const dbPath = path.join(dataDir, 'complaints.sqlite');
  const db = openDatabase(dbPath);
  db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?)')
    .run('admin-id', 'admin', 'test-hash', 'admin', 1, '2026-11-01T00:00:00Z');
  db.close();

  const attachmentName = 'SY-2026-001_12345678-1234-1234-1234-123456789abc.pdf';
  const fileBytes = Buffer.from('%PDF-1.7\nattachment-test-data\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'attachments', attachmentName), fileBytes);
  fs.writeFileSync(path.join(dataDir, 'audit-head.hash'), 'sample-head-hash');
  const backupDir = path.join(dir, 'backup');
  const saved = await createEncryptedBundle({
    databasePath: dbPath, secret: SECRET, backupDir
  });
  assert.equal(saved.encrypted, true);
  assert.equal(saved.attachmentCount, 1);
  const ciphertext = fs.readFileSync(saved.destination);
  assert.ok(ciphertext.length > 100);
  assert.ok(ciphertext.subarray(0, 12).toString('ascii') === 'COMPLBUNDLE2');
  assert.equal(ciphertext.includes(fileBytes), false, 'attachment bytes must not be plaintext');

  const valid = await verifyEncryptedBundle({
    bundlePath: saved.destination, secret: SECRET
  });
  assert.equal(valid.verified, true);
  assert.equal(valid.attachmentCount, 1);
  assert.equal(valid.counts.users, 1);
  const restoredDir = path.join(dir, 'restored');
  const result = await extractEncryptedBundle({
    bundlePath: saved.destination, secret: SECRET, outputDir: restoredDir
  });
  assert.equal(result.verified, true);
  assert.deepEqual(fs.readFileSync(path.join(restoredDir, 'attachments', attachmentName)), fileBytes);
  assert.equal(fs.readFileSync(path.join(restoredDir, 'audit-head.hash'), 'utf8'), 'sample-head-hash');

  await assert.rejects(extractEncryptedBundle({
    bundlePath: saved.destination, secret: SECRET, outputDir: restoredDir
  }), /empty/);
  const wrongPasswordDir = path.join(dir, 'wrong-key');
  await assert.rejects(extractEncryptedBundle({
    bundlePath: saved.destination, secret: 'incorrect-secret-with-required-length-123',
    outputDir: wrongPasswordDir
  }));
  assert.equal(fs.existsSync(wrongPasswordDir), false, 'wrong keys should leave no partial data');
  const tampered = path.join(dir, 'modified.csb');
  const modified = Buffer.from(ciphertext);
  modified[75] ^= 0x20;
  fs.writeFileSync(tampered, modified);
  const tamperedDir = path.join(dir, 'modified-output');
  await assert.rejects(extractEncryptedBundle({
    bundlePath: tampered, secret: SECRET, outputDir: tamperedDir
  }));
  assert.equal(fs.existsSync(tamperedDir), false, 'tampered backups must not leave partial files');
});

test('full backup refuses symbolic links and unsafe filenames', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-backup-unsafe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = path.join(dir, 'data');
  fs.mkdirSync(path.join(data, 'attachments'), { recursive: true });
  const file = path.join(data, 'complaints.sqlite');
  openDatabase(file).close();
  fs.writeFileSync(path.join(data, 'attachments', 'unsafe:name'), 'should refuse');
  await assert.rejects(createEncryptedBundle({
    databasePath: file, secret: SECRET, backupDir: path.join(dir, 'output')
  }), /Unsafe or non-file attachment/);
});
