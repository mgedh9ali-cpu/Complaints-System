'use strict';
const path = require('node:path');
const PDFDocument = require('pdfkit');

// Fontkit shapes Arabic glyphs. PDFKit lays out separate words from left to right,
// so wrap in logical reading order first, then place each visual line right to left.
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

function buildSimplePdf(lines, title) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 44, info: { Title: title || 'تقرير شكوى', Author: 'شعبة الاستفسارات والشكاوى' } });
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
            const display = /[\u0600-\u06ff]/.test(line) ? line.split(' ').reverse().join(' ') : line;
            document.text(display, 44, document.y, { width, align: 'right', lineBreak: false });
            document.y += height;
          }
        }
        document.y += 5;
      }
      writeParagraph(title || 'تقرير شكوى', 17, '#164f42');
      for (const line of lines) writeParagraph(line, 11, '#172c26');
      document.end();
    } catch (error) { reject(error); document.destroy(); }
  });
}
module.exports = { buildSimplePdf, escapePdfText: value => String(value || '') };
