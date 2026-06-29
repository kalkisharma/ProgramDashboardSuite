import { state } from '../state.js';
import { showToast, safeSetItem } from '../ui/toast.js';

let _draftTimer = null;
let _exportReminderTimer = null;

export function fullSnapshot() {
  return {
    tasks:   state.ProjectData.tasks.map(t => ({ ...t, start: t.start ? new Date(t.start) : null, end: t.end ? new Date(t.end) : null, baselineStart: t.baselineStart ? new Date(t.baselineStart) : null, baselineEnd: t.baselineEnd ? new Date(t.baselineEnd) : null, deps: [...t.deps] })),
    specs:   state.ProjectData.specs.map(s => ({ ...s, depIds: [...s.depIds] })),
    org:     state.ProjectData.org.map(p => ({ ...p, reportsTo: [...(p.reportsTo || [])] })),
    weights: state.ProjectData.weights.map(w => ({ ...w })),
    referenceFiles: (state.ProjectData.referenceFiles || []).map(rf => ({ ...rf })),
    info:    { ...state.ProjectData.info }
  };
}

export function updateUndoRedoBtns() {
  const u = document.getElementById('gantt-undo-btn');
  const r = document.getElementById('gantt-redo-btn');
  if (u) u.disabled = state.undoStack.length === 0;
  if (r) r.disabled = state.redoStack.length === 0;
}

export function scheduleDraftSave() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    if (!state.isDirty || !state.ProjectData.tasks.length) return;
    const draft = { snapshot: fullSnapshot(), title: state.ProjectData.info['Project Title'] || 'Untitled', savedAt: Date.now() };
    safeSetItem('vh-draft', JSON.stringify(draft));
  }, 3000);
}

export function scheduleExportReminder() {
  if (_exportReminderTimer) return;
  _exportReminderTimer = setTimeout(() => {
    _exportReminderTimer = null;
    if (state.isDirty) showToast('Heads up: you have unsaved changes. Export to Excel to make a permanent copy.', null, 10000);
  }, 15 * 60 * 1000);
}

export function clearDraft() {
  clearTimeout(_draftTimer);
  clearTimeout(_exportReminderTimer);
  _exportReminderTimer = null;
  state.isDirty = false;
  localStorage.removeItem('vh-draft');
}

// Push an already-captured snapshot (e.g. taken before a live drag began) onto the undo
// stack with the full safety machinery: clears redo, marks dirty, schedules autosave +
// export reminder, refreshes buttons.
export function pushUndoSnapshot(label, snapshot) {
  if (state.undoStack.length >= 50) state.undoStack.shift();
  state.undoStack.push({ label, snapshot });
  state.redoStack = [];
  state.isDirty = true;
  scheduleDraftSave();
  scheduleExportReminder();
  updateUndoRedoBtns();
}

export function pushUndo(label) {
  pushUndoSnapshot(label, fullSnapshot());
}
