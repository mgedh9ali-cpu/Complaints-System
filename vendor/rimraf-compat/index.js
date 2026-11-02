'use strict';
const fs = require('node:fs');
function settings(options) {
  return { recursive: true, force: true, maxRetries: options?.maxBusyTries ?? 3, retryDelay: 100 };
}
function remove(target, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (typeof callback !== 'function') throw new TypeError('A cleanup callback is required.');
  fs.rm(target, settings(options), callback);
}
remove.sync = (target, options) => fs.rmSync(target, settings(options));
module.exports = remove;
