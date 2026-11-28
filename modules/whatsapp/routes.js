'use strict';

const express = require('express');
const { isAllowed, MAX_FILE_SIZE } = require('../../lib/attachments');
const { createLocalTranscriber } = require('./transcription');

function createWhatsAppRouter({ middleware, rolesService, transcriber = createLocalTranscriber() }) {
  const router = express.Router();
  const { requireAuth, requireCsrf } = middleware;
  const canCreate = rolesService.requirePermission('complaints.create');

  router.get('/whatsapp/transcription', requireAuth, canCreate, (_req, res) => {
    res.json({ available: transcriber.ready });
  });
  router.post('/whatsapp/transcription', requireAuth, canCreate, requireCsrf,
    express.raw({ type: 'audio/ogg', limit: MAX_FILE_SIZE, inflate: false }),
    async (req, res, next) => {
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || !isAllowed({
        buffer, size: buffer.length, originalname: 'voice.opus', mimetype: 'audio/ogg'
      })) {
        return res.status(400).json({ error: 'اختر تسجيل واتساب أصليًا بصيغة Opus أو Ogg وحجم لا يتجاوز 5 ميغابايت.' });
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once('close', abort);
      try {
        const { status, ...body } = await transcriber.transcribe(buffer, controller.signal);
        if (!res.destroyed) res.status(status).json(body);
      } catch {
        next(new Error('Local WhatsApp transcription failed'));
      } finally {
        res.removeListener('close', abort);
      }
    });
  return router;
}

module.exports = { createWhatsAppRouter };
