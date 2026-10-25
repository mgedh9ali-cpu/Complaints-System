const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const app = fs.readFileSync('app.js', 'utf8');

test('CSV sanitizer prefixes formula-leading values', () => {
  const definition = app.split(String.fromCharCode(10)).find(line => line.startsWith('function csvSafe(value)'));
  assert.ok(definition, 'csvSafe(value) must exist in app.js');
  const sanitizer = vm.runInNewContext('(' + definition.replace('function csvSafe', 'function') + ')');
  const payloads = ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '  =1+1', String.fromCharCode(9) + '=1+1', String.fromCharCode(1) + '@SUM(A1)'];
  for (const payload of payloads) {
    assert.equal(sanitizer(payload), "'" + payload, `should neutralize ${JSON.stringify(payload)}`);
  }
  assert.equal(sanitizer('plain text'), 'plain text');
  assert.equal(sanitizer('12345'), '12345');
  assert.equal(sanitizer(null), '');
});

test('modal focus trap uses a collection selector and accessible description', () => {
  assert.ok(app.includes('const items=$$('), 'focus trap must query all focusable items');
  assert.ok(app.includes('aria-describedby="modalDescription"'), 'modal must describe its content to assistive technology');
});

test('modal opening and tab navigation share visible focus targets', () => {
  assert.ok(app.includes('function modalFocusables(dlg)'), 'shared visible-focus selector must exist');
  assert.ok(app.includes('.filter(el=>el.offsetParent!==null)'), 'focus targets must be visible');
  assert.ok(app.includes('const items=modalFocusables(dlg);(items[0]||dlg).focus()'), 'opening a modal must focus the first visible target');
  assert.ok(app.includes('const items=modalFocusables(dlg);if(!items.length)'), 'tab navigation must use the same visible targets');
});
