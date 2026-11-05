'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const APP_ID = 'complaints-system';
const FORMAT = 1;

function defaultUserDataHint() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'complaints-local-system');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'complaints-local-system');
  }
  return path.join(os.homedir(), '.local', 'share', 'complaints-local-system');
}

function writeDataRootMarker(dataDir, { databasePath, attachmentsPath } = {}) {
  const marker = path.join(dataDir, 'data-root.json');
  const body = {
    application_id: APP_ID,
    data_directory_format: FORMAT,
    database_path: path.basename(databasePath || 'complaints.sqlite'),
    attachments_path: attachmentsPath || 'attachments',
    state: 'ready',
    updated_at: new Date().toISOString()
  };
  const tmp = marker + '.tmp';
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, marker);
  return marker;
}

function readDataRootMarker(dataDir) {
  const marker = path.join(dataDir, 'data-root.json');
  if (!fs.existsSync(marker)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (value?.application_id !== APP_ID) return null;
    return value;
  } catch {
    return null;
  }
}

function describeDataLocation(databasePath) {
  const abs = path.resolve(databasePath);
  const dataDir = path.dirname(abs);
  const marker = readDataRootMarker(dataDir);
  return {
    databasePath: abs,
    dataDir,
    markerPresent: Boolean(marker),
    marker,
    platformDefaultHint: defaultUserDataHint(),
    outsideInstallTree: !abs.includes('node_modules') && !/Complaints-System[/\\]data/.test(abs)
  };
}

module.exports = {
  APP_ID,
  FORMAT,
  defaultUserDataHint,
  writeDataRootMarker,
  readDataRootMarker,
  describeDataLocation
};
