'use strict';

const express = require('express');

function createReportsRouter({ reportsService, middleware, audit }) {
  const router = express.Router();
  const { requireAuth, requireRole } = middleware;

  router.get('/export/csv', requireAuth, requireRole('admin', 'staff', 'reviewer'), (req, res) => {
    const { buffer, filename, count } = reportsService.buildCsv();
    if (typeof audit === 'function') {
      audit(req.user.id, 'csv_export', 'export', filename, { count });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  });

  router.get('/export/xlsx', requireAuth, requireRole('admin', 'staff', 'reviewer'), async (req, res, next) => {
    try {
      const { buffer, filename, count } = await reportsService.buildXlsx(req.user.username);
      if (typeof audit === 'function') {
        audit(req.user.id, 'xlsx_export', 'export', filename, { count });
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
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/export/xlsx/:id', requireAuth, requireRole('admin', 'staff', 'reviewer'), async (req, res, next) => {
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

  return router;
}

module.exports = { createReportsRouter };
