'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function grab(source, name) {
  const start = source.indexOf('function ' + name);
  if (start < 0) throw new Error('missing ' + name);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

test('persian keyboard letters and eastern digits match the arabic office spelling', () => {
  const format = fs.readFileSync(path.join(__dirname, '../ui/core/format.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../modules/complaints/routes.js'), 'utf8');
  const norm = vm.runInNewContext(grab(format, 'norm') + '\nnorm');
  const { normalizeText, normalizePhone } = vm.runInNewContext(
    grab(routes, 'normalizeText') + '\n' + grab(routes, 'normalizePhone') + '\n({normalizeText, normalizePhone})'
  );
  const arabic = 'علي كريم';
  const persian = 'علی کریم';
  assert.equal(norm(persian), norm(arabic));
  assert.equal(normalizeText(persian), normalizeText(arabic));
  assert.equal(norm(persian), normalizeText(persian));
  assert.equal(normalizeText('مؤسسة'), normalizeText('موسسه'));
  assert.equal(normalizePhone('٠٩٤٤١٢٣٤٥٦'), '0944123456');
  assert.equal(normalizePhone('۰۹۴۴۱۲۳۴۵۶'), '0944123456');
  assert.equal(normalizePhone('+963944123456'), '0944123456');
  assert.notEqual(persian, norm(persian));
});

test('dashboard explains a stopped sla clock and does not turn it on', () => {
  const dash = fs.readFileSync(path.join(__dirname, '../ui/pages/dashboard.js'), 'utf8');
  assert.match(dash, /عدّاد المهلة متوقف/);
  assert.match(dash, /slaApproved/);
  assert.doesNotMatch(dash, /slaApproved\s*=\s*true/);
});