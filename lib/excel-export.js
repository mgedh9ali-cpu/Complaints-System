'use strict';

const ExcelJS = require('exceljs');

const STATUS_AR = {
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد',
  awaiting_approval: 'بانتظار اعتماد',
  closed: 'مغلقة',
  cancelled: 'ملغاة'
};

const PRIORITY_AR = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  urgent: 'عاجلة'
};

/**
 * Build a professional .xlsx workbook from complaints array.
 * @param {Array} complaints
 * @param {object} options - { title, generatedBy }
 * @returns {Promise<Buffer>}
 */
async function buildComplaintsWorkbook(complaints = [], options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام الشكاوى المحلي';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('الشكاوى', {
    views: [{ rightToLeft: true }],
    properties: { defaultRowHeight: 22 }
  });

  // Title row
  sheet.mergeCells('A1:L1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = options.title || 'تقرير الشكاوى';
  titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145B49' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  // Meta row
  sheet.mergeCells('A2:L2');
  sheet.getCell('A2').value = `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}  |  عدد السجلات: ${complaints.length}` +
    (options.generatedBy ? `  |  بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF555555' } };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  // Headers
  const headers = [
    'الرقم المرجعي', 'الاسم', 'الهاتف', 'المحافظة', 'الجهة',
    'التصنيف', 'الأولوية', 'الحالة', 'الملخص', 'تاريخ الإنشاء',
    'تاريخ الاستحقاق', 'المسؤول'
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7A5C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
  });
  headerRow.height = 26;

  // Data
  for (const c of complaints) {
    const row = sheet.addRow([
      c.id || c.ref || '',
      c.name || c.citizenName || '',
      c.phone || '',
      c.province || '',
      c.entity || '',
      c.category || '',
      PRIORITY_AR[c.priority] || c.priority || '',
      STATUS_AR[c.status] || c.status || '',
      c.summary || c.description || '',
      formatDate(c.created || c.createdAt),
      formatDate(c.due || c.dueDate),
      c.owner || c.assignedTo || ''
    ]);
    row.eachCell((cell) => {
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
      cell.font = { name: 'Arial', size: 10 };
    });
  }

  // Column widths
  const widths = [16, 18, 14, 12, 16, 14, 10, 14, 40, 16, 14, 14];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // Auto-filter
  if (complaints.length > 0) {
    sheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3 + complaints.length, column: headers.length }
    };
  }

  // Freeze header
  sheet.views = [{ state: 'frozen', ySplit: 3, rightToLeft: true }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function formatDate(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('ar-SY');
  } catch {
    return String(v);
  }
}

module.exports = { buildComplaintsWorkbook, STATUS_AR, PRIORITY_AR };
