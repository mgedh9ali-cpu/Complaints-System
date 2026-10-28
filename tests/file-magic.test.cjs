'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { detectMimeFromBuffer, isContentCompatible } = require('../lib/file-magic');

test('detects PDF and PNG signatures', () => {
  const pdf = Buffer.from('%PDF-1.4 sample');
  assert.equal(detectMimeFromBuffer(pdf), 'application/pdf');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectMimeFromBuffer(png), 'image/png');
});

test('rejects unknown binary as incompatible', () => {
  const exeLike = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const detected = detectMimeFromBuffer(exeLike);
  assert.equal(isContentCompatible('application/pdf', detected, '.pdf'), false);
});

test('accepts zip magic for docx extension', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.equal(detectMimeFromBuffer(zip), 'application/zip');
  assert.equal(
    isContentCompatible(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
      '.docx'
    ),
    true
  );
});
