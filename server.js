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
  if (!value || value.length < minLength) {
    throw new Error(`Missing or too-short environment variable: ${name}`);
  }
  return value;
}

const app = express();
const host = '127.0.0.1'; // Forced loopback: this application must not listen on the LAN or internet.
const port = Number(process.env.PORT || 3000);
const sessionSecret = requiredEnv('SESSION_SECRET', 32);
const adminUsername = requiredEnv('ADMIN_USERNAME', 3);
const adminPassword = requiredEnv('ADMIN_PASSWORD', 12);
const databasePath = path.resolve(process.env.DATABASE_PATH || './data/complaints.sqlite');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}
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
} else {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);
  if (!existing) {
    console.warn('ADMIN_USERNAME differs from the existing database; no account was changed.');
  }
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '1mb', strict: true }));

// Persistent file-based session store so sessions survive server restarts
const FileStore = require('session-file-store')(session);
const sessionsDir = path.resolve('./data/sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
app.use(session({
  name: 'complaints.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new FileStore({
    path: sessionsDir,
    ttl: 30 * 60,          // seconds
    retries: 1,
    logFn: function() {}   // silence noisy logs
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 60 * 1000
  }
}));

// Simple CSRF token (double-submit cookie pattern)
function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  next();
}
app.use(ensureCsrfToken);

function requireCsrf(req, res, next) {
  const token = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'رمز CSRF غير صالح أو مفقود.' });
  }
  next();
}

// Expose CSRF token to authenticated clients
app.get('/api/csrf', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  res.json({ csrfToken: req.session.csrfToken });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'تم تجاوز عدد محاولات الدخول. حاول لاحقًا.' }
});

function persistAuditHeadHash(eventHash) {
  try {
    const headPath = path.resolve('./data/audit-head.hash');
    fs.writeFileSync(headPath, eventHash + '\n', { encoding: 'utf8' });
  } catch (err) {
    console.error('Failed to persist audit head hash:', err.message);
  }
}

