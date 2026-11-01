'use strict';

/**
 * Only accept requests addressed to the loopback web origin used by Electron.
 * Without this check, a hostile website could DNS-rebind its hostname to the
 * locally listening complaints server.
 */
function requireLocalHost(port) {
  const allowed = new Set([
    '127.0.0.1:' + port,
    'localhost:' + port
  ]);
  return function localHostGuard(req, res, next) {
    const host = req.headers.host;
    if (typeof host !== 'string' || !allowed.has(host.toLowerCase())) {
      res.status(421).type('text/plain').send('Unrecognized local host.');
      return;
    }
    next();
  };
}

module.exports = { requireLocalHost };
