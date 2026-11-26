'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createNetworkFetch } = require('../desktop/update-network');
const { selectRelease, compareVersions, downloadVerified, createReleaseFetch } = require('../desktop/update-core');
const bytes = Buffer.from('MZ synthetic installer fixture');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const commit = 'a'.repeat(40), version = '1.0.0-rc.9';
function published(overrides = {}) {
  const tag = 'v' + version + '-build.' + commit;
  return { tag_name: tag, draft: false, published_at: '2026-11-14T10:00:00Z', body: 'إصلاحات التحديث <script>unsafe</script>',
    assets: [{ id: 123, name: 'complaints-system-' + version + '-setup.exe', state: 'uploaded', size: bytes.length, digest: 'sha256:' + sha256,
      browser_download_url: 'https://github.com/mgedh9ali-cpu/Complaints-System/releases/download/' + tag + '/complaints-system-' + version + '-setup.exe' }], ...overrides };
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory;
}
test('selects immutable published installer builds, rejects downgrade, draft and completed builds', () => {
  const release = published();
  assert.equal(selectRelease([release], '1.0.0-rc.8').commit, commit);
  assert.equal(selectRelease([release], version, release.tag_name), null);
  assert.equal(selectRelease([release], '1.0.0'), null);
  assert.equal(selectRelease([published({ draft: true })], '1.0.0-rc.8'), null);
  assert.equal(selectRelease([published({ tag_name: 'v1.0.0-rc.9' })], '1.0.0-rc.8'), null);
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.99'), 1);
});
test('rejects missing digests, oversized assets and external executable sources', () => {
  for (const mutate of [a => { delete a.digest; }, a => { a.size = 2 ** 40; }, a => { a.browser_download_url = 'https://example.com/setup.exe'; }]) {
    const release = published(); mutate(release.assets[0]); assert.throws(() => selectRelease([release], version));
  }
});
test('download progress reaches exact size and verified bytes, while corrupted or partial files are removed', async t => {
  const root = temporary(t), release = selectRelease([published()], version);
  const progress = [];
  const fetch = async () => new Response(bytes);
  const destination = path.join(root, 'setup.exe');
  await downloadVerified({ fetch, release, destination, onProgress: value => progress.push(value) });
  assert.deepEqual(fs.readFileSync(destination), bytes); assert.equal(progress.at(-1), 100);
  for (const content of [Buffer.from('wrong bytes'), Buffer.concat([bytes, bytes]), Buffer.alloc(bytes.length, 0)]) {
    const bad = path.join(root, crypto.randomUUID() + '.exe');
    await assert.rejects(downloadVerified({ fetch: async () => new Response(content), release, destination: bad }));
    assert.equal(fs.existsSync(bad), false);
  }
  await assert.rejects(downloadVerified({ fetch, release, destination }));
  assert.deepEqual(fs.readFileSync(destination), bytes, 'an existing file must never be overwritten or deleted');
});
test('private asset redirect drops credentials and rejects foreign redirect destinations', async () => {
  const calls = [];
  const fetch = createReleaseFetch(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?signature=test' } }) : new Response(bytes);
  }, 'test-only-secret');
  await fetch('https://api.github.com/repos/mgedh9ali-cpu/Complaints-System/releases/assets/123');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-secret');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.credentials, 'omit');
  const unsafe = createReleaseFetch(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } }), 'test-only-secret');
  await assert.rejects(unsafe('https://api.github.com/repos/mgedh9ali-cpu/Complaints-System/releases/assets/123'));
});
test('Chromium network adapter exposes redirects, streams bytes and honors cancellation', async () => {
  let request;
  const net = { request(options) {
    assert.equal(options.redirect, 'manual'); assert.equal(options.useSessionCookies, false);
    request = new EventEmitter(); request.setHeader = () => {}; request.end = () => {};
    request.abort = () => request.emit('error', new Error('cancelled'));
    return request;
  } };
  const fetch = createNetworkFetch(net);
  const redirected = fetch('https://api.github.com/test');
  request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/test', {});
  assert.equal((await redirected).headers.get('location'), 'https://release-assets.githubusercontent.com/test');
  const streamed = fetch('https://release-assets.githubusercontent.com/test');
  const response = Readable.from([bytes]); response.statusCode = 200; response.headers = { 'content-length': String(bytes.length) };
  request.emit('response', response);
  assert.deepEqual(Buffer.from(await (await streamed).arrayBuffer()), bytes);
  const controller = new AbortController();
  const cancelled = fetch('https://api.github.com/test', { signal: controller.signal });
  controller.abort(new Error('timeout')); await assert.rejects(cancelled);
});

