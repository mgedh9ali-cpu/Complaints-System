'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILES = [
  'thmanyahsans-Regular.woff2',
  'thmanyahsans-Medium.woff2',
  'thmanyahsans-Bold.woff2'
];

function readB64(srcDir, name) {
  const whole = path.join(srcDir, name + '.b64');
  if (fs.existsSync(whole)) {
    return fs.readFileSync(whole, 'utf8').replace(/\s+/g, '');
  }
  const partsList = path.join(srcDir, name + '.parts');
  if (fs.existsSync(partsList)) {
    const lines = fs
      .readFileSync(partsList, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let out = '';
    for (const line of lines) {
      const p = path.join(srcDir, line);
      if (!fs.existsSync(p)) return null;
      out += fs.readFileSync(p, 'utf8').replace(/\s+/g, '');
    }
    return out || null;
  }
  // Discover sequential p0,p1,... without .parts file
  let out = '';
  for (let i = 0; i < 20; i += 1) {
    const p = path.join(srcDir, name + '.p' + i + '.b64');
    if (!fs.existsSync(p)) break;
    out += fs.readFileSync(p, 'utf8').replace(/\s+/g, '');
  }
  return out || null;
}

/**
 * Materialize Thmanyah Sans woff2 from fonts-src into fonts/.
 */
function ensureThmanyahFonts(rootDir = process.cwd()) {
  const fontsDir = path.join(rootDir, 'fonts');
  const srcDir = path.join(rootDir, 'fonts-src');
  fs.mkdirSync(fontsDir, { recursive: true });

  let written = 0;
  for (const name of FILES) {
    const dest = path.join(fontsDir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    const b64 = readB64(srcDir, name);
    if (!b64) continue;
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1000) continue;
    fs.writeFileSync(dest, buf);
    written += 1;
  }
  return { fontsDir, written };
}

module.exports = { ensureThmanyahFonts, FILES };

if (require.main === module) {
  const result = ensureThmanyahFonts(path.resolve(__dirname, '..'));
  process.stdout.write(
    'Thmanyah fonts: wrote ' + result.written + ' file(s) into ' + result.fontsDir + '\n'
  );
}
