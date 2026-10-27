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
  normal: 'عادية',
  medium: 'متوسطة',
  high: 'عالية',
  urgent: 'عاجلة'
};

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

async function buildComplaintsWorkbook(complaints = [], options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام الشكاوى المحلي';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('الشكاوى', {
    views: [{ rightToLeft: true }],
    properties: { defaultRowHeight: 22 }
  });

  sheet.mergeCells('A1:L1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = options.title || 'تقرير الشكاوى';
  titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145B49' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  sheet.mergeCells('A2:L2');
  sheet.getCell('A2').value = `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}  |  عدد السجلات: ${complaints.length}` +
    (options.generatedBy ? `  |  بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF555555' } };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

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

  const widths = [16, 18, 14, 12, 16, 14, 10, 14, 40, 16, 14, 14];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  if (complaints.length > 0) {
    sheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3 + complaints.length, column: headers.length }
    };
  }

  sheet.views = [{ state: 'frozen', ySplit: 3, rightToLeft: true }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Detailed workbook for one complaint (name + full details). */
async function buildSingleComplaintWorkbook(complaint, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام الشكاوى المحلي';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('تفاصيل الشكوى', {
    views: [{ rightToLeft: true }],
    properties: { defaultRowHeight: 22 }
  });

  sheet.mergeCells('A1:B1');
  const title = sheet.getCell('A1');
  title.value = 'تفاصيل الشكوى — ' + (complaint.id || '');
  title.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145B49' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  sheet.mergeCells('A2:B2');
  sheet.getCell('A2').value = `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}` +
    (options.generatedBy ? `  |  بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF555555' } };

  const fields = [
    ['الرقم المرجعي', complaint.id || ''],
    ['الاسم', complaint.name || complaint.citizenName || ''],
    ['الهاتف', complaint.phone || ''],
    ['المحافظة', complaint.province || ''],
    ['الجهة', complaint.entity || ''],
    ['التصنيف', complaint.category || ''],
    ['الأولوية', PRIORITY_AR[complaint.priority] || complaint.priority || ''],
    ['الحالة', STATUS_AR[complaint.status] || complaint.status || ''],
    ['المسؤول', complaint.owner || complaint.assignedTo || ''],
    ['تاريخ الإنشاء', formatDate(complaint.created || complaint.createdAt)],
    ['تاريخ الاستحقاق', formatDate(complaint.due || complaint.dueDate)],
    ['آخر تحديث', formatDate(complaint.updated || complaint.updatedAt)],
    ['الملخص', complaint.summary || complaint.description || ''],
    ['التفاصيل', complaint.details || '']
  ];

  for (const [label, value] of fields) {
    const row = sheet.addRow([label, value == null ? '' : String(value)]);
    row.getCell(1).font = { bold: true, name: 'Arial', size: 11 };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F2ED' } };
    row.getCell(2).font = { name: 'Arial', size: 11 };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top', horizontal: 'right' };
    [1, 2].forEach(i => {
      row.getCell(i).border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
    });
  }

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 60;

  // Timeline sheet if present
  const timeline = Array.isArray(complaint.timeline) ? complaint.timeline : [];
  if (timeline.length) {
    const tl = workbook.addWorksheet('الجدول الزمني', { views: [{ rightToLeft: true }] });
    const h = tl.addRow(['الحدث', 'بواسطة', 'الوقت', 'التفصيل']);
    h.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7A5C' } };
    });
    for (const item of timeline) {
      tl.addRow([item.event || '', item.by || '', formatDate(item.at), item.detail || '']);
    }
    [18, 14, 16, 40].forEach((w, i) => { tl.getColumn(i + 1).width = w; });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { buildComplaintsWorkbook, buildSingleComplaintWorkbook, STATUS_AR, PRIORITY_AR };
