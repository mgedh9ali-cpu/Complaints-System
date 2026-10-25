'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { rateLimit } = require('express-rate-limit');

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
    updated_at TEXT NOT NULL
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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb', strict: true }));
app.use(session({
  name: 'complaints.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'تم تجاوز عدد محاولات الدخول. حاول لاحقًا.' }
});

function audit(actorUserId, action, targetType, targetId = null, details = {}) {
  db.prepare(`INSERT INTO audit_events
    (id, actor_user_id, action, target_type, target_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), actorUserId || null, action, targetType, targetId,
      JSON.stringify(details), new Date().toISOString());
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

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'sqlite', mode: 'local' }));

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

app.get('/api/state', requireAuth, (req, res) => {
  const row=db.prepare('SELECT state_json, updated_at FROM app_state WHERE id=1').get();
  res.json({state:row?JSON.parse(row.state_json):null,updatedAt:row?.updated_at||null});
});

app.put('/api/state', requireAuth, requireRole('admin','staff'), (req, res) => {
  const state=req.body;
  if(!state||typeof state!=='object'||Array.isArray(state)||
     !Array.isArray(state.complaints)||state.complaints.length>5000||
     !Array.isArray(state.notifications)||!Array.isArray(state.templates)||
     !state.settings||typeof state.settings!=='object'||Array.isArray(state.settings)){
    return res.status(400).json({error:'بنية البيانات المرسلة غير صالحة.'});
  }
  const stateJson=JSON.stringify(state);
  if(Buffer.byteLength(stateJson,'utf8')>900*1024)return res.status(413).json({error:'حجم البيانات أكبر من الحد المسموح.'});
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO app_state(id,state_json,updated_by,updated_at) VALUES(1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(stateJson,req.user.id,now);
  audit(req.user.id,'application_state_saved','application',null,{complaintCount:state.complaints.length});
  res.json({saved:true,updatedAt:now});
});


const { createSyncPackage, validateSyncPackage, stageProgramUpdate } = require('./lib/offline-sync');
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

app.post('/api/sync/import', requireAuth, requireRole('admin'), (req, res) => {
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
    const pendingDir = stageProgramUpdate(payload, path.resolve(process.env.DATA_DIR || './data'));
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('INSERT INTO app_state(id,state_json,updated_by,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
        .run(JSON.stringify(payload.state), req.user.id, now);
      audit(req.user.id, 'sync_imported', 'sync', payload.syncId, {
        sourceInstanceId: payload.sourceInstanceId,
        complaintCount: payload.state.complaints.length,
        programUpdateStaged: true
      });
    })();
    res.json({
      imported: true, complaintCount: payload.state.complaints.length, updateStaged: true,
      updatePath: path.relative(process.cwd(), pendingDir),
      warning: 'استوردت البيانات؛ حزمة البرنامج محفوظة للمراجعة ولم تُشغّل تلقائيًا.'
    });
  } catch (error) {
    console.error('Offline sync import failed:', error.message);
    res.status(500).json({ error: 'تعذر إكمال الاستيراد. راجع سجل الخادم.' });
  }
});

app.get('/api/complaints', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, payload_json, created_at, updated_at FROM complaints ORDER BY updated_at DESC').all();
  res.json({ complaints: rows.map(row => ({
    ...JSON.parse(row.payload_json), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at
  })) });
});

app.post('/api/complaints', requireAuth, (req, res) => {
  if (!validComplaint(req.body)) return res.status(400).json({ error: 'بيانات الشكوى غير مكتملة أو غير صالحة.' });
  const now = new Date().toISOString();
  const id = `CMP-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const payload = {
    summary: req.body.summary.trim(),
    province: req.body.province.trim(),
    category: req.body.category.trim(),
    details: typeof req.body.details === 'string' ? req.body.details.trim() : '',
    phone: typeof req.body.phone === 'string' ? req.body.phone.trim() : '',
    status: 'new'
  };
  const save = db.transaction(() => {
    db.prepare('INSERT INTO complaints(id, payload_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, JSON.stringify(payload), req.user.id, now, now);
    audit(req.user.id, 'complaint_created', 'complaint', id, { status: 'new' });
  });
  save();
  res.status(201).json({ complaint: { ...payload, id, createdAt: now, updatedAt: now } });
});

app.patch('/api/complaints/:id/status', requireAuth, (req, res) => {
  const allowed = ['new', 'in_progress', 'awaiting_reply', 'awaiting_approval', 'closed'];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'حالة الشكوى غير صالحة.' });
  const row = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الشكوى غير موجودة.' });
  const previous = JSON.parse(row.payload_json);
  const next = { ...previous, status: req.body.status };
  const now = new Date().toISOString();
  const save = db.transaction(() => {
    db.prepare('UPDATE complaints SET payload_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next), now, req.params.id);
    audit(req.user.id, 'complaint_status_changed', 'complaint', req.params.id, {
      from: previous.status || 'new', to: req.body.status
    });
  });
  save();
  res.json({ complaint: { ...next, id: req.params.id, updatedAt: now } });
});

app.get('/api/audit', requireAuth, requireRole('admin', 'reviewer'), (req, res) => {
  const rows = db.prepare(`SELECT id, actor_user_id, action, target_type, target_id, details_json, created_at
    FROM audit_events ORDER BY created_at DESC LIMIT 500`).all();
  res.json({ events: rows.map(row => ({
    id: row.id, actorUserId: row.actor_user_id, action: row.action,
    targetType: row.target_type, targetId: row.target_id,
    details: JSON.parse(row.details_json), createdAt: row.created_at
  })) });
});

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
