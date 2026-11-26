'use strict';

const express = require('express');

function readFilters(query) {
  const q = query || {};
  return {
    status: typeof q.status === 'string' ? q.status : undefined,
    province: typeof q.province === 'string' ? q.province : undefined,
    category: typeof q.category === 'string' ? q.category : undefined,
    priority: typeof q.priority === 'string' ? q.priority : undefined,
    from: typeof q.from === 'string' ? q.from : undefined,
    to: typeof q.to === 'string' ? q.to : undefined
  };
}

function createReportsRouter({ reportsService, middleware, audit, rolesService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

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

  router.post('/export/:format/selection', requireAuth, (req, res, next) => {
    if (!['csv', 'xlsx', 'pdf'].includes(req.params.format)) return res.sendStatus(404);
    return requirePermission(req.params.format === 'csv' ? 'export.csv' : 'export.xlsx')(req, res, next);
  }, requireCsrf, async (req, res, next) => {
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length > 5000 || ids.some(id => typeof id !== 'string' || !id || id.length > 100)) {
        return res.status(400).json({ error: 'اختر حتى 5000 سجل للتصدير في المرة الواحدة.' });
      }
      const format = req.params.format;
      const filters = { ids: [...new Set(ids)], includeArchived: req.body.includeArchived === true };
      const result = format === 'csv' ? reportsService.buildCsv(filters)
        : format === 'xlsx' ? await reportsService.buildXlsx(req.user.username, filters)
        : await reportsService.buildRegistryPdf(req.user.username, filters);
      if (typeof audit === 'function') audit(req.user.id, format + '_export', 'export', result.filename,
        { count: result.count, selectedIds: filters.ids, includeArchived: filters.includeArchived });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Export-Count', String(result.count));
      res.setHeader('Content-Type', {csv: 'text/csv; charset=utf-8', pdf: 'application/pdf',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[format]);
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename));
      res.send(result.buffer);
    } catch (error) { next(error); }
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

  router.get('/export/pdf/:id', requireAuth, requirePermission('export.xlsx'), async (req, res, next) => {
    try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 100) {
      return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
    }
    const kind = req.query.kind === 'receipt' ? 'receipt' : 'report';
    const result = await reportsService.buildSinglePdf(id, req.user.username, { kind });
    if (!result) return res.status(404).json({ error: 'الشكوى غير موجودة.' });
    if (typeof audit === 'function') {
      audit(req.user.id, kind === 'receipt' ? 'pdf_receipt' : 'pdf_export_single', 'export', id, {
        filename: result.filename,
        integrityHash: result.integrityHash
      });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename)
    );
    res.setHeader('Cache-Control', 'no-store');
    if (result.integrityHash) res.setHeader('X-Integrity-Hash', result.integrityHash);
    res.send(result.buffer);
    } catch (error) { next(error); }
  });

  router.get('/export/docx/:id', requireAuth, requirePermission('export.xlsx'), async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id || id.length > 100) return res.status(400).json({ error: 'معرّف الشكوى غير صالح.' });
      const result = await reportsService.buildSingleDocx(id, req.user.username);
      if (!result) return res.status(404).json({ error: 'الشكوى غير موجودة.' });
      if (typeof audit === 'function') audit(req.user.id, 'docx_export_single', 'export', id, { filename: result.filename, integrityHash: result.integrityHash });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Integrity-Hash', result.integrityHash);
      res.send(result.buffer);
    } catch (error) { next(error); }
  });


  // Custom previews and downloads share a single allowlisted server model.
  const custom = require('./custom');
  router.get('/reports/custom/preview', requireAuth, requirePermission('export.xlsx'), (req,res,next)=>{
    try {
      const model=custom.buildModel(reportsService,req.query);
      res.setHeader('Cache-Control','no-store');
      res.json({...model,rows:model.rows.slice(0,100),previewLimit:100});
    } catch(error){if(error.status===400)return res.status(400).json({error:error.message});next(error);}
  });
  router.get('/reports/custom/export/:format', requireAuth, requirePermission('export.xlsx'), async(req,res,next)=>{
    try {
      const format=req.params.format;
      if(!Object.hasOwn(custom.FORMATS,format))return res.sendStatus(404);
      const model=custom.buildModel(reportsService,req.query);
      const buffer=await custom.encodeReport(model,format);
      const filename='report-'+new Date().toISOString().slice(0,10)+'.'+format;
      if(typeof audit==='function')audit(req.user.id,'custom_report_export','export',filename,{format,count:model.count,columns:model.columns.map(c=>c.key)});
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Type',custom.FORMATS[format]);
      res.setHeader('Content-Disposition','attachment; filename="'+filename+'"');
      res.setHeader('X-Export-Count',String(model.count));
      res.send(buffer);
    } catch(error){if(error.status===400)return res.status(400).json({error:error.message});next(error);}
  });

  return router;
}

module.exports = { createReportsRouter };
