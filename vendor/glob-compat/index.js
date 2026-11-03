'use strict';
const modern = require('glob-patched');
function legacyOptions(options) {
  return { windowsPathsNoEscape: process.platform === 'win32', ...(options || {}) };
}
// Legacy glob emits forward slashes, without the modern `posix` option's
// Windows namespace prefix (//?/C:/...) that breaks older ASAR callers.
const legacyPaths = paths => process.platform === 'win32'
  ? paths.map(value => typeof value === 'string' ? value.replace(/\\/g, '/') : value)
  : paths;
function glob(pattern, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (options && options.sync) {
    if (callback) throw new TypeError('callback provided to sync glob');
    return legacyPaths(modern.globSync(pattern, legacyOptions(options)));
  }
  const result = modern.glob(pattern, legacyOptions(options)).then(legacyPaths);
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
glob.sync = (pattern, options) => legacyPaths(modern.globSync(pattern, legacyOptions(options)));
module.exports = glob;
