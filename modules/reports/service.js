'use strict';

const { buildComplaintsWorkbook, buildSingleComplaintWorkbook } = require('../../lib/excel-export');
const { buildSimplePdf } = require('../../lib/simple-pdf');
const {dayBoundary,dayKey}=require('../../lib/work-time');

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
  let s = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseDayBound(value,endOfDay){return dayBoundary(value,endOfDay);}

function createReportsService({ complaintsService }) {
  function listComplaints() {
    const { state } = complaintsService.readState();
    return Array.isArray(state.complaints) ? state.complaints.filter(c => !c.archivedAt) : [];
  }

  function findComplaint(id) {
    const complaints = listComplaints();
    return complaints.find((c) => c && c.id === id) || null;
  }

  function applyFilters(complaints, filters = {}) {
    let rows = complaints.slice();
    if (Array.isArray(filters.ids)) { const selected = new Set(filters.ids); rows = rows.filter(c => selected.has(c.id)); }
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
    const slaApproved = complaintsService.readState().state.settings.slaApproved === true;
    for (const c of rows) {
      const st = c.status || 'unknown';
      byStatus[st] = (byStatus[st] || 0) + 1;
      if (slaApproved && c.due && !['closed', 'cancelled', 'draft'].includes(c.status)) {
        const dueMs = Date.parse(c.due);
        if (Number.isFinite(dueMs) && now > dueMs) late += 1;
      }
    }
    const reportNumber =
      'RPT-' +
      dayKey().replace(/-/g, '') +
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

  async function buildSinglePdf(id, generatedBy) {
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
      'اسم المشتكي: ' + (complaint.name || '-'),
      'الهاتف: ' + (complaint.phone || '-'),
      'التفاصيل: ' + String(complaint.details || '-'),
      'مُصدر التقرير: ' + (generatedBy || 'system'),
      'وقت الإصدار: ' + new Date().toISOString()
    ];
    if (complaint.survey && complaint.survey.rating) {
      lines.push('تقييم الخدمة: ' + complaint.survey.rating + '/5');
    }
    if (complaint.reply) lines.push('الرد: ' + complaint.reply.text, 'مرحلة الرد: ' + complaint.reply.status,
      'معد الرد: ' + complaint.reply.author, 'المعتمد: ' + (complaint.reply.approvedBy || '-'));
    const buffer = await buildSimplePdf(lines, 'تقرير شكوى - ' + complaint.id);
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
