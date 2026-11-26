'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const SCRYPT_OPTS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const MAX_WORKERS = 2;
const IDLE_MS = 60_000;

let nextId = 1;
const queue = [];
const workers = [];
const busy = new Set();

function spawnWorker() {
  const worker = new Worker(path.join(__dirname, 'crypto-worker.js'));
  worker.__pending = new Map();
  worker.on('message', (msg) => {
    const pending = worker.__pending.get(msg.id);
    if (!pending) return;
    worker.__pending.delete(msg.id);
    busy.delete(worker);
    worker.unref();
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(Buffer.from(msg.key, 'base64'));
    drain();
    scheduleIdleExit(worker);
  });
  // An idle worker must not keep the process alive on its own (tests, CLI);
  // a worker with an assigned job is ref'd again in drain().
  worker.unref();
  worker.on('error', (err) => {
    for (const [, pending] of worker.__pending) pending.reject(err);
    worker.__pending.clear();
    busy.delete(worker);
    const idx = workers.indexOf(worker);
    if (idx >= 0) workers.splice(idx, 1);
    drain();
  });
  worker.on('exit', () => {
    const idx = workers.indexOf(worker);
    if (idx >= 0) workers.splice(idx, 1);
    busy.delete(worker);
  });
  workers.push(worker);
  return worker;
}

function scheduleIdleExit(worker) {
  if (worker.__idleTimer) clearTimeout(worker.__idleTimer);
  worker.__idleTimer = setTimeout(() => {
    if (worker.__pending.size || busy.has(worker) || queue.length) return;
    worker.terminate().catch(() => {});
  }, IDLE_MS);
  if (typeof worker.__idleTimer.unref === 'function') worker.__idleTimer.unref();
}

function takeWorker() {
  for (const w of workers) {
    if (!busy.has(w)) return w;
  }
  if (workers.length < MAX_WORKERS) return spawnWorker();
  return null;
}

function drain() {
  while (queue.length) {
    const worker = takeWorker();
    if (!worker) return;
    const job = queue.shift();
    busy.add(worker);
    worker.ref();
    if (worker.__idleTimer) {
      clearTimeout(worker.__idleTimer);
      worker.__idleTimer = null;
    }
    worker.__pending.set(job.id, { resolve: job.resolve, reject: job.reject });
    worker.postMessage(job.payload);
  }
}

function runScrypt(password, salt, keyLen = 32, opts = SCRYPT_OPTS) {
  const id = nextId++;
  const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  const payload = {
    id,
    type: 'scrypt',
    password,
    salt: saltBuf.toString('base64'),
    keyLen,
    opts
  };
  return new Promise((resolve, reject) => {
    queue.push({ id, payload, resolve, reject });
    drain();
  });
}

module.exports = { runScrypt, SCRYPT_OPTS };
