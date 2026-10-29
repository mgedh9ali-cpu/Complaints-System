'use strict';

const express = require('express');

function createRolesRouter({ rolesService, middleware }) {
  const router = express.Router();
  const { requireAuth } = middleware;

  router.get('/roles', requireAuth, (req, res) => {
    res.json({ roles: rolesService.listRoles() });
  });

  router.get('/roles/:roleId', requireAuth, (req, res) => {
    const role = rolesService.getRole(String(req.params.roleId || '').trim());
    if (!role) return res.status(404).json({ error: 'الدور غير موجود.' });
    res.json({ role });
  });

  router.get('/roles/:roleId/permissions', requireAuth, (req, res) => {
    const role = rolesService.getRole(String(req.params.roleId || '').trim());
    if (!role) return res.status(404).json({ error: 'الدور غير موجود.' });
    res.json({ roleId: role.id, permissions: role.permissions });
  });

  return router;
}

module.exports = { createRolesRouter };
