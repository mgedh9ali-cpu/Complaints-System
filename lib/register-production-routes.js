'use strict';

/** Optional production-bundle routes (isolated backup verify). */
function registerProductionRoutes(app, deps) {
  const {
    requireAuth, requireRole, requireCsrf, audit, logger, verifyRestore,
    backupUpload, path, fs, os
  } = deps;

  app.post(
    '/api/backup/verify',
    requireAuth,
    requireRole('admin'),
    requireCsrf,
    backupUpload.single('backup'),
    async (req, res) => {
      if (!req.file || !Buffer.isBuffer(req.file.buffer) || req.file.buffer.length < 100) {
        return res.status(400).json({ error: 'أرفق ملف نسخة SQLite صالحًا.' });
      }
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-verify-upload-'));
      const tmpFile = path.join(tmpDir, 'upload.sqlite');
      try {
        fs.writeFileSync(tmpFile, req.file.buffer);
        const result = await verifyRestore(tmpFile);
        audit(req.user.id, 'backup_verified', 'backup', req.file.originalname || 'upload.sqlite', {
          counts: result.counts,
          size: req.file.size
        });
        logger.info('backup verified', { userId: req.user.id, counts: result.counts });
        res.json({ verified: true, counts: result.counts });
      } catch (err) {
        logger.warn('backup verify failed', { error: err.message, userId: req.user.id });
        audit(req.user.id, 'backup_verify_failed', 'backup', req.file.originalname || 'upload.sqlite', {
          error: String(err.message || err).slice(0, 500)
        });
        res.status(400).json({ error: 'فشل فحص النسخة: ' + (err.message || 'ملف غير صالح') });
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
  );
}

module.exports = { registerProductionRoutes };
