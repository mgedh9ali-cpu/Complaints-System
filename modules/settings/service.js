'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  slaDays: 7,
  slaApproved: false,
  provinces: [],
  entities: [],
  categories: [],
  priorities: [
    { value: 'urgent', label: 'عاجلة' },
    { value: 'high', label: 'مرتفعة' },
    { value: 'normal', label: 'عادية' },
    { value: 'low', label: 'منخفضة' }
  ]
});

const LIST_KEYS = ['provinces', 'entities', 'categories', 'priorities'];

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {
    slaDays: Number.isFinite(Number(src.slaDays)) ? Math.max(1, Math.min(365, Number(src.slaDays))) : DEFAULT_SETTINGS.slaDays,
    slaApproved: Boolean(src.slaApproved),
    provinces: Array.isArray(src.provinces) ? src.provinces.slice(0, 200) : [],
    entities: Array.isArray(src.entities) ? src.entities.slice(0, 500) : [],
    categories: Array.isArray(src.categories) ? src.categories.slice(0, 200) : [],
    priorities: Array.isArray(src.priorities) && src.priorities.length
      ? src.priorities.slice(0, 20)
      : DEFAULT_SETTINGS.priorities.map((p) => ({ ...p }))
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
        details: { slaDays: normalized.slaDays, slaApproved: normalized.slaApproved,
          before: state.settings, after: normalized }
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
