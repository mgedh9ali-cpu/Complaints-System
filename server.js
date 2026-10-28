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

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const passwordHash = bcrypt.hashSync(adminPassword, 12);
  db.prepare('INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), adminUsername, passwordHash, 'admin', new Date().toISOString());
  console.log(`Created initial administrator account: ${adminUsername}`);
}

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

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  next();
}
app.use(ensureCsrfToken);

function requireCsrf(req, res, next) {
  const token = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
  if (!token || token !== req.session.csrfToken) return res.status(403).json({ error: 'رمز CSRF غير صالح أو مفقود.' });
  next();
}

app.get('/api/csrf', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  res.json({ csrfToken: req.session.csrfToken });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'تم تجاوز عدد محاولات الدخول. حاول لاحقًا.' }
});

function persistAuditHeadHash(eventHash) {
  try { fs.writeFileSync(path.resolve('./data/audit-head.hash'), eventHash + '\n'); } catch (err) { console.error(err.message); }
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

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  const user = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.active !== 1) return req.session.destroy(() => res.status(401).json({ error: 'الحساب غير فعال.' }));
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
    next();
  };
}

const { validComplaint } = require('./lib/validation');
const { diffComplaints } = require('./lib/complaint-state-diff');
const { backupDatabase } = require('./scripts/backup-database');
const { verifyRestore } = require('./scripts/verify-database-restore');
const multer = require('multer');
const { saveAttachment, getAttachmentPath, deleteAttachment, listAttachmentsForComplaint, MAX_FILE_SIZE, MAX_FILES_PER_COMPLAINT } = require('./lib/attachments');
const { buildComplaintsWorkbook, buildSingleComplaintWorkbook } = require('./lib/excel-export');
const { createSyncPackage, validateSyncPackage, stageProgramUpdate, verifyProgramUpdate } = require('./lib/offline-sync');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_COMPLAINT } });

const instanceIdPath = path.resolve(process.env.INSTANCE_ID_PATH || './data/instance-id');
fs.mkdirSync(path.dirname(instanceIdPath), { recursive: true });
if (!fs.existsSync(instanceIdPath)) fs.writeFileSync(instanceIdPath, crypto.randomUUID() + '\n', { flag: 'wx' });
const sourceInstanceId = fs.readFileSync(instanceIdPath, 'utf8').trim();

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'sqlite', mode: 'local', version: '0.5.1' }));

app.get('/api/export/csv', requireAuth, requireRole('admin', 'staff', 'reviewer'), (req, res) => {
  const row = db.prepare('SELECT state_json FROM app_state WHERE id=1').get();
  const state = row ? JSON.parse(row.state_json) : { complaints: [] };
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
    const row = db.prepare('SELECT state_json FROM app_state WHERE id=1').get();
    const state = row ? JSON.parse(row.state_json) : { complaints: [] };
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

app.get('/api/export/xlsx/:id', requireAuth, requireRole('admin', 'staff', 'reviewer'), async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 100) return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
    let complaint = null;
    const row = db.prepare('SELECT state_json FROM app_state WHERE id=1').get();
    if (row) {
      const state = JSON.parse(row.state_json);
      const list = Array.isArray(state.complaints) ? state.complaints : [];
      complaint = list.find(c => c && c.id === id) || null;
    }
    if (!complaint) {
      const crow = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(id);
      if (crow) complaint = { id, ...JSON.parse(crow.payload_json) };
    }
    if (!complaint) return res.status(404).json({ error: 'الشكوى غير موجودة.' });
    const buffer = await buildSingleComplaintWorkbook(complaint, { generatedBy: req.user.username });
    const filename = 'شكوى-' + id + '.xlsx';
    audit(req.user.id, 'xlsx_export_single', 'export', id, { filename });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) { next(err); }
});

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

