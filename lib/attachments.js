'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ATTACHMENTS_DIR = path.resolve('./data/attachments');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES_PER_COMPLAINT = 5;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv'
]);

const ALLOWED_EXT = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'
]);

function ensureDir() {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

function safeFilename(original) {
  const base = path.basename(String(original || 'file')).replace(/[^\w.\u0600-\u06FF\- ]+/g, '_').slice(0, 80);
  const ext = path.extname(base).toLowerCase();
  const name = path.basename(base, ext).slice(0, 60) || 'file';
  return { name, ext };
}

function isAllowed(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return false;
  if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) return false;
  if (file.size > MAX_FILE_SIZE) return false;
  return true;
}

/**
 * Save an uploaded file for a complaint.
 * Returns metadata to store in the complaint payload.
 */
function saveAttachment(complaintId, file) {
  ensureDir();
  if (!isAllowed(file)) {
    throw new Error('نوع الملف أو حجمه غير مسموح. المسموح: PDF, صور, Word, Excel, نص (حد أقصى 5MB).');
  }

  const { name, ext } = safeFilename(file.originalname);
  const id = crypto.randomUUID();
  const storedName = `${complaintId}_${id}${ext}`;
  const dest = path.join(ATTACHMENTS_DIR, storedName);

  fs.writeFileSync(dest, file.buffer);

  return {
    id,
    originalName: name + ext,
    storedName,
    mime: file.mimetype || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString()
  };
}

function getAttachmentPath(storedName) {
  const full = path.join(ATTACHMENTS_DIR, path.basename(storedName));
  if (!full.startsWith(ATTACHMENTS_DIR)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

function deleteAttachment(storedName) {
  const full = getAttachmentPath(storedName);
  if (full) {
    try { fs.unlinkSync(full); } catch (_) {}
  }
}

function listAttachmentsForComplaint(complaintId) {
  ensureDir();
  const prefix = complaintId + '_';
  return fs.readdirSync(ATTACHMENTS_DIR)
    .filter(f => f.startsWith(prefix))
    .map(storedName => {
      const full = path.join(ATTACHMENTS_DIR, storedName);
      const stat = fs.statSync(full);
      return {
        storedName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    });
}

module.exports = {
  ATTACHMENTS_DIR,
  MAX_FILE_SIZE,
  MAX_FILES_PER_COMPLAINT,
  ALLOWED_MIME,
  ALLOWED_EXT,
  ensureDir,
  saveAttachment,
  getAttachmentPath,
  deleteAttachment,
  listAttachmentsForComplaint,
  isAllowed
};
