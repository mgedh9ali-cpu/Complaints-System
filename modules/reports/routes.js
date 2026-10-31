'use strict';

const express = require('express');

function readFilters(query) {
  const q = query || {};
  return {
    status: typeof q.status === 'string' ? q.status : undefined,
    province: typeof q.province === 'string' ? q.province : undefined,
    owner: typeof q.owner === 'string' ? q.owner : undefined,
    from: typeof q.from === 'string' ? q.from : undefined,
    to: typeof q.to === 'string' ? q.to : undefined
  };
}

function createReportsRouter({ reportsService, middleware, audit, rolesService }) {
  const router = express.Router();
  const { requireAuth } = middleware;
  const requirePermission =
    rolesService && typeof rolesService.requirePermission === 'function'
      ? (action) => rolesService.requirePermission(action)
      : () => (req, res, next) => next();

  router.get('/export/summary', requireAuth, requirePermission('export.csv'), (req, res) => {
    const filters = readFilters(req.query);
    const summary = reportsService.buildSummaryReport(filters, req.user.username);
    if (typeof audit === 'function') {
      audit(req.user.id, 'report_summary', 'export', summary.reportNumber, {
        count: summary.totals.all,
        filters
      });
    }
    res.json(summary);
  });

  router.get('/export/csv', requireAuth, requirePermission('export.csv'), (req, res) => {
    const filters = readFilters(req.query);
    const { buffer, filename, count } = reportsService.buildCsv(filters);
    if (typeof audit === 'function') {
      audit(req.user.id, 'csv_export', 'export', filename, { count, filters });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Count', String(count));
    res.send(buffer);
  });

  router.get('/export/xlsx', requireAuth, requirePermission('export.xlsx'), async (req, res, next) => {
    try {
      const filters = readFilters(req.query);
      const { buffer, filename, count } = await reportsService.buildXlsx(req.user.username, filters);
      if (typeof audit === 'function') {
        audit(req.user.id, 'xlsx_export', 'export', filename, { count, filters });
      }
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent(filename)
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Export-Count', String(count));
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/export/xlsx/:id', requireAuth, requirePermission('export.xlsx'), async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id || id.length > 100) {
        return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
      }
      const result = await reportsService.buildSingleXlsx(id, req.user.username);
      if (!result) return res.status(404).json({ error: 'الشكوى غير موجودة.' });
      if (typeof audit === 'function') {
        audit(req.user.id, 'xlsx_export_single', 'export', id, { filename: result.filename });
      }
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename)
      );
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.buffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/export/pdf/:id', requireAuth, requirePermission('export.xlsx'), (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 100) {
      return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
    }
    const result = reportsService.buildSinglePdf(id, req.user.username);
    if (!result) return res.status(404).json({ error: 'الشكوى غير موجودة.' });
    if (typeof audit === 'function') {
      audit(req.user.id, 'pdf_export_single', 'export', id, { filename: result.filename });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename)
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  });

  return router;
}

module.exports = { createReportsRouter };