app.get('/api/attachments/by-complaint/:complaintId', requireAuth, (req, res) => {
  const complaintId = String(req.params.complaintId || '').trim();
  if (!complaintId || complaintId.length > 100) return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
  const items = listAttachmentsForComplaint(complaintId);
  res.json({ attachments: items });
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

app.post('/api/auth/login', loginLimiter, (req, res, next) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 200)
    return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور.' });
  const user = db.prepare('SELECT id, username, password_hash, role, active FROM users WHERE username = ?').get(username.trim());
  const matches = user ? bcrypt.compareSync(password, user.password_hash) : false;
  if (!user || !matches || user.active !== 1) {
    if (user) audit(user.id, 'login_failed', 'user', user.id);
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
  }
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = { id: user.id };
    audit(user.id, 'login_success', 'user', user.id);
    req.session.save(saveErr => {
      if (saveErr) return next(saveErr);
      res.json({ user: { id: user.id, username: user.username, role: user.role } });
    });
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  audit(req.user.id, 'logout', 'user', req.user.id);
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'تعذر إنهاء الجلسة.' });
    res.clearCookie('complaints.sid', { httpOnly: true, sameSite: 'strict' });
    res.status(204).end();
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

app.get('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY created_at ASC').all();
  res.json({ users });
});

app.post('/api/users', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
  const { username, password, role } = req.body || {};
  if (typeof username !== 'string' || !/^[\p{L}\p{N}._-]{3,64}$/u.test(username.trim()) ||
      typeof password !== 'string' || password.length < 12 || password.length > 200 ||
      !['admin', 'staff', 'reviewer'].includes(role))
    return res.status(400).json({ error: 'اسم المستخدم أو كلمة المرور أو الدور غير صالح.' });
  const id = crypto.randomUUID();
  const normalizedUsername = username.trim();
  const passwordHash = bcrypt.hashSync(password, 12);
  try {
    db.prepare('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, normalizedUsername, passwordHash, role, new Date().toISOString());
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل.' });
    throw error;
  }
  audit(req.user.id, 'user_created', 'user', id, { username: normalizedUsername, role });
  res.status(201).json({ user: { id, username: normalizedUsername, role, active: 1 } });
});

app.patch('/api/users/:id/active', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'قيمة تفعيل الحساب غير صالحة.' });
  const target = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'الحساب غير موجود.' });
  if (target.id === req.user.id && req.body.active === false) return res.status(409).json({ error: 'لا يمكن للمدير تعطيل حسابه الحالي.' });
  if (target.role === 'admin' && target.active === 1 && req.body.active === false) {
    const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").get().count;
    if (activeAdmins <= 1) return res.status(409).json({ error: 'لا يمكن تعطيل آخر حساب مدير نشط.' });
  }
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, target.id);
  audit(req.user.id, req.body.active ? 'user_activated' : 'user_deactivated', 'user', target.id, { username: target.username, role: target.role });
  res.json({ user: { id: target.id, username: target.username, role: target.role, active: req.body.active ? 1 : 0 } });
});

app.get('/api/backup/database', requireAuth, requireRole('admin'), async (req, res, next) => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-database-backup-'));
  const filename = 'complaints-database-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite';
  const destination = path.join(backupDir, filename);
  try {
    audit(req.user.id, 'database_backup_created', 'database', filename, { format: 'sqlite', verified: true });
    const result = await backupDatabase(databasePath, destination);
    if (!result.verified) throw new Error('Backup verification did not complete.');
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(destination, error => { fs.rmSync(backupDir, { recursive: true, force: true }); if (error && !res.headersSent) next(error); });
  } catch (error) { fs.rmSync(backupDir, { recursive: true, force: true }); next(error); }
});

