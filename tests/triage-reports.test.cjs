'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const reportsScript = read('ui/pages/reports.js');

function renderReport(complaints) {
  const context = {
    db: { complaints },
    heading: (title, desc, actions) => '<header>' + title + desc + actions + '</header>',
    btn: (label, action) => '<button data-action="' + action + '">' + label + '</button>',
    esc: value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]),
    ageDays: c => Math.max(0, Math.floor((Date.now() - new Date(c.created)) / 86400000)),
    lateComplaints: () => complaints.filter(c => c.late)
  };
  return vm.runInNewContext(reportsScript + '\nreportsPage();', context);
}

test('operational reports render an empty state without fabricated data', () => {
  const html = renderReport([]);
  assert.match(html, /لم تُسجل شكاوى خلال آخر 14 يومًا/);
  assert.match(html, /لا توجد تصنيفات مسجلة/);
  assert.match(html, /لا توجد محافظات مسجلة/);
  assert.doesNotMatch(html, /class="daily-chart"/);
});

test('operational reports chart real records, escape labels and retain local export actions', () => {
  const html = renderReport([
    {
      id: 'SY-2026-001',
      created: new Date().toISOString(),
      category: '<script>alert(1)</script>',
      province: 'دمشق',
      status: 'new',
      late: true
    },
    {
      id: 'SY-2026-002',
      created: new Date().toISOString(),
      category: 'خدمات',
      province: 'حلب',
      status: 'closed'
    }
  ]);
  assert.match(html, /class="daily-chart"/);
  assert.equal((html.match(/class="daily-bar-item"/g) || []).length, 14);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /data-action="export-csv"/);
  assert.match(html, /data-action="print-report"/);
  assert.match(html, /aria-valuenow="1"/);
  assert.match(html, /سجلات متجاوزة للمهلة/);
});

test('approval mark appears only on approved or sent replies and supports print', () => {
  const detail = read('ui/pages/detail.js');
  const css = read('redesign.css');
  assert.match(detail, /\['approved','sent'\]\.includes\(c\.reply\.status\)/);
  assert.match(detail, /approval-stamp/);
  assert.match(detail, /اعتماد إداري داخلي/);
  assert.match(detail, /approvalEvent/);
  assert.match(css, /@media print/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.daily-chart/);
});

test('new interface formats dates with consistent Latin digits and keeps server bundle parseable', () => {
  const format = read('ui/core/format.js');
  assert.match(format, /ar-SY-u-nu-latn/);
  assert.doesNotMatch(reportsScript, /https?:\/\//);
  const { validateUiBundle } = require('../lib/ui-bundle');
  assert.equal(validateUiBundle().files, 15);
});


test('cancelled, closed and draft complaints are never reported as overdue', () => {
  const context = { db: { settings: { slaApproved: true } } };
  const script = read('ui/core/format.js');
  const overdue = status => vm.runInNewContext(
    script + '\nisLate({ status: ' + JSON.stringify(status) +
    ', due: "2000-01-01T00:00:00.000Z" });',
    context
  );
  assert.equal(overdue('cancelled'), false);
  assert.equal(overdue('closed'), false);
  assert.equal(overdue('draft'), false);
  assert.equal(overdue('in_progress'), true);
});
