'use strict';

// Apply only to newly recorded events; rewriting old rows would break the chain.
const PRIVATE_FIELDS = new Set(['name','phone','nationalid','address','summary','details','notes','reply','text','body','message']);
function describePrivate(value) {
  return { redacted: true, ...(typeof value === 'string' || Array.isArray(value) ? { length: value.length } : {}) };
}
function sanitizeAuditDetails(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.replace(/[_-]/g, '').toLowerCase();
    if (/password|passwd|secret|token|cookie|authorization|apikey/.test(normalized)) return [key, '[REDACTED]'];
    if (PRIVATE_FIELDS.has(normalized)) {
      if (item && typeof item === 'object' && !Array.isArray(item) &&
          Object.keys(item).every(k => ['before','after'].includes(k))) {
        return [key, Object.fromEntries(Object.entries(item).map(([side, content]) => [side, describePrivate(content)]))];
      }
      return [key, describePrivate(item)];
    }
    return [key, sanitizeAuditDetails(item)];
  }));
}
module.exports = { sanitizeAuditDetails };
