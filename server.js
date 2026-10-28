'use strict';
/**
 * Loader: assembles server from server_parts/*.txt (full application source).
 * Keeps the live entrypoint as server.js for package.json and the Windows installer.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const partsDir = path.join(__dirname, 'server_parts');
const files = fs.readdirSync(partsDir).filter((f) => f.endsWith('.txt')).sort();
if (!files.length) {
  throw new Error('server_parts is empty; cannot boot the application.');
}
const code = files.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8')).join('');
module.filename = path.join(__dirname, 'server.js');
module.paths = Module._nodeModulePaths(__dirname);
module._compile(code, module.filename);
