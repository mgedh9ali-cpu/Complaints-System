'use strict';

/**
 * Thin service wrapper around lib/attachments.
 * Keeps route handlers free of filesystem details.
 */

const attachmentsLib = require('../../lib/attachments');
const fs = require('node:fs');
const path = require('node:path');
const { storageFor } = require('../../lib/storage-codec');

function createAttachmentsService({ db } = {}) {
  const storage = db ? storageFor(db) : null;
  if (db) db.exec(`CREATE TABLE IF NOT EXISTS attachment_records (
    stored_name TEXT PRIMARY KEY, complaint_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
  )`);
  function metadata(storedName) {
    const row = db?.prepare('SELECT metadata_json FROM attachment_records WHERE stored_name=?').get(storedName);
    return row ? storage.decodeJson(row.metadata_json, 'attachment-meta:' + storedName) : null;
  }
  return {
    MAX_FILE_SIZE: attachmentsLib.MAX_FILE_SIZE,
    MAX_FILES_PER_COMPLAINT: attachmentsLib.MAX_FILES_PER_COMPLAINT,
    save: (complaintId, file) => attachmentsLib.saveAttachment(complaintId, file),
    record(meta, complaintId) {
      if (db) db.prepare('INSERT INTO attachment_records(stored_name,complaint_id,metadata_json) VALUES(?,?,?)')
        .run(meta.storedName, complaintId, storage.encodeJson(meta, 'attachment-meta:' + meta.storedName));
    },
    metadata,
    getPath: (storedName) => attachmentsLib.getAttachmentPath(storedName),
    read: (storedName) => attachmentsLib.readAttachment(storedName),
    remove: (storedName) => attachmentsLib.deleteAttachment(storedName),
    archive(storedName) {
      const source = attachmentsLib.getAttachmentPath(storedName);
      if (!source) throw new Error('المرفق غير موجود.');
      const dir = path.join(path.dirname(attachmentsLib.ATTACHMENTS_DIR), 'retired-attachments');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const destination = path.join(dir, path.basename(storedName));
      if (fs.existsSync(destination)) throw new Error('يوجد مرفق مؤرشف بنفس الاسم.');
      fs.renameSync(source, destination);
      return { source, destination };
    },
    restoreArchived({ source, destination }) { fs.renameSync(destination, source); },
    listByComplaint: (complaintId) => attachmentsLib.listAttachmentsForComplaint(complaintId).map(item => ({ ...item, ...metadata(item.storedName) }))
  };
}

module.exports = { createAttachmentsService };
