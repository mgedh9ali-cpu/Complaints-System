'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { API, selectRelease, downloadVerified, fileHash, createReleaseFetch } = require('./update-core');
const { createNetworkFetch } = require('./update-network');

const portableFilename = /^complaints-system-.*-portable(?: \(\d+\))?\.exe$/i;

function readReceipt(base) {
  try { return JSON.parse(fs.readFileSync(path.join(base, 'update-receipt.json'), 'utf8')); }
  catch (_) { return null; }
}
function saveReceipt(base, receipt) {
  const file = path.join(base, 'update-receipt.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(receipt), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function installedCommit() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')).commit; }
  catch (_) { return null; }
}
function history(base) {
  try {
    const entries = JSON.parse(fs.readFileSync(path.join(base, 'update-history.json'), 'utf8'));
    return Array.isArray(entries) ? entries.slice(0, 30) : [];
  } catch (_) { return []; }
}
function recordHistory(base, state, version, commit, message) {
  try {
    const file = path.join(base, 'update-history.json');
    const entries = [{ at: new Date().toISOString(), state, version, commit, message }, ...history(base)].slice(0, 30);
    fs.writeFileSync(file + '.tmp', JSON.stringify(entries), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  } catch (_) { /* history failure must not interrupt a verified update */ }
}
function validStaging(base, staging) {
  return typeof staging === 'string' && path.dirname(staging) === path.join(base, 'updates') && /^[a-f0-9-]{36}$/.test(path.basename(staging));
}
let activeStatus;
function statusWindow(parent, initial = {}) {
  activeStatus?.close();
  const { BrowserWindow } = require('electron');
  const window = new BrowserWindow({ width: 760, height: 690, minWidth: 480, minHeight: 400, parent, modal: true, autoHideMenuBar: true, title: 'تحديث التطبيق',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'update-preload.js') } });
  let status = { message: 'جارٍ التحقق من آخر إصدار…', ...initial }, locked = true, receiveToken, receiveConfirmation, cancelDownload;
  const send = () => { if (!window.isDestroyed()) window.webContents.send('complaints:update-status', status); };
  window.on('close', event => { if (locked) { event.preventDefault(); if (status.cancelable) cancelDownload?.(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('did-finish-load', send);
  window.loadFile(path.join(__dirname, 'update.html')).catch(() => {});
  const { ipcMain } = require('electron');
  ipcMain.handle('complaints:update-token', (event, token) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !receiveToken) throw new Error('مصدر غير مسموح.');
    if (typeof token !== 'string' || !/^(github_pat_|ghp_)[a-zA-Z0-9_]{20,280}$/.test(token)) return false;
    const resolve = receiveToken; receiveToken = null; resolve(token); return true;
  });
  ipcMain.handle('complaints:update-confirm', event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !receiveConfirmation) throw new Error('مصدر غير مسموح.');
    const resolve = receiveConfirmation;
    receiveConfirmation = null;
    activeStatus.show({ canInstall: false, message: 'جارٍ تجهيز التنزيل…' });
    resolve(true);
  });
  window.on('closed', () => {
    ipcMain.removeHandler('complaints:update-token');
    ipcMain.removeHandler('complaints:update-confirm');
    receiveToken?.(null);
    receiveConfirmation?.(false);
  });
  activeStatus = {
    show(next) { status = { ...status, ...next }; locked = !status.done && !status.needsToken && !status.canInstall; send(); },
    setCancel(callback) { cancelDownload = callback; },
    close() { locked = false; if (!window.isDestroyed()) window.close(); },
    confirm(release) {
      return new Promise(resolve => {
        receiveConfirmation = resolve;
        this.show({
          message: 'يتوفر إصدار جديد. ينشئ التطبيق نسخة احتياطية قبل التثبيت، ثم يُعاد تشغيله.',
          version: release.version,
          notes: release.notes,
          availableCommit: release.commit,
          publishedAt: release.publishedAt,
          total: release.size,
          canInstall: true
        });
      });
    },
    token() {
      locked = false;
      status = { ...status, message: 'يلزم إعداد صلاحية القراءة مرة واحدة. يمكنك إغلاق النافذة للإلغاء.', needsToken: true };
      send();
      return new Promise(resolve => { receiveToken = resolve; });
    }
  };
  return activeStatus;
}
async function runUpdate({ app, window, paths, runtime, admin }) {
  if (process.platform !== 'win32' || !app.isPackaged) throw new Error('التحديث التلقائي متاح في نسخة Windows المثبتة أو المحمولة.');
  const base = paths.applicationBase;
  const current = app.getVersion(), commit = installedCommit();
  const view = statusWindow(window, { currentVersion: current, currentCommit: commit, history: history(base) });
  let staging, handedOff = false, release;
  const controller = new AbortController();
  view.setCancel(() => controller.abort(new Error('أُلغي التنزيل بناءً على طلبك.')));
  const previous = readReceipt(paths.applicationBase);
  try {
    const { net, safeStorage } = require('electron');
    const tokenFile = path.join(paths.applicationBase, 'update-access.bin');
    let token;
    try { token = safeStorage.decryptString(fs.readFileSync(tokenFile)); } catch (_) {}
    const networkFetch = createNetworkFetch(net);
    let fetch = createReleaseFetch(networkFetch, token);
    const list = () => fetch(API + '/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
    let response = await list();
    if ([401, 403, 404].includes(response.status)) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('حماية رمز الوصول غير متاحة على هذا الجهاز.');
      token = await view.token();
      if (!token) return;
      fetch = createReleaseFetch(networkFetch, token);
      response = await list();
      if (response.ok) fs.writeFileSync(tokenFile, safeStorage.encryptString(token), { mode: 0o600 });
      view.show({ needsToken: false });
    }
    if (!response.ok) throw new Error('تعذر الاتصال بخادم التحديثات (' + response.status + '). أعد المحاولة لاحقًا.');
    // Release metadata contains GitHub's digest for the exact published installer.
    const releases = await response.json();
    release = selectRelease(releases, current, previous?.state === 'complete' && previous.commit === commit && previous.version === current ? previous.tag : null, commit);
    if (!release) {
      recordHistory(base, 'checked', current, commit, 'لم يُعثر على بناء أحدث مطابق لقناة التحديث.');
      view.show({ message: 'لم يُعثر على إصدار أحدث متوافق في قناة التحديث الحالية.', version: current, done: true, history: history(base) }); return;
    }
    if (!await view.confirm(release)) { recordHistory(base, 'cancelled', release.version, release.commit, 'أُلغيت معاينة التحديث.'); return; }
    staging = path.join(paths.applicationBase, 'updates', crypto.randomUUID());
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    const installer = path.join(staging, 'setup.exe');
    view.show({ message: 'جارٍ تنزيل التحديث…', phase: 'التنزيل', percent: 0, downloaded: 0, total: release.size, cancelable: true });
    await downloadVerified({ fetch, release, destination: installer, signal: controller.signal, onProgress: (percent, details) => view.show({ percent, ...details }) });
    view.show({ cancelable: false, phase: 'التحقق', message: 'تم التحقق من حجم الملف وبصمته.' });
    await admin();
    view.show({ message: 'تم التحقق من الملف. جارٍ حفظ نسخة احتياطية قبل التثبيت…', phase: 'النسخ الاحتياطي', percent: null });
    if (!await runtime.backupScheduler.runOnce()) throw new Error('لم تكتمل النسخة الاحتياطية. أعد المحاولة بعد اكتمال النسخ أو إصلاح مجلده. لم يبدأ التثبيت.');
    const user = await admin();
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    const oldPortable = portable && portableFilename.test(path.basename(portable))
      ? { file: path.resolve(portable), sha256: await fileHash(portable) } : null;
    const receipt = { ...release, state: 'pending', staging, oldPortable, preparedAt: new Date().toISOString() };
    const config = path.join(staging, 'install.json');
    fs.copyFileSync(path.join(__dirname, 'install-update.ps1'), path.join(staging, 'install.ps1'));
    fs.writeFileSync(config, JSON.stringify({ pid: process.pid, installer, sha256: release.sha256 }), { mode: 0o600 });
    runtime.audit(user.id, 'application_update_prepared', 'system', release.version, { tag: release.tag, sha256: release.sha256 });
    saveReceipt(paths.applicationBase, receipt);
    view.show({ phase: 'التثبيت', message: 'جارٍ بدء التثبيت. سيُغلق التطبيق ويظهر شريط تثبيت Windows، ثم تفتح النسخة الجديدة تلقائيًا.', percent: null });
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(staging, 'install.ps1'), '-Config', config], { detached: true, stdio: 'ignore', windowsHide: true, cwd: staging });
    await once(child, 'spawn');
    child.unref();
    handedOff = true;
    recordHistory(base, 'pending', release.version, release.commit, 'بدأ التثبيت؛ لم يُؤكّد تشغيل البناء الجديد بعد.');
    view.close();
    app.quit();
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const message = cancelled ? 'أُلغي التنزيل. لم يبدأ التثبيت.' : 'تعذّر إكمال التحديث قبل تسليم التثبيت. ' + String(error.message || '').slice(0, 300);
    recordHistory(base, cancelled ? 'cancelled' : 'failed', release?.version || current, release?.commit || commit, cancelled ? 'أُلغي التنزيل.' : 'تعذّر إكمال التحديث قبل التثبيت.');
    view.show({ message, cancelable: false, percent: null, done: true, history: history(base) });
    if (previous) saveReceipt(paths.applicationBase, previous);
    else fs.rmSync(path.join(paths.applicationBase, 'update-receipt.json'), { force: true });
  } finally {
    if (staging && !handedOff) fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function completeUpdate({ app, window, paths }) {
  const receipt = readReceipt(paths.applicationBase);
  if (!receipt || !['pending', 'complete'].includes(receipt.state) || !app.isPackaged) return false;
  const commit = installedCommit();
  if (receipt.state === 'pending' && validStaging(paths.applicationBase, receipt.staging) && fs.existsSync(path.join(receipt.staging, 'install.json.error'))) {
    saveReceipt(paths.applicationBase, { ...receipt, state: 'failed' });
    recordHistory(paths.applicationBase, 'failed', receipt.version, receipt.commit, 'أبلغ مثبّت Windows عن فشل العملية.');
    const view = statusWindow(window, { currentVersion: app.getVersion(), currentCommit: commit, history: history(paths.applicationBase) });
    view.show({ message: 'أبلغ مثبّت Windows عن فشل التحديث. لم يُعتمد الإصدار الجديد ولم تُحذف النسخة المحمولة السابقة. يمكنك إعادة المحاولة من الإعدادات.', version: receipt.version, done: true });
    return false;
  }
  if (!commit) return false;
  // Called only after the server, database checks and main page loaded successfully.
  // A previous executable with the same version cannot acknowledge a newer build.
  if (receipt.version !== app.getVersion() || receipt.commit !== commit) return false;
  if (receipt.state === 'complete' && !receipt.cleanupPending) return false;
  let cleanupPending = false;
  if (receipt.oldPortable && !process.env.PORTABLE_EXECUTABLE_FILE) {
    const old = receipt.oldPortable;
    if (portableFilename.test(path.basename(old.file)) && path.resolve(old.file) !== path.resolve(app.getPath('exe'))) {
      try {
        if (fs.existsSync(old.file) && await fileHash(old.file) === old.sha256) {
          for (let attempt = 0; ; attempt++) {
            try {
              fs.rmSync(old.file, { force: true });
              break;
            } catch (error) {
              if (attempt >= 4 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
              await delay(500);
              if (!fs.existsSync(old.file) || await fileHash(old.file) !== old.sha256) break;
            }
          }
        }
      } catch (_) { cleanupPending = true; }
    }
  }
  // Remove only the dedicated download folder, never application data or backups.
  const updateRoot = path.join(paths.applicationBase, 'updates');
  if (typeof receipt.staging === 'string' && path.dirname(receipt.staging) === updateRoot && /^[a-f0-9-]{36}$/.test(path.basename(receipt.staging))) {
    try { fs.rmSync(receipt.staging, { recursive: true, force: true }); } catch (_) { cleanupPending = true; }
  }
  saveReceipt(paths.applicationBase, { ...receipt, state: 'complete', cleanupPending });
  if (receipt.state === 'complete') return false;
  recordHistory(paths.applicationBase, 'complete', receipt.version, receipt.commit, 'تم تشغيل البناء الجديد والتحقق من هويته.');
  const view = statusWindow(window, { currentVersion: app.getVersion(), currentCommit: commit, history: history(paths.applicationBase), publishedAt: receipt.publishedAt });
  view.show({ message: 'اكتمل التحديث بنجاح. حُفظت قاعدة البيانات والمرفقات والإعدادات.' + (cleanupPending ? ' بعض ملفات النسخة القديمة قيد الاستخدام. ستُعاد محاولة تنظيفها عند التشغيل القادم.' : ''), version: receipt.version, notes: receipt.notes, done: true });
  return true;
}
module.exports = { runUpdate, completeUpdate, readReceipt, saveReceipt };
