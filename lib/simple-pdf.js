'use strict';
const path = require('node:path');
const PDFDocument = require('pdfkit');

// Keep Arabic words shaped independently and position them explicitly: PDFKit's
// cached word layout moves trailing spaces to the wrong side of Arabic words.
const hasArabic = value => /[\u0600-\u06ff]/.test(value);
function rtlRuns(line) {
  const runs = [];
  for (const word of line.split(/\s+/).filter(Boolean)) {
    if (!hasArabic(word) && runs.length && !hasArabic(runs[runs.length - 1])) runs[runs.length - 1] += ' ' + word;
    else runs.push(word);
  }
  return runs;
}
function wrapParagraph(document, paragraph, width) {
  const lines = []; let line = '';
  for (const word of String(paragraph).split(/\s+/).filter(Boolean)) {
    const candidate = line ? line + ' ' + word : word;
    if (document.widthOfString(candidate) <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    for (const character of word) {
      if (line && document.widthOfString(line + character) > width) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * buildSimplePdf(lines, title)
 * or buildSimplePdf({ title, lines, integrityHash })
 */
function buildSimplePdf(linesOrOptions, titleArg) {
  let lines = linesOrOptions;
  let title = titleArg;
  let integrityHash = null;
  if (linesOrOptions && typeof linesOrOptions === 'object' && !Array.isArray(linesOrOptions)) {
    title = linesOrOptions.title || titleArg;
    lines = linesOrOptions.lines || [];
    integrityHash = linesOrOptions.integrityHash || null;
  }
  if (!Array.isArray(lines)) lines = [];

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 44, info: { Title: title || 'تقرير شكوى', Author: 'الاستفسارات والشكاوى' } });
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));
    try {
      document.font(path.join(__dirname, '..', 'assets', 'NotoSansArabic.ttf'));
      const width = document.page.width - 88;
      function writeParagraph(text, size, color) {
        document.fontSize(size).fillColor(color);
        const height = document.currentLineHeight(true) + 4;
        for (const logical of String(text).split(/\r?\n/)) {
          for (const line of wrapParagraph(document, logical, width)) {
            if (document.y + height > document.page.height - 44) document.addPage();
            const y = document.y;
            if (hasArabic(line)) {
              let right = 44 + width;
              const gap = document.widthOfString(' ');
              for (const run of rtlRuns(line)) {
                const runWidth = document.widthOfString(run);
                document.text(run, right - runWidth, y, { lineBreak: false });
                right -= runWidth + gap;
              }
            } else document.text(line, 44, y, { width, align: 'right', lineBreak: false });
            document.y = y + height;
          }
        }
        document.y += 5;
      }
      writeParagraph(title || 'تقرير شكوى', 17, '#164f42');
      for (const line of lines) writeParagraph(line, 11, '#172c26');
      if (integrityHash) {
        document.y = Math.max(document.y + 12, document.page.height - 80);
        writeParagraph('رمز النزاهة (SHA-256): ' + integrityHash, 9, '#3D4337');
        writeParagraph('هذا الرمز يثبت مطابقة الورقة للسجل الأصلي في النظام.', 9, '#6B7F67');
      }
      document.end();
    } catch (error) { reject(error); document.destroy(); }
  });
}
module.exports = { buildSimplePdf, escapePdfText: value => String(value || '') };
