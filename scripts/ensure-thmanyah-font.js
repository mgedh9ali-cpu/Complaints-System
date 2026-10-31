'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILES = [
  'thmanyahsans-Regular.woff2',
  'thmanyahsans-Medium.woff2',
  'thmanyahsans-Bold.woff2'
];

/**
 * Materialize Thmanyah Sans woff2 files from fonts-src/*.b64 into fonts/.
 * Safe to call on every startup (writes only when missing or empty).
 */
function ensureThmanyahFonts(rootDir = process.cwd()) {
  const fontsDir = path.join(rootDir, 'fonts');
  const srcDir = path.join(rootDir, 'fonts-src');
  fs.mkdirSync(fontsDir, { recursive: true });

  let written = 0;
  for (const name of FILES) {
    const dest = path.join(fontsDir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    const b64Path = path.join(srcDir, name + '.b64');
    if (!fs.existsSync(b64Path)) continue;
    const b64 = fs.readFileSync(b64Path, 'utf8').replace(/\s+/g, '');
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