app.post('/api/backup/verify', requireAuth, requireRole('admin'), express.raw({
  type: 'application/vnd.sqlite3',
  limit: '250mb'
}), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'اختر ملف SQLite غير فارغ للفحص.' });
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-backup-check-'));
  const uploadedPath = path.join(tempDir, 'uploaded-backup.sqlite');
  try {
    fs.writeFileSync(uploadedPath, req.body, { flag: 'wx', mode: 0o600 });
    const result = await verifyRestore(uploadedPath);
    audit(req.user.id, 'database_backup_verified', 'database', null, {
      format: 'sqlite', verified: true, counts: result.counts
    });
    res.json({ verified: true, counts: result.counts });
  } catch (error) {
    audit(req.user.id, 'database_backup_verification_failed', 'database', null, {
      format: 'sqlite', verified: false
    });
    res.status(400).json({ error: 'تعذّر التحقق من ملف النسخة. تأكد أنه نسخة SQLite كاملة وسليمة من هذا النظام.' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

app.get('/api/state', requireAuth, (req, res) => {
  const row = db.prepare('SELECT state_json, updated_at, revision FROM app_state WHERE id=1').get();
  res.json({ state: row ? JSON.parse(row.state_json) : null, updatedAt: row?.updated_at || null, revision: row?.revision ?? 0 });
});

app.put('/api/state', requireAuth, requireRole('admin','staff'), requireCsrf, (req, res) => {
  const revisionHeader = req.get('X-State-Revision');
  if (typeof revisionHeader !== 'string' || !/^(0|[1-9]\d*)$/.test(revisionHeader))
    return res.status(428).json({ error: 'رقم إصدار البيانات مطلوب. أعد تحميل الحالة قبل الحفظ.' });
  const expectedRevision = Number(revisionHeader);
  if (!Number.isSafeInteger(expectedRevision)) return res.status(400).json({ error: 'رقم إصدار البيانات غير صالح.' });
  const state = req.body;
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.complaints) || state.complaints.length > 5000 ||
     !Array.isArray(state.notifications) || !Array.isArray(state.templates) || !state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings))
    return res.status(400).json({ error: 'بنية البيانات المرسلة غير صالحة.' });
  const complaintIds = new Set();
  for (const complaint of state.complaints) {
    if (!complaint || typeof complaint !== 'object' || Array.isArray(complaint) || typeof complaint.id !== 'string' || !complaint.id.trim() || complaint.id.length > 100)
      return res.status(400).json({ error: 'يتضمن ملف الشكاوى سجلًا بمعرّف غير صالح.' });
    if (complaintIds.has(complaint.id)) return res.status(400).json({ error: 'تتضمن البيانات معرّفات شكاوى مكررة.' });
    complaintIds.add(complaint.id);
  }
  let stateJson = JSON.stringify(state);
  if (Buffer.byteLength(stateJson, 'utf8') > 900 * 1024) return res.status(413).json({ error: 'حجم البيانات أكبر من الحد المسموح.' });
  const now = new Date().toISOString();
  const saveState = db.transaction(() => {
    const currentRow = db.prepare('SELECT state_json, revision FROM app_state WHERE id=1').get();
    const currentRevision = currentRow?.revision ?? 0;
    if (currentRevision !== expectedRevision) return { conflict: true, currentRevision };
    const previousState = currentRow ? JSON.parse(currentRow.state_json) : null;
    const previousById = new Map((Array.isArray(previousState?.complaints) ? previousState.complaints : [])
      .filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
    const transitions = {
      new: ['in_progress', 'cancelled'],
      in_progress: ['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'],
      awaiting_reply: ['in_progress', 'awaiting_approval', 'closed'],
      awaiting_approval: ['in_progress', 'closed'],
      closed: ['in_progress'],
      cancelled: []
    };
    for (const complaint of state.complaints) {
      const previous = previousById.get(complaint.id);
      if (!previous || previous.status === complaint.status) continue;
      if (!transitions[previous.status]?.includes(complaint.status)) {
        return { error: 'invalid_transition', id: complaint.id, from: previous.status, to: complaint.status };
      }
      const submittedHistory = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : [];
      const submittedEntry = [...submittedHistory].reverse().find(item => item && item.from === previous.status && item.to === complaint.status);
      const reason = typeof submittedEntry?.reason === 'string' ? submittedEntry.reason.trim() : '';
      const reasonRequired = complaint.status === 'closed' || complaint.status === 'cancelled' || previous.status === 'closed';
      if (!submittedEntry || (reasonRequired && !reason)) return { error: 'status_history_required', id: complaint.id };
      complaint.statusHistory = [
        ...(Array.isArray(previous.statusHistory) ? previous.statusHistory : []),
        { from: previous.status, to: complaint.status, by: req.user.username, at: now, reason }
      ];
      complaint.timeline = [
        ...(Array.isArray(previous.timeline) ? previous.timeline : []),
        { event: 'تغيير حالة الشكوى', by: req.user.username, at: now,
          detail: previous.status + ' → ' + complaint.status + (reason ? ' — ' + reason : '') }
      ];
      complaint.updated = now;
    }
    stateJson = JSON.stringify(state);
    if (Buffer.byteLength(stateJson, 'utf8') > 900 * 1024) return { error: 'state_too_large' };
    const complaintChanges=diffComplaints(previousState,state);
    const nextRevision = currentRevision + 1;
    db.prepare(`INSERT INTO app_state(id,state_json,updated_by,updated_at,revision) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=excluded.revision`)
      .run(stateJson, req.user.id, now, nextRevision);
    for(const change of complaintChanges) audit(req.user.id,change.action,'complaint',change.id,change.details);
    audit(req.user.id,'application_state_saved','application',null,{
      complaintCount:state.complaints.length,
      complaintChanges:complaintChanges.length,
      revision:nextRevision
    });
    return { conflict: false, revision: nextRevision, complaintChanges };
  });
  const result = saveState.immediate();
  if (result.conflict) return res.status(409).json({ error: 'لم يُحفظ التغيير لأن مستخدمًا آخر حفظ نسخة أحدث.', currentRevision: result.currentRevision });
  if (result.error === 'invalid_transition') return res.status(409).json({ error: 'انتقال الحالة غير مسموح من ' + result.from + ' إلى ' + result.to + '.', complaintId: result.id });
  if (result.error === 'status_history_required') return res.status(400).json({ error: 'يجب تسجيل سجل الحالة وسبب الإغلاق أو الإلغاء أو إعادة الفتح.', complaintId: result.id });
  if (result.error === 'state_too_large') return res.status(413).json({ error: 'حجم البيانات بعد إضافة سجل الحالة أكبر من الحد المسموح.' });
  const complaintChanges = result.complaintChanges;
  res.json({ saved:true, updatedAt:now, revision:result.revision, complaintChangesLogged:complaintChanges.length });
});

app.post('/api/complaints', requireAuth, requireRole('admin', 'staff'), requireCsrf, (req, res) => {
  const body = req.body || {};
  if (!validComplaint(body)) return res.status(400).json({ error: 'بيانات الشكوى غير صالحة.' });
  const id = 'SY-' + new Date().getFullYear() + '-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const complaint = {
    id, name: body.name || '', phone: body.phone || '', province: body.province, entity: body.entity || '',
    category: body.category, priority: body.priority || 'normal', status: 'new', owner: body.owner || req.user.username,
    summary: body.summary, details: body.details || '', created: now, updated: now,
    due: new Date(Date.now() + 7 * 86400000).toISOString(), notes: [],
    timeline: [{ event: 'تسجيل الشكوى', by: req.user.username, at: now, detail: 'تم الإنشاء عبر API.' }],
    referrals: [], reply: null, confidentiality: 'normal', survey: null, attachments: []
  };
  db.prepare('INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, JSON.stringify(complaint), req.user.id, now, now);
  audit(req.user.id, 'complaint_created', 'complaint', id, { source: 'api', status: 'new' });
  res.status(201).json({ complaint });
});

app.patch('/api/complaints/:id/status', requireAuth, requireRole('admin', 'staff'), requireCsrf, (req, res) => {
  const allowed = ['new', 'in_progress', 'awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'];
  const targetStatus = req.body?.status;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!allowed.includes(targetStatus)) return res.status(400).json({ error: 'حالة الشكوى غير صالحة.' });
  if (reason.length > 1000) return res.status(400).json({ error: 'سبب التغيير أطول من الحد المسموح.' });
  const transitions = {
    new: ['in_progress', 'cancelled'],
    in_progress: ['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'],
    awaiting_reply: ['in_progress', 'awaiting_approval', 'closed'],
    awaiting_approval: ['in_progress', 'closed'],
    closed: ['in_progress'],
    cancelled: []
  };
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 100) return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });

  const changeStatus = db.transaction(() => {
    const stateRow = db.prepare('SELECT state_json, revision FROM app_state WHERE id=1').get();
    let state = stateRow ? JSON.parse(stateRow.state_json) : null;
    const stateComplaint = state && Array.isArray(state.complaints) ? state.complaints.find(item => item && item.id === id) : null;
    const tableRow = db.prepare('SELECT payload_json FROM complaints WHERE id=?').get(id);
    const tableComplaint = tableRow ? JSON.parse(tableRow.payload_json) : null;
    if (!stateComplaint && !tableComplaint) return { error: 'not_found' };
    const currentStatus = stateComplaint?.status ?? tableComplaint?.status;
    if (!allowed.includes(currentStatus)) return { error: 'invalid_current_status' };
    if (stateComplaint && tableComplaint && stateComplaint.status !== tableComplaint.status) return { error: 'source_conflict' };
    if (currentStatus === targetStatus) return { error: 'same_status' };
    if (!transitions[currentStatus]?.includes(targetStatus)) return { error: 'invalid_transition', currentStatus };
    if ((targetStatus === 'closed' || targetStatus === 'cancelled' || currentStatus === 'closed') && !reason) return { error: 'reason_required' };

    const now = new Date().toISOString();
    const historyEntry = { from: currentStatus, to: targetStatus, by: req.user.username, at: now, reason };
    const updateComplaint = complaint => {
      const updated = { ...complaint, status: targetStatus, updated: now };
      updated.statusHistory = [...(Array.isArray(complaint.statusHistory) ? complaint.statusHistory : []), historyEntry];
      updated.timeline = [...(Array.isArray(complaint.timeline) ? complaint.timeline : []), {
        event: 'تغيير حالة الشكوى', by: req.user.username, at: now,
        detail: currentStatus + ' → ' + targetStatus + (reason ? ' — ' + reason : '')
      }];
      return updated;
    };
    if (stateComplaint) {
      state.complaints = state.complaints.map(item => item && item.id === id ? updateComplaint(item) : item);
      const nextRevision = (stateRow?.revision ?? 0) + 1;
      db.prepare(`INSERT INTO app_state(id,state_json,updated_by,updated_at,revision)
        VALUES(1,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=excluded.revision`)
        .run(JSON.stringify(state), req.user.id, now, nextRevision);
    }
    if (tableComplaint) db.prepare('UPDATE complaints SET payload_json=?, updated_at=? WHERE id=?').run(JSON.stringify(updateComplaint(tableComplaint)), now, id);
    audit(req.user.id, 'complaint_status_changed', 'complaint', id, { from: currentStatus, to: targetStatus, reason, source: 'status_endpoint' });
    return { complaintId: id, from: currentStatus, status: targetStatus, updatedAt: now };
  });
  let result;
  try { result = changeStatus.immediate(); }
  catch (error) {
    console.error('Complaint status update failed:', error.message);
    return res.status(500).json({ error: 'تعذر حفظ تغيير حالة الشكوى.' });
  }
  if (result.error === 'not_found') return res.status(404).json({ error: 'الشكوى غير موجودة.' });
  if (result.error === 'invalid_current_status') return res.status(409).json({ error: 'حالة الشكوى الحالية غير صالحة؛ راجع السجل قبل التعديل.' });
  if (result.error === 'source_conflict') return res.status(409).json({ error: 'يوجد تعارض بين مصادر بيانات الشكوى؛ لم يتم تغيير الحالة.' });
  if (result.error === 'same_status') return res.status(409).json({ error: 'الشكوى تحمل هذه الحالة بالفعل.' });
  if (result.error === 'invalid_transition') return res.status(409).json({ error: 'انتقال الحالة غير مسموح من ' + result.currentStatus + ' إلى ' + targetStatus + '.' });
  if (result.error === 'reason_required') return res.status(400).json({ error: 'يجب إدخال سبب عند الإغلاق أو الإلغاء أو إعادة فتح شكوى مغلقة.' });
  res.json({ ok: true, ...result });
});

