'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('active Arabic UI uses the bundled Tajawal font consistently and preloads it locally', () => {
  const fallback = read('fallback-font.css'), system = read('ui-system.css'), html = read('index.html');
  assert.match(fallback, /src:\s*url\("\/assets\/Tajawal-Regular\.ttf"\)/);
  assert.match(fallback, /--ui-font:\s*"Tajawal"/);
  assert.match(system, /--font:\s*"Tajawal"/);
  assert.match(system, /--ui-font:\s*var\(--font\)/);
  assert.match(html, /rel="preload" href="\/assets\/Tajawal-Regular\.ttf" as="font"/);
  assert.doesNotMatch(html, /rel="stylesheet" href="thmanyah-fonts\.css"/);
  assert.doesNotMatch(fallback, /https?:\/\//);
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
