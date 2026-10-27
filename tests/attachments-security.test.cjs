'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowed, BLOCKED_EXT } = require('../lib/attachments');

function fakeFile({ name, mime, content }) {
  return {
    originalname: name,
    mimetype: mime,
    size: content.length,
    buffer: Buffer.from(content)
  };
}

describe('attachments security', () => {
  it('accepts a real PDF', () => {
    const file = fakeFile({
      name: 'report.pdf',
      mime: 'application/pdf',
      content: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x0A, 0x25, 0xC2, 0xB5])
    });
    assert.equal(isAllowed(file), true);
  });

  it('rejects .exe even with pdf mime', () => {
    const file = fakeFile({
      name: 'malware.exe',
      mime: 'application/pdf',
      content: Buffer.from([0x4D, 0x5A, 0x90, 0x00])
    });
    assert.equal(isAllowed(file), false);
  });

  it('rejects .html', () => {
    const file = fakeFile({
      name: 'page.html',
      mime: 'text/html',
      content: Buffer.from('<html><script>alert(1)</script></html>')
    });
    assert.equal(isAllowed(file), false);
  });

  it('rejects .js', () => {
    const file = fakeFile({
      name: 'script.js',
      mime: 'application/javascript',
      content: Buffer.from('console.log(1)')
    });
    assert.equal(isAllowed(file), false);
  });

  it('rejects ZIP archive by extension', () => {
    const file = fakeFile({
      name: 'archive.zip',
      mime: 'application/zip',
      content: Buffer.from([0x50, 0x4B, 0x03, 0x04])
    });
    assert.equal(isAllowed(file), false);
  });

  it('blocked extension list contains critical types', () => {
    for (const ext of ['.exe', '.js', '.html', '.zip', '.bat', '.php']) {
      assert.ok(BLOCKED_EXT.has(ext), `expected ${ext} to be blocked`);
    }
  });

  it('rejects PDF extension with executable content', () => {
    const file = fakeFile({
      name: 'fake.pdf',
      mime: 'application/pdf',
      content: Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00]) // MZ
    });
    assert.equal(isAllowed(file), false);
  });
});
