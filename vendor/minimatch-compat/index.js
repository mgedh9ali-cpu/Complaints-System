'use strict';
// Older build dependencies call require('minimatch') directly. Modern users
// consume named exports. Both delegate to the same official patched engine.
const modern = require('minimatch-patched');
function minimatch(path, pattern, options) {
  return modern.minimatch(path, pattern, options);
}
Object.assign(minimatch, modern);
// FileList passes path.normalize() patterns to the legacy list API on Windows.
// Keep modern named matching APIs unchanged; adapt only that legacy entry point.
minimatch.match = (files, pattern, options) => modern.match(files, pattern, {
  windowsPathsNoEscape: process.platform === 'win32', ...(options || {})
});
module.exports = minimatch;
