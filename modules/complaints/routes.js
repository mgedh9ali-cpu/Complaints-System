'use strict';

const express = require('express');
const { submitSurvey } = require('./survey');
const { notifyComplaintCreated, notifyStatusChanged } = require('../../lib/mail');

function createComplaintsRouter({
  complaintsService,
  middleware,
  audit,
  logger,
  validComplaint,
  diffComplaints,
  db,
  rolesService
}) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  const requirePermission =
    rolesService && typeof rolesService.requirePermission === 'function'
      ? (action) => rolesService.requirePermission(action)
      : () => (req, res, next) => next();

  router.get('/state', requireAuth, requirePermission('complaints.read'), (req, res) => {
    const { state, updatedAt, revision } = complaintsService.readState();
    res.json({ state, updatedAt, revision });
  });

  router.put(
    '/state',
    requireAuth,
    requirePermission('complaints.update'),
    requireCsrf,
    (req, res) => {
      const revisionHeader = req.get('X-State-Revision');
      if (typeof revisionHeader !== 'string' || !/^(0|[1-9]\d*)$/.test(revisionHeader)) {
        return res.status(428).json({ error: 'رقم إصدار البيانات مطلوب. أعد تحميل الحالة قبل الحفظ.' });
      }
      const expectedRevision = Number(revisionHeader);
      if (!Number.isSafeInteger(expectedRevision)) {
        return res.status(400).json({ error: 'رقم إصدار البيانات غير صالح.' });
      }
      const state = req.body;
      if (
        !state ||
        typeof state !== 'object' ||
        Array.isArray(state) ||
        !Array.isArray(state.complaints) ||
        state.complaints.length > 5000 ||
        !Array.isArray(state.notifications) ||
        !Array.isArray(state.templates) ||
        !state.settings ||
        typeof state.settings !== 'object' ||
        Array.isArray(state.settings)
      ) {
        return res.status(400).json({ error: 'بنية البيانات المرسلة غير صالحة.' });
      }
      const complaintIds = new Set();
      for (const complaint of state.complaints) {
        if (
          !complaint ||
          typeof complaint !== 'object' ||
          Array.isArray(complaint) ||
          typeof complaint.id !== 'string' ||
          !complaint.id.trim() ||
          complaint.id.length > 100
        ) {
          return res.status(400).json({ error: 'يتضمن ملف الشكاوى سجلًا بمعرّف غير صالح.' });
        }
        if (complaintIds.has(complaint.id)) {
          return res.status(400).json({ error: 'تتضمن البيانات معرّفات شكاوى مكررة.' });
        }
        complaintIds.add(complaint.id);
      }
      const stateJson = JSON.stringify(state);
      if (Buffer.byteLength(stateJson, 'utf8') > 900 * 1024) {
        return res.status(413).json({ error: 'حجم البيانات أكبر من الحد المسموح.' });
      }

      const result = complaintsService.saveState({
        state,
        userId: req.user.id,
        expectedRevision,
        diffComplaints
      });

      if (result.conflict) {
        return res.status(409).json({
          error: 'لم يُحفظ التغيير لأن مستخدمًا آخر حفظ نسخة أحدث.',
          currentRevision: result.currentRevision
        });
      }
      if (result.invalidTransition) {
        return res.status(409).json({
          error:
            result.error ||
            'تغيير الحالة غير مسموح عبر حفظ الحالة الكامل. استخدم مسار تغيير الحالة.'
        });
      }

      for (const change of result.complaintChanges || []) {
        audit(req.user.id, change.action, 'complaint', change.id, change.details);
      }
      audit(req.user.id, 'application_state_saved', 'application', null, {
        complaintCount: state.complaints.length,
        complaintChanges: (result.complaintChanges || []).length,
        revision: result.revision
      });
      if (logger) {
        logger.info('application state saved', {
          userId: req.user.id,
          revision: result.revision,
          complaintCount: state.complaints.length
        });
      }
      res.json({
        saved: true,
        updatedAt: result.updatedAt,
        revision: result.revision,
        complaintChangesLogged: (result.complaintChanges || []).length
      });
    }
  );

  router.post(
    '/complaints',
    requireAuth,
    requirePermission('complaints.create'),
    requireCsrf,
    (req, res) => {
      const body = req.body || {};
      if (!validComplaint(body)) return res.status(400).json({ error: 'بيانات الشكوى غير صالحة.' });
      const result = complaintsService.createComplaint({
        body,
        userId: req.user.id,
        username: req.user.username
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error || 'تعذر إنشاء الشكوى.' });
      }
      notifyComplaintCreated(result.complaint, logger).catch(() => {});
      res.status(201).json({ complaint: result.complaint, revision: result.revision });
    }
  );

  router.patch(
    '/complaints/:id/status',
    requireAuth,
    requirePermission('complaints.status'),
    requireCsrf,
    (req, res) => {
      const fromHint = req.body?.from;
      const result = complaintsService.changeStatus({
        complaintId: req.params.id,
        toStatus: req.body?.status,
        reason: req.body?.reason,
        userId: req.user.id,
        username: req.user.username
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error || 'تعذر تغيير الحالة.' });
      }
      if (!result.unchanged) {
        const hist = result.complaint.statusHistory || [];
        const last = hist[hist.length - 1];
        notifyStatusChanged(result.complaint, last?.from || fromHint || '', logger).catch(() => {});
      }
      res.json({
        ok: true,
        id: req.params.id,
        status: result.complaint.status,
        revision: result.revision,
        statusHistory: result.complaint.statusHistory || [],
        unchanged: Boolean(result.unchanged)
      });
    }
  );

  router.post(
    '/complaints/:id/survey',
    requireAuth,
    requirePermission('complaints.status'),
    requireCsrf,
    (req, res) => {
      const result = submitSurvey({
        db,
        complaintsService,
        complaintId: req.params.id,
        rating: req.body?.rating,
        comment: req.body?.comment,
        actorLabel: req.user.username,
        userId: req.user.id,
        audit
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json({ ok: true, survey: result.survey, revision: result.revision });
    }
  );

  return router;
}

module.exports = { createComplaintsRouter };
