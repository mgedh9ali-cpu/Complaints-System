'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MAX_AUTOMATIC_RETENTION_DAYS = 7;

function pruneBackups(directory, now = Date.now(), retentionDays = MAX_AUTOMATIC_RETENTION_DAYS) {
  if (!fs.existsSync(directory)) return;
  const days = Number.isFinite(Number(retentionDays)) ? Math.max(1, Math.min(MAX_AUTOMATIC_RETENTION_DAYS, Math.floor(Number(retentionDays)))) : MAX_AUTOMATIC_RETENTION_DAYS;
  const keepMs = days * 86400000;
  const snapshots = fs.readdirSync(directory).filter(n => /^automatic-.*\.csb$/.test(n))
    .map(name => {
      try { const stat = fs.lstatSync(path.join(directory, name)); return stat.isFile() ? { name, mtime: stat.mtimeMs } : null; }
      catch (_) { return null; }
    }).filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of snapshots) {
    if (file.mtime < now - keepMs) {
      try { fs.unlinkSync(path.join(directory, file.name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function createBackupScheduler({ backupService, directory, logger, intervalMs = 15 * 60000, now = () => new Date() }) {
  let running = false, timer;
  let interval = Math.max(5 * 60000, intervalMs | 0);
  let status = {
    lastSuccessfulAt: null,
    lastError: null,
    lastRestoreTestAt: null,
    lastRestoreTestResult: null,
    lastRestoreTestDetail: null,
    lastRestoreTestFile: null,
    running: false,
    intervalMinutes: interval / 60000,
    retentionDays: MAX_AUTOMATIC_RETENTION_DAYS
  };
  let statusPath = path.join(directory, 'backup-status.json');
  try {
    const loaded = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    status = { ...status, ...loaded, retentionDays: MAX_AUTOMATIC_RETENTION_DAYS, running: false };
    if (Number.isFinite(status.intervalMinutes) && status.intervalMinutes >= 5) {
      interval = status.intervalMinutes * 60000;
    }
  } catch (_) {}
  function persist() {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(statusPath + '.tmp', JSON.stringify(status), { mode: 0o600 });
    fs.renameSync(statusPath + '.tmp', statusPath);
  }
  async function runOnce() {
    if (running) return false;
    running = true; status.running = true;
    let backup;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      backup = await backupService.createCompleteBackup();
      const destination = path.join(directory, 'automatic-' + now().toISOString().replace(/[:.]/g, '-') + '.csb');
      fs.copyFileSync(backup.destination, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      status.lastSuccessfulAt = now().toISOString(); status.lastError = null;
      pruneBackups(directory, now().getTime(), status.retentionDays);
      logger?.info('Automatic encrypted backup verified', { filename: path.basename(destination) });
      return true;
    } catch (error) {
      status.lastError = error.message;
      logger?.error('Automatic encrypted backup failed', { message: error.message });
      return false;
    } finally {
      if (backup) backupService.cleanupBackupDir(backup.backupDir);
      status.running = false; running = false;
      try { persist(); } catch (error) { status.lastError = error.message; logger?.error('Backup status could not be saved', { message: error.message }); }
    }
  }
  function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      runOnce().catch(error => logger?.error('Automatic backup failed', { message: error.message }));
    }, interval);
    timer.unref?.();
  }
  return {
    runOnce,
    setDirectory(nextDirectory) {
      if (running) throw new Error('انتظر اكتمال النسخة الجارية ثم أعد اختيار المجلد.');
      directory = path.resolve(nextDirectory);
      statusPath = path.join(directory, 'backup-status.json');
      status = { ...status, lastSuccessfulAt: null, lastError: null };
      persist();
    },
    configure({ intervalMinutes, retentionDays } = {}) {
      if (intervalMinutes != null) {
        const m = Number(intervalMinutes);
        if (!Number.isFinite(m) || m < 5 || m > 24 * 60) throw new Error('الفاصل يجب أن يكون بين 5 و 1440 دقيقة.');
        interval = Math.round(m) * 60000;
        status.intervalMinutes = interval / 60000;
        restartTimer();
      }
      if (retentionDays != null) {
        const d = Number(retentionDays);
        if (!Number.isFinite(d) || d !== MAX_AUTOMATIC_RETENTION_DAYS) throw new Error('سياسة النسخ التلقائي ثابتة: الاحتفاظ بآخر 7 أيام فقط.');
        status.retentionDays = MAX_AUTOMATIC_RETENTION_DAYS;
      }
      persist();
      return this.status();
    },
    recordRestoreTest({ ok, detail, filename } = {}) {
      status.lastRestoreTestAt = now().toISOString();
      status.lastRestoreTestResult = ok ? 'ok' : 'failed';
      status.lastRestoreTestDetail = typeof detail === 'string' ? detail.slice(0, 500) : null;
      status.lastRestoreTestFile = typeof filename === 'string' ? filename.slice(0, 200) : null;
      persist();
      return this.status();
    },
    start() {
      runOnce().catch(error => logger?.error('Automatic backup failed', { message: error.message }));
      restartTimer();
    },
    stop() { clearInterval(timer); },
    status() {
      return {
        ...status,
        directory,
        overdue: !status.lastSuccessfulAt || now().getTime() - Date.parse(status.lastSuccessfulAt) > interval * 2
      };
    }
  };
}
module.exports = { createBackupScheduler, pruneBackups };
