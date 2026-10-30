'use strict';

const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const Database = require('better-sqlite3');
const { hashAuditEvent } = require('./lib/audit-integrity');
const { logger } = require('./lib/logger');

const { createAuthService } = require('./modules/auth/service');
const { createAuthMiddleware } = require('./modules/auth/middleware');
const { createAuthRouter } = require('./modules/auth/routes');
const { createRolesService } = require('./modules/roles/service');
const { createRolesRouter } = require('./modules/roles/routes');
const { createComplaintsService } = require('./modules/complaints/service');
const { createComplaintsRouter } = require('./modules/complaints/routes');
const { createDashboardService } = require('./modules/dashboard/service');
const { createDashboardRouter } = require('./modules/dashboard/routes');
const { createAttachmentsService } = require('./modules/attachments/service');
const { createAttachmentsRouter } = require('./modules/attachments/routes');
const { createReportsService } = require('./modules/reports/service');
const { createReportsRouter } = require('./modules/reports/routes');
const { createSettingsService } = require('./modules/settings/service');
const { createSettingsRouter } = require('./modules/settings/routes');
const { createBackupService } = require('./modules/backup/service');
const { createBackupRouter } = require('./modules/backup/routes');
const { createAuditService } = require('./modules/audit/service');
const { createAuditRouter } = require('./modules/audit/routes');
const { createSyncService } = require('./modules/sync/service');
const { createSyncRouter } = require('./modules/sync/routes');
const { createHealthService } = require('./modules/health/service');
const { createHealthRouter } = require('./modules/health/routes');

const APP_VERSION = '0.7.1';

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
const sessionsDir = path.resolve('./data/sessions');
fs.mkdirSync(sessionsDir, { recursive: true });

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
if (process.env.ALLOW_LAN === 'true' || (process.env.HOST && !['127.0.0.1', 'localhost'].includes(process.env.HOST))) {
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

const appStateColumns = new Set(db.prepare('PRAGMA table_info(app_state)').all().map((row) => row.name));
if (!appStateColumns.has('revision')) {
  db.exec('ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)');
}

const auditColumns = new Set(db.prepare('PRAGMA table_info(audit_events)').all().map((row) => row.name));
const auditChainNeedsMigration = !auditColumns.has('previous_hash') || !auditColumns.has('event_hash');
if (!auditColumns.has('previous_hash')) db.exec('ALTER TABLE audit_events ADD COLUMN previous_hash TEXT');
if (!auditColumns.has('event_hash')) db.exec('ALTER TABLE audit_events ADD COLUMN event_hash TEXT');
if (auditChainNeedsMigration) {
  const migrateAuditChain = db.transaction(() => {
    let previousHash = null;
    const rows = db
      .prepare(
        `SELECT rowid AS _rowid, id, actor_user_id, action, target_type, target_id,
                details_json, created_at FROM audit_events ORDER BY rowid ASC`
      )
      .all();
    const update = db.prepare('UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE rowid = ?');
    for (const row of rows) {
      const eventHash = hashAuditEvent(row, previousHash);
      update.run(previousHash, eventHash, row._rowid);
      previousHash = eventHash;
    }
  });
  migrateAuditChain();
}

const auditService = createAuditService({ db, logger });
const audit = (actorUserId, action, targetType, targetId = null, details = {}) =>
  auditService.record(actorUserId, action, targetType, targetId, details);

const authService = createAuthService({ db, audit, logger, sessionsDir });
authService.ensureBootstrapAdmin(adminUsername, adminPassword);

const middleware = createAuthMiddleware({ db });
const { ensureCsrfToken } = middleware;

const rolesService = createRolesService();
const complaintsService = createComplaintsService({ db, audit, logger });
const dashboardService = createDashboardService({ complaintsService });
const attachmentsService = createAttachmentsService();
const reportsService = createReportsService({ complaintsService });
const settingsService = createSettingsService({ complaintsService });
const backupService = createBackupService({ databasePath });
const healthService = createHealthService({ db, databasePath, version: APP_VERSION });

const instanceIdPath = path.resolve(process.env.INSTANCE_ID_PATH || './data/instance-id');
fs.mkdirSync(path.dirname(instanceIdPath), { recursive: true });
if (!fs.existsSync(instanceIdPath)) fs.writeFileSync(instanceIdPath, crypto.randomUUID() + '\n', { flag: 'wx' });
const sourceInstanceId = fs.readFileSync(instanceIdPath, 'utf8').trim();

const syncService = createSyncService({
  complaintsService,
  auditService,
  db,
  sourceInstanceId,
  rootDir: path.resolve('.')
});

app.disable('x-powered-by');
app.use(
  helmet({
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
  })
);
app.use(express.json({ limit: '1mb', strict: true }));

const FileStore = require('session-file-store')(session);
app.use(
  session({
    name: 'complaints.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new FileStore({ path: sessionsDir, ttl: 30 * 60, retries: 1, logFn: function () {} }),
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 30 * 60 * 1000
    }
  })
);
app.use(ensureCsrfToken);

