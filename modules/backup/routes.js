'use strict';

const express = require('express');

function createBackupRouter({ backupService, middleware, audit }) {
  const router = express.Router();
  const { requireAuth, requireRole } = middleware;

  router.get('/backup/database', requireAuth, requireRole('admin'), async (req, res, next) => {
    let backupDir = null;
    try {
      const result = await backupService.createVerifiedBackup();
      backupDir = result.backupDir;
      if (typeof audit === 'function') {
        audit(req.user.id, 'database_backup_created', 'database', result.filename, {
          format: 'sqlite',
          verified: true,
          counts: result.counts
        });
      }
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(result.destination, (err) => {
        backupService.cleanupBackupDir(backupDir);
        if (err && !res.headersSent) next(err);
      });
    } catch (error) {
      if (backupDir) backupService.cleanupBackupDir(backupDir);
      next(error);
    }
  });

  return router;
}

module.exports = { createBackupRouter };
