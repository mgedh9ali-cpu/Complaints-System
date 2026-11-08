'use strict';
/* Thmanyah Sans — materialises the bundled WOFF2 files from their base64 parts.
 *
 * The font is delivered as base64 parts so it can be reviewed as text. A part
 * set is only complete when the reassembled bytes are a whole WOFF2 file: the
 * signature must be "wOF2" and the length header must equal the file size.
 * Incomplete sets are skipped, never written, so the browser never downloads a
 * truncated font that fails to parse.
 */
const fs = require('node:fs');
const path = require('node:path');

const WEIGHTS = ['Light', 'Regular', 'Medium', 'Bold', 'Black'];
const MAX_PARTS = 64;
const WOFF2_SIGNATURE = 'wOF2';

function readB64(dir, weight) {
  const single = path.join(dir, `ThmanyahSans-${weight}.woff2.b64`);
  if (fs.existsSync(single)) {
    return fs.readFileSync(single, 'utf8').replace(/\s+/g, '');
  }
  const prefix = path.join(dir, `ThmanyahSans-${weight}.woff2.p`);
  const parts = [];
  for (let i = 0; i < MAX_PARTS; i++) {
    const p = `${prefix}${String(i).padStart(2, '0')}.txt`;
    if (!fs.existsSync(p)) break;
    parts.push(fs.readFileSync(p, 'utf8').replace(/\s+/g, ''));
  }
  return parts.length ? parts.join('') : null;
}

/* A WOFF2 file starts with the signature, the original flavour and the total
 * file length. A truncated file declares more bytes than it carries. */
function readDeclaredLength(buffer) {
  if (buffer.length < 12) return null;
  return buffer.readUInt32BE(8);
}

function isCompleteWoff2(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.subarray(0, 4).toString('binary') !== WOFF2_SIGNATURE) return false;
  const declared = readDeclaredLength(buffer);
  return declared !== null && declared === buffer.length;
}

function ensureThmanyahFonts(rootDir = path.join(__dirname, '..')) {
  const dir = path.join(rootDir, 'assets', 'fonts', 'thmanyah');
  fs.mkdirSync(dir, { recursive: true });
  const materialised = [];
  const skipped = [];
  for (const weight of WEIGHTS) {
    const b64 = readB64(dir, weight);
    if (!b64) {
      skipped.push(`${weight}: no base64 parts found`);
      continue;
    }
    const buffer = Buffer.from(b64, 'base64');
    if (!isCompleteWoff2(buffer)) {
      skipped.push(`${weight}: incomplete font (${buffer.length} bytes, declared ${readDeclaredLength(buffer) ?? 'unknown'})`);
      continue;
    }
    const out = path.join(dir, `ThmanyahSans-${weight}.woff2`);
    let needsWrite = true;
    if (fs.existsSync(out)) {
      if (fs.readFileSync(out).equals(buffer)) needsWrite = false;
    }
    if (needsWrite) fs.writeFileSync(out, buffer);
    materialised.push(weight);
  }
  return { dir, materialised, skipped };
}

module.exports = { ensureThmanyahFonts, isCompleteWoff2, readB64, WEIGHTS };

if (require.main === module) {
  const report = ensureThmanyahFonts();
  console.log('Thmanyah fonts ensured in', report.dir);
  for (const weight of report.materialised) console.log('  materialised:', weight);
  for (const reason of report.skipped) console.log('  skipped:', reason);
}
