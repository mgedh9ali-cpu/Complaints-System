'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildComplaintsWorkbook, PRIORITY_AR } = require('../lib/excel-export');

test('Excel export translates the priorities the system actually stores', async () => {
  // The application stores priorities as normal/high/urgent (see lib/validation.js and app.js).
  // A mapping that only knows low/medium would export the most common priority as raw "normal".
  assert.equal(PRIORITY_AR.normal, 'عادية');
  assert.equal(PRIORITY_AR.high, 'عالية');
  assert.equal(PRIORITY_AR.urgent, 'عاجلة');

  const buffer = await buildComplaintsWorkbook([
    {
      id: 'SY-2026-00001', name: 'اختبار', phone: '0944 000 000', province: 'دمشق',
      entity: 'مديرية الخدمات العامة', category: 'خدمات عامة', priority: 'normal',
      status: 'new', summary: 'شكوى للاختبار', details: '', created: new Date().toISOString(),
      updated: new Date().toISOString(), due: new Date().toISOString(), owner: 'مختبِر'
    }
  ], { title: 'تقرير اختبار', generatedBy: 'tester' });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('الشكاوى');
  assert.ok(sheet, 'the workbook must contain the complaints sheet');

  const values = [];
  sheet.eachRow(row => values.push(row.values.slice(1).map(v => (v == null ? '' : String(v)))));
  const flat = values.map(row => row.join('|')).join('\n');
  assert.ok(flat.includes('عادية'), 'the Arabic priority label must appear in the report');
  assert.ok(!flat.includes('|normal|'), 'the raw English priority must not leak into the report');
});
