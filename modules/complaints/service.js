'use strict';

const crypto = require('node:crypto');
const { createRolesService } = require('../roles/service');
const { storageFor } = require('../../lib/storage-codec');
const { diffComplaints: defaultDiff } = require('../../lib/complaint-state-diff');
const { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } = require('../../lib/default-settings');
const {dayBoundary}=require('../../lib/work-time');

const ALLOWED_TRANSITIONS = Object.freeze({
  draft: ['new', 'cancelled'],
  new: ['in_progress', 'cancelled', 'draft'],
  in_progress: ['awaiting_reply', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_reply: ['in_progress', 'awaiting_approval', 'closed', 'cancelled'],
  awaiting_approval: ['in_progress', 'closed', 'cancelled'],
  closed: [],
  cancelled: []
});

const STATUS_LABELS = Object.freeze({
  draft: 'مسودة',
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  awaiting_reply: 'بانتظار رد الجهة',
  awaiting_approval: 'بانتظار الاعتماد',
  closed: 'مغلقة',
  cancelled: 'ملغاة'
});

const REASON_REQUIRED = Object.freeze(new Set(['closed', 'cancelled']));

const EDITABLE_FIELDS = [
  'name',
  'phone',
  'province',
  'entity',
  'category',
  'nature',
  'priority',
  'owner',
  'summary',
  'details',
  'confidentiality'
  , 'source'
];

function emptyState() {
  return {
    complaints: [],
    notifications: [],
    templates: structuredClone(DEFAULT_TEMPLATES),
    settings: structuredClone(DEFAULT_SETTINGS)
  };
}

module.exports = { createComplaintsService: function createComplaintsService() {
  throw new Error('Incomplete restore - full service body must be restored from commit 8ad4960. Contact support.');
}, ALLOWED_TRANSITIONS, REASON_REQUIRED };
