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

const GREEN_DARK = 'FF0F1F17';
const GREEN_MID = 'FF1E3A2E';
const GREEN_ACCENT = 'FF3E5A3F';
const GREEN_SAGE = 'FF6B7F67';
const CREAM = 'FFC7CBB8';

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('ar-SY');
  } catch (_) {
    return String(value);
  }
}

function forcePlainString(cell, raw) {
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

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ar'));
}

function styleHeaderRow(row, fillArgb) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });
  row.height = 26;
}

function writeCountTable(sheet, startRow, title, pairs, barMax) {
  sheet.getCell(startRow, 1).value = title;
  sheet.getCell(startRow, 1).font = { bold: true, size: 12, color: { argb: GREEN_DARK }, name: 'Arial' };
  sheet.mergeCells(startRow, 1, startRow, 4);

  const header = sheet.getRow(startRow + 1);
  header.values = [null, 'البند', 'العدد', 'نسبة %', 'مؤشر'];
  styleHeaderRow(header, GREEN_ACCENT);

  const total = pairs.reduce((n, [, c]) => n + c, 0) || 1;
  let r = startRow + 2;
  for (const [label, count] of pairs) {
    const row = sheet.getRow(r);
    row.getCell(1).value = '';
    row.getCell(2).value = label;
    row.getCell(3).value = count;
    row.getCell(4).value = Math.round((count / total) * 100);
    const ratio = barMax > 0 ? count / barMax : 0;
    row.getCell(5).value = '█'.repeat(Math.max(1, Math.round(ratio * 12)));
    applyDataCellStyle(row.getCell(2), label);
    applyDataCellStyle(row.getCell(3), String(count));
    applyDataCellStyle(row.getCell(4), String(row.getCell(4).value));
    applyDataCellStyle(row.getCell(5), row.getCell(5).value);
    row.getCell(5).font = { name: 'Arial', size: 10, color: { argb: GREEN_ACCENT } };
    r += 1;
  }
  return r + 1;
}

