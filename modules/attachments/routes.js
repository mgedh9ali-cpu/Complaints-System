'use strict';

const express = require('express');
const path = require('node:path');
const multer = require('multer');

function createAttachmentsRouter({ attachmentsService, middleware, audit }) {
  const router = express.Router();
  const { requireAuth, requireRole, requireCsrf } = middleware;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: attachmentsService.MAX_FILE_SIZE,
      files: attachmentsService.MAX_FILES_PER_COMPLAINT
    }
  });

  router.post(
    '/attachments/:complaintId',
    requireAuth,
    requireRole('admin', 'staff'),
    requireCsrf,
    upload.array('files', attachmentsService.MAX_FILES_PER_COMPLAINT),
    (req, res) => {
      const complaintId = String(req.params.complaintId || '').trim();
      if (!complaintId || complaintId.length > 100) {
        return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
      }
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'لم يتم إرسال أي ملف.' });
      }
      try {
        const saved = [];
        for (const file of req.files) {
          const meta = attachmentsService.save(complaintId, file);
          saved.push(meta);
          if (typeof audit === 'function') {
            audit(req.user.id, 'attachment_uploaded', 'attachment', meta.id, {
              complaintId,
              originalName: meta.originalName,
              size: meta.size
            });
          }
        }
        res.status(201).json({ attachments: saved });
      } catch (err) {
        res.status(400).json({ error: err.message || 'فشل رفع الملف.' });
      }
    }
  );

  router.get('/attachments/by-complaint/:complaintId', requireAuth, (req, res) => {
    const complaintId = String(req.params.complaintId || '').trim();
    if (!complaintId || complaintId.length > 100) {
      return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
    }
    const items = attachmentsService.listByComplaint(complaintId);
    res.json({ attachments: items });
  });

  router.get('/attachments/:storedName', requireAuth, (req, res) => {
    const storedName = path.basename(req.params.storedName || '');
    const full = attachmentsService.getPath(storedName);
    if (!full) return res.status(404).json({ error: 'الملف غير موجود.' });
    res.download(full, storedName, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'تعذر تنزيل الملف.' });
    });
  });

  router.delete(
    '/attachments/:storedName',
    requireAuth,
    requireRole('admin', 'staff'),
    requireCsrf,
    (req, res) => {
      const storedName = path.basename(req.params.storedName || '');
      attachmentsService.remove(storedName);
      if (typeof audit === 'function') {
        audit(req.user.id, 'attachment_deleted', 'attachment', storedName, {});
      }
      res.status(204).end();
    }
  );

  return router;
}

module.exports = { createAttachmentsRouter };
