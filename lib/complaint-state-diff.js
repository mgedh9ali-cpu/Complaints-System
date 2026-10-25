'use strict';

function diffComplaints(previousState, nextState) {
  const previous = Array.isArray(previousState?.complaints) ? previousState.complaints : [];
  const next = Array.isArray(nextState?.complaints) ? nextState.complaints : [];
  const previousById = new Map(previous.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
  const nextById = new Map(next.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
  const changes = [];

  for (const [id, complaint] of nextById) {
    const oldComplaint = previousById.get(id);
    if (!oldComplaint) {
      changes.push({
        action: 'complaint_created',
        id,
        details: { source: 'state_api', status: complaint.status ?? null }
      });
      continue;
    }

    if (oldComplaint.status !== complaint.status) {
      changes.push({
        action: 'complaint_status_changed',
        id,
        details: {
          source: 'state_api',
          from: oldComplaint.status ?? null,
          to: complaint.status ?? null
        }
      });
    }

    const ignored = new Set(['id', 'status', 'createdAt', 'updatedAt']);
    const fields = [...new Set([...Object.keys(oldComplaint), ...Object.keys(complaint)])]
      .filter(key => !ignored.has(key) && JSON.stringify(oldComplaint[key]) !== JSON.stringify(complaint[key]))
      .sort();
    if (fields.length) {
      changes.push({
        action: 'complaint_updated',
        id,
        details: { source: 'state_api', changedFields: fields }
      });
    }
  }

  for (const id of previousById.keys()) {
    if (!nextById.has(id)) {
      changes.push({
        action: 'complaint_removed',
        id,
        details: { source: 'state_api' }
      });
    }
  }
  return changes;
}

module.exports = { diffComplaints };
