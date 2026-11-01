'use strict';

const express = require('express');

function createBackupRouter({ backupService, middleware, audit, rolesService }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get(
    '/backup/database',
    requireAuth,
    requirePermission('backup.database'),
    async (req, res, next) => {
      let backupDir = null;
      try {
        const result = await backupService.createVerifiedBackup({ encrypt: true });
        backupDir = result.backupDir;
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
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="' + result.filename + '"'
        );
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Backup-Encrypted', result.encrypted ? '1' : '0');
        res.sendFile(result.destination, (err) => {
          backupService.cleanupBackupDir(backupDir);
          if (err && !res.headersSent) next(err);
        });
      } catch (error) {
        if (backupDir) backupService.cleanupBackupDir(backupDir);
        next(error);
      }
    }
  );

  router.get(
    '/backup/complete',
    requireAuth,
    requirePermission('backup.database'),
    async (req, res, next) => {
      let backupDir = null;
      try {
        const result = await backupService.createCompleteBackup();
        backupDir = result.backupDir;
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
        res.sendFile(result.destination, (error) => {
          backupService.cleanupBackupDir(backupDir);
          if (error && !res.headersSent) next(error);
        });
      } catch (error) {
        if (backupDir) backupService.cleanupBackupDir(backupDir);
        next(error);
      }
    }
  );

  return router;
}

module.exports = { createBackupRouter };
