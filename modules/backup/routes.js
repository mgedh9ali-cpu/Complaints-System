'use strict';

const express = require('express');

function createBackupRouter({ backupService, middleware, audit, rolesService, backupScheduler }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  function backupDir() {
    return backupScheduler?.status?.()?.directory ||
      backupService.defaultBackupDirectory?.() ||
      null;
  }

  router.get(
    '/backup/status',
    requireAuth,
    requirePermission('backup.database'),
    (req, res) => {
      const directory = backupDir();
      const auto = backupScheduler?.status?.() || null;
      const backups = backupService.listBackups ? backupService.listBackups(directory, 40) : [];
      res.json({ automatic: auto, directory, backups, count: backups.length });
    }
  );

  router.get(
    '/backup/history',
    requireAuth,
    requirePermission('backup.database'),
    (req, res) => {
      const directory = backupDir();
      const backups = backupService.listBackups ? backupService.listBackups(directory, 50) : [];
      res.json({ directory, backups });
    }
  );

  router.patch(
    '/backup/settings',
    requireAuth,
    requirePermission('backup.database'),
    middleware.requireCsrf,
    (req, res, next) => {
      try {
        if (!backupScheduler?.configure) {
          return res.status(400).json({ error: 'جدولة النسخ غير متاحة.' });
        }
        const { intervalMinutes, retentionDays } = req.body || {};
        const status = backupScheduler.configure({ intervalMinutes, retentionDays });
        if (typeof audit === 'function') {
          audit(req.user.id, 'backup_settings_updated', 'system', null, {
            intervalMinutes: status.intervalMinutes,
            retentionDays: status.retentionDays
          });
        }
        res.json({ ok: true, automatic: status });
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    '/backup/file',
    requireAuth,
    requirePermission('backup.database'),
    middleware.requireCsrf,
    (req, res, next) => {
      try {
        const name = (req.body && req.body.name) || req.query.name;
        const result = backupService.deleteBackup(name, backupDir());
        if (typeof audit === 'function') {
          audit(req.user.id, 'backup_file_deleted', 'database', result.deleted, {});
        }
        res.json({ ok: true, deleted: result.deleted });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/backup/verify',
    requireAuth,
    requirePermission('backup.database'),
    middleware.requireCsrf,
    async (req, res, next) => {
      try {
        const name = req.body?.name;
        const result = await backupService.verifyStoredBackup(name, backupDir());
        if (backupScheduler?.recordRestoreTest) {
          backupScheduler.recordRestoreTest({
            ok: result.ok,
            detail: result.ok ? 'اختبار استعادة ناجح' : 'فشل التحقق',
            filename: result.filename
          });
        }
        if (typeof audit === 'function') {
          audit(req.user.id, result.ok ? 'backup_restore_test_ok' : 'backup_restore_test_failed', 'database', result.filename, {
            counts: result.counts,
            attachmentCount: result.attachmentCount
          });
        }
        res.json({
          ok: result.ok,
          filename: result.filename,
          counts: result.counts,
          attachmentCount: result.attachmentCount,
          files: result.files,
          automatic: backupScheduler?.status?.() || null
        });
      } catch (error) {
        if (backupScheduler?.recordRestoreTest) {
          try {
            backupScheduler.recordRestoreTest({
              ok: false,
              detail: error.message,
              filename: req.body?.name || null
            });
          } catch (_) { /* ignore */ }
        }
        next(error);
      }
    }
  );

  router.get(
    '/backup/database',
    requireAuth,
    requirePermission('backup.database'),
    async (req, res, next) => {
      let backupDirTmp = null;
      try {
        const result = await backupService.createVerifiedBackup({ encrypt: true });
        backupDirTmp = result.backupDir;
        if (typeof audit === 'function') {
          audit(req.user.id, 'database_backup_created', 'database', result.filename, {
            format: result.encrypted ? 'sqlite.enc' : 'sqlite',
            encrypted: Boolean(result.encrypted),
            verified: true,
            counts: result.counts
          });
        }
        const contentType = result.encrypted
          ? 'application/octet-stream'
          : 'application/vnd.sqlite3';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Backup-Encrypted', result.encrypted ? '1' : '0');
        res.sendFile(result.destination, (err) => {
          backupService.cleanupBackupDir(backupDirTmp);
          if (err && !res.headersSent) next(err);
        });
      } catch (error) {
        if (backupDirTmp) backupService.cleanupBackupDir(backupDirTmp);
        next(error);
      }
    }
  );

  router.get(
    '/backup/complete',
    requireAuth,
    requirePermission('backup.database'),
    async (req, res, next) => {
      let backupDirTmp = null;
      try {
        const result = await backupService.createCompleteBackup();
        backupDirTmp = result.backupDir;
        if (typeof audit === 'function') {
          audit(req.user.id, 'complete_backup_created', 'database', result.filename, {
            format: 'csb', encrypted: true, verified: true,
            counts: result.counts, attachmentCount: result.attachmentCount
          });
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Backup-Encrypted', '1');
        res.setHeader('X-Backup-Includes-Attachments', '1');
        if (result.attachmentCount != null) {
          res.setHeader('X-Backup-Attachment-Count', String(result.attachmentCount));
        }
        res.sendFile(result.destination, (error) => {
          backupService.cleanupBackupDir(backupDirTmp);
          if (error && !res.headersSent) next(error);
        });
      } catch (error) {
        if (backupDirTmp) backupService.cleanupBackupDir(backupDirTmp);
        next(error);
      }
    }
  );

  return router;
}

module.exports = { createBackupRouter };
