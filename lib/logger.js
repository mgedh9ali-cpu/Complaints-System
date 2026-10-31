'use strict';

const LEVELS = {
  error: 0,
  warn: 1,
  security: 1,
  audit: 2,
  info: 2,
  debug: 3
};

const currentLevel =
  LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

const REDACT_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'sessionSecret',
  'SESSION_SECRET',
  'token',
  'csrfToken',
  'cookie'
]);

function sanitizeMeta(value, seen) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMeta(item, seen));
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (REDACT_KEYS.has(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeMeta(val, seen);
    }
  }
  return out;
}

function write(level, message, meta = {}) {
  if ((LEVELS[level] ?? 99) > currentLevel) return;
  const safeMeta =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? sanitizeMeta(meta, new WeakSet())
      : {};
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: String(message),
    ...safeMeta
  };
  let line;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({
      ts: entry.ts,
      level,
      msg: entry.msg,
      metaError: 'unserializable_meta'
    });
  }
  if (level === 'error' || level === 'security') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const logger = {
  error(msg, meta) {
    write('error', msg, meta);
  },
  warn(msg, meta) {
    write('warn', msg, meta);
  },
  security(msg, meta) {
    write('security', msg, meta);
  },
  audit(msg, meta) {
    write('audit', msg, meta);
  },
  info(msg, meta) {
    write('info', msg, meta);
  },
  debug(msg, meta) {
    write('debug', msg, meta);
  },
  requestError(err, req = {}) {
    write('error', err.message || 'Request failed', {
      stack: err.stack,
      method: req.method,
      path: req.originalUrl || req.url,
      userId: req.user?.id || req.session?.user?.id || null
    });
  }
};

module.exports = { logger, sanitizeMeta };
