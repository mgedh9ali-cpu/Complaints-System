'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectMimeFromBuffer, isContentCompatible } = require('../lib/file-magic');

describe('file-magic', () => {
  it('detects PDF', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
    assert.equal(detectMimeFromBuffer(buf), 'application/pdf');
  });

  it('detects JPEG', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    assert.equal(detectMimeFromBuffer(buf), 'image/jpeg');
  });

  it('detects PNG', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
    assert.equal(detectMimeFromBuffer(buf), 'image/png');
  });

  it('detects WEBP', () => {
    const buf = Buffer.alloc(16);
    buf.write('RIFF', 0);
    buf.write('WEBP', 8);
    assert.equal(detectMimeFromBuffer(buf), 'image/webp');
  });

  it('detects ZIP (docx/xlsx container)', () => {
    const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    assert.equal(detectMimeFromBuffer(buf), 'application/zip');
  });

  it('accepts docx claimed MIME with ZIP magic', () => {
    assert.equal(
      isContentCompatible(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
        '.docx'
      ),
      true
    );
  });

  it('rejects executable disguised as PDF', () => {
    // MZ header (Windows PE)
    const buf = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
    const detected = detectMimeFromBuffer(buf);
    assert.equal(
      isContentCompatible('application/pdf', detected, '.pdf'),
      false
    );
  });

  it('accepts plain text', () => {
    const buf = Buffer.from('مرحبا بكم في نظام الشكاوى\nHello world\n');
    assert.equal(detectMimeFromBuffer(buf), 'text/plain');
    assert.equal(isContentCompatible('text/plain', 'text/plain', '.txt'), true);
  });
});
