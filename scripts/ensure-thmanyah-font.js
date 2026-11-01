'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILES = [
  'thmanyahsans-Regular.woff2',
  'thmanyahsans-Medium.woff2',
  'thmanyahsans-Bold.woff2'
];

function validWoff2(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= 48 &&
    buffer.toString('ascii', 0, 4) === 'wOF2' &&
    buffer.readUInt32BE(8) === buffer.length;
}

function readCandidate(sourceDir, name, source) {
  if (source === 'parts') {
    const partsList = path.join(sourceDir, name + '.parts');
    if (!fs.existsSync(partsList)) return null;
    const names = fs.readFileSync(partsList, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!names.length || names.some(file => path.basename(file) !== file)) return null;
    if (names.some(file => !fs.existsSync(path.join(sourceDir, file)))) return null;
    return names.map(file => fs.readFileSync(path.join(sourceDir, file), 'utf8').replace(/\s+/g, '')).join('');
  }
  const complete = path.join(sourceDir, name + '.b64');
  if (!fs.existsSync(complete)) return null;
  return fs.readFileSync(complete, 'utf8').replace(/\s+/g, '');
}

function decodeCandidate(base64) {
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) return null;
  const decoded = Buffer.from(base64, 'base64');
  return validWoff2(decoded) ? decoded : null;
}

/**
 * A font is considered installed only when the decoded WOFF2 header and
 * declared byte length match. Partial GitHub-upload chunks must not be served
 * as a font (browsers silently switch to the system fallback).
 */
function ensureThmanyahFonts(rootDir = process.cwd()) {
  const fontsDir = path.join(rootDir, 'fonts');
  const srcDir = path.join(rootDir, 'fonts-src');
  fs.mkdirSync(fontsDir, { recursive: true });
  let written = 0;
  const available = [];
  const missing = [];

  for (const name of FILES) {
    const destination = path.join(fontsDir, name);
    if (fs.existsSync(destination) && validWoff2(fs.readFileSync(destination))) {
      available.push(name);
      continue;
    }
    let decoded = null;
    // Prefer the complete part manifest; some legacy .b64 files are truncated.
    for (const source of ['parts', 'whole']) {
      decoded = decodeCandidate(readCandidate(srcDir, name, source));
      if (decoded) break;
    }
    if (!decoded) {
      missing.push(name);
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      continue;
    }
    fs.writeFileSync(destination, decoded);
    written += 1;
    available.push(name);
  }
  return { fontsDir, written, available, missing };
}

module.exports = { ensureThmanyahFonts, FILES, validWoff2 };

if (require.main === module) {
  const result = ensureThmanyahFonts(path.resolve(__dirname, '..'));
  process.stdout.write('Thmanyah fonts: ' + result.available.length +
    ' available; ' + result.missing.length + ' missing; ' + result.written +
    ' written into ' + result.fontsDir + '\n');
  if (result.missing.length) {
    process.stderr.write('Incomplete Thmanyah source files: ' + result.missing.join(', ') + '\n');
  }
}
