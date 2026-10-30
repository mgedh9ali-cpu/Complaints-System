'use strict';

/**
 * Automated acceptance gates for P0 security / lifecycle / permissions.
 * Complements docs/manual-acceptance-checklist.md (manual device steps remain required).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createRolesService } = require('../modules/roles/service.js');
const { createAuthService } = require('../modules/auth/service.js');
const { createComplaintsService } = require('../modules/complaints/service.js');
const { createReportsService } = require('../modules/reports/service.js');
const { createDashboardService } = require('../modules/dashboard/service.js');
const { revokeUserSessions } = require('../lib/session-revoke.js');
const { parseStoredAttachmentName } = require('../modules/attachments/routes.js');
const { findComplaintConflicts } = require('../modules/sync/service.js');
const { isAllowed } = require('../lib/attachments.js');
const { hashAuditEvent, verifyAuditRows } = require('../lib/audit-integrity.js');

function setupDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-p0-'));
  const db = new Database(path.join(dir, 't.sqlite'));
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE complaints (
      id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_state (
      id INTEGER PRIMARY KEY CHECK(id = 1), state_json TEXT NOT NULL,
      updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL,
      target_type TEXT NOT NULL, target_id TEXT, details_json TEXT NOT NULL,
      created_at TEXT NOT NULL, previous_hash TEXT, event_hash TEXT
    );
  `);
  return { db, dir };
}

test('acceptance: roles matrix blocks staff from backup and user admin', () => {
  const roles = createRolesService();
  assert.equal(roles.can('staff', 'backup.database'), false);
  assert.equal(roles.can('staff', 'users.manage'), false);
  assert.equal(roles.can('reviewer', 'complaints.create'), false);
  assert.equal(roles.can('reviewer', 'attachments.read'), true);
  assert.equal(roles.can('admin', 'sync.import'), true);
});

test('acceptance: password change and deactivate path work', () => {
  const { db, dir } = setupDb();
  const sessionsDir = path.join(dir, 'sessions');
  fs.mkdirSync(sessionsDir);
  try {
    const auth = createAuthService({ db, audit: () => {}, logger: null, sessionsDir });
    auth.ensureBootstrapAdmin('adminuser', 'Admin-password-12');
    const user = db.prepare('SELECT id FROM users WHERE username=?').get('adminuser');
    fs.writeFileSync(
      path.join(sessionsDir, 'old.json'),
      JSON.stringify({ user: { id: user.id } })
    );
    const changed = auth.changePassword({
      userId: user.id,
      currentPassword: 'Admin-password-12',
      newPassword: 'Admin-password-99',
      keepSessionId: null
    });
    assert.equal(changed.ok, true);
    assert.equal(auth.authenticate('adminuser', 'Admin-password-99').ok, true);

    const staff = auth.createUser({
      username: 'staffone',
      password: 'Staff-password-12',
      role: 'staff',
      actorId: user.id
    });
    assert.equal(staff.ok, true);
    fs.writeFileSync(
      path.join(sessionsDir, 'staff.json'),
      JSON.stringify({ user: { id: staff.user.id } })
    );
    const deactivated = auth.setActive({
      targetId: staff.user.id,
      active: false,
      actorId: user.id
    });
    assert.equal(deactivated.ok, true);
    assert.ok((deactivated.sessionsRevoked || 0) >= 1);
    assert.equal(fs.existsSync(path.join(sessionsDir, 'staff.json')), false);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acceptance: complaint lifecycle number + transitions + reason', () => {
  const { db, dir } = setupDb();
  try {
    const auth = createAuthService({ db, audit: () => {}, logger: null });
    auth.ensureBootstrapAdmin('adminuser', 'Admin-password-12');
    const user = db.prepare('SELECT id, username FROM users WHERE username=?').get('adminuser');
    const complaints = createComplaintsService({ db, audit: () => {}, logger: null });
    const created = complaints.createComplaint({
      body: { summary: 'قبول آلي', province: 'دمشق', category: 'استفسار عام' },
      userId: user.id,
      username: user.username
    });
    assert.equal(created.ok, true);
    assert.match(created.complaint.id, /^SY-\d{4}-/);
    assert.ok(complaints.readState().state.complaints.some((c) => c.id === created.complaint.id));
    assert.ok(db.prepare('SELECT id FROM complaints WHERE id=?').get(created.complaint.id));

    assert.equal(
      complaints.changeStatus({
        complaintId: created.complaint.id,
        toStatus: 'closed',
        reason: 'مباشر',
        userId: user.id,
        username: user.username
      }).ok,
      false
    );

    assert.equal(
      complaints.changeStatus({
        complaintId: created.complaint.id,
        toStatus: 'in_progress',
        userId: user.id,
        username: user.username
      }).ok,
      true
    );

    assert.equal(
      complaints.changeStatus({
        complaintId: created.complaint.id,
        toStatus: 'closed',
        reason: '',
        userId: user.id,
        username: user.username
      }).status,
      400
    );

    assert.equal(
      complaints.changeStatus({
        complaintId: created.complaint.id,
        toStatus: 'closed',
        reason: 'اكتملت المعالجة',
        userId: user.id,
        username: user.username
      }).ok,
      true
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acceptance: attachment magic rejects mismatched content', () => {
  const fakeExe = {
    originalname: 'virus.pdf',
    mimetype: 'application/pdf',
    size: 4,
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00])
  };
  assert.equal(isAllowed(fakeExe), false);
  const okPdf = {
    originalname: 'doc.pdf',
    mimetype: 'application/pdf',
    size: 8,
    buffer: Buffer.from('%PDF-1.4')
  };
  assert.equal(isAllowed(okPdf), true);
  assert.equal(parseStoredAttachmentName('SY-2026-aa_not-a-uuid.pdf'), null);
});

test('acceptance: audit chain detects tampering', () => {
  const rows = [];
  let prev = null;
  for (let i = 0; i < 3; i += 1) {
    const row = {
      id: 'e' + i,
      actor_user_id: 'u1',
      action: 'test',
      target_type: 'x',
      target_id: null,
      details_json: '{}',
      created_at: '2026-01-0' + (i + 1),
      previous_hash: prev
    };
    row.event_hash = hashAuditEvent(row, prev);
    prev = row.event_hash;
    rows.push(row);
  }
  assert.equal(verifyAuditRows(rows).valid, true);
  rows[1].details_json = '{"tampered":true}';
  assert.equal(verifyAuditRows(rows).valid, false);
});

test('acceptance: sync conflicts are reported', () => {
  const conflicts = findComplaintConflicts(
    [{ id: 'a', status: 'new', updated: 't1' }],
    [{ id: 'a', status: 'closed', updated: 't2' }]
  );
  assert.equal(conflicts.length, 1);
});

test('acceptance: reports filter and summary metadata', () => {
  const { db, dir } = setupDb();
  try {
    const auth = createAuthService({ db, audit: () => {}, logger: null });
    auth.ensureBootstrapAdmin('adminuser', 'Admin-password-12');
    const user = db.prepare('SELECT id, username FROM users WHERE username=?').get('adminuser');
    const complaints = createComplaintsService({ db, audit: () => {}, logger: null });
    complaints.createComplaint({
      body: { summary: 'واحدة', province: 'دمشق', category: 'استفسار عام' },
      userId: user.id,
      username: user.username
    });
    complaints.createComplaint({
      body: { summary: 'اثنتان', province: 'حلب', category: 'استفسار عام' },
      userId: user.id,
      username: user.username
    });
    const reports = createReportsService({ complaintsService: complaints });
    const csv = reports.buildCsv({ province: 'دمشق' });
    assert.equal(csv.count, 1);
    const summary = reports.buildSummaryReport({ province: 'دمشق' }, 'adminuser');
    assert.match(summary.reportNumber, /^RPT-/);
    assert.equal(summary.totals.all, 1);
    assert.equal(summary.generatedBy, 'adminuser');

    const dashboard = createDashboardService({ complaintsService: complaints });
    const dash = dashboard.buildSummary();
    assert.equal(dash.totals.all, 2);
    assert.ok(dash.byProvince['دمشق'] >= 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acceptance: session revoke helper isolates users', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-sess-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ user: { id: 'u1' } }));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ user: { id: 'u2' } }));
    assert.equal(revokeUserSessions(dir, 'u1').revoked, 1);
    assert.equal(fs.existsSync(path.join(dir, 'b.json')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
