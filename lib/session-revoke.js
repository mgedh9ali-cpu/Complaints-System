'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Destroy session-file-store sessions that belong to a given user id.
 * session-file-store writes one JSON file per session under sessionsDir.
 */
function revokeUserSessions(sessionsDir, userId, options = {}) {
  if (!userId || typeof userId !== 'string') return { revoked: 0 };
  const keepSessionId = options.keepSessionId || null;
  let revoked = 0;
  let dir;
  try {
    dir = fs.readdirSync(sessionsDir);
  } catch {
    return { revoked: 0 };
  }
  for (const name of dir) {
    if (!name || name.startsWith('.')) continue;
    const full = path.join(sessionsDir, name);
    if (keepSessionId && (name === keepSessionId || name === keepSessionId + '.json')) {
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const sidUser =
      data && data.user && typeof data.user === 'object' ? data.user.id : null;
    if (sidUser === userId) {
      try {
        fs.unlinkSync(full);
        revoked += 1;
      } catch {
        /* ignore busy files */
      }
    }
  }
  return { revoked };
}

module.exports = { revokeUserSessions };
