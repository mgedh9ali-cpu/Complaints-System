'use strict';

const ALLOWED_TRANSITIONS = Object.freeze({
  draft: ['new', 'cancelled'],
  new: ['in_progress', 'cancelled', 'draft'],
  in_progress: ['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_reply: ['in_progress', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_approval: ['in_progress', 'closed', 'cancelled'],
  closed: [],
  cancelled: []
});

const USERNAME_RE = /^[\p{L}\p{N}._-]{3,64}$/u;

function normalizeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (maxLen && trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

function isValidStatusTransition(fromStatus, toStatus) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, toStatus)) {
    return false;
  }
  const from = fromStatus || 'new';
  if (from === toStatus) return true;
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  return allowed.includes(toStatus);
}

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username.trim());
}

function isValidPassword(password, { min = 12, max = 200 } = {}) {
  return typeof password === 'string' && password.length >= min && password.length <= max;
}

function validComplaint(value, { allowedPriorities = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const forbidden = ['__proto__', 'constructor', 'prototype'];
  for (const k of Object.getOwnPropertyNames(value)) {
    if (forbidden.includes(k)) return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && forbidden.includes(key)) return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype) return false;

  const required = ['summary', 'province', 'category'];
  for (const key of required) {
    if (typeof value[key] !== 'string' || !value[key].trim()) return false;
  }
  if (value.summary.trim().length > 180 ||
      value.province.trim().length > 120 ||
      value.category.trim().length > 120) return false;
  if (value.owner !== undefined && value.owner !== null &&
      (typeof value.owner !== 'string' || value.owner.length > 120)) return false;
  if (value.details !== undefined) {
    if (typeof value.details !== 'string' || value.details.length > 10000) return false;
  }
  if (value.phone !== undefined) {
    if (typeof value.phone !== 'string' || value.phone.length > 40) return false;
    if (!/^[\d\s+\-().]{0,40}$/.test(value.phone)) return false;
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.length > 120) return false;
  }
  if (value.entity !== undefined) {
    if (typeof value.entity !== 'string' || value.entity.length > 120) return false;
  }
  if (value.source !== undefined && !['phone','whatsapp','telegram','other'].includes(value.source)) return false;
  if (value.priority !== undefined) {
    if (!['low', 'normal', 'high', 'urgent', ...allowedPriorities].includes(value.priority)) return false;
  }
  if (value.status !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, value.status)) {
      return false;
    }
  }
  if (value.confidentiality !== undefined) {
    if (!['normal', 'restricted', 'confidential'].includes(value.confidentiality)) {
      return false;
    }
  }
  return true;
}

function validStatePayload(state) {
  function safe(value, depth = 0) {
    if (depth > 25) return false;
    if (!value || typeof value !== 'object') return true;
    return Object.entries(value).every(([key, item]) => !['__proto__','constructor','prototype'].includes(key) && safe(item, depth + 1));
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || !safe(state) ||
      !Array.isArray(state.complaints) || state.complaints.length > 50000 ||
      !Array.isArray(state.notifications) || state.notifications.length > 20000 ||
      !Array.isArray(state.templates) || state.templates.length > 1000 ||
      !state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) return false;
  for (const key of ['provinces','entities','categories']) {
    if (state.settings[key] !== undefined && (!Array.isArray(state.settings[key]) ||
        state.settings[key].length > 500 || state.settings[key].some(v => typeof v !== 'string' || v.length > 200))) return false;
  }
  const priorities = state.settings.priorities;
  if (priorities !== undefined && (!Array.isArray(priorities) || priorities.length > 20 ||
      priorities.some(p => !p || typeof p.value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.value) || typeof p.label !== 'string' || p.label.length > 100))) return false;
  const ids = new Set();
  for (const c of state.complaints) {
    if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(c.id) || ids.has(c.id)) return false;
    ids.add(c.id);
    if (c.coAssistants !== undefined && (!Array.isArray(c.coAssistants) || c.coAssistants.length > 100 || c.coAssistants.some(u => typeof u !== 'string' || u.length > 120))) return false;
    for (const key of ['notes','timeline','referrals']) if (c[key] !== undefined && (!Array.isArray(c[key]) || c[key].length > 10000)) return false;
  }
  return state.notifications.every(n => n && (typeof n.id === 'number' && Number.isSafeInteger(n.id) ||
    typeof n.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(n.id)) && typeof n.title === 'string' && n.title.length <= 500 &&
    typeof n.body === 'string' && n.body.length <= 4000) &&
    state.templates.every(t => t && typeof t.name === 'string' && t.name.length <= 200 && typeof t.text === 'string' && t.text.length <= 10000);
}

function validComplaintDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = ['summary', 'province', 'category'];
  if (fields.some(key => value[key] !== undefined && typeof value[key] !== 'string')) {
    return false;
  }
  if (![value.summary, value.details, value.category].some(
    item => typeof item === 'string' && item.trim()
  )) return false;
  return validComplaint({
    ...value,
    summary: value.summary?.trim() || 'مسودة بانتظار الاستكمال',
    province: value.province?.trim() || 'غير محددة',
    category: value.category?.trim() || 'غير مصنفة',
    status: 'draft'
  });
}

module.exports = {
  validComplaint,
  validStatePayload,
  validComplaintDraft,
  normalizeString,
  isValidStatusTransition,
  isValidUsername,
  isValidPassword,
  ALLOWED_TRANSITIONS,
  USERNAME_RE
};
