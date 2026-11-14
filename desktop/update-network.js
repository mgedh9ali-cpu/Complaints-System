'use strict';
const { Readable } = require('node:stream');

// Electron net.fetch does not reliably expose manual redirect responses.
// Keep Chromium's system proxy support while handling every redirect ourselves.
function createNetworkFetch(net) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return; }
    const request = net.request({ url, redirect: 'manual', useSessionCookies: false });
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    const abort = () => { request.abort(); if (!settled) { settled = true; reject(options.signal.reason); } cleanup(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    const headersFor = values => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(values || {})) {
        for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(key, item);
      }
      return headers;
    };
    request.on('error', error => { cleanup(); if (!settled) { settled = true; reject(error); } });
    request.on('redirect', (status, _method, location, headers) => {
      if (settled) return;
      settled = true; cleanup();
      const result = headersFor(headers); result.set('location', location);
      resolve(new Response(null, { status, headers: result }));
      request.abort();
    });
    request.on('response', response => {
      if (settled) return;
      settled = true;
      response.once('end', cleanup); response.once('close', cleanup);
      const body = [204, 205, 304].includes(response.statusCode) ? null : Readable.toWeb(response);
      resolve(new Response(body, { status: response.statusCode, headers: headersFor(response.headers) }));
    });
    try {
      for (const [key, value] of Object.entries(options.headers || {})) request.setHeader(key, value);
      request.end();
    } catch (error) { cleanup(); request.abort(); reject(error); }
  });
}
module.exports = { createNetworkFetch };
