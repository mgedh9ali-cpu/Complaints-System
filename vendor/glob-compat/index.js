'use strict';
const modern = require('glob-patched');
function legacyOptions(options) {
  return { windowsPathsNoEscape: process.platform === 'win32', ...(options || {}) };
}
function glob(pattern, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (options && options.sync) {
    if (callback) throw new TypeError('callback provided to sync glob');
    return modern.globSync(pattern, legacyOptions(options));
  }
  const result = modern.glob(pattern, legacyOptions(options));
  if (typeof callback === 'function') {
    result.then(paths => callback(null, paths), error => callback(error));
    return;
  }
  return result;
}
// Named async/stream/iterator APIs stay native. Legacy .glob callback calls,
// .sync and the callable export are the only adapted entry points.
Object.assign(glob, modern);
glob.glob = glob;
glob.sync = (pattern, options) => modern.globSync(pattern, legacyOptions(options));
module.exports = glob;
