'use strict';
// Older build dependencies call require('minimatch') directly. Modern users
// consume named exports. Both delegate to the same official patched engine.
const modern = require('minimatch-patched');
function minimatch(path, pattern, options) {
  return modern.minimatch(path, pattern, options);
}
Object.assign(minimatch, modern);
module.exports = minimatch;
