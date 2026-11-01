'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Thmanyah Sans is the first Arabic UI font and uses only local installed faces', () => {
  const faces = read('thmanyah-fonts.css');
  const ui = read('ui-enhancements.css');
  const styles = read('styles.css');
  const html = read('index.html');
  for (const weight of [400, 500, 700]) {
    assert.match(faces, new RegExp('font-weight:\\s*' + weight + '\\s*;'));
  }
  assert.match(faces, /src:\s*local\(/);
  assert.doesNotMatch(faces, /url\s*\(|\.woff2|\.otf|https?:\/\//);
  assert.match(ui, /--ui-font:\s*"Thmanyah Sans"/);
  assert.match(styles, /font-family:\s*"Thmanyah Sans"/);
  assert.match(html, /href="thmanyah-fonts\.css"/);
});

test('Font binaries and reconstruction sources are not bundled or served', () => {
  const pkg = JSON.parse(read('package.json'));
  const server = read('server.js');
  assert.ok(pkg.build.files.includes('!fonts/**/*'));
  assert.ok(pkg.build.files.includes('!fonts-src/**/*'));
  assert.doesNotMatch(server, /express\.static\(path\.join\(__dirname, 'fonts'\)/);
  assert.ok(!pkg.scripts.fonts, 'No script should distribute partial font sources');
  assert.doesNotMatch(pkg.scripts.postinstall, /ensure-thmanyah-font/);
  assert.equal(fs.existsSync(path.join(root, 'fonts-src')), false);
});
