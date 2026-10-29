'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const Database = require('better-sqlite3');
const { hashAuditEvent } = require('./lib/audit-integrity');
const { logger } = require('./lib/logger');
const { createComplaintsService } = require('./modules/complaints/service');
const { createComplaintsRouter } = require('./modules/complaints/routes');
const { createAuthService } = require('./modules/auth/service');
const { createAuthMiddleware } = require('./modules/auth/middleware');
const { createAuthRouter } = require('./modules/auth/routes');

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
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','staff','reviewer')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    state_json TEXT NOT NULL CHECK(json_valid(state_json)),
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details_json TEXT NOT NULL CHECK(json_valid(details_json)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_complaints_updated ON complaints(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
`);

const appStateColumns = new Set(db.prepare('PRAGMA table_info(app_state)').all().map(row => row.name));
if (!appStateColumns.has('revision')) {
  db.exec('ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)');
}

const auditColumns = new Set(db.prepare('PRAGMA table_info(audit_events)').all().map(row => row.name));
const auditChainNeedsMigration = !auditColumns.has('previous_hash') || !auditColumns.has('event_hash');
if (!auditColumns.has('previous_hash')) db.exec('ALTER TABLE audit_events ADD COLUMN previous_hash TEXT');
if (!auditColumns.has('event_hash')) db.exec('ALTER TABLE audit_events ADD COLUMN event_hash TEXT');
if (auditChainNeedsMigration) {
  const migrateAuditChain = db.transaction(() => {
    let previousHash = null;
    const rows = db.prepare(`SELECT rowid AS _rowid, id, actor_user_id, action, target_type, target_id,
      details_json, created_at FROM audit_events ORDER BY rowid ASC`).all();
    const update = db.prepare('UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE rowid = ?');
    for (const row of rows) {
      const eventHash = hashAuditEvent(row, previousHash);
      update.run(previousHash, eventHash, row._rowid);
      previousHash = eventHash;
    }
  });
  migrateAuditChain();
}

function persistAuditHeadHash(eventHash) {
  try { fs.writeFileSync(path.resolve('./data/audit-head.hash'), eventHash + '\n'); }
  catch (err) { logger.error('Failed to persist audit head hash', { error: err.message }); }
}

function audit(actorUserId, action, targetType, targetId = null, details = {}) {
  const event = {
    id: crypto.randomUUID(), actor_user_id: actorUserId || null, action,
    target_type: targetType, target_id: targetId,
    details_json: JSON.stringify(details), created_at: new Date().toISOString()
  };
  const previousHash = db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get()?.event_hash ?? null;
  const eventHash = hashAuditEvent(event, previousHash);
  db.prepare(`INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, details_json, created_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, event.actor_user_id, event.action, event.target_type, event.target_id, event.details_json, event.created_at, previousHash, eventHash);
  persistAuditHeadHash(eventHash);
}

const authService = createAuthService({ db, audit, logger });
authService.ensureBootstrapAdmin(adminUsername, adminPassword);

const middleware = createAuthMiddleware({ db });
const { requireAuth, requireRole, requireCsrf, ensureCsrfToken } = middleware;

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '1mb', strict: true }));

const FileStore = require('session-file-store')(session);
const sessionsDir = path.resolve('./data/sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
app.use(session({
  name: 'complaints.sid', secret: sessionSecret, resave: false, saveUninitialized: false,
  store: new FileStore({ path: sessionsDir, ttl: 30 * 60, retries: 1, logFn: function() {} }),
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 30 * 60 * 1000 }
}));
app.use(ensureCsrfToken);

const { validComplaint } = require('./lib/validation');
const { diffComplaints } = require('./lib/complaint-state-diff');
const { backupDatabase } = require('./scripts/backup-database');
const multer = require('multer');
const { saveAttachment, getAttachmentPath, deleteAttachment, MAX_FILE_SIZE, MAX_FILES_PER_COMPLAINT } = require('./lib/attachments');
const { buildComplaintsWorkbook } = require('./lib/excel-export');
const { createSyncPackage, validateSyncPackage, stageProgramUpdate, verifyProgramUpdate } = require('./lib/offline-sync');

const complaintsService = createComplaintsService({ db, audit, logger });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_COMPLAINT } });

