'use strict';

/**
 * Strict validation for complaint objects.
 * Returns true only if the value is a safe, well-formed complaint.
 */
function validComplaint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  // Prevent prototype pollution.
  // Object.keys() only sees enumerable own keys, so a payload that replaced the
  // prototype (`{ __proto__: {...} }`) or hid the key in a non-enumerable
  // property would slip through. Check own property names and the prototype.
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const key of Object.getOwnPropertyNames(value)) {
    if (dangerous.includes(key)) return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && dangerous.includes(key)) return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return false;

  const required = ['summary', 'province', 'category'];
  for (const key of required) {
    if (typeof value[key] !== 'string' || !value[key].trim()) return false;
  }

  if (value.summary.trim().length > 180) return false;
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
  if (value.priority !== undefined) {
    if (!['normal', 'high', 'urgent'].includes(value.priority)) return false;
  }
  if (value.status !== undefined) {
    const allowed = ['new', 'in_progress', 'awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'];
    if (!allowed.includes(value.status)) return false;
  }
  if (value.confidentiality !== undefined) {
    if (!['normal', 'restricted', 'confidential'].includes(value.confidentiality)) return false;
  }

  return true;
}

module.exports = { validComplaint };
