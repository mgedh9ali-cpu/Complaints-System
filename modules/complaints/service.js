'use strict';
const fs = require('node:fs');
const path = require('node:path');
const parts = [];
for (let i = 0; ; i++) {
  const f = path.join(__dirname, 'svc.b64.' + i);
  if (!fs.existsSync(f)) break;
  parts.push(fs.readFileSync(f, 'utf8'));
}
if (!parts.length) throw new Error('missing svc.b64 parts');
const code = Buffer.from(parts.join(''), 'base64').toString('utf8');
const Module = require('module');
const m = new Module(path.join(__dirname, 'service.assembled.js'));
m.filename = path.join(__dirname, 'service.assembled.js');
m.paths = Module._nodeModulePaths(__dirname);
m._compile(code, m.filename);
module.exports = m.exports;