const instanceIdPath = path.resolve(process.env.INSTANCE_ID_PATH || './data/instance-id');
fs.mkdirSync(path.dirname(instanceIdPath), { recursive: true });
if (!fs.existsSync(instanceIdPath)) fs.writeFileSync(instanceIdPath, crypto.randomUUID() + '\n', { flag: 'wx' });
const sourceInstanceId = fs.readFileSync(instanceIdPath, 'utf8').trim();

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'sqlite', mode: 'local', version: '0.6.0' }));

app.use('/api', createAuthRouter({ authService, middleware, audit }));
app.use('/api', createComplaintsRouter({
  complaintsService, middleware, audit, logger, validComplaint, diffComplaints, db
}));

app.post('/api/attachments/:complaintId', requireAuth, requireRole('admin', 'staff'), requireCsrf, upload.array('files', MAX_FILES_PER_COMPLAINT), (req, res) => {
  const complaintId = String(req.params.complaintId || '').trim();
  if (!complaintId || complaintId.length > 100) return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم إرسال أي ملف.' });
  try {
    const saved = [];
    for (const file of req.files) {
      const meta = saveAttachment(complaintId, file);
      saved.push(meta);
      audit(req.user.id, 'attachment_uploaded', 'attachment', meta.id, { complaintId, originalName: meta.originalName, size: meta.size });
    }
    res.status(201).json({ attachments: saved });
  } catch (err) { res.status(400).json({ error: err.message || 'فشل رفع الملف.' }); }
});

app.get('/api/attachments/:storedName', requireAuth, (req, res) => {
  const storedName = path.basename(req.params.storedName || '');
  const full = getAttachmentPath(storedName);
  if (!full) return res.status(404).json({ error: 'الملف غير موجود.' });
  res.download(full, storedName, (err) => { if (err && !res.headersSent) res.status(500).json({ error: 'تعذر تنزيل الملف.' }); });
});

app.delete('/api/attachments/:storedName', requireAuth, requireRole('admin', 'staff'), requireCsrf, (req, res) => {
  const storedName = path.basename(req.params.storedName || '');
  deleteAttachment(storedName);
  audit(req.user.id, 'attachment_deleted', 'attachment', storedName, {});
  res.status(204).end();
});

app.get('/api/export/csv', requireAuth, requireRole('admin', 'staff', 'reviewer'), (req, res) => {
  const { state } = complaintsService.readState();
  const complaints = Array.isArray(state.complaints) ? state.complaints : [];
  const headers = ['id', 'name', 'phone', 'province', 'entity', 'category', 'priority', 'status', 'summary', 'created', 'updated', 'due', 'owner'];
  const escapeCsv = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [headers.join(',')];
  for (const c of complaints) lines.push(headers.map(h => escapeCsv(c[h])).join(','));
  const csv = '\uFEFF' + lines.join('\n');
  const filename = 'complaints-export-' + new Date().toISOString().slice(0, 10) + '.csv';
  audit(req.user.id, 'csv_export', 'export', filename, { count: complaints.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

app.get('/api/export/xlsx', requireAuth, requireRole('admin', 'staff', 'reviewer'), async (req, res, next) => {
  try {
    const { state } = complaintsService.readState();
    const complaints = Array.isArray(state.complaints) ? state.complaints : [];
    const buffer = await buildComplaintsWorkbook(complaints, { title: 'تقرير الشكاوى', generatedBy: req.user.username });
    const filename = 'تقرير-الشكاوى-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    audit(req.user.id, 'xlsx_export', 'export', filename, { count: complaints.length });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) { next(err); }
});

app.get('/api/backup/database', requireAuth, requireRole('admin'), async (req, res, next) => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-database-backup-'));
  try {
    const result = await backupDatabase({ databasePath, backupDir });
    audit(req.user.id, 'database_backup', 'backup', path.basename(result.backupPath), {});
    res.download(result.backupPath, path.basename(result.backupPath), (err) => {
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch (_) {}
      if (err && !res.headersSent) res.status(500).json({ error: 'تعذر تنزيل النسخة الاحتياطية.' });
    });
  } catch (err) {
    try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch (_) {}
    next(err);
  }
});

app.use(express.static(path.resolve('.'), { index: 'index.html', extensions: ['html'] }));

app.use((err, req, res, next) => {
  logger.requestError(err, req);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم.' });
});

app.listen(port, host, () => {
  logger.info('server listening', { host, port, version: '0.6.0' });
  console.log(`Complaints system listening on http://${host}:${port}`);
});