function harness(t, { backup = true, corrupt = false, revoke = false, bundledCommit = commit, spawnError = false, approve = true } = {}) {
  const base = temporary(t), messages = [], handlers = new Map();
  const calls = { quit: 0, spawn: 0, backup: 0, admin: 0, audit: 0 };
  const data = path.join(base, 'data'); fs.mkdirSync(data); fs.writeFileSync(path.join(data, 'complaints.sqlite'), 'existing database');
  fs.writeFileSync(path.join(base, '.env'), 'existing encryption keys');
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.send = (_channel, status) => {
        messages.push(status);
        if (!status.canInstall || this.promptHandled) return;
        this.promptHandled = true;
        queueMicrotask(() => {
          if (!approve) { this.close(); return; }
          handlers.get('complaints:update-confirm')({ sender: this.webContents, senderFrame: this.webContents.mainFrame });
        });
      };
      this.webContents.setWindowOpenHandler = () => {}; }
    loadFile() { queueMicrotask(() => this.webContents.emit('did-finish-load')); return Promise.resolve(); }
    isDestroyed() { return this.destroyed || false; }
    close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); if (!prevented) { this.destroyed = true; this.emit('closed'); } }
  }
  const source = fs.readFileSync(path.join(__dirname, '../desktop/updater.js'), 'utf8');
  const sandbox = { module: { exports: {} }, __dirname: path.join(__dirname, '../desktop'), process: { platform: 'win32', pid: process.pid, env: { SystemRoot: 'C:/Windows' } }, AbortSignal, URL,
    require(name) {
      if (name === 'electron') return { BrowserWindow: Window, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
        safeStorage: { decryptString() { return 'test-only-token'; } },
        net: { async fetch(url) { return url.includes('/assets/') ? new Response(corrupt ? 'corrupt' : bytes) : new Response(JSON.stringify([published()])); } } };
      if (name === 'node:child_process') return { spawn() { calls.spawn++; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit(spawnError ? 'error' : 'spawn', new Error('simulated failure'))); return child; } };
      if (name === 'node:fs') return { ...fs, readFileSync(file, ...args) { if (String(file).endsWith('build-info.json')) return JSON.stringify({ commit: bundledCommit }); return fs.readFileSync(file, ...args); } };
      if (name === './update-core') return require('../desktop/update-core');
      if (name === './update-network') return { createNetworkFetch: net => net.fetch.bind(net) };
      return require(name);
    }
  };
  vm.runInNewContext(source, sandbox);
  const options = { app: { isPackaged: true, getVersion: () => version, getPath: () => path.join(base, 'installed.exe'), quit() { calls.quit++; } },
    paths: { applicationBase: base }, window: {}, runtime: { backupScheduler: { async runOnce() { calls.backup++; return backup; } }, audit() { calls.audit++; } },
    async admin() { calls.admin++; if (revoke && calls.admin > 1) throw new Error('revoked'); return { id: 'admin' }; } };
  return { base, calls, messages, options, environment: sandbox.process.env, updater: sandbox.module.exports };
}
test('closing the release preview cancels before download or installation', async t => {
  const h = harness(t, { approve: false });
  await h.updater.runUpdate(h.options);
  assert.ok(h.messages.some(status => status.canInstall && status.notes));
  assert.equal(fs.existsSync(path.join(h.base, 'updates')), false);
  assert.equal(h.calls.backup, 0);
  assert.equal(h.calls.spawn, 0);
  assert.equal(h.calls.quit, 0);
  assert.equal(h.updater.readReceipt(h.base), null);
});
test('verified download and backup precede installation; startup of the expected build acknowledges success and preserves data', async t => {
  const h = harness(t);
  await h.updater.runUpdate(h.options);
  assert.equal(h.calls.backup, 1); assert.equal(h.calls.spawn, 1); assert.equal(h.calls.quit, 1);
  assert.equal(h.updater.readReceipt(h.base).state, 'pending');
  assert.equal(await h.updater.completeUpdate(h.options), true);
  assert.equal(h.updater.readReceipt(h.base).state, 'complete');
  assert.ok(h.messages.some(item => item.done && item.version === version && item.notes.includes('إصلاحات')));
  assert.equal(fs.readFileSync(path.join(h.base, 'data', 'complaints.sqlite'), 'utf8'), 'existing database');
  assert.equal(fs.readFileSync(path.join(h.base, '.env'), 'utf8'), 'existing encryption keys');
});
test('failed checksums, backups, revoked permissions or helper launch never quit or acknowledge installation', async t => {
  for (const failure of [{ corrupt: true }, { backup: false }, { revoke: true }, { spawnError: true }]) {
    const h = harness(t, failure); await h.updater.runUpdate(h.options);
    assert.equal(h.calls.quit, 0); assert.equal(h.updater.readReceipt(h.base), null);
    assert.ok(h.messages.at(-1).done); assert.equal(fs.readFileSync(path.join(h.base, '.env'), 'utf8'), 'existing encryption keys');
  }
});
test('an old build with a reused version cannot confirm or delete pending update files', async t => {
  const h = harness(t, { bundledCommit: 'b'.repeat(40) });
  await h.updater.runUpdate(h.options);
  const receipt = h.updater.readReceipt(h.base);
  assert.equal(await h.updater.completeUpdate(h.options), false);
  assert.equal(h.updater.readReceipt(h.base).state, 'pending'); assert.equal(fs.existsSync(receipt.staging), true);
});
test('the original portable executable is removed only after the new installed build starts; a changed file is kept', async t => {
  for (const changed of [false, true]) {
    const h = harness(t), portable = path.join(h.base, 'complaints-system-1.0.0-rc.8-portable (1).exe');
    fs.writeFileSync(portable, bytes); h.environment.PORTABLE_EXECUTABLE_FILE = portable;
    await h.updater.runUpdate(h.options);
    assert.equal(fs.existsSync(portable), true, 'download or shutdown must never remove the previous executable');
    if (changed) fs.writeFileSync(portable, 'a different file');
    delete h.environment.PORTABLE_EXECUTABLE_FILE;
    await h.updater.completeUpdate(h.options);
    assert.equal(fs.existsSync(portable), changed);
    assert.equal(fs.existsSync(path.join(h.base, 'data', 'complaints.sqlite')), true);
  }
});
