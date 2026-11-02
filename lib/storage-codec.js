'use strict';
const crypto = require('node:crypto');
const MAGIC = Buffer.from('CSSTORE1');

function createStorageCodec(secret) {
  if (!secret) return {
    enabled: false, encodeJson: JSON.stringify, decodeJson: JSON.parse,
    seal: value => value, open: value => value
  };
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Storage key must contain at least 32 characters.');
  const key = crypto.createHash('sha256').update('complaints-storage-v1\0' + secret).digest();
  function seal(plain, context) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(String(context)));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  }
  function open(bytes, context) {
    if (!Buffer.isBuffer(bytes) || bytes.length < MAGIC.length + 28 ||
        !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unencrypted or invalid protected data.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
    decipher.setAAD(Buffer.from(String(context)));
    decipher.setAuthTag(bytes.subarray(20, 36));
    return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  }
  return {
    enabled: true, seal, open,
    encodeJson(value, context) {
      return JSON.stringify({ storage: 'aes-256-gcm-v1', sealed: seal(Buffer.from(JSON.stringify(value)), context).toString('base64') });
    },
    decodeJson(text, context) {
      const parsed = JSON.parse(text);
      if (parsed?.storage !== 'aes-256-gcm-v1' || typeof parsed.sealed !== 'string') throw new Error('Protected JSON is missing encryption.');
      return JSON.parse(open(Buffer.from(parsed.sealed, 'base64'), context).toString('utf8'));
    }
  };
}
const plainCodec = createStorageCodec();
const storageFor = db => db.storageCodec || plainCodec;
const isSealed = bytes => Buffer.isBuffer(bytes) && bytes.subarray(0, 8).equals(MAGIC);
module.exports = { createStorageCodec, storageFor, isSealed };
