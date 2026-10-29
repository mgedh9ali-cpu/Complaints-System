'use strict';

const { buildComplaintsWorkbook, buildSingleComplaintWorkbook } = require('../../lib/excel-export');

const CSV_HEADERS = [
  'id', 'name', 'phone', 'province', 'entity', 'category',
  'priority', 'status', 'summary', 'created', 'updated', 'due', 'owner'
];

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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

  function buildCsv() {
    const complaints = listComplaints();
    const lines = [CSV_HEADERS.join(',')];
    for (const c of complaints) {
      lines.push(CSV_HEADERS.map((h) => escapeCsv(c[h])).join(','));
    }
    return {
      buffer: Buffer.from('\uFEFF' + lines.join('\n'), 'utf8'),
      filename: 'complaints-export-' + new Date().toISOString().slice(0, 10) + '.csv',
      count: complaints.length
    };
  }

  async function buildXlsx(generatedBy) {
    const complaints = listComplaints();
    const buffer = await buildComplaintsWorkbook(complaints, {
      title: 'تقرير الشكاوى',
      generatedBy: generatedBy || 'system'
    });
    return {
      buffer,
      filename: 'تقرير-الشكاوى-' + new Date().toISOString().slice(0, 10) + '.xlsx',
      count: complaints.length
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

  return { listComplaints, findComplaint, buildCsv, buildXlsx, buildSingleXlsx };
}

module.exports = { createReportsService };
