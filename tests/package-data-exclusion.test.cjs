const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

test('Windows portable package excludes local secrets, citizen data and temporary backups', () => {
  const pkg = require('../package.json');
  const files = pkg.build.files || [];
  assert.ok(files.includes('!.env') || files.some(f => f.includes('.env')), 'missing !.env');
  assert.ok(files.includes('!data/**/*') || files.some(f => f.includes('data')), 'missing !data/**/*');
  const mainJs = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
  assert.match(mainJs, /process\.env\.DATABASE_PATH = paths\.databasePath/);
});

test('release package keeps the modular UI and configuration initializer', () => {
  const pkg = require('../package.json');
  assert.ok(!pkg.build.files.includes('**/*'), 'packaging must use an explicit source allowlist');
  const files = (pkg.build.files || []).map(f => String(f).replace(/\\/g, '/'));
  for (const inc of ['ui/**/*', 'scripts/**/*', 'modules/**/*', 'assets/**/*']) {
    assert.ok(files.includes(inc) || files.some(f => f.includes(inc.replace('/**/*', ''))), inc);
  }
  assert.ok(!files.some(x => /^!ui\//.test(x)));
  assert.ok(!files.some(x => /^!scripts\//.test(x)));
  const init = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
  assert.match(init, /initialize-local-config\.js/);
});