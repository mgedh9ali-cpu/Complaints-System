'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { detectMimeFromBuffer, isContentCompatible } = require('./file-magic');

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

// Dangerous extensions that must never be accepted even if MIME is spoofed
const BLOCKED_EXT = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.html', '.htm', '.xhtml', '.svg', '.xml',
  '.php', '.asp', '.aspx', '.jsp', '.cgi',
  '.sh', '.bash', '.ps1', '.vbs', '.wsf',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
  '.dll', '.so', '.dylib', '.jar', '.war'
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

/**
 * Validate extension + claimed MIME + real file content (magic bytes).
 */
function isAllowed(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (BLOCKED_EXT.has(ext)) return false;
  if (!ALLOWED_EXT.has(ext)) return false;
  if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) return false;
  if (file.size > MAX_FILE_SIZE) return false;

  // Content inspection (magic bytes)
  if (file.buffer && Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
    const detected = detectMimeFromBuffer(file.buffer);
    if (!isContentCompatible(file.mimetype || '', detected, ext)) {
      return false;
    }
  }

  return true;
}

/**
 * Save an uploaded file for a complaint.
 * Returns metadata to store in the complaint payload.
 */
function saveAttachment(complaintId, file) {
  ensureDir();
  if (!isAllowed(file)) {
    throw new Error(
      'نوع الملف أو محتواه أو حجمه غير مسموح. المسموح: PDF, صور, Word, Excel, نص (حد أقصى 5MB). تم رفض الملفات التنفيذية أو المموّهة.'
    );
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
  BLOCKED_EXT,
  ensureDir,
  saveAttachment,
  getAttachmentPath,
  deleteAttachment,
  listAttachmentsForComplaint,
  isAllowed
};
