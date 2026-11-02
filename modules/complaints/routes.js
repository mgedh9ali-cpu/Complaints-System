'use strict';

const express = require('express');
const { validComplaintDraft, validStatePayload } = require('../../lib/validation');

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
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);
  router.use('/complaints/:id', requireAuth, (req, res, next) => {
    const revision = req.get('X-State-Revision');
    if (revision !== undefined && (!/^(0|[1-9]\d*)$/.test(revision) ||
        Number(revision) !== complaintsService.readState().revision)) {
      return res.status(409).json({ error: 'تغيرت البيانات؛ أعد تحميل الشكوى قبل تنفيذ الإجراء.' });
    }
    next();
  });

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
        state.complaints.length > 50000 ||
        !Array.isArray(state.notifications) ||
        !Array.isArray(state.templates) ||
        !state.settings ||
        typeof state.settings !== 'object' ||
        Array.isArray(state.settings)
      ) {
        return res.status(400).json({ error: 'بنية البيانات المرسلة غير صالحة.' });
      }
      if (complaintsService.readState().revision === 0 && state.complaints.length) {
        return res.status(409).json({ error: 'إنشاء الأرقام عبر حفظ الحالة غير مسموح؛ استخدم تسجيل الشكاوى أو الاستيراد المعتمد.' });
      }
      const storedState = complaintsService.readState().state;
      if (!rolesService.can(req.user, 'settings.manage') && JSON.stringify(storedState.settings) !== JSON.stringify(state.settings)) {
        return res.status(403).json({ error: 'إعدادات النظام لا يغيّرها إلا المدير.' });
      }
      const priorityValues = Array.isArray(state.settings.priorities) ? state.settings.priorities.map(p => p?.value) : [];
      if (!validStatePayload(state) || state.complaints.some(c => !validComplaint(c, {
        allowedPriorities: [...priorityValues, storedState.complaints.find(old => old.id === c.id)?.priority]
      }))) {
        return res.status(400).json({ error: 'توجد حقول شكوى غير صالحة.' });
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
        return res.status(409).json({ error: result.error || 'تغيير الحالة غير مسموح.' });
      }
      // Events are recorded atomically inside complaintsService.saveState.
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
      const asDraft = body.asDraft === true || body.status === 'draft';
      const allowedPriorities = complaintsService.readState().state.settings.priorities?.map(p => p.value) || [];
      if (asDraft ? !validComplaintDraft(body) : !validComplaint(body, { allowedPriorities })) {
        return res.status(400).json({ error: 'بيانات الشكوى أو المسودة غير صالحة.' });
      }
      const prepared = asDraft ? {
        ...body,
        summary: body.summary?.trim() || 'مسودة بانتظار الاستكمال',
        province: body.province?.trim() || 'غير محددة',
        category: body.category?.trim() || 'غير مصنفة'
      } : body;
      const result = complaintsService.createComplaint({
        body: prepared,
        userId: req.user.id,
        username: req.user.username,
        asDraft
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error || 'تعذر الإنشاء.' });
      }
      res.status(201).json({ complaint: result.complaint, revision: result.revision });
    }
  );

  router.patch(
    '/complaints/:id',
    requireAuth,
    requirePermission('complaints.update'),
    requireCsrf,
    (req, res) => {
      const incoming = req.body;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return res.status(400).json({ error: 'بنية تعديل الشكوى غير صالحة.' });
      }
      const current = complaintsService.readState().state.complaints.find(
        item => item && item.id === req.params.id
      );
      const allowedPriorities = complaintsService.readState().state.settings.priorities?.map(p => p.value) || [];
      if (current && !validComplaint({ ...current, ...incoming }, { allowedPriorities: [...allowedPriorities, current.priority] })) {
        return res.status(400).json({ error: 'حقول تعديل الشكوى غير صالحة.' });
      }
      const result = complaintsService.updateComplaint({
        complaintId: req.params.id,
        body: incoming,
        userId: req.user.id,
        username: req.user.username
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json({
        ok: true,
        complaint: result.complaint,
        revision: result.revision,
        unchanged: Boolean(result.unchanged)
      });
    }
  );

  router.delete(
    '/complaints/:id',
    requireAuth,
    requirePermission('complaints.delete'),
    requireCsrf,
    (req, res) => {
      const result = complaintsService.deleteComplaint({
        complaintId: req.params.id,
        userId: req.user.id,
        username: req.user.username
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json({ ok: true, deletedId: result.deletedId, revision: result.revision });
    }
  );

  router.post(
    '/complaints/:id/referrals',
    requireAuth,
    requirePermission('complaints.update'),
    requireCsrf,
    (req, res) => {
      const result = complaintsService.addReferral({
        complaintId: req.params.id,
        entity: req.body?.entity,
        due: req.body?.due,
        note: req.body?.note,
        userId: req.user.id,
        username: req.user.username
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.status(201).json({
        ok: true,
        referral: result.referral,
        complaint: result.complaint,
        revision: result.revision
      });
    }
  );

  router.patch('/complaints/:id/referrals/:index/response', requireAuth, requirePermission('complaints.update'), requireCsrf, (req, res) => {
    const result = complaintsService.recordReferralResponse({ complaintId: req.params.id, index: Number(req.params.index),
      response: req.body?.response, userId: req.user.id, username: req.user.username });
    res.status(result.ok ? 200 : result.status || 400).json(result);
  });

  router.patch('/complaints/:id/reply', requireAuth, requireCsrf, (req, res) => {
    const result = complaintsService.actOnReply({ complaintId: req.params.id, action: req.body?.action,
      text: req.body?.text, userId: req.user.id, username: req.user.username });
    res.status(result.ok ? 200 : result.status || 400).json(result);
  });

  router.patch(
    '/complaints/:id/status',
    requireAuth,
    requirePermission('complaints.status'),
    requireCsrf,
    (req, res) => {
      const result = complaintsService.changeStatus({
        complaintId: req.params.id,
        toStatus: req.body?.status,
        reason: req.body?.reason,
        userId: req.user.id,
        username: req.user.username,
        closureException: req.body?.closureException === true
      });
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error || 'تعذر تغيير الحالة.' });
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

  return router;
}

module.exports = { createComplaintsRouter };
