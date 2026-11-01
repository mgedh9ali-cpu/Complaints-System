'use strict';

/** Save an entire attachment request, or remove files written before a failure. */
function saveAttachmentBatch({ attachmentsService, complaintId, files }) {
  if (!attachmentsService ||
      typeof attachmentsService.save !== 'function' ||
      typeof attachmentsService.remove !== 'function' ||
      typeof attachmentsService.listByComplaint !== 'function') {
    throw new Error('Attachment storage service is unavailable.');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('لم يتم إرسال أي ملف.');
  }
  const existing = attachmentsService.listByComplaint(complaintId);
  const limit = attachmentsService.MAX_FILES_PER_COMPLAINT;
  if (!Array.isArray(existing) || !Number.isSafeInteger(limit) ||
      limit <= 0 || existing.length + files.length > limit) {
    throw new Error('الحد الأقصى لعدد المرفقات لهذه الشكوى (5 ملفات).');
  }
  const saved = [];
  try {
    for (const file of files) saved.push(attachmentsService.save(complaintId, file));
    return saved;
  } catch (error) {
    for (const meta of saved.reverse()) {
      try { attachmentsService.remove(meta.storedName); } catch (_) {}
    }
    throw error;
  }
}

module.exports = { saveAttachmentBatch };
