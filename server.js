'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');

const { loadEnv } = require('./config/env');
const { openDatabase } = require('./config/db');
const { createSessionMiddleware } = require('./config/session');
const { createHelmetMiddleware } = require('./config/security');
const { logger } = require('./lib/logger');
const { lockDownDir, lockDownFile, lockDownDataTree } = require('./lib/data-protection');
const { ensureThmanyahFonts } = require('./scripts/ensure-thmanyah-font');

try {
  const fontResult = ensureThmanyahFonts(path.resolve(__dirname));
  if (fontResult.written) {
    logger.info('Thmanyah fonts materialized', fontResult);
  }
} catch (err) {
  try {
    logger.warn('Thmanyah font ensure failed', { message: err.message });
  } catch (_) {}
}

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
const { validComplaint } = require('./lib/validation');
const { diffComplaints } = require('./lib/complaint-state-diff');

const env = loadEnv();
const app = express();

const dataRoot = path.dirname(path.resolve(env.databasePath));
lockDownDataTree(dataRoot);
lockDownDir(env.sessionsDir);

const db = openDatabase(env.databasePath);
lockDownFile(env.databasePath);

const auditService = createAuditService({ db, logger });
const audit = (actorUserId, action, targetType, targetId = null, details = {}) =>
  auditService.record(actorUserId, action, targetType, targetId, details);

const authService = createAuthService({
  db,
  audit,
  logger,
  sessionsDir: env.sessionsDir
});
authService.ensureBootstrapAdmin(env.adminUsername, env.adminPassword);

const middleware = createAuthMiddleware({ db, audit });
const { ensureCsrfToken } = middleware;

const rolesService = createRolesService();
const complaintsService = createComplaintsService({ db, audit, logger });
const dashboardService = createDashboardService({ complaintsService });
const attachmentsService = createAttachmentsService();
const reportsService = createReportsService({ complaintsService });
const settingsService = createSettingsService({ complaintsService });
const backupService = createBackupService({
  databasePath: env.databasePath,
  sessionSecret: env.backupSecret || env.sessionSecret
});
const healthService = createHealthService({
  db,
  databasePath: env.databasePath,
  version: env.version
});

fs.mkdirSync(path.dirname(env.instanceIdPath), { recursive: true });
if (!fs.existsSync(env.instanceIdPath)) {
  fs.writeFileSync(env.instanceIdPath, crypto.randomUUID() + '\n', {
    flag: 'wx',
    mode: 0o600
  });
}
lockDownFile(env.instanceIdPath);
const sourceInstanceId = fs.readFileSync(env.instanceIdPath, 'utf8').trim();

const syncService = createSyncService({
  complaintsService,
  auditService,
  db,
  sourceInstanceId,
  rootDir: path.resolve('.')
});

app.disable('x-powered-by');
app.use(createHelmetMiddleware());
app.use(express.json({ limit: '1mb', strict: true }));
app.use(
  createSessionMiddleware({
    sessionSecret: env.sessionSecret,
    sessionsDir: env.sessionsDir,
    cookieSecure: env.cookieSecure
  })
);
app.use(ensureCsrfToken);

app.use((req, res, next) => {
  const p = (req.path || '').toLowerCase();
  if (
    p.includes('/data/') ||
    p.startsWith('/data') ||
    p.includes('.sqlite') ||
    p.includes('.env') ||
    p.includes('/sessions') ||
    p.includes('node_modules') ||
    p.includes('/modules/') ||
    p.includes('/config/') ||
    p.includes('/scripts/') ||
    p.endsWith('.md')
  ) {
    return res.status(404).end();
  }
  next();
});

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
    const fullPath = path.join(__dirname, 'app.full.js');
    if (!fs.existsSync(fullPath)) throw new Error('app.full.js missing');
    const fullContent = fs.readFileSync(fullPath, 'utf8');
    if (
      fullContent.length < 10000 ||
      !fullContent.includes("'use strict'") ||
      !fullContent.includes('STORAGE_KEY')
    ) {
      throw new Error('app.full.js incomplete or corrupt');
    }
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fullContent);
  } catch (error) {
    logger.error('UI bundle load failed', { message: error.message });
    res.status(500).type('text/plain').send('تعذر تحميل واجهة النظام.');
  }
});

const PUBLIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/ui-enhancements.css': 'ui-enhancements.css',
  '/ui-enhancements.js': 'ui-enhancements.js',
  '/thmanyah-fonts.css': 'thmanyah-fonts.css',
  '/attachments-ui-bridge.js': 'attachments-ui-bridge.js',
  '/app.js': 'app.js',
  '/manifest.json': 'manifest.json',
  '/sw.js': 'sw.js'
};

app.get(Object.keys(PUBLIC_FILES), (req, res, next) => {
  const rel = PUBLIC_FILES[req.path];
  if (!rel) return next();
  const full = path.join(__dirname, rel);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

app.use(
  '/fonts',
  express.static(path.join(__dirname, 'fonts'), {
    dotfiles: 'deny',
    index: false,
    fallthrough: false
  })
);

app.use((err, req, res, next) => {
  logger.requestError(err, req);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم.' });
});

app.listen(env.port, env.host, () => {
  logger.info('server listening', { host: env.host, port: env.port, version: env.version });
  console.log(
    `Complaints system listening on http://${env.host}:${env.port} (v${env.version})`
  );
});
