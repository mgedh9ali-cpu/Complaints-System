'use strict';

/**
 * Lightweight magic-byte (file signature) checks.
 * Complements MIME / extension checks in lib/attachments.js.
 */

const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x03, 0x04] },
  { mime: 'application/msword', bytes: [0xD0, 0xCF, 0x11, 0xE0] }
];

function detectMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  for (const sig of SIGNATURES) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      if (sig.mime === 'image/webp') {
        if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
        continue;
      }
      return sig.mime;
    }
  }

  const sample = buffer.subarray(0, Math.min(512, buffer.length));
  let printable = 0;
  for (const b of sample) {
    if (b === 0x09 || b === 0x0A || b === 0x0D || (b >= 0x20 && b <= 0x7E) || b >= 0xC0) printable++;
  }
  if (sample.length && printable / sample.length > 0.92) return 'text/plain';
  return null;
}

function isContentCompatible(claimedMime, detectedMime, ext) {
  if (!detectedMime) return false;

  const officeExts = new Set(['.docx', '.xlsx', '.doc', '.xls']);
  const officeMimes = new Set([
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]);

  if (detectedMime === claimedMime) return true;
  if (detectedMime === 'application/zip' && (officeExts.has(ext) || officeMimes.has(claimedMime))) return true;
  if (detectedMime === 'application/msword' && (ext === '.doc' || ext === '.xls' || officeMimes.has(claimedMime))) return true;
  if (detectedMime === 'text/plain' && (claimedMime === 'text/plain' || claimedMime === 'text/csv' || ext === '.txt' || ext === '.csv')) return true;
  return false;
}

module.exports = { detectMimeFromBuffer, isContentCompatible };
