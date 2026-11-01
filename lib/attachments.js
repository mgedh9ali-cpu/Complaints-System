'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { lockDownDir, lockDownFile } = require('./data-protection');
const { createStorageCodec, isSealed } = require('./storage-codec');
const attachmentCodec = () => createStorageCodec(process.env.DATA_KEY || process.env.SESSION_SECRET);

function attachmentsRoot() {
  if (process.env.DATABASE_PATH) {
    return path.join(path.dirname(path.resolve(process.env.DATABASE_PATH)), 'attachments');
  }
  return path.resolve('./data/attachments');
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
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
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
  '.csv'
]);

function ensureDir() {
  const dir = attachmentsRoot();
  lockDownDir(dir);
  return dir;
}

function safeFilename(original) {
  let displayName = String(original || 'file');
  // Multipart filename parameters may be decoded as latin1 by the parser.
  // Repair only valid UTF-8 byte sequences; preserve correctly decoded names.
  if ([...displayName].every(character => character.codePointAt(0) <= 255)) {
    const decoded = Buffer.from(displayName, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) displayName = decoded;
  }
  const base = path
    .basename(displayName)
    .replace(/[^\w.\u0600-\u06FF\- ]+/g, '_')
    .slice(0, 80);
  const ext = path.extname(base).toLowerCase();
  const name = path.basename(base, ext).slice(0, 60) || 'file';
  return { name, ext };
}

const MIME_BY_EXT = {
  '.pdf': new Set(['application/pdf']),
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
  '.png': new Set(['image/png']),
  '.webp': new Set(['image/webp']),
  '.gif': new Set(['image/gif']),
  '.doc': new Set(['application/msword']),
  '.docx': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]),
  '.xls': new Set(['application/vnd.ms-excel']),
  '.xlsx': new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]),
  '.txt': new Set(['text/plain']),
  '.csv': new Set(['text/csv', 'text/plain'])
};

function zipEntryNames(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return null;
  const minOffset = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = new Set();
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      return null;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) return null;
    names.add(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset = end;
  }
  return names;
}

function matchesContentSignature(file, ext) {
  const data = file.buffer;
  if (!Buffer.isBuffer(data) || data.length === 0) return false;
  if (ext === '.pdf') return data.subarray(0, 5).toString('ascii') === '%PDF-';
  if (ext === '.jpg' || ext === '.jpeg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (ext === '.png') {
    return (
      data.length >= 8 &&
      data
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (ext === '.gif') {
    return ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'));
  }
  if (ext === '.webp') {
    return (
      data.length >= 12 &&
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (ext === '.doc' || ext === '.xls') {
    return (
      data.length >= 8 &&
      data
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    );
  }
  if (ext === '.docx' || ext === '.xlsx') {
    const entries = zipEntryNames(data);
    if (!entries || !entries.has('[Content_Types].xml')) return false;
    return ext === '.docx'
      ? entries.has('word/document.xml')
      : entries.has('xl/workbook.xml');
  }
  if (ext === '.txt' || ext === '.csv') {
    if (data.includes(0)) return false;
    for (const byte of data) {
      if (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte)) return false;
    }
    return true;
  }
  return false;
}

function isAllowed(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !MIME_BY_EXT[ext]) return false;
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) return false;
  if (
    !Number.isFinite(file.size) ||
    file.size !== file.buffer.length ||
    file.size > MAX_FILE_SIZE
  ) {
    return false;
  }
  if (!MIME_BY_EXT[ext].has(file.mimetype)) return false;
  return matchesContentSignature(file, ext);
}

function saveAttachment(complaintId, file) {
  // Complaint IDs originate from the server and must never become path syntax.
  if (typeof complaintId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(complaintId)) {
    throw new Error('معرّف الشكوى لا يصلح لمسار مرفقات آمن.');
  }
  const dir = ensureDir();
  if (!isAllowed(file)) {
    throw new Error(
      'نوع الملف أو حجمه غير مسموح. المسموح: PDF, صور, Word, Excel, نص (حد أقصى 5MB).'
    );
  }
  const existing = fs.readdirSync(dir).filter((entry) => entry.startsWith(complaintId + '_'));
  if (existing.length >= MAX_FILES_PER_COMPLAINT) {
    throw new Error('تم بلوغ الحد الأقصى لعدد المرفقات لهذه الشكوى (5 ملفات).');
  }
  const { name, ext } = safeFilename(file.originalname);
  const id = crypto.randomUUID();
  const storedName = `${complaintId}_${id}${ext}`;
  const dest = path.join(dir, storedName);
  fs.writeFileSync(dest, attachmentCodec().seal(file.buffer, 'attachment:' + storedName), { mode: 0o600, flag: 'wx' });
  lockDownFile(dest);
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
  const dir = ensureDir();
  const full = path.join(dir, path.basename(storedName));
  if (!full.startsWith(dir + path.sep) && full !== dir) return null;
  if (!fs.existsSync(full) || !fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) return null;
  return full;
}

function deleteAttachment(storedName) {
  const full = getAttachmentPath(storedName);
  if (full) {
    fs.unlinkSync(full);
  }
}

function readAttachment(storedName) {
  const full = getAttachmentPath(storedName);
  if (!full) return null;
  return attachmentCodec().open(fs.readFileSync(full), 'attachment:' + path.basename(storedName));
}

function protectLegacyAttachments() {
  const codec = attachmentCodec();
  if (!codec.enabled) return;
  const root = path.dirname(attachmentsRoot());
  for (const folder of ['attachments', 'retired-attachments']) {
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.encrypting')) {
        if (fs.existsSync(path.join(dir,name.slice(0,-11)))) continue;
        throw new Error('Incomplete attachment migration requires recovery.');
      }
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe attachment during encryption migration.');
      const bytes = fs.readFileSync(file);
      fs.rmSync(file + '.encrypting', { force: true });
      if (isSealed(bytes)) { codec.open(bytes, 'attachment:' + name); continue; }
      fs.writeFileSync(file + '.encrypting', codec.seal(bytes, 'attachment:' + name), { mode: 0o600, flag: 'wx' });
      fs.renameSync(file + '.encrypting', file);
    }
  }
}

function listAttachmentsForComplaint(complaintId) {
  const dir = ensureDir();
  const prefix = complaintId + '_';
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .map((storedName) => {
      const full = path.join(dir, storedName);
      const stat = fs.statSync(full);
      return {
        storedName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    });
}

module.exports = {
  get ATTACHMENTS_DIR() {
    return attachmentsRoot();
  },
  MAX_FILE_SIZE,
  MAX_FILES_PER_COMPLAINT,
  ALLOWED_MIME,
  ALLOWED_EXT,
  ensureDir,
  saveAttachment,
  getAttachmentPath,
  readAttachment,
  protectLegacyAttachments,
  deleteAttachment,
  listAttachmentsForComplaint,
  isAllowed
};
