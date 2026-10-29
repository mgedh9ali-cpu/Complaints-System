'use strict';

/**
 * Central role + permission definitions.
 * Used by auth middleware and any module that needs capability checks.
 */

const ROLES = Object.freeze(['admin', 'staff', 'reviewer']);

const ROLE_LABELS = Object.freeze({
  admin: 'مدير النظام',
  staff: 'موظف معالجة',
  reviewer: 'مراجع'
});

/** Actions that endpoints / UI can check against a role. */
const PERMISSIONS = Object.freeze({
  'users.manage': ['admin'],
  'users.list': ['admin'],
  'complaints.create': ['admin', 'staff'],
  'complaints.update': ['admin', 'staff'],
  'complaints.status': ['admin', 'staff'],
  'complaints.read': ['admin', 'staff', 'reviewer'],
  'attachments.upload': ['admin', 'staff'],
  'attachments.delete': ['admin', 'staff'],
  'attachments.read': ['admin', 'staff', 'reviewer'],
  'export.csv': ['admin', 'staff', 'reviewer'],
  'export.xlsx': ['admin', 'staff', 'reviewer'],
  'backup.database': ['admin'],
  'settings.manage': ['admin'],
  'dashboard.view': ['admin', 'staff', 'reviewer'],
  'audit.read': ['admin']
});

function createRolesService() {
  function listRoles() {
    return ROLES.map((id) => ({
      id,
      label: ROLE_LABELS[id] || id,
      permissions: Object.keys(PERMISSIONS).filter((action) =>
        PERMISSIONS[action].includes(id)
      )
    }));
  }

  function getRole(roleId) {
    if (!ROLES.includes(roleId)) return null;
    return {
      id: roleId,
      label: ROLE_LABELS[roleId] || roleId,
      permissions: Object.keys(PERMISSIONS).filter((action) =>
        PERMISSIONS[action].includes(roleId)
      )
    };
  }

  function can(role, action) {
    if (typeof role !== 'string' || typeof action !== 'string') return false;
    const allowed = PERMISSIONS[action];
    return Array.isArray(allowed) && allowed.includes(role);
  }

  function requirePermission(action) {
    return (req, res, next) => {
      if (!req.user || !can(req.user.role, action)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذه العملية.' });
      }
      next();
    };
  }

  return {
    ROLES,
    ROLE_LABELS,
    PERMISSIONS,
    listRoles,
    getRole,
    can,
    requirePermission
  };
}

module.exports = { createRolesService, ROLES, ROLE_LABELS, PERMISSIONS };
