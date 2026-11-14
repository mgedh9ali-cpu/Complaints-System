'use strict';

/**
 * Fast 404 for common scanner probes and sensitive paths.
 * Runs before static routes so no disk or stack work is done.
 */
function createProbeGuard() {
  return function probeGuard(req, res, next) {
    const p = (req.path || '').toLowerCase();
    let raw = '';
    try {
      raw = decodeURIComponent(req.originalUrl || req.url || '').toLowerCase();
    } catch (_) {
      raw = String(req.originalUrl || req.url || '').toLowerCase();
    }
    const blocked =
      p.includes('/data/') ||
      p.startsWith('/data') ||
      p.includes('.sqlite') ||
      p.includes('.db') ||
      p.includes('.env') ||
      p.includes('/sessions') ||
      p.includes('node_modules') ||
      p.includes('/modules/') ||
      p.includes('/config/') ||
      p.includes('/scripts/') ||
      p.includes('/desktop/') ||
      p.includes('/.git') ||
      p.includes('/.ssh') ||
      p.includes('/.aws') ||
      p.includes('wp-admin') ||
      p.includes('wp-login') ||
      p.includes('phpmyadmin') ||
      p.includes('actuator') ||
      p.endsWith('.md') ||
      p.endsWith('.map') ||
      raw.includes('/.env') ||
      raw.includes('/.git/') ||
      raw.includes('/package-lock') ||
      raw.includes('/server.js') ||
      raw.includes('/desktop/main');
    if (blocked) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).end();
    }
    return next();
  };
}

module.exports = { createProbeGuard };
