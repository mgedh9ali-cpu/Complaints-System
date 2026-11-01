'use strict';

function parsedHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLocalAppUrl(value, appOrigin) {
  const candidate = parsedHttpUrl(value);
  return Boolean(candidate && candidate.origin === appOrigin);
}

function isPermittedExternalUrl(value, appOrigin) {
  const candidate = parsedHttpUrl(value);
  return Boolean(candidate && candidate.origin !== appOrigin);
}

module.exports = { isLocalAppUrl, isPermittedExternalUrl };
