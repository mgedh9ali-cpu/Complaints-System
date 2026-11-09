'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Thmanyah Sans is primary across the interface, startup, and printed HTML', () => {
  const system = read('ui-system.css');
  const layout = read('ui-layout.css');
  const html = read('index.html');
  const local = read('thmanyah-fonts.css');
  const splash = read('desktop/splash.html');
  const printed = read('ui/features/documents.js');
  const sw = read('sw.js');
  const server = read('server.js');

  assert.match(system, /--font:\s*"Thmanyah Sans","ThmanyahSans","Cairo"/);
  assert.match(layout, /--ui-font:\s*var\(--font\)/);
  assert.match(layout, /font-family:\s*var\(--ui-font\)\s*!important/);
  assert.match(html, /href="thmanyah-fonts\.css"/);
  assert.ok(html.indexOf('href="thmanyah-fonts.css"') < html.indexOf('href="ui-system.css"'));
  assert.match(local, /src:\s*local\("Thmanyah Sans Regular"\)/);
  for (const weight of [300, 400, 500, 700, 900]) {
    assert.match(local, new RegExp('font-weight: ' + weight + ';'));
  }
  assert.doesNotMatch(local, /url\(|https?:\/\//);
  assert.match(splash, /font:600 18px "Thmanyah Sans"/);
  assert.equal((printed.match(/font-family:"Thmanyah Sans"/g) || []).length, 2);
  assert.match(sw, /'\/thmanyah-fonts\.css'/);
  assert.match(server, /'\/thmanyah-fonts\.css': 'thmanyah-fonts\.css'/);
});

test('Cairo and Noto remain bundled as licensed fallbacks but no Thmanyah payload is distributed', () => {
  const system=read('ui-system.css');
  const pkg=JSON.parse(read('package.json'));
  const server=read('server.js');
  const gitignore=read('.gitignore');
  assert.match(system, /font-weight: 200 1000/);
  for (const subset of ['arabic', 'latin']) {
    const file = 'cairo-' + subset + '-wght-normal.woff2';
    assert.ok(system.includes('/assets/fonts/' + file));
    assert.ok(server.includes('/assets/fonts/' + file));
    assert.equal(fs.readFileSync(path.join(root, 'assets/fonts', file)).subarray(0, 4).toString(), 'wOF2');
  }
  assert.ok(fs.existsSync(path.join(root, 'assets/NotoSansArabic.ttf')));
  assert.ok(pkg.build.files.includes('assets/fonts/**'));
  assert.ok(pkg.build.files.includes('!assets/fonts/thmanyah/**/*'));
  assert.ok(pkg.build.files.includes('!fonts/**/*'));
  assert.ok(pkg.build.files.includes('!fonts-src/**/*'));
  assert.doesNotMatch(server, /'\/assets\/fonts\/thmanyah\//);
  assert.match(gitignore, /assets\/fonts\/thmanyah\/\*/);
  assert.equal(fs.existsSync(path.join(root, 'scripts/ensure-thmanyah-fonts.js')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets/fonts/thmanyah')), ['.gitkeep']);
});
