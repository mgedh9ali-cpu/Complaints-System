'use strict';

/**
 * Unified structured logger for the Complaints System.
 * Levels: error | warn | info | debug
 * Output is JSON lines for easy grepping.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function write(level, message, meta = {}) {
  if ((LEVELS[level] ?? 99) > currentLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: String(message),
    ...meta
  };

  if (entry.password) entry.password = '[redacted]';
  if (entry.password_hash) entry.password_hash = '[redacted]';
  if (entry.sessionSecret) entry.sessionSecret = '[redacted]';

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const logger = {
  error(msg, meta) { write('error', msg, meta); },
  warn(msg, meta) { write('warn', msg, meta); },
  info(msg, meta) { write('info', msg, meta); },
  debug(msg, meta) { write('debug', msg, meta); },
  requestError(err, req = {}) {
    write('error', err.message || 'Request failed', {
      stack: err.stack,
      method: req.method,
      path: req.originalUrl || req.url,
      userId: req.user?.id || req.session?.user?.id || null
    });
  }
};

module.exports = { logger };
