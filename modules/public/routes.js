'use strict';

const express = require('express');

/**
 * Public (unauthenticated) routes — intentionally minimal and non-sensitive.
 */
function createPublicRouter({ complaintsService, db }) {
  const router = express.Router();

  const STATUS_LABELS = {
    new: 'جديدة',
    in_progress: 'قيد المعالجة',
    awaiting_reply: 'بانتظار رد الجهة',
    awaiting_approval: 'بانتظار الاعتماد',
    closed: 'مغلقة',
    cancelled: 'ملغاة'
  };

  function findComplaint(id) {
    const { state } = complaintsService.readState();
    let complaint = (state.complaints || []).find((c) => c && c.id === id);
    if (complaint) return complaint;
    if (!db) return null;
    try {
      const row = db.prepare('SELECT payload_json FROM complaints WHERE id = ?').get(id);
      if (row && row.payload_json) return JSON.parse(row.payload_json);
    } catch (_) {
      return null;
    }
    return null;
  }

  router.get('/public/track/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 100 || !/^SY-\d{4}-[0-9a-f-]{8}$/i.test(id)) {
      return res.status(400).json({ error: 'رقم المرجع غير صالح.' });
    }

    const complaint = findComplaint(id);
    if (!complaint) {
      return res.status(404).json({ error: 'لا توجد شكوى بهذا الرقم.' });
    }

    const status = complaint.status || 'new';
    res.json({
      id: complaint.id,
      status,
      statusLabel: STATUS_LABELS[status] || status,
      category: complaint.category || null,
      priority: complaint.priority || null,
      created: complaint.created || null,
      updated: complaint.updated || null,
      hasReply: Boolean(complaint.reply),
      closed: status === 'closed' || status === 'cancelled'
    });
  });

  return router;
}

module.exports = { createPublicRouter };
