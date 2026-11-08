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

test('the applied font is the bundled one, not a legacy stack', () => {
  const sheets = ['ui-system.css', 'ui-layout.css', 'ui-glass-ref.css', 'ui-21st-ref.css', 'ui-complaints-view.css', 'ui-transitions.css', 'ui-icon-motion.css', 'ui-table-motion.css'];
  for (const sheet of sheets) {
    const source = read(sheet);
    assert.doesNotMatch(source, /Thmanyah/i, sheet + ' must not reintroduce the unfinished font');
    assert.doesNotMatch(source, /font-family:\s*[^;]*Thmanyah/i, sheet + ' must not stack the unfinished font');
  }
  // Only the design system may declare the interface font, and it must point at the
  // token that carries the bundled family. A second font-family rule on the root
  // elements silently overrides the whole application typography.
  const system = read('ui-system.css');
  assert.match(system, /--font:\s*"Cairo"/);
  const foreign = sheets.filter(sheet => sheet !== 'ui-system.css')
    .filter(sheet => /(^|[\s,{}])(?:html|body)[^{]*\{[^}]*font-family/.test(read(sheet)));
  assert.deepEqual(foreign, [], 'only ui-system.css may set the interface font family');
});

test('the active font stack resolves only to locally bundled font files', () => {
  const system = read('ui-system.css');
  const stack = /--font:\s*([^;]+);/.exec(system);
  assert.ok(stack, 'the design system must declare a font stack');
  const families = [...stack[1].matchAll(/"([^"]+)"|([A-Za-z][\w-]*)/g)].map(match => match[1] || match[2]);
  const systemFamilies = new Set(['sans-serif', 'serif', 'monospace', 'Tahoma', 'Segoe UI', 'Arial']);
  const faces = new Map();
  for (const sheet of ['ui-system.css', 'fallback-font.css']) {
    for (const block of read(sheet).matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const family = /font-family:\s*"([^"]+)"/.exec(block[1]);
      const source = /url\("([^"]+)"\)/.exec(block[1]);
      if (family && source) faces.set(family[1], source[1]);
    }
  }
  for (const family of families) {
    if (systemFamilies.has(family)) continue;
    assert.ok(faces.has(family), family + ' must be provided by a local @font-face');
    const source = faces.get(family);
    assert.ok(source.startsWith('/'), family + ' must load from the local asset folder');
    assert.ok(fs.existsSync(path.join(root, source.replace(/^\//, ''))), source + ' must exist on disk');
  }
});

test('an unfinished font is never written to disk and never reaches the release', () => {
  const { ensureThmanyahFonts, isCompleteWoff2 } = require('../scripts/ensure-thmanyah-fonts');
  const complete = Buffer.alloc(64);
  complete.write('wOF2', 0, 'binary');
  complete.writeUInt32BE(64, 8);
  assert.equal(isCompleteWoff2(complete), true);
  const truncated = complete.subarray(0, 40);
  assert.equal(isCompleteWoff2(truncated), false, 'a truncated font must be rejected');
  assert.equal(isCompleteWoff2(Buffer.alloc(4)), false);

  const report = ensureThmanyahFonts(root);
  for (const weight of report.materialised) {
    const file = path.join(root, 'assets', 'fonts', 'thmanyah', `ThmanyahSans-${weight}.woff2`);
    assert.ok(fs.existsSync(file));
    assert.equal(isCompleteWoff2(fs.readFileSync(file)), true, weight + ' must be a whole WOFF2 file');
  }
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('!assets/fonts/thmanyah/**/*'), 'unfinished font parts must stay out of the release');
  assert.ok(pkg.build.files.includes('!thmanyah-fonts.css'));
  assert.doesNotMatch(read('index.html'), /thmanyah-fonts\.css/);
  assert.doesNotMatch(read('server.js'), /thmanyah-fonts\.css/);
});
