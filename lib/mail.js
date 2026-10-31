'use strict';

/**
 * Optional email notifications. Disabled unless SMTP is configured.
 * Prefer SMTP_URL (e.g. smtp://user:pass@host:587) or discrete SMTP_* vars.
 */

function isMailEnabled() {
  return Boolean(
    process.env.SMTP_URL ||
      (process.env.SMTP_HOST && process.env.SMTP_FROM)
  );
}

async function sendMail({ to, subject, text }) {
  if (!isMailEnabled()) {
    return { sent: false, reason: 'smtp_disabled' };
  }
  if (!to) return { sent: false, reason: 'no_recipient' };

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return { sent: false, reason: 'nodemailer_not_installed' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'complaints-local@localhost';
  let transporter;
  if (process.env.SMTP_URL) {
    transporter = nodemailer.createTransport(process.env.SMTP_URL);
  } else {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined
    });
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject: subject || 'إشعار نظام الشكاوى',
      text: text || ''
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message || 'send_failed' };
  }
}

function notifyComplaintCreated(complaint, logger) {
  const to = process.env.NOTIFY_ADMIN_EMAIL;
  if (!to) return Promise.resolve({ sent: false, reason: 'no_admin_email' });
  return sendMail({
    to,
    subject: `شكوى جديدة ${complaint.id}`,
    text: [
      `رقم المرجع: ${complaint.id}`,
      `الحالة: ${complaint.status}`,
      `التصنيف: ${complaint.category || '-'}`,
      `الأولوية: ${complaint.priority || '-'}`,
      `الملخص: ${complaint.summary || '-'}`,
      '',
      'تم إنشاء الشكوى على النظام المحلي.'
    ].join('\n')
  }).then((r) => {
    if (logger && !r.sent) logger.info('mail skipped/failed', r);
    return r;
  });
}

function notifyStatusChanged(complaint, fromStatus, logger) {
  const to = process.env.NOTIFY_ADMIN_EMAIL;
  if (!to) return Promise.resolve({ sent: false, reason: 'no_admin_email' });
  return sendMail({
    to,
    subject: `تحديث حالة ${complaint.id}`,
    text: [
      `رقم المرجع: ${complaint.id}`,
      `من: ${fromStatus}`,
      `إلى: ${complaint.status}`,
      `التحديث: ${complaint.updated || ''}`
    ].join('\n')
  }).then((r) => {
    if (logger && !r.sent) logger.info('mail skipped/failed', r);
    return r;
  });
}

module.exports = {
  isMailEnabled,
  sendMail,
  notifyComplaintCreated,
  notifyStatusChanged
};
