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
    const complaints = applyFilters(listComplaints(), filters);
    const byStatus = {};
    const byProvince = {};
    const byCategory = {};
    for (const c of complaints) {
      const st = c.status || 'unknown';
      byStatus[st] = (byStatus[st] || 0) + 1;
      const pr = c.province || '—';
      byProvince[pr] = (byProvince[pr] || 0) + 1;
      const cat = c.category || '—';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    return {
      reportNumber: 'SUM-' + new Date().toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      generatedBy: generatedBy || 'system',
      filters,
      totals: { all: complaints.length, byStatus, byProvince, byCategory },
      complaints: complaints.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        province: c.province,
        category: c.category,
        created: c.created
      }))
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
      generatedBy: generatedBy || 'system',
      from: filters.from || '',
      to: filters.to || '',
      status: filters.status || '',
      province: filters.province || ''
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
      'تقرير شكوى فردية',
      'الرقم: ' + (complaint.id || ''),
      'الاسم: ' + (complaint.name || ''),
      'الحالة: ' + (STATUS_LABELS[complaint.status] || complaint.status || ''),
      'المحافظة: ' + (complaint.province || ''),
      'التصنيف: ' + (complaint.category || ''),
      'الملخص: ' + (complaint.summary || ''),
      'التفاصيل: ' + (complaint.details || ''),
      'تاريخ الإنشاء: ' + (complaint.created || ''),
      'المسؤول: ' + (complaint.owner || ''),
      'مُصدر بواسطة: ' + (generatedBy || 'system')
    ];
    const buffer = await buildSimplePdf({
      title: 'شكوى ' + (complaint.id || ''),
      lines
    });
    return {
      buffer,
      filename: 'شكوى-' + id + '.pdf'
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
    buildSinglePdf,
    STATUS_LABELS
  };
}

module.exports = { createReportsService, STATUS_LABELS };
