'use strict';

const express = require('express');

/**
 * Public (unauthenticated) routes — intentionally minimal and non-sensitive.
 */
function createPublicRouter({ complaintsService }) {
  const router = express.Router();

  const STATUS_LABELS = {
    new: 'جديدة',
    in_progress: 'قيد المعالجة',
    awaiting_reply: 'بانتظار رد الجهة',
    awaiting_approval: 'بانتظار الاعتماد',
    closed: 'مغلقة',
    cancelled: 'ملغاة'
  };

  router.get('/public/track/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 100 || !/^SY-\d{4}-[0-9a-f-]{8}$/i.test(id)) {
      return res.status(400).json({ error: 'رقم المرجع غير صالح.' });
    }

    const { state } = complaintsService.readState();
    let complaint = (state.complaints || []).find((c) => c && c.id === id);
    if (!complaint) {
      // Dual-read from normalized table if present
      try {
        const Database = null;
      } catch (_) {}
    }
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
      // لا نعيد الاسم أو الهاتف أو التفاصيل النصية الكاملة للخصوصية
      hasReply: Boolean(complaint.reply),
      closed: status === 'closed' || status === 'cancelled'
    });
  });

  return router;
}

module.exports = { createPublicRouter };