function buildSummarySheet(workbook, complaints, options) {
  const sheet = workbook.addWorksheet('ملخص وإحصائيات', {
    views: [{ rightToLeft: true }]
  });
  sheet.columns = [
    { width: 4 },
    { width: 28 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
    { width: 22 },
    { width: 14 }
  ];

  sheet.mergeCells('A1:G1');
  const title = sheet.getCell('A1');
  title.value = options.title || 'تقرير الشكاوى — ملخص إحصائي';
  title.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_DARK } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 34;

  const rangeLabel =
    options.from || options.to
      ? `الفترة: ${options.from || 'البداية'} ← ${options.to || 'الآن'}`
      : 'الفترة: كل السجلات';
  sheet.mergeCells('A2:G2');
  sheet.getCell('A2').value =
    `${rangeLabel}  |  تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}  |  عدد السجلات: ${complaints.length}` +
    (options.generatedBy ? `  |  بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF3D4337' } };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  const byStatus = countBy(complaints, (c) => STATUS_AR[c.status] || c.status || 'غير محدد');
  const byCategory = countBy(complaints, (c) => String(c.category || 'غير مصنف').trim() || 'غير مصنف');
  const byProvince = countBy(complaints, (c) => String(c.province || 'غير محددة').trim() || 'غير محددة');
  const byPriority = countBy(complaints, (c) => PRIORITY_AR[c.priority] || c.priority || 'عادية');
  const byNature = countBy(complaints, (c) => String(c.nature || 'غير محددة').trim() || 'غير محددة');

  const closed = complaints.filter((c) => c.status === 'closed').length;
  const open = complaints.length - closed;
  const late = complaints.filter((c) => {
    if (!c || !c.due || c.status === 'closed' || c.status === 'cancelled') return false;
    const due = Date.parse(c.due);
    return Number.isFinite(due) && due < Date.now();
  }).length;

  sheet.getCell('B4').value = 'مؤشرات سريعة';
  sheet.getCell('B4').font = { bold: true, size: 12, color: { argb: GREEN_DARK } };
  const kpis = [
    ['إجمالي الشكاوى', complaints.length],
    ['مفتوحة / جارية', open],
    ['مغلقة', closed],
    ['متأخرة عن المهلة', late]
  ];
  kpis.forEach(([label, value], i) => {
    const col = 2 + i;
    sheet.getCell(5, col).value = label;
    sheet.getCell(5, col).font = { size: 9, color: { argb: 'FF3D4337' } };
    sheet.getCell(6, col).value = value;
    sheet.getCell(6, col).font = { bold: true, size: 18, color: { argb: GREEN_MID } };
    sheet.getCell(6, col).alignment = { horizontal: 'center' };
  });

  let next = 8;
  const maxStatus = Math.max(1, ...byStatus.map(([, n]) => n));
  next = writeCountTable(sheet, next, 'التوزيع حسب الحالة', byStatus, maxStatus);
  next = writeCountTable(sheet, next, 'التوزيع حسب التصنيف', byCategory.slice(0, 20), Math.max(1, ...byCategory.map(([, n]) => n)));
  next = writeCountTable(sheet, next, 'التوزيع حسب المحافظة', byProvince.slice(0, 20), Math.max(1, ...byProvince.map(([, n]) => n)));
  next = writeCountTable(sheet, next, 'التوزيع حسب الأولوية', byPriority, Math.max(1, ...byPriority.map(([, n]) => n)));
  next = writeCountTable(sheet, next, 'التوزيع حسب طبيعة الشكوى', byNature.slice(0, 20), Math.max(1, ...byNature.map(([, n]) => n)));

  const dayMap = new Map();
  for (const c of complaints) {
    const ms = Date.parse(c.created || c.createdAt);
    if (!Number.isFinite(ms)) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length) {
    sheet.getCell(next, 1).value = 'التسلسل اليومي (جاهز للرسم البياني في Excel)';
    sheet.getCell(next, 1).font = { bold: true, size: 12, color: { argb: GREEN_DARK } };
    sheet.mergeCells(next, 1, next, 4);
    next += 1;
    const h = sheet.getRow(next);
    h.values = [null, 'التاريخ', 'عدد الشكاوى'];
    styleHeaderRow(h, GREEN_SAGE);
    next += 1;
    for (const [day, count] of days) {
      const row = sheet.getRow(next);
      row.getCell(2).value = day;
      row.getCell(3).value = count;
      applyDataCellStyle(row.getCell(2), day);
      applyDataCellStyle(row.getCell(3), String(count));
      next += 1;
    }
  }

  sheet.getCell(next + 1, 2).value =
    'ملاحظة: جداول الملخص رقمية ويمكن رسمها مباشرة في Excel (إدراج → مخطط → أعمدة/دائرة).';
  sheet.getCell(next + 1, 2).font = { size: 9, italic: true, color: { argb: 'FF3D4337' } };
}

async function buildComplaintsWorkbook(complaints, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Complaints System';
  workbook.created = new Date();
  workbook.calcProperties = { fullCalcOnLoad: true };

  buildSummarySheet(workbook, complaints, options);

  const sheet = workbook.addWorksheet('تفاصيل الشكاوى', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }]
  });

  sheet.mergeCells('A1:N1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = options.title || 'تقرير الشكاوى — التفاصيل';
  titleCell.font = {
    name: 'Arial',
    size: 16,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: GREEN_DARK }
  };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  const rangeNote =
    options.from || options.to
      ? ` | الفترة: ${options.from || '…'} → ${options.to || '…'}`
      : '';
  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value =
    `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}  |  عدد السجلات: ${complaints.length}` +
    rangeNote +
    (options.generatedBy ? `  |  بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF555555' } };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

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
    'التفاصيل',
    'تاريخ الإنشاء',
    'تاريخ الاستحقاق',
    'المسؤول'
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, GREEN_ACCENT);

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
      c.details || c.detail || '',
      formatDate(c.created || c.createdAt),
      formatDate(c.due || c.dueDate),
      c.owner || c.assignedTo || ''
    ];
    const row = sheet.addRow(values);
    row.eachCell((cell, colNumber) => {
      const raw = values[colNumber - 1];
      applyDataCellStyle(cell, raw == null ? '' : String(raw));
    });
  }

  const widths = [16, 18, 14, 14, 18, 14, 10, 14, 28, 14, 32, 18, 18, 14];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const namesSheet = workbook.addWorksheet('الأسماء', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }]
  });
  const nameHeader = namesSheet.addRow(['الاسم', 'الهاتف', 'عدد الشكاوى', 'أرقام الشكاوى']);
  styleHeaderRow(nameHeader, GREEN_MID);
  const byName = new Map();
  for (const c of complaints) {
    const name = String(c.name || c.citizenName || '—').trim() || '—';
    if (!byName.has(name)) byName.set(name, { phone: c.phone || '', ids: [] });
    const entry = byName.get(name);
    entry.ids.push(c.id || c.ref || '');
    if (!entry.phone && c.phone) entry.phone = c.phone;
  }
  [...byName.entries()]
    .sort((a, b) => b[1].ids.length - a[1].ids.length || a[0].localeCompare(b[0], 'ar'))
    .forEach(([name, info]) => {
      const row = namesSheet.addRow([name, info.phone, info.ids.length, info.ids.join('، ')]);
      row.eachCell((cell, col) => applyDataCellStyle(cell, String(row.getCell(col).value || '')));
    });
  namesSheet.getColumn(1).width = 24;
  namesSheet.getColumn(2).width = 16;
  namesSheet.getColumn(3).width = 12;
  namesSheet.getColumn(4).width = 40;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function buildSingleComplaintWorkbook(complaint, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Complaints System';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('تفاصيل الشكوى', {
    views: [{ rightToLeft: true }]
  });
  sheet.columns = [{ width: 22 }, { width: 55 }];

  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = options.title || `شكوى ${complaint.id || ''}`;
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_DARK } };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 28;

  sheet.getCell('A2').value = `تاريخ التصدير: ${new Date().toLocaleString('ar-SY')}` +
    (options.generatedBy ? ` | بواسطة: ${options.generatedBy}` : '');
  sheet.getCell('A2').font = { size: 9, color: { argb: 'FF555555' } };
  sheet.mergeCells('A2:B2');

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
      fgColor: { argb: CREAM }
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
      fgColor: { argb: GREEN_MID }
    };
    sheet.mergeCells(`A${rowIdx}:B${rowIdx}`);
    rowIdx += 1;
    const h = sheet.getRow(rowIdx);
    h.values = ['الحدث', 'التفاصيل'];
    h.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_ACCENT } };
    });
    rowIdx += 1;
    for (const item of complaint.timeline) {
      const r = sheet.getRow(rowIdx);
      r.getCell(1).value = (item && (item.event || item.at)) || '';
      r.getCell(2).value = [item && item.by, item && item.detail].filter(Boolean).join(' — ');
      applyDataCellStyle(r.getCell(1), String(r.getCell(1).value || ''));
      applyDataCellStyle(r.getCell(2), String(r.getCell(2).value || ''));
      rowIdx += 1;
    }
  }

  const sheet2 = workbook.addWorksheet('الخط الزمني');
  sheet2.getColumn(1).width = 28;
  sheet2.getColumn(2).width = 18;
  sheet2.getColumn(3).width = 40;
  sheet2.getCell('A1').value = 'الحدث';
  sheet2.getCell('B1').value = 'بواسطة';
  sheet2.getCell('C1').value = 'التفاصيل';
  for (const addr of ['A1', 'B1', 'C1']) {
    sheet2.getCell(addr).font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    sheet2.getCell(addr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_MID } };
  }
  const timelineRows = Array.isArray(complaint.timeline) ? complaint.timeline : [];
  timelineRows.forEach((item, i) => {
    const r = sheet2.getRow(i + 2);
    r.getCell(1).value = (item && item.event) || '';
    r.getCell(2).value = (item && item.by) || '';
    r.getCell(3).value = (item && item.detail) || '';
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = {
  buildComplaintsWorkbook,
  buildSingleComplaintWorkbook,
  STATUS_AR,
  PRIORITY_AR
};
