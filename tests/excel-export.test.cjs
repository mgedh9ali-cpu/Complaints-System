'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildComplaintsWorkbook, PRIORITY_AR } = require('../lib/excel-export');

test('Excel export translates the priorities the system actually stores', async () => {
  assert.equal(PRIORITY_AR.normal, 'عادية');
  assert.equal(PRIORITY_AR.high, 'عالية');
  assert.equal(PRIORITY_AR.urgent, 'عاجلة');

  const buffer = await buildComplaintsWorkbook([
    {
      id: 'SY-2026-00001',
      name: 'اختبار',
      phone: '0912345678',
      province: 'دمشق',
      entity: 'جهة',
      category: 'عام',
      priority: 'normal',
      status: 'new',
      summary: 'ملخص',
      created: '2026-01-15T10:00:00.000Z',
      due: '2026-01-22T10:00:00.000Z',
      owner: 'admin'
    }
  ], { title: 'اختبار', generatedBy: 'test' });

  assert.ok(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array);
  assert.ok(buffer.byteLength > 500, 'workbook should be a non-trivial xlsx');
});
