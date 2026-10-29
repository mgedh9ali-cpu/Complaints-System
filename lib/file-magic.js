'use strict';

/**
 * Lightweight magic-byte (file signature) checks.
 * Complements MIME / extension checks so attackers cannot
 * upload executables or HTML by renaming the extension.
 */

const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },                         // %PDF
  { mime: 'image/jpeg',      bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',       bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/gif',       bytes: [0x47, 0x49, 0x46, 0x38] },                         // GIF8
  { mime: 'image/webp',      bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },               // RIFF....WEBP
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x03, 0x04] },                         // PK.. (docx/xlsx/zip)
  { mime: 'application/msword', bytes: [0xD0, 0xCF, 0x11, 0xE0] },                      // OLE compound
];

/** Detect MIME family from the first bytes of a buffer. Returns null if unknown. */
function detectMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  for (const sig of SIGNATURES) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) { match = false; break; }
    }
    if (match) {
      // Special case: RIFF container must also contain WEBP
      if (sig.mime === 'image/webp') {
        if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
          return 'image/webp';
        }
        continue;
      }
      return sig.mime;
    }
  }

  // Plain text heuristic: high ratio of printable ASCII / UTF-8
  const sample = buffer.subarray(0, Math.min(512, buffer.length));
  let printable = 0;
  for (const b of sample) {
    if (b === 0x09 || b === 0x0A || b === 0x0D || (b >= 0x20 && b <= 0x7E) || b >= 0xC0) {
      printable++;
    }
  }
  if (printable / sample.length > 0.92) return 'text/plain';

  return null;
}

/**
 * Returns true if the detected content type is compatible with the claimed MIME / extension family.
 * Zip-based office formats (docx/xlsx) are accepted when magic says application/zip.
 */
function isContentCompatible(claimedMime, detectedMime, ext) {
  if (!detectedMime) return false; // unknown binary → reject

  const officeExts = new Set(['.docx', '.xlsx', '.doc', '.xls']);
  const officeMimes = new Set([
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]);

  if (detectedMime === claimedMime) return true;

  // docx / xlsx are ZIP containers
  if (detectedMime === 'application/zip' && (officeExts.has(ext) || officeMimes.has(claimedMime))) {
    return true;
  }

  // legacy .doc / .xls
  if (detectedMime === 'application/msword' && (ext === '.doc' || ext === '.xls' || officeMimes.has(claimedMime))) {
    return true;
  }

  // text family
  if (detectedMime === 'text/plain' && (claimedMime === 'text/plain' || claimedMime === 'text/csv' || ext === '.txt' || ext === '.csv')) {
    return true;
  }

  // jpeg aliases
  if (detectedMime === 'image/jpeg' && (ext === '.jpg' || ext === '.jpeg')) return true;

  return false;
}

module.exports = {
  detectMimeFromBuffer,
  isContentCompatible,
  SIGNATURES
};
