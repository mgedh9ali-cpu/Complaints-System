'use strict';
function protectReminderNotes(db, codec) {
  const columns = db.prepare('PRAGMA table_info(complaint_reminders)').all();
  if (!columns.length) return;
  if (!columns.some(c => c.name === 'note_encrypted')) db.exec('ALTER TABLE complaint_reminders ADD COLUMN note_encrypted INTEGER NOT NULL DEFAULT 0 CHECK(note_encrypted IN (0,1))');
  if (!codec.enabled) return;
  db.exec('CREATE TABLE IF NOT EXISTS reminder_storage_migration(id INTEGER PRIMARY KEY CHECK(id=1), cleanup_pending INTEGER NOT NULL CHECK(cleanup_pending IN (0,1)))');
  const rows = db.prepare('SELECT id, note FROM complaint_reminders WHERE note_encrypted=0').all();
  if (rows.length) {
    const update = db.prepare('UPDATE complaint_reminders SET note=?, note_encrypted=1 WHERE id=?');
    db.transaction(() => {
      for (const row of rows) update.run(codec.encodeJson(row.note, 'reminder:' + row.id), row.id);
      db.prepare('INSERT INTO reminder_storage_migration(id,cleanup_pending) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET cleanup_pending=1').run();
    })();
  }
  if (db.prepare('SELECT cleanup_pending FROM reminder_storage_migration WHERE id=1').get()?.cleanup_pending !== 1) return;
  // The durable marker resumes sanitization after an interrupted migration.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('UPDATE reminder_storage_migration SET cleanup_pending=0 WHERE id=1').run();
  db.pragma('wal_checkpoint(TRUNCATE)');
}
module.exports = { protectReminderNotes };
