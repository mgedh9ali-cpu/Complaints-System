'use strict';

const ROLES = Object.freeze(['admin', 'staff', 'reviewer']);

const ROLE_LABELS = Object.freeze({
  admin: 'مدير النظام',
  staff: 'موظف معالجة',
  reviewer: 'مراجع'
});

const PERMISSIONS = Object.freeze({
  'users.manage': ['admin'],
  'users.list': ['admin'],
  'complaints.create': ['admin', 'staff'],
  'complaints.update': ['admin', 'staff'],
  'complaints.delete': ['admin'],
  'complaints.status': ['admin', 'staff'],
  'complaints.read': ['admin', 'staff', 'reviewer'],
  'complaints.assign': ['admin', 'staff'],
  'complaints.reopen': ['admin'],
  'complaints.closeException': ['admin'],
  'replies.draft': ['admin', 'staff'],
  'replies.approve': ['admin'],
  'replies.send': ['admin', 'staff'],
  'approvals.request': ['admin', 'staff'],
  'approvals.decide': ['admin'],
  'attachments.upload': ['admin', 'staff'],
  // Permanent removal is restricted to the manager until a separate approval workflow exists.
  'attachments.delete': ['admin'],
  'attachments.read': ['admin', 'staff', 'reviewer'],
  'export.csv': ['admin', 'staff', 'reviewer'],
  'export.xlsx': ['admin', 'staff', 'reviewer'],
  'backup.database': ['admin'],
  'settings.manage': ['admin'],
  'settings.read': ['admin', 'staff', 'reviewer'],
  'dashboard.view': ['admin', 'staff', 'reviewer'],
  'audit.read': ['admin', 'reviewer'],
  'audit.verify': ['admin'],
  'sync.export': ['admin', 'staff'],
  'sync.import': ['admin']
});

// Administrative powers cannot be delegated by a permission override.
const CUSTOMIZABLE = Object.freeze([
  'complaints.create', 'complaints.update', 'complaints.status', 'complaints.read',
  'complaints.assign', 'complaints.reopen', 'complaints.closeException',
  'attachments.upload', 'attachments.read', 'export.csv', 'export.xlsx',
  'replies.draft', 'replies.approve', 'replies.send', 'approvals.request',
  'dashboard.view', 'audit.read', 'sync.export'
]);

function createRolesService({ db } = {}) {
  if (db) db.exec(`CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    overrides_json TEXT NOT NULL CHECK(json_valid(overrides_json))
  )`);
  function listRoles() {
    return ROLES.map((id) => ({
      id,
      label: ROLE_LABELS[id] || id,
      permissions: Object.keys(PERMISSIONS).filter((action) => PERMISSIONS[action].includes(id))
    }));
  }

  function getRole(roleId) {
    if (!ROLES.includes(roleId)) return null;
    return {
      id: roleId,
      label: ROLE_LABELS[roleId] || roleId,
      permissions: Object.keys(PERMISSIONS).filter((action) => PERMISSIONS[action].includes(roleId))
    };
  }

  function can(subject, action) {
    const role = typeof subject === 'string' ? subject : subject?.role;
    if (typeof role !== 'string' || typeof action !== 'string') return false;
    if (role !== 'admin' && subject?.id && db && CUSTOMIZABLE.includes(action)) {
      const row = db.prepare('SELECT overrides_json FROM user_permissions WHERE user_id=?').get(subject.id);
      const overrides = row ? JSON.parse(row.overrides_json) : {};
      if (typeof overrides[action] === 'boolean') return overrides[action];
    }
    const allowed = PERMISSIONS[action];
    return Array.isArray(allowed) && allowed.includes(role);
  }

  function requirePermission(action) {
    return (req, res, next) => {
      if (!req.user || !can(req.user, action)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
      }
      next();
    };
  }

  return {
    ROLES,
    ROLE_LABELS,
    PERMISSIONS,
    CUSTOMIZABLE,
    listRoles,
    getRole,
    can,
    effectivePermissions: (user) => Object.keys(PERMISSIONS).filter(action => can(user, action)),
    requirePermission
  };
}

module.exports = { createRolesService, ROLES, ROLE_LABELS, PERMISSIONS, CUSTOMIZABLE };