app.get('/api/audit', requireAuth, requireRole('admin', 'reviewer'), (req, res) => {
  const rows = db.prepare(`SELECT id, actor_user_id, action, target_type, target_id, details_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 500`).all();
  res.json({ events: rows.map(row => ({ id: row.id, actorUserId: row.actor_user_id, action: row.action, targetType: row.target_type, targetId: row.target_id, details: JSON.parse(row.details_json), createdAt: row.created_at })) });
});

app.get('/api/sync/export', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const row = db.prepare('SELECT state_json FROM app_state WHERE id=1').get();
  const state = row ? JSON.parse(row.state_json) : {
    complaints: [], notifications: [], templates: [],
    settings: { slaDays: 7, slaApproved: false, provinces: [], entities: [], categories: [] }
  };
  const bundle = createSyncPackage(state, __dirname, sourceInstanceId);
  audit(req.user.id, 'sync_exported', 'sync', bundle.syncId, { complaintCount: state.complaints.length });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="complaints-sync-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.send(JSON.stringify(bundle));
});

app.post('/api/sync/import', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
  const payload = req.body;
  const validation = validateSyncPackage(payload);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 950 * 1024)
    return res.status(413).json({ error: 'ملف المزامنة أكبر من الحد المسموح.' });
  if (payload.sourceInstanceId === sourceInstanceId)
    return res.status(400).json({ error: 'هذا الملف صادر من النسخة الحالية.' });
  if (db.prepare("SELECT id FROM audit_events WHERE action='sync_imported' AND target_id=?").get(payload.syncId))
    return res.status(409).json({ error: 'سبق استيراد ملف المزامنة هذا.' });
  try {
    const publicKeyPath = path.resolve(process.env.UPDATE_PUBLIC_KEY_PATH || './data/trusted-update-public.pem');
    let updateTrusted = false;
    let trustedPublicKey = null;
    if (fs.existsSync(publicKeyPath)) {
      try {
        trustedPublicKey = fs.readFileSync(publicKeyPath, 'utf8');
        updateTrusted = verifyProgramUpdate(payload, trustedPublicKey);
      } catch { trustedPublicKey = null; updateTrusted = false; }
    }
    const pendingDir = updateTrusted
      ? stageProgramUpdate(payload, path.resolve(process.env.DATA_DIR || './data'), trustedPublicKey)
      : null;
    const now = new Date().toISOString();
    db.transaction(() => {
      const currentRow = db.prepare('SELECT revision FROM app_state WHERE id=1').get();
      const nextRevision = (currentRow?.revision ?? 0) + 1;
      db.prepare('INSERT INTO app_state(id,state_json,updated_by,updated_at,revision) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=excluded.revision')
        .run(JSON.stringify(payload.state), req.user.id, now, nextRevision);
      audit(req.user.id, 'sync_imported', 'sync', payload.syncId, {
        sourceInstanceId: payload.sourceInstanceId,
        complaintCount: payload.state.complaints.length,
        programUpdateStaged: Boolean(updateTrusted),
        programUpdateSignatureVerified: Boolean(updateTrusted)
      });
    })();
    res.json({
      imported: true, complaintCount: payload.state.complaints.length, updateStaged: Boolean(updateTrusted),
      ...(pendingDir ? { updatePath: path.relative(process.cwd(), pendingDir) } : {}),
      warning: updateTrusted
        ? 'استوردت البيانات؛ حزمة البرنامج موقعة بمفتاح موثوق ومحفوظة للمراجعة، ولم تُشغّل تلقائيًا.'
        : 'استوردت البيانات فقط. لم تُحفظ ملفات البرنامج للتطبيق لأن التوقيع الرقمي الموثوق غير موجود أو غير صالح.'
    });
  } catch (error) {
    console.error('Offline sync import failed:', error.message);
    res.status(500).json({ error: 'تعذر إكمال الاستيراد. راجع سجل الخادم.' });
  }
});

app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'sw.js')); });
app.get('/ui-enhancements.css', (req, res) => res.sendFile(path.join(__dirname, 'ui-enhancements.css')));
app.get('/ui-enhancements.js', (req, res) => res.sendFile(path.join(__dirname, 'ui-enhancements.js')));
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/attachments-ui-bridge.js', (req, res) => res.sendFile(path.join(__dirname, 'attachments-ui-bridge.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Request failed:', err.message);
  res.status(500).json({ error: 'حدث خطأ داخلي. راجع سجل تشغيل الخادم.' });
});

const server = app.listen(port, host, () => {
  console.log(`Complaints system listening at http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, db, server, validComplaint };
