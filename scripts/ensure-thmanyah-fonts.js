'use strict';
const fs = require('node:fs');
const path = require('node:path');

const WEIGHTS = ['Light', 'Regular', 'Medium', 'Bold', 'Black'];

function readB64(dir, weight) {
  const single = path.join(dir, `ThmanyahSans-${weight}.woff2.b64`);
  if (fs.existsSync(single)) {
    return fs.readFileSync(single, 'utf8').replace(/\s+/g, '');
  }
  const prefix = path.join(dir, `ThmanyahSans-${weight}.woff2.p`);
  const parts = [];
  for (let i = 0; i < 64; i++) {
    const p = `${prefix}${String(i).padStart(2, '0')}.txt`;
    if (!fs.existsSync(p)) break;
    parts.push(fs.readFileSync(p, 'utf8').replace(/\s+/g, ''));
  }
  return parts.length ? parts.join('') : null;
}

function ensureThmanyahFonts(rootDir = path.join(__dirname, '..')) {
  const dir = path.join(rootDir, 'assets', 'fonts', 'thmanyah');
  fs.mkdirSync(dir, { recursive: true });
  for (const weight of WEIGHTS) {
    const b64 = readB64(dir, weight);
    if (!b64) continue;
    const out = path.join(dir, `ThmanyahSans-${weight}.woff2`);
    const buf = Buffer.from(b64, 'base64');
    let needsWrite = true;
    if (fs.existsSync(out)) {
      if (fs.readFileSync(out).equals(buf)) needsWrite = false;
    }
    if (needsWrite) fs.writeFileSync(out, buf);
  }
  return dir;
}

module.exports = { ensureThmanyahFonts };

if (require.main === module) {
  console.log('Thmanyah fonts ensured in', ensureThmanyahFonts());
}
