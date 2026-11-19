'use strict';

const { parentPort } = require('node:worker_threads');
const crypto = require('node:crypto');

parentPort.on('message', (msg) => {
  const { id, type, password, salt, keyLen, opts } = msg || {};
  try {
    if (type !== 'scrypt') {
      parentPort.postMessage({ id, error: 'unsupported task type' });
      return;
    }
    if (typeof password !== 'string' || !Buffer.isBuffer(salt) && typeof salt !== 'string') {
      parentPort.postMessage({ id, error: 'invalid scrypt inputs' });
      return;
    }
    const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'base64');
    const length = Number(keyLen) || 32;
    const options = opts && typeof opts === 'object' ? opts : { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
    crypto.scrypt(password, saltBuf, length, options, (err, key) => {
      if (err) {
        parentPort.postMessage({ id, error: err.message || 'scrypt failed' });
        return;
      }
      parentPort.postMessage({ id, key: key.toString('base64') }, []);
    });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message || 'worker error' });
  }
});
