'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');

const { loadEnv } = require('./config/env');
const { openDatabase } = require('./config/db');
const { createSessionMiddleware } = require('./config/session');
const { createHelmetMiddleware } = require('./config/security');
const { requireLocalHost } = require('./lib/local-origin');
const { logger } = require('./lib/logger');
const { lockDownDir, lockDownFile, lockDownDataTree } = require('./lib/data-protection');
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
const { createApprovalsService } = require('./modules/approvals/service');
const { createApprovalsRouter } = require('./modules/approvals/routes');
const { createBackupScheduler } = require('./modules/backup/scheduler');

const env = loadEnv();
const app = express();

const dataRoot = path.dirname(path.resolve(env.databasePath));
lockDownDataTree(dataRoot);
lockDownDir(env.sessionsDir);

process.env.DATA_KEY = env.storageKey;
const db = openDatabase(env.databasePath, { storageKey: env.storageKey });
require('./lib/attachments').protectLegacyAttachments();
lockDownFile(env.databasePath);

const auditService = createAuditService({ db, logger, databasePath: env.databasePath });
if (!auditService.verifyChain().ok) throw new Error('Audit integrity verification failed; restore a verified complete backup.');
const audit = (actorUserId, action, targetType, targetId = null, details = {}) =>
  auditService.record(actorUserId, action, targetType, targetId, details);
audit.syncHead = () => auditService.syncHead();

const authService = createAuthService({
  db,
  audit,
  logger,
  sessionsDir: env.sessionsDir
});
authService.ensureBootstrapAdmin(env.adminUsername, env.adminPassword);

const middleware = createAuthMiddleware({ db, audit });
const { ensureCsrfToken } = middleware;

const rolesService = createRolesService({ db });
const complaintsService = createComplaintsService({ db, audit, logger, rolesService });
const dashboardService = createDashboardService({ complaintsService });
const attachmentsService = createAttachmentsService({ db });
const approvalsService = createApprovalsService({ db, audit, complaintsService, attachmentsService });
const reportsService = createReportsService({ complaintsService });
const settingsService = createSettingsService({ complaintsService });
const backupService = createBackupService({
  databasePath: env.databasePath,
  sessionSecret: env.backupSecret || env.sessionSecret
});
const backupScheduler = createBackupScheduler({ backupService,
  directory: path.resolve(process.env.BACKUP_DIR || path.join(dataRoot, 'backups')), logger });
const healthService = createHealthService({
  db,
  databasePath: env.databasePath,
  version: env.version
  , backupScheduler
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
  dataDir: dataRoot,
  rootDir: path.resolve('.')
});

app.disable('x-powered-by');
app.use(requireLocalHost(env.port));
app.use(createHelmetMiddleware());
app.use(express.json({ limit: '16mb', strict: true }));
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
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', createAuthRouter({ authService, middleware, audit, rolesService }));
app.use('/api', createRolesRouter({ rolesService, middleware }));
app.use('/api', createApprovalsRouter({ approvalsService, middleware, rolesService }));
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
    complaintsService,
    db
  })
);
app.use('/api', createReportsRouter({ reportsService, middleware, audit, rolesService }));
app.use('/api', createSettingsRouter({ settingsService, middleware, audit, logger, rolesService }));
app.use('/api', createBackupRouter({ backupService, middleware, audit, rolesService }));
app.use('/api', createAuditRouter({ auditService, middleware, rolesService }));
app.use('/api', createSyncRouter({ syncService, middleware, auditService, rolesService, backupService, complaintsService }));

const {assembleUiBundle}=require('./lib/ui-bundle');
app.get('/app.bundle.js',(req,res)=>{
 try{
  const bundled=assembleUiBundle();
  res.type('application/javascript');
  res.setHeader('Cache-Control','no-store');
  res.send(bundled);
 }catch(error){
  logger.error('Modular UI bundle failed',{message:error.message});
  res.status(500).type('text/plain').send('تعذر تحميل واجهة النظام.');
 }
});

const PUBLIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/ui-enhancements.css': 'ui-enhancements.css',
  '/redesign.css': 'redesign.css',
  '/fallback-font.css': 'fallback-font.css',
  '/assets/NotoSansArabic.ttf': 'assets/NotoSansArabic.ttf',
  '/ui-enhancements.js': 'ui-enhancements.js',
  '/thmanyah-fonts.css': 'thmanyah-fonts.css',
  '/attachments-ui-bridge.js': 'attachments-ui-bridge.js',
  '/app.js': 'app.js',
  '/manifest.json': 'manifest.json',
  '/sw.js': 'sw.js',
  '/sw-register.js': 'sw-register.js'
};

app.get(Object.keys(PUBLIC_FILES), (req, res, next) => {
  const rel = PUBLIC_FILES[req.path];
  if (!rel) return next();
  const full = path.join(__dirname, rel);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});


app.use((err, req, res, next) => {
  logger.requestError(err, req);
  if (res.headersSent) return next(err);
  const status = err.type === 'entity.too.large' ? 413 :
    err.type === 'entity.parse.failed' || err.name === 'MulterError' ? 400 : 500;
  res.status(status).json({ error: status === 413 ? 'حجم الطلب أكبر من المسموح.' :
    status === 400 ? 'بيانات الطلب أو المرفقات غير صالحة.' : 'خطأ داخلي في الخادم.' });
});

app.listen(env.port, env.host, () => {
  backupScheduler.start();
  const reminders = setInterval(() => {
    try { complaintsService.runReminders(); } catch (error) { logger.error('Reminder processing failed', { message: error.message }); }
  }, 60000);
  reminders.unref();
  logger.info('server listening', { host: env.host, port: env.port, version: env.version });
  console.log(
    `Complaints system listening on http://${env.host}:${env.port} (v${env.version})`
  );
});
