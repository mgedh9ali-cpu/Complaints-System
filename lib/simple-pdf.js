'use strict';

/**
 * Minimal single-page PDF (PDF 1.4) for offline reports.
 * Uses UTF-16BE string literals so Arabic labels render in modern readers.
 */

function escapePdfText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function toUtf16BeHex(str) {
  const s = String(str || '');
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    hex += code.toString(16).toUpperCase().padStart(4, '0');
  }
  return hex;
}

function lineCmd(text, x, y, fontSize) {
  const hex = toUtf16BeHex(text);
  return `BT /F1 ${fontSize} Tf ${x} ${y} Td <${hex}> Tj ET`;
}

function buildSimplePdf(lines, title) {
  const pageWidth = 595;
  const pageHeight = 842;
  const contentLines = [];
  let y = pageHeight - 50;
  contentLines.push(lineCmd(title || 'Complaint report', 50, y, 16));
  y -= 28;
  for (const line of lines) {
    if (y < 50) break;
    contentLines.push(lineCmd(line, 50, y, 11));
    y -= 16;
  }
  const stream = contentLines.join('\n');
  const streamBuf = Buffer.from(stream, 'utf8');

  const objects = [];
  objects.push('1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj\n');
  objects.push('2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj\n');
  objects.push(
    `3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj\n`
  );
  objects.push(
    `4 0 obj
<< /Length ${streamBuf.length} >>
stream
${stream}
endstream
endobj\n`
  );
  objects.push(
    '5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>
endobj\n'
  );

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = { buildSimplePdf, escapePdfText };
