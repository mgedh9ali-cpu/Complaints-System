'use strict';
const fs = require('node:fs');
const path = require('node:path');

function pruneBackups(directory, now = Date.now()) {
  if (!fs.existsSync(directory)) return;
  const snapshots = fs.readdirSync(directory).filter(n => /^automatic-.*\.csb$/.test(n))
    .map(name => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const days = new Set();
  for (const file of snapshots) {
    const day = new Date(file.mtime).toISOString().slice(0, 10);
    const keep = now - file.mtime < 86400000 || (now - file.mtime < 30 * 86400000 && !days.has(day));
    if (keep) days.add(day);
    else fs.unlinkSync(path.join(directory, file.name));
  }
}

function createBackupScheduler({ backupService, directory, logger, intervalMs = 15 * 60000, now = () => new Date() }) {
  let running = false, timer;
  let status = { lastSuccessfulAt: null, lastError: null, running: false, intervalMinutes: intervalMs / 60000, retentionDays: 30 };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statusPath = path.join(directory, 'backup-status.json');
  try { status = { ...status, ...JSON.parse(fs.readFileSync(statusPath, 'utf8')), running: false }; } catch (_) {}
  function persist() {
    fs.writeFileSync(statusPath + '.tmp', JSON.stringify(status), { mode: 0o600 });
    fs.renameSync(statusPath + '.tmp', statusPath);
  }
  async function runOnce() {
    if (running) return false;
    running = true; status.running = true;
    let backup;
    try {
      backup = await backupService.createCompleteBackup();
      const destination = path.join(directory, 'automatic-' + now().toISOString().replace(/[:.]/g, '-') + '.csb');
      fs.copyFileSync(backup.destination, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      status.lastSuccessfulAt = now().toISOString(); status.lastError = null;
      pruneBackups(directory, now().getTime());
      logger?.info('Automatic encrypted backup verified', { filename: path.basename(destination) });
      return true;
    } catch (error) {
      status.lastError = error.message;
      logger?.error('Automatic encrypted backup failed', { message: error.message });
      return false;
    } finally {
      if (backup) backupService.cleanupBackupDir(backup.backupDir);
      status.running = false; running = false;
      persist();
    }
  }
  return {
    runOnce,
    start() { runOnce().catch(error => logger?.error('Backup status could not be saved', { message: error.message }));
      timer = setInterval(() => { runOnce().catch(error => logger?.error('Backup status could not be saved', { message: error.message })); }, intervalMs); timer.unref?.(); },
    stop() { clearInterval(timer); },
    status() { return { ...status, overdue: !status.lastSuccessfulAt || Date.now() - Date.parse(status.lastSuccessfulAt) > intervalMs * 2 }; }
  };
}
module.exports = { createBackupScheduler, pruneBackups };
