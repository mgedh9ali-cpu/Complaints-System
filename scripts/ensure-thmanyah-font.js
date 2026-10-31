'use strict';
/** Reconstruct fonts/thmanyahsans-Regular.woff2 from base64 parts if missing. */
const fs = require('node:fs');
const path = require('node:path');

function ensure() {
  const root = path.resolve(__dirname, '..');
  const fontsDir = path.join(root, 'fonts');
  const target = path.join(fontsDir, 'thmanyahsans-Regular.woff2');
  if (fs.existsSync(target) && fs.statSync(target).size > 1000) return target;
  fs.mkdirSync(fontsDir, { recursive: true });
  const partsDir = path.join(root, 'fonts-src');
  if (!fs.existsSync(partsDir)) return null;
  const files = fs.readdirSync(partsDir).filter((f) => f.startsWith('Regular.b64')).sort();
  if (!files.length) return null;
  const b64 = files.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8')).join('').replace(/\s+/g, '');
  fs.writeFileSync(target, Buffer.from(b64, 'base64'));
  return target;
}

if (require.main === module) {
  const p = ensure();
  console.log(p ? 'font ready: ' + p : 'no font parts found');
}
module.exports = { ensure };
