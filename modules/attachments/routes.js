'use strict';

const express = require('express');
const path = require('node:path');
const multer = require('multer');
const { saveAttachmentBatch } = require('./upload-batch');

const UUID_TAIL =
  /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.[^.]+)?$/i;

/** storedName format: {complaintId}_{uuid}{ext} */
function parseStoredAttachmentName(storedName) {
  const base = path.basename(String(storedName || ''));
  const match = base.match(UUID_TAIL);
  if (!match) return null;
  const complaintId = base.slice(0, match.index);
  if (!complaintId || complaintId.length > 100) return null;
  return { complaintId, storedName: base };
}

function createAttachmentsRouter({
  attachmentsService,
  middleware,
  audit,
  rolesService,
  complaintsService,
  db
}) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  function complaintExists(complaintId) {
    if (!complaintsService || typeof complaintsService.readState !== 'function') {
      return true;
    }
    const { state } = complaintsService.readState();
    return (state.complaints || []).some((c) => c && c.id === complaintId);
  }

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
    requirePermission('attachments.upload'),
    requireCsrf,
    upload.array('files', attachmentsService.MAX_FILES_PER_COMPLAINT),
    (req, res) => {
      const complaintId = String(req.params.complaintId || '').trim();
      if (!complaintId || complaintId.length > 100) {
        return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
      }
      if (!complaintExists(complaintId)) {
        return res.status(404).json({ error: 'الشكوى غير موجودة.' });
      }
      const complaint = complaintsService?.readState().state.complaints.find(c => c.id === complaintId);
      if (complaint && (complaint.archivedAt || ['closed','cancelled'].includes(complaint.status))) {
        return res.status(409).json({ error: 'لا يمكن رفع مرفقات إلى شكوى مغلقة أو مؤرشفة.' });
      }
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'لم يتم إرسال أي ملف.' });
      }
      let saved = [];
      let auditCommitted = false;
      try {
        saved = saveAttachmentBatch({ attachmentsService, complaintId, files: req.files });
        const recordUploads = () => {
          for (const meta of saved) {
            attachmentsService.record?.(meta, complaintId);
            if (typeof audit === 'function') {
              audit(req.user.id, 'attachment_uploaded', 'attachment', meta.id, {
                complaintId, originalName: meta.originalName, size: meta.size
              });
            }
          }
        };
        if (db && typeof db.transaction === 'function') {
          db.transaction(recordUploads)();
          auditCommitted = true;
          if (typeof audit?.syncHead === 'function') audit.syncHead();
        } else {
          recordUploads();
          auditCommitted = true;
        }
        return res.status(201).json({ attachments: saved });
      } catch (err) {
        // A successful disk write must not leave unaudited orphan attachments.
        if (!auditCommitted) {
          for (const meta of saved.reverse()) {
            try { attachmentsService.remove(meta.storedName); } catch (_) {}
          }
        }
        if (saved.length) return res.status(500).json({ error: 'تعذر تسجيل المرفقات بأمان.' });
        return res.status(400).json({ error: err.message || 'فشل رفع الملف.' });
      }
    }
  );

  router.get(
    '/attachments/by-complaint/:complaintId',
    requireAuth,
    requirePermission('attachments.read'),
    (req, res) => {
      const complaintId = String(req.params.complaintId || '').trim();
      if (!complaintId || complaintId.length > 100) {
        return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
      }
      if (!complaintExists(complaintId)) {
        return res.status(404).json({ error: 'الشكوى غير موجودة.' });
      }
      const items = attachmentsService.listByComplaint(complaintId);
      if (typeof audit === 'function') {
        audit(req.user.id, 'attachments_listed', 'complaint', complaintId, {
          count: items.length
        });
      }
      res.json({ attachments: items });
    }
  );

  router.get(
    '/attachments/:storedName',
    requireAuth,
    requirePermission('attachments.read'),
    (req, res) => {
      const parsed = parseStoredAttachmentName(req.params.storedName);
      if (!parsed) {
        return res.status(400).json({ error: 'اسم الملف غير صالح أو لا يرتبط بشكوى.' });
      }
      if (!complaintExists(parsed.complaintId)) {
        return res.status(404).json({ error: 'الشكوى المرتبطة بالملف غير موجودة.' });
      }
      const full = attachmentsService.getPath(parsed.storedName);
      if (!full) return res.status(404).json({ error: 'الملف غير موجود.' });
      // Record every authorized file access before releasing sensitive bytes.
      if (typeof audit === 'function') {
        audit(req.user.id, 'attachment_accessed', 'attachment', parsed.storedName, {
          complaintId: parsed.complaintId
        });
      }
      const bytes = attachmentsService.read(parsed.storedName);
      if (!bytes) return res.status(404).json({ error: 'الملف غير موجود.' });
      res.attachment(attachmentsService.metadata?.(parsed.storedName)?.originalName || parsed.storedName).send(bytes);
    }
  );

  router.delete(
    '/attachments/:storedName',
    requireAuth,
    requirePermission('attachments.delete'),
    requireCsrf,
    (req, res) => {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < 3 || reason.length > 500) {
        return res.status(400).json({ error: 'يجب إدخال سبب الحذف (من 3 إلى 500 حرف).' });
      }
      const parsed = parseStoredAttachmentName(req.params.storedName);
      if (!parsed) {
        return res.status(400).json({ error: 'اسم الملف غير صالح أو لا يرتبط بشكوى.' });
      }
      if (!complaintExists(parsed.complaintId)) {
        return res.status(404).json({ error: 'الشكوى المرتبطة بالملف غير موجودة.' });
      }
      // attachment_deleted is recorded by the separate two-person approval transaction.
      res.status(409).json({ error: 'قدّم طلب حذف من مسار الموافقات؛ يلزم قرار مدير مختلف عن مقدم الطلب.' });
    }
  );

  return router;
}

module.exports = { createAttachmentsRouter, parseStoredAttachmentName };
