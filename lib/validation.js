'use strict';

function validComplaint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const required = ['summary', 'province', 'category'];
  if (!required.every(key => typeof value[key] === 'string' && value[key].trim())) return false;
  if (value.summary.trim().length > 180) return false;
  if (value.details !== undefined && (typeof value.details !== 'string' || value.details.length > 10000)) return false;
  if (value.phone !== undefined && (typeof value.phone !== 'string' || value.phone.length > 40)) return false;
  return true;
}

module.exports = { validComplaint };
