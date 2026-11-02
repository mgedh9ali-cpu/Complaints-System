'use strict';

/**
 * Dashboard aggregates derived from application state.
 * Keeps heavy summary logic off the client.
 */

const CLOSED_STATUSES = new Set(['closed', 'cancelled']);
const APPROVAL_STATUS = 'awaiting_approval';

function createDashboardService({ complaintsService }) {
  function isLate(complaint, nowMs) {
    if (!complaint || (CLOSED_STATUSES.has(complaint.status)||complaint.status==='draft')) return false;
    if (!complaint.due) return false;
    const dueMs = Date.parse(complaint.due);
    return Number.isFinite(dueMs) && nowMs > dueMs;
  }

  function buildSummary(options = {}) {
    const { state } = complaintsService.readState();
    const complaints = Array.isArray(state.complaints) ? state.complaints.filter(c => !c.archivedAt) : [];
    const nowMs = Date.now();
    const recentLimit = Number.isInteger(options.recentLimit) && options.recentLimit > 0
      ? Math.min(options.recentLimit, 50)
      : 5;

    const byStatus = Object.create(null);
    const byPriority = Object.create(null);
    const byProvince = Object.create(null);

    let open = 0;
    let late = 0;
    let pendingApproval = 0;
    let urgentNoOwner = 0;
    let missingFields = 0;

    for (const c of complaints) {
      if (!c || typeof c !== 'object') continue;
      const status = c.status || 'unknown';
      const priority = c.priority || 'normal';
      const province = c.province || 'غير محدد';

      byStatus[status] = (byStatus[status] || 0) + 1;
      byPriority[priority] = (byPriority[priority] || 0) + 1;
      byProvince[province] = (byProvince[province] || 0) + 1;

      if (!CLOSED_STATUSES.has(status)) open += 1;
      if (state.settings.slaApproved === true && isLate(c, nowMs)) late += 1;
      if (status === APPROVAL_STATUS) pendingApproval += 1;
      if (priority === 'urgent' && !c.owner && !CLOSED_STATUSES.has(status)) urgentNoOwner += 1;
      if (!c.province || !c.summary || !c.owner) missingFields += 1;
    }

    const recent = [...complaints]
      .filter((c) => c && c.created)
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
      .slice(0, recentLimit)
      .map((c) => ({
        id: c.id,
        summary: c.summary || '',
        status: c.status,
        priority: c.priority || 'normal',
        owner: c.owner || null,
        created: c.created,
        province: c.province || null
      }));

    const lateItems = complaints
      .filter((c) => state.settings.slaApproved === true && isLate(c, nowMs))
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        summary: c.summary || '',
        status: c.status,
        due: c.due,
        owner: c.owner || null,
        priority: c.priority || 'normal'
      }));

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        all: complaints.length,
        open,
        late,
        pendingApproval,
        urgentNoOwner,
        missingFields
      },
      byStatus,
      byPriority,
      byProvince,
      recent,
      lateItems
    };
  }

  return { buildSummary };
}

module.exports = { createDashboardService };
