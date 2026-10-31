'use strict';

const { buildComplaintsWorkbook, buildSingleComplaintWorkbook } = require('../../lib/excel-export');
const { buildSimplePdf } = require('../../lib/simple-pdf');

const CSV_HEADERS = [
  'id', 'name', 'phone', 'province', 'entity', 'category',
  'priority', 'status', 'summary', 'created', 'updated', 'due', 'owner'
];

const STATUS_LABELS = Object.freeze({
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد الجهة',
  awaiting_approval: 'بانتظار الاعتماد',
  closed: 'مغلقة',
  cancelled: 'ملغاة'
});

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseDayBound(value, endOfDay) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const ms = Date.parse(endOfDay ? t + 'T23:59:59.999Z' : t + 'T00:00:00.000Z');
  return Number.isFinite(ms) ? ms : null;
}

function createReportsService({ complaintsService }) {
  function listComplaints() {
    const { state } = complaintsService.readState();
    return Array.isArray(state.complaints) ? state.complaints : [];
  }

  function findComplaint(id) {
    const complaints = listComplaints();
    return complaints.find((c) => c && c.id === id) || null;
  }

  function applyFilters(complaints, filters = {}) {
    let rows = complaints.slice();
    if (filters.status) {
      const allowed = String(filters.status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowed.length) {
        rows = rows.filter((c) => c && allowed.includes(c.status));
      }
    }
    if (filters.province) {
      const p = String(filters.province).trim();
      rows = rows.filter((c) => c && c.province === p);
    }
    if (filters.owner) {
      const o = String(filters.owner).trim();
      rows = rows.filter((c) => c && c.owner === o);
    }
    const fromMs = parseDayBound(filters.from, false);
    const toMs = parseDayBound(filters.to, true);
    if (fromMs != null || toMs != null) {
      rows = rows.filter((c) => {
        if (!c || !c.created) return false;
        const createdMs = Date.parse(c.created);
        if (!Number.isFinite(createdMs)) return false;
        if (fromMs != null && createdMs < fromMs) return false;
        if (toMs != null && createdMs > toMs) return false;
        return true;
      });
    }
    return rows;
  }

  function buildSummaryReport(filters = {}, generatedBy) {
    const all = listComplaints();
    const rows = applyFilters(all, filters);
    const byStatus = Object.create(null);
    for (const key of Object.keys(STATUS_LABELS)) byStatus[key] = 0;
    let late = 0;
    const now = Date.now();
    for (const c of rows) {
      const st = c.status || 'unknown';
      byStatus[st] = (byStatus[st] || 0) + 1;
      if (c.due && !['closed', 'cancelled'].includes(c.status)) {
        const dueMs = Date.parse(c.due);
        if (Number.isFinite(dueMs) && now > dueMs) late += 1;
      }
    }
    const reportNumber =
      'RPT-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      String(rows.length).padStart(4, '0');
    return {
      reportNumber,
      generatedAt: new Date().toISOString(),
      generatedBy: generatedBy || 'system',
      filters: {
        status: filters.status || null,
        province: filters.province || null,
        owner: filters.owner || null,
        from: filters.from || null,
        to: filters.to || null
      },
      totals: {
        all: rows.length,
        late,
        byStatus
      },
      statusLabels: STATUS_LABELS
    };
  }

  function buildCsv(filters = {}) {
    const complaints = applyFilters(listComplaints(), filters);
    const lines = [CSV_HEADERS.join(',')];
    for (const c of complaints) {
      lines.push(CSV_HEADERS.map((h) => escapeCsv(c[h])).join(','));
    }
    return {
      buffer: Buffer.from('\uFEFF' + lines.join('\n'), 'utf8'),
      filename: 'complaints-export-' + new Date().toISOString().slice(0, 10) + '.csv',
      count: complaints.length,
      filters
    };
  }

  async function buildXlsx(generatedBy, filters = {}) {
    const complaints = applyFilters(listComplaints(), filters);
    const buffer = await buildComplaintsWorkbook(complaints, {
      title: 'تقرير الشكاوى',
      generatedBy: generatedBy || 'system'
    });
    return {
      buffer,
      filename: 'تقرير-الشكاوى-' + new Date().toISOString().slice(0, 10) + '.xlsx',
      count: complaints.length,
      filters
    };
  }

  async function buildSingleXlsx(id, generatedBy) {
    const complaint = findComplaint(id);
    if (!complaint) return null;
    const buffer = await buildSingleComplaintWorkbook(complaint, {
      generatedBy: generatedBy || 'system'
    });
    return {
      buffer,
      filename: 'شكوى-' + id + '.xlsx',
      complaint
    };
  }

  function buildSinglePdf(id, generatedBy) {
    const complaint = findComplaint(id);
    if (!complaint) return null;
    const lines = [
      'المعرّف: ' + complaint.id,
      'الحالة: ' + (STATUS_LABELS[complaint.status] || complaint.status || ''),
      'التصنيف: ' + (complaint.category || '-'),
      'الأولوية: ' + (complaint.priority || '-'),
      'المحافظة: ' + (complaint.province || '-'),
      'الجهة: ' + (complaint.entity || '-'),
      'المسؤول: ' + (complaint.owner || '-'),
      'الإنشاء: ' + (complaint.created || '-'),
      'التحديث: ' + (complaint.updated || '-'),
      'الاستحقاق: ' + (complaint.due || '-'),
      'الملخص: ' + (complaint.summary || '-'),
      'التفاصيل: ' + String(complaint.details || '-').slice(0, 500),
      'مُصدر التقرير: ' + (generatedBy || 'system'),
      'وقت الإصدار: ' + new Date().toISOString()
    ];
    if (complaint.survey && complaint.survey.rating) {
      lines.push('تقييم الخدمة: ' + complaint.survey.rating + '/5');
    }
    const buffer = buildSimplePdf(lines, 'تقرير شكوى — ' + complaint.id);
    return {
      buffer,
      filename: 'complaint-' + id + '.pdf',
      complaint
    };
  }

  return {
    listComplaints,
    findComplaint,
    applyFilters,
    buildSummaryReport,
    buildCsv,
    buildXlsx,
    buildSingleXlsx,
    buildSinglePdf
  };
}

module.exports = { createReportsService };
