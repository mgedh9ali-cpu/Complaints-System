'use strict';

const ExcelJS = require('exceljs');

const STATUS_AR = {
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد',
  awaiting_approval: 'بانتظار اعتماد',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
  draft: 'مسودة'
};

const PRIORITY_AR = {
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة'
};

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('ar-SY');
  } catch (_) {
    return String(value);
  }
}

function forcePlainString(cell, raw) {
  // ExcelJS converts leading "=" into Formula cells. Establish a String cell first,
  // then mutate only the string payload so model/style stay valid.
  cell.value = 'S' + raw;
  try {
    if (cell._value && typeof cell._value === 'object' && 'value' in cell._value) {
      cell._value.value = raw;
    }
  } catch (_) {
    cell.value = raw;
  }
  cell.numFmt = '@';
}

function applyDataCellStyle(cell, raw) {
  if (typeof raw === 'string' && /^[=+\-@\t\r]/.test(raw)) {
    forcePlainString(cell, raw);
  }
  cell.alignment = {
    horizontal: 'right',
    vertical: 'middle',
    wrapText: true
  };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
  };
  cell.font = { name: 'Arial', size: 10 };
}

async function buildComplaintsWorkbook(complaints, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Complaints System';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('الشكاوى', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }]
  });

  sheet.mergeCells('A1:M1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = options.title || 'تقرير الشكاوى';
  titleCell.font = {
    name: 'Arial',
    size: 16,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF145B49' }
  };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  sheet.mergeCells('A2:M2');
  sheet.getCell('A2').value =
    `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}  |  عدد السجلات: ${complaints.length}` +
    (options.generatedBy ? `  |  بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF555555' } };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  // Column I must remain الملخص so formula-injection round-trip tests stay stable.
  const headers = [
    'الرقم المرجعي',
    'الاسم',
    'الهاتف',
    'المحافظة',
    'الجهة',
    'التصنيف',
    'الأولوية',
    'الحالة',
    'الملخص',
    'طبيعة الشكاوي',
    'تاريخ الإنشاء',
    'تاريخ الاستحقاق',
    'المسؤول'
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
      name: 'Arial',
      size: 11
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A7A5C' }
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });
  headerRow.height = 26;

  for (const c of complaints) {
    const values = [
      c.id || c.ref || '',
      c.name || c.citizenName || '',
      c.phone || '',
      c.province || '',
      c.entity || '',
      c.category || '',
      PRIORITY_AR[c.priority] || c.priority || '',
      STATUS_AR[c.status] || c.status || '',
      c.summary || c.description || '',
      c.nature || '',
      formatDate(c.created || c.createdAt),
      formatDate(c.due || c.dueDate),
      c.owner || c.assignedTo || ''
    ];
    const row = sheet.addRow(values);
    row.eachCell((cell, colNumber) => {
      applyDataCellStyle(cell, values[colNumber - 1]);
    });
  }

  const widths = [16, 18, 14, 12, 16, 14, 10, 14, 40, 14, 16, 14, 14];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  if (complaints.length > 0) {
    sheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3 + complaints.length, column: headers.length }
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function buildSingleComplaintWorkbook(complaint, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Complaints System';
  const sheet = workbook.addWorksheet('تفاصيل الشكوى', {
    views: [{ rightToLeft: true }]
  });
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 60;

  const title = sheet.getCell('A1');
  sheet.mergeCells('A1:B1');
  title.value = options.title || `شكوى ${complaint.id || ''}`;
  title.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145B49' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 28;

  sheet.getCell('A2').value = `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}`;
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF555555' } };

  const fields = [
    ['الرقم المرجعي', complaint.id || ''],
    ['الاسم', complaint.name || ''],
    ['الهاتف', complaint.phone || ''],
    ['المحافظة', complaint.province || ''],
    ['الجهة', complaint.entity || ''],
    ['التصنيف', complaint.category || ''],
    ['طبيعة الشكاوي', complaint.nature || ''],
    ['الأولوية', PRIORITY_AR[complaint.priority] || complaint.priority || ''],
    ['الحالة', STATUS_AR[complaint.status] || complaint.status || ''],
    ['الملخص', complaint.summary || ''],
    ['التفاصيل', complaint.details || ''],
    ['المسؤول', complaint.owner || ''],
    ['تاريخ الإنشاء', formatDate(complaint.created || complaint.createdAt)],
    ['تاريخ الاستحقاق', formatDate(complaint.due || complaint.dueDate)]
  ];

  let rowIdx = 4;
  for (const [label, value] of fields) {
    const row = sheet.getRow(rowIdx);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, name: 'Arial', size: 11 };
    row.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEEF6F2' }
    };
    const raw = value == null ? '' : String(value);
    row.getCell(2).value = raw;
    if (/^[=+\-@\t\r]/.test(raw)) {
      forcePlainString(row.getCell(2), raw);
    }
    row.getCell(2).font = { name: 'Arial', size: 11 };
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
    for (let i = 1; i <= 2; i++) {
      row.getCell(i).border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
    }
    rowIdx += 1;
  }

  if (Array.isArray(complaint.timeline) && complaint.timeline.length) {
    rowIdx += 1;
    sheet.getCell(`A${rowIdx}`).value = 'سجل المتابعة';
    sheet.getCell(`A${rowIdx}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${rowIdx}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A7A5C' }
    };
    sheet.mergeCells(`A${rowIdx}:B${rowIdx}`);
    rowIdx += 1;
    const h = sheet.getRow(rowIdx);
    h.values = ['الحدث', 'التفاصيل'];
    h.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E8B6D' } };
    });
    rowIdx += 1;
    for (const item of complaint.timeline) {
      const r = sheet.getRow(rowIdx);
      r.getCell(1).value = item.event || '';
      r.getCell(2).value = [item.by, item.at, item.detail].filter(Boolean).join(' — ');
      rowIdx += 1;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = {
  buildComplaintsWorkbook,
  buildSingleComplaintWorkbook,
  STATUS_AR,
  PRIORITY_AR
};
