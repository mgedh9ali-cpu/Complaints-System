'use strict';
const fs = require('node:fs');
const path = require('node:path');

const WEIGHTS = ['Light', 'Regular', 'Medium', 'Bold', 'Black'];

function ensureThmanyahFonts(rootDir = path.join(__dirname, '..')) {
  const dir = path.join(rootDir, 'assets', 'fonts', 'thmanyah');
  fs.mkdirSync(dir, { recursive: true });
  for (const weight of WEIGHTS) {
    const out = path.join(dir, `ThmanyahSans-${weight}.woff2`);
    const b64Path = out + '.b64';
    if (!fs.existsSync(b64Path)) continue;
    const b64 = fs.readFileSync(b64Path, 'utf8').replace(/\s+/g, '');
    const buf = Buffer.from(b64, 'base64');
    let needsWrite = true;
    if (fs.existsSync(out)) {
      const existing = fs.readFileSync(out);
      if (existing.equals(buf)) needsWrite = false;
    }
    if (needsWrite) fs.writeFileSync(out, buf);
  }
  return dir;
}

module.exports = { ensureThmanyahFonts };

if (require.main === module) {
  const dir = ensureThmanyahFonts();
  console.log('Thmanyah fonts ensured in', dir);
}
