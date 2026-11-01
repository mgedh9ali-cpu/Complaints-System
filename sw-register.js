'use strict';

(() => {
  if (!('serviceWorker' in navigator)) return;
  if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    }).catch(() => {
      // A service worker is optional: authenticated data always requires Express.
    });
  });
})();
