'use strict';

/**
 * Thin service wrapper around lib/attachments.
 * Keeps route handlers free of filesystem details.
 */

const attachmentsLib = require('../../lib/attachments');

function createAttachmentsService() {
  return {
    MAX_FILE_SIZE: attachmentsLib.MAX_FILE_SIZE,
    MAX_FILES_PER_COMPLAINT: attachmentsLib.MAX_FILES_PER_COMPLAINT,
    save: (complaintId, file) => attachmentsLib.saveAttachment(complaintId, file),
    getPath: (storedName) => attachmentsLib.getAttachmentPath(storedName),
    remove: (storedName) => attachmentsLib.deleteAttachment(storedName),
    listByComplaint: (complaintId) => attachmentsLib.listAttachmentsForComplaint(complaintId)
  };
}

module.exports = { createAttachmentsService };
