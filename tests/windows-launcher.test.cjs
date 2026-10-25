'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const launcherPath = path.join(root, 'start-windows.bat');

test('Windows launcher exists and checks required local prerequisites', () => {
  assert.equal(fs.existsSync(launcherPath), true, 'Windows launcher must be present');
  const source = fs.readFileSync(launcherPath, 'utf8');

  assert.match(source, /where node/i, 'launcher must check for Node.js');
  assert.match(source, /20\.6/i, 'launcher must enforce the minimum Node.js version');
  assert.match(source, /if not exist ["']?\.env/i, 'launcher must refuse to run without local configuration');
  assert.match(source, /node_modules\\express\\package\.json/i, 'launcher must check that dependencies are preinstalled');
});

test('Windows launcher is offline-safe and runs tests before starting the server', () => {
  const source = fs.readFileSync(launcherPath, 'utf8');

  assert.match(source, /will NOT download packages or access the internet/i);
  assert.doesNotMatch(source, /\bnpm\s+install\b/i, 'launcher must not install or download dependencies');
  assert.doesNotMatch(source, /\bcurl\b|\binvoke-webrequest\b|\bstart-bitstransfer\b/i,
    'launcher must not contain common network download commands');

  const testIndex = source.indexOf('call npm test');
  const startIndex = source.indexOf('call npm start');
  assert.notEqual(testIndex, -1, 'launcher must run automated tests');
  assert.notEqual(startIndex, -1, 'launcher must start the local server');
  assert.ok(testIndex < startIndex, 'tests must run before the server starts');

  assert.match(source, /http:\/\/127\.0\.0\.1:3000/i, 'launcher must direct users to loopback only');
  assert.match(source, /Ctrl\+C/i, 'launcher must document how to stop the server');
});