const { validComplaint } = require('./lib/validation');
const { diffComplaints } = require('./lib/complaint-state-diff');

app.use('/api', createHealthRouter({ healthService, middleware }));
app.use('/api', createAuthRouter({ authService, middleware, audit }));
app.use('/api', createRolesRouter({ rolesService, middleware }));
app.use(
  '/api',
  createComplaintsRouter({
    complaintsService,
    middleware,
    audit,
    logger,
    validComplaint,
    diffComplaints,
    db,
    rolesService
  })
);
app.use('/api', createDashboardRouter({ dashboardService, middleware, rolesService }));
app.use(
  '/api',
  createAttachmentsRouter({
    attachmentsService,
    middleware,
    audit,
    rolesService,
    complaintsService
  })
);
app.use('/api', createReportsRouter({ reportsService, middleware, audit, rolesService }));
app.use('/api', createSettingsRouter({ settingsService, middleware, audit, logger, rolesService }));
app.use('/api', createBackupRouter({ backupService, middleware, audit, rolesService }));
app.use('/api', createAuditRouter({ auditService, middleware, rolesService }));
app.use('/api', createSyncRouter({ syncService, middleware, auditService, rolesService }));

app.get('/app.bundle.js', (req, res) => {
  try {
    // 1. Prefer single healthy full file (app.full.js)
    const fullPath = path.join(__dirname, 'app.full.js');
    if (fs.existsSync(fullPath)) {
      const fullContent = fs.readFileSync(fullPath, 'utf8');
      if (fullContent.length > 10000 && fullContent.includes("'use strict'") && fullContent.includes('STORAGE_KEY')) {
        res.type('application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(fullContent);
      }
    }

    // 2. Assemble sequential plain parts app-p01.js, app-p02.js, ...
    const parts = [];
    for (let i = 1; ; i += 1) {
      const partPath = path.join(__dirname, `app-p${String(i).padStart(2, '0')}.js`);
      if (!fs.existsSync(partPath)) break;
      parts.push(fs.readFileSync(partPath, 'utf8'));
    }
    if (parts.length) {
      const source = parts.join('');
      if (source.length > 10000) {
        res.type('application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(source);
      }
    }

    // 3. Fallback: gz base64 chunks (legacy)
    const gzParts = [];
    for (let index = 0; ; index += 1) {
      const gzPath = path.join(__dirname, `app-ui-gz-${index}.txt`);
      if (!fs.existsSync(gzPath)) break;
      gzParts.push(fs.readFileSync(gzPath, 'utf8'));
    }
    if (!gzParts.length) throw new Error('no UI source found (full/parts/gz)');
    const compressed = Buffer.from(gzParts.join('').replace(/\s+/g, ''), 'base64');
    const source = zlib.gunzipSync(compressed).toString('utf8');
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(source);
  } catch (error) {
    logger.error('UI bundle assembly failed', { message: error.message });
    res.status(500).type('text/plain').send('تعذر تحميل واجهة النظام.');
  }
});

app.use(express.static(path.resolve('.'), { index: 'index.html', extensions: ['html'] }));

app.use((err, req, res, next) => {
  logger.requestError(err, req);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم.' });
});

app.listen(port, host, () => {
  logger.info('server listening', { host, port, version: APP_VERSION });
  console.log(`Complaints system listening on http://${host}:${port} (v${APP_VERSION})`);
});
