"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { isAllowed, MAX_FILE_SIZE } = require("../lib/attachments");

function file(originalname, mimetype, bytes) {
  const buffer = Buffer.from(bytes);
  return { originalname, mimetype, buffer, size: buffer.length };
}

function zipWithEntries(names) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

test("attachment validation accepts a PDF whose content matches its extension and MIME type", () => {
  assert.equal(
    isAllowed(file("report.pdf", "application/pdf", "%PDF-1.7\nexample")),
    true,
  );
});

test("attachment validation rejects a fake PDF and mismatched MIME types", () => {
  assert.equal(
    isAllowed(file("report.pdf", "application/pdf", "MZ executable")),
    false,
  );
  assert.equal(
    isAllowed(file("report.pdf", "image/png", "%PDF-1.7\nexample")),
    false,
  );
});

test("attachment validation checks image signatures instead of trusting filename or browser MIME", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  assert.equal(isAllowed(file("photo.png", "image/png", png)), true);
  assert.equal(isAllowed(file("photo.png", "image/png", "not a png")), false);
});

test("attachment validation rejects a valid generic ZIP disguised as an Office document", () => {
  const genericZip = zipWithEntries(["[Content_Types].xml", "random.txt"]);
  assert.equal(
    isAllowed(
      file(
        "report.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        genericZip,
      ),
    ),
    false,
  );
});

test("attachment validation rejects empty, inconsistent-size, and oversized payloads", () => {
  assert.equal(
    isAllowed({
      originalname: "empty.pdf",
      mimetype: "application/pdf",
      buffer: Buffer.alloc(0),
      size: 0,
    }),
    false,
  );
  assert.equal(
    isAllowed({
      originalname: "bad.pdf",
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.7"),
      size: 1,
    }),
    false,
  );
  const bytes = Buffer.alloc(MAX_FILE_SIZE + 1, 0x41);
  assert.equal(
    isAllowed({
      originalname: "large.pdf",
      mimetype: "application/pdf",
      buffer: bytes,
      size: bytes.length,
    }),
    false,
  );
});
