'use strict';

const express = require('express');

function createSettingsRouter({ settingsService, middleware, audit, logger, rolesService }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  if (!rolesService || typeof rolesService.requirePermission !== 'function') {
    throw new Error('Role enforcement service is required for protected routes.');
  }
  const requirePermission = (action) => rolesService.requirePermission(action);

  router.get('/settings', requireAuth, requirePermission('settings.read'), (req, res) => {
    const { settings, revision, updatedAt } = settingsService.getSettings();
    res.json({ settings, revision, updatedAt });
  });

  router.put('/settings', requireAuth, requirePermission('settings.manage'), requireCsrf, (req, res) => {
    const revisionHeader = req.get('X-State-Revision');
    if (typeof revisionHeader !== 'string' || !/^(0|[1-9]\d*)$/.test(revisionHeader)) {
      return res.status(428).json({ error: 'رقم إصدار البيانات مطلوب. أعد تحميل الإعدادات قبل الحفظ.' });
    }
    const expectedRevision = Number(revisionHeader);
    if (!Number.isSafeInteger(expectedRevision)) {
      return res.status(400).json({ error: 'رقم إصدار البيانات غير صالح.' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'بنية الإعدادات غير صالحة.' });
    }

    const result = settingsService.updateSettings({
      settings: body,
      userId: req.user.id,
      expectedRevision
    });

    if (result.conflict) {
      return res.status(409).json({
        error: 'لم يُحفظ التغيير لأن مستخدمًا آخر حفظ نسخة أحدث.',
        currentRevision: result.currentRevision
      });
    }

    if (typeof audit === 'function') {
      audit(req.user.id, 'settings_updated', 'settings', null, {
        revision: result.revision,
        slaDays: result.settings.slaDays,
        slaApproved: result.settings.slaApproved
      });
    }
    if (logger) {
      logger.info('settings updated', { userId: req.user.id, revision: result.revision });
    }

    res.json({
      saved: true,
      settings: result.settings,
      revision: result.revision,
      updatedAt: result.updatedAt
    });
  });

  return router;
}

module.exports = { createSettingsRouter };
