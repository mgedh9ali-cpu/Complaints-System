'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const installerPath = path.join(root, 'installer', 'ComplaintsSystem.iss');
const launcherPath = path.join(root, 'start-installed-app.bat');
const browserPath = path.join(root, 'scripts', 'open-browser-new-window.ps1');
const workflowPath = path.join(root, '.github', 'workflows', 'windows-installer.yml');

test('Windows installer bundles the runtime and app dependencies in one setup executable', () => {
  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /OutputBaseFilename=Shubat-Al-Shakawi-Setup/);
  assert.match(installer, /payload\\node\.exe/);
  assert.match(installer, /payload\\\*\.dll/);
  assert.match(installer, /node_modules\\\*/);
  assert.match(installer, /PrivilegesRequired=lowest/);
  assert.match(installer, /autodesktop/);
  assert.match(installer, /autoprograms/);
  assert.match(installer, /\[Run\][\s\S]*Flags: postinstall nowait skipifsilent/);
  assert.doesNotMatch(installer, /Source:.*\.env/i, 'installer must not package a real local environment file');
  assert.doesNotMatch(installer, /Source:.*complaints\.sqlite/i, 'installer must not package a database');
});

test('installed launcher starts only the local server and does not download runtime files', () => {
  const launcher = fs.readFileSync(launcherPath, 'utf8');
  assert.match(launcher, /node\.exe --env-file=\.env server\.js/);
  assert.match(launcher, /127\.0\.0\.1/);
  assert.match(launcher, /initialize-local-config\.js/);
  assert.match(launcher, /open-browser-new-window\.ps1/);
  assert.doesNotMatch(launcher, /\bnpm\s+install\b/i);
  assert.doesNotMatch(launcher, /\bcurl\b|\binvoke-webrequest\b|\bstart-bitstransfer\b/i);
});

test('browser helper waits for local readiness and requests a new browser window', () => {
  const browser = fs.readFileSync(browserPath, 'utf8');
  assert.match(browser, /127\.0\.0\.1/);
  assert.match(browser, /AddSeconds\(90\)/);
  assert.match(browser, /--new-window/);
  assert.match(browser, /-new-window/);
  assert.match(browser, /Start-Process -FilePath/);
  assert.match(browser, /Start-Process \$url/, 'default-browser fallback should remain available');
  assert.doesNotMatch(browser, /https?:\/\/(?!127\.0\.0\.1)/i,
    'browser helper must not contact an external service');
});

test('Windows installer workflow tests the project before producing one EXE artifact', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /ISCC_PATH/);
  assert.match(workflow, /Shubat-Al-Shakawi-Setup\.exe/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});
