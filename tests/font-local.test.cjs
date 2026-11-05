'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('active Cairo font is bundled and preloaded locally in both writing systems', () => {
 const system=read('ui-system.css'),html=read('index.html'),pkg=JSON.parse(read('package.json')),server=read('server.js');
 assert.match(system,/--font:\s*"Cairo"/);assert.match(system,/font-weight: 200 1000/);
 for(const subset of ['arabic','latin']){
  const file='cairo-'+subset+'-wght-normal.woff2';
  assert.ok(system.includes('/assets/fonts/'+file));assert.ok(server.includes('/assets/fonts/'+file));
  assert.equal(fs.readFileSync(path.join(root,'assets/fonts',file)).subarray(0,4).toString(),'wOF2');
 }
 assert.match(html,/rel="preload" href="\/assets\/fonts\/cairo-arabic-wght-normal\.woff2"/);
 assert.doesNotMatch(html,/href="(?:thmanyah-fonts|ui-compat)\.css"/);assert.ok(pkg.build.files.includes('assets/fonts/**'));
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