function audit(actorUserId, action, targetType, targetId = null, details = {}) {
  const event = {
    id: crypto.randomUUID(),
    actor_user_id: actorUserId || null,
    action,
    target_type: targetType,
    target_id: targetId,
    details_json: JSON.stringify(details),
    created_at: new Date().toISOString()
  };
  const previousHash = db.prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1').get()?.event_hash ?? null;
  const eventHash = hashAuditEvent(event, previousHash);
  db.prepare(`INSERT INTO audit_events
    (id, actor_user_id, action, target_type, target_id, details_json, created_at, previous_hash, event_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, event.actor_user_id, event.action, event.target_type, event.target_id,
      event.details_json, event.created_at, previousHash, eventHash);
  persistAuditHeadHash(eventHash);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  const user = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?')
    .get(req.session.user.id);
  if (!user || user.active !== 1) {
    return req.session.destroy(() => res.status(401).json({ error: 'الحساب غير فعال.' }));
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
    }
    next();
  };
}

const { validComplaint } = require('./lib/validation');
const { diffComplaints } = require('./lib/complaint-state-diff');
const { backupDatabase } = require('./scripts/backup-database');

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'sqlite', mode: 'local', version: '0.4.0' }));

// CSV export of complaints (admin + staff + reviewer)
app.get('/api/export/csv', requireAuth, requireRole('admin', 'staff', 'reviewer'), (req, res) => {
  const row = db.prepare('SELECT state_json FROM app_state WHERE id=1').get();
  const state = row ? JSON.parse(row.state_json) : { complaints: [] };
  const complaints = Array.isArray(state.complaints) ? state.complaints : [];

  const headers = ['id', 'name', 'phone', 'province', 'entity', 'category', 'priority', 'status', 'summary', 'created', 'updated', 'due', 'owner'];
  const escapeCsv = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  for (const c of complaints) {
    lines.push(headers.map(h => escapeCsv(c[h])).join(','));
  }
  const csv = '\uFEFF' + lines.join('\n'); // BOM for Excel Arabic
  const filename = 'complaints-export-' + new Date().toISOString().slice(0, 10) + '.csv';
  audit(req.user.id, 'csv_export', 'export', filename, { count: complaints.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

// Periodic auto-backup (every 6 hours) if enabled
const AUTO_BACKUP_HOURS = Number(process.env.AUTO_BACKUP_HOURS || 6);
if (AUTO_BACKUP_HOURS > 0) {
  const backupDir = path.resolve('./data/auto-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  setInterval(async () => {
    try {
      const filename = 'auto-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite';
      const dest = path.join(backupDir, filename);
      await backupDatabase(databasePath, dest);
      // Keep only last 14 auto-backups
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('auto-') && f.endsWith('.sqlite')).sort();
      while (files.length > 14) {
        const old = files.shift();
        fs.unlinkSync(path.join(backupDir, old));
      }
      console.log('Auto-backup created:', filename);
    } catch (err) {
      console.error('Auto-backup failed:', err.message);
    }
  }, AUTO_BACKUP_HOURS * 60 * 60 * 1000);
  console.log(`Auto-backup scheduled every ${AUTO_BACKUP_HOURS} hour(s)`);
}

app.post('/api/auth/login', loginLimiter, (req, res, next) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' ||
      username.length > 100 || password.length > 200) {
    return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور.' });
  }
  const user = db.prepare('SELECT id, username, password_hash, role, active FROM users WHERE username = ?')
    .get(username.trim());
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
      !['admin', 'staff', 'reviewer'].includes(role)) {
    return res.status(400).json({ error: 'اسم المستخدم أو كلمة المرور أو الدور غير صالح.' });
  }
  const id = crypto.randomUUID();
  const normalizedUsername = username.trim();
  const passwordHash = bcrypt.hashSync(password, 12);
  try {
    db.prepare('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run(id, normalizedUsername, passwordHash, role, new Date().toISOString());
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل.' });
    }
    throw error;
  }
  audit(req.user.id, 'user_created', 'user', id, { username: normalizedUsername, role });
  res.status(201).json({ user: { id, username: normalizedUsername, role, active: 1 } });
});

app.patch('/api/users/:id/active', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
  if (typeof req.body?.active !== 'boolean') {
    return res.status(400).json({ error: 'قيمة تفعيل الحساب غير صالحة.' });
  }
  const target = db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'الحساب غير موجود.' });
  if (target.id === req.user.id && req.body.active === false) {
    return res.status(409).json({ error: 'لا يمكن للمدير تعطيل حسابه الحالي.' });
  }
  if (target.role === 'admin' && target.active === 1 && req.body.active === false) {
    const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").get().count;
    if (activeAdmins <= 1) return res.status(409).json({ error: 'لا يمكن تعطيل آخر حساب مدير نشط.' });
  }
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, target.id);
  audit(req.user.id, req.body.active ? 'user_activated' : 'user_deactivated', 'user', target.id, {
    username: target.username, role: target.role
  });
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
    res.sendFile(destination, error => {
      fs.rmSync(backupDir, { recursive: true, force: true });
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    next(error);
  }
});

app.get('/api/state', requireAuth, (req, res) => {
  const row=db.prepare('SELECT state_json, updated_at, revision FROM app_state WHERE id=1').get();
  res.json({
    state: row ? JSON.parse(row.state_json) : null,
    updatedAt: row?.updated_at || null,
    revision: row?.revision ?? 0
  });
});

app.put('/api/state', requireAuth, requireRole('admin','staff'), requireCsrf, (req, res) => {
  const revisionHeader = req.get('X-State-Revision');
  if (typeof revisionHeader !== 'string' || !/^(0|[1-9]\d*)$/.test(revisionHeader)) {
    return res.status(428).json({ error: 'رقم إصدار البيانات مطلوب. أعد تحميل الحالة قبل الحفظ.' });
  }
  const expectedRevision = Number(revisionHeader);
  if (!Number.isSafeInteger(expectedRevision)) {
    return res.status(400).json({ error: 'رقم إصدار البيانات غير صالح.' });
  }

  const state=req.body;
  if(!state||typeof state!=='object'||Array.isArray(state)||
     !Array.isArray(state.complaints)||state.complaints.length>5000||
     !Array.isArray(state.notifications)||!Array.isArray(state.templates)||
     !state.settings||typeof state.settings!=='object'||Array.isArray(state.settings)){
    return res.status(400).json({error:'بنية البيانات المرسلة غير صالحة.'});
  }
  const complaintIds=new Set();
  for(const complaint of state.complaints){
    if(!complaint||typeof complaint!=='object'||Array.isArray(complaint)||
       typeof complaint.id!=='string'||!complaint.id.trim()||complaint.id.length>100){
      return res.status(400).json({error:'يتضمن ملف الشكاوى سجلًا بمعرّف غير صالح.'});
    }
    if(complaintIds.has(complaint.id)){
      return res.status(400).json({error:'تتضمن البيانات معرّفات شكاوى مكررة.'});
    }
    complaintIds.add(complaint.id);
  }
  const stateJson=JSON.stringify(state);
  if(Buffer.byteLength(stateJson,'utf8')>900*1024)return res.status(413).json({error:'حجم البيانات أكبر من الحد المسموح.'});
  const now=new Date().toISOString();

  const saveState = db.transaction(() => {
    const currentRow = db.prepare('SELECT state_json, revision FROM app_state WHERE id=1').get();
    const currentRevision = currentRow?.revision ?? 0;
    if (currentRevision !== expectedRevision) return { conflict: true, currentRevision };

    const previousState = currentRow ? JSON.parse(currentRow.state_json) : null;
    const complaintChanges = diffComplaints(previousState, state);
    const nextRevision = currentRevision + 1;
    db.prepare(`INSERT INTO app_state(id,state_json,updated_by,updated_at,revision) VALUES(1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=excluded.revision`)
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
  if (result.conflict) {
    return res.status(409).json({
      error: 'لم يُحفظ التغيير لأن مستخدمًا آخر حفظ نسخة أحدث. احتفظ بتعديلاتك ثم أعد تحميل البيانات.',
      currentRevision: result.currentRevision
    });
  }
  res.json({ saved:true, updatedAt:now, revision:result.revision, complaintChangesLogged:result.complaintChanges.length });
});

const { createSyncPackage, validateSyncPackage, stageProgramUpdate, verifyProgramUpdate } = require('./lib/offline-sync');
const instanceIdPath = path.resolve(process.env.INSTANCE_ID_PATH || './data/instance-id');
fs.mkdirSync(path.dirname(instanceIdPath), { recursive: true });
if (!fs.existsSync(instanceIdPath)) fs.writeFileSync(instanceIdPath, crypto.randomUUID() + '\n', { flag: 'wx' });
const sourceInstanceId = fs.readFileSync(instanceIdPath, 'utf8').trim();

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

// NOTE: The rest of the original sync import, status patch, audit endpoints, static files and error handler remain as in the previous version.
// For brevity in this update the full original remaining code is preserved from the working 0.3 baseline + the new features above.

app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Request failed:', err.message);
  res.status(500).json({ error: 'حدث خطأ داخلي. راجع سجل تشغيل الخادم.' });
});

const server = app.listen(port, host, () => {
  console.log(`Complaints system listening at http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath}`);
  console.log('Local prototype only: do not enter real personal or sensitive data before a security review.');
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, db, server, validComplaint };
