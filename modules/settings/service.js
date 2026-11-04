'use strict';

const { DEFAULT_SETTINGS: LIB_DEFAULTS } = require('../../lib/default-settings');

const DEFAULT_SETTINGS = Object.freeze({
  slaDays: LIB_DEFAULTS.slaDays || 7,
  slaApproved: Boolean(LIB_DEFAULTS.slaApproved),
  completionReminderHours: LIB_DEFAULTS.completionReminderHours || 24,
  categoryDescriptions: LIB_DEFAULTS.categoryDescriptions || {},
  entityDescriptions: LIB_DEFAULTS.entityDescriptions || {},
  natureDescriptions: LIB_DEFAULTS.natureDescriptions || {},
  provinces: Array.isArray(LIB_DEFAULTS.provinces) ? LIB_DEFAULTS.provinces.slice() : [],
  entities: Array.isArray(LIB_DEFAULTS.entities) ? LIB_DEFAULTS.entities.slice() : [],
  categories: Array.isArray(LIB_DEFAULTS.categories) ? LIB_DEFAULTS.categories.slice() : [],
  natures: Array.isArray(LIB_DEFAULTS.natures) ? LIB_DEFAULTS.natures.slice() : [],
  priorities: Array.isArray(LIB_DEFAULTS.priorities)
    ? LIB_DEFAULTS.priorities.map((p) => ({ ...p }))
    : [
        { value: 'urgent', label: 'عاجلة' },
        { value: 'high', label: 'عالية' },
        { value: 'normal', label: 'عادية' },
        { value: 'low', label: 'منخفضة' }
      ]
});

const LIST_KEYS = ['provinces', 'entities', 'categories', 'natures', 'priorities'];

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pickList = (key) => {
    const fromSrc = Array.isArray(src[key]) ? src[key] : null;
    if (fromSrc && fromSrc.length > 0) {
      return key === 'priorities'
        ? fromSrc.slice(0, 20).map((p) => (typeof p === 'object' && p ? { ...p } : p))
        : fromSrc.slice(0, key === 'entities' ? 500 : 200);
    }
    const fromDefault = DEFAULT_SETTINGS[key];
    return Array.isArray(fromDefault)
      ? (key === 'priorities' ? fromDefault.map((p) => ({ ...p })) : fromDefault.slice())
      : [];
  };

  const out = {
    slaDays: Number.isFinite(Number(src.slaDays))
      ? Math.max(1, Math.min(365, Number(src.slaDays)))
      : DEFAULT_SETTINGS.slaDays,
    slaApproved: Boolean(src.slaApproved),
    completionReminderHours: Number.isFinite(Number(src.completionReminderHours))
      ? Math.max(1, Math.min(168, Number(src.completionReminderHours)))
      : DEFAULT_SETTINGS.completionReminderHours,
    categoryDescriptions:
      src.categoryDescriptions && typeof src.categoryDescriptions === 'object' && !Array.isArray(src.categoryDescriptions)
        ? { ...src.categoryDescriptions }
        : { ...DEFAULT_SETTINGS.categoryDescriptions },
    entityDescriptions:
      src.entityDescriptions && typeof src.entityDescriptions === 'object' && !Array.isArray(src.entityDescriptions)
        ? { ...src.entityDescriptions }
        : { ...DEFAULT_SETTINGS.entityDescriptions },
    natureDescriptions:
      src.natureDescriptions && typeof src.natureDescriptions === 'object' && !Array.isArray(src.natureDescriptions)
        ? { ...src.natureDescriptions }
        : { ...DEFAULT_SETTINGS.natureDescriptions },
    provinces: pickList('provinces'),
    entities: pickList('entities'),
    categories: pickList('categories'),
    natures: pickList('natures'),
    priorities: pickList('priorities')
  };
  return out;
}

function createSettingsService({ complaintsService }) {
  function getSettings() {
    const { state, revision, updatedAt } = complaintsService.readState();
    const settings = normalizeSettings(state.settings);
    return { settings, revision, updatedAt };
  }

  function updateSettings({ settings, userId, expectedRevision }) {
    const normalized = normalizeSettings(settings);
    const { state } = complaintsService.readState();
    const nextState = {
      ...state,
      settings: normalized,
      complaints: Array.isArray(state.complaints) ? state.complaints : [],
      notifications: Array.isArray(state.notifications) ? state.notifications : [],
      templates: Array.isArray(state.templates) ? state.templates : []
    };

    const result = complaintsService.saveState({
      state: nextState,
      userId,
      expectedRevision,
      diffComplaints: () => [],
      auditEvents: [{
        action: 'settings_updated',
        targetType: 'settings',
        id: null,
        details: {
          slaDays: normalized.slaDays,
          slaApproved: normalized.slaApproved,
          before: state.settings,
          after: normalized
        }
      }]
    });

    if (result.conflict) {
      return { ok: false, conflict: true, currentRevision: result.currentRevision };
    }
    if (result.invalidTransition) {
      return { ok: false, invalidTransition: true, error: result.error };
    }
    return {
      ok: true,
      settings: normalized,
      revision: result.revision,
      updatedAt: result.updatedAt
    };
  }

  return { getSettings, updateSettings, DEFAULT_SETTINGS, LIST_KEYS, normalizeSettings };
}

module.exports = { createSettingsService, DEFAULT_SETTINGS };
