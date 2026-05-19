import * as XLSX from "xlsx";
import "./styles.css";
import { ZOOM_STEPS, SPECS_ZOOM_STEPS, ORG_ZOOM_STEPS, RH, HH, PHASE_NAMES_FALLBACK } from './constants.js';
import { GANTT_COLORS, PHASE_COLORS, SPEC_COLORS, TEAM_COLORS, phaseColor, ganttColor, teamColor, clearColorCache } from './colors.js';
import { esc, parseDate, parseDeps, fmt, daysBetween, parseWorkDays, isWorkDay, addDays, snapToWorkDay, countWorkDays, workDaysRemaining, wdDisplay } from './utils.js';
import { computeCriticalPath } from './compute/criticalPath.js';
import { computeConflicts } from './compute/conflicts.js';
import { recalcWBS, wouldCreateCycle } from './compute/wbs.js';
import { parseInfoSheet, parseScheduleSheet, parseSpecsSheet, parseOrgSheet, parseWeightSheet, extractWorkDays } from './parse.js';
import { buildWorkbook, generateSampleExcel } from './excel.js';

// ─── Function Index ───────────────────────────────────────────────────────────
// L12   App State          — ProjectData, ganttWorkDays, undo/redo stacks, drag state
// L48   Work Day Utilities — workdaysSummary, toggleWorkdaysPicker
// L51   Theme              — toggleTheme, applyTheme
// L305  Tab Switching      — switchTab, renderDashboard, safeRender
// L316  File Loading       — drag-drop + file input wiring, parseWorkbook
// L452  Gantt Chart        — renderGantt, renderBodyGrid, renderGanttCalendar,
//                            initGanttPan, initGanttColumnResize, initGanttNameColResize,
//                            adjustZoom, toggleGanttLegend, toggleCriticalPath,
//                            toggleGanttCalendar, jumpToGanttDate, navigateCalendar
// L1774 Gantt Inline Edits — startTaskNameEdit, startTaskTeamEdit, startTaskPctEdit,
//                            startBarDrag, endBarDrag, openGanttDatePicker,
//                            togglePhaseCollapse, addGanttTask, resetGanttToImported,
//                            exportGanttSVG, exportGanttPNG
// L1873 Spec Panel Edits   — startSpecFieldEdit, saveSpecField, addSpecRow
// L2021 Side Panel Notes   — openNoteEdit, saveNoteEdit
// L2059 Dependency Editing — openDepEdit, saveDepEdit, dep add/remove helpers
// L2226 Row Reorder        — startRowDrag, doRowDragMove, endRowDrag
// L2314 Add/Delete         — addGanttTask (duplicate entry above; also deleteTask, deleteSpec)
// L2429 Save to Excel      — saveToExcel (thin wrapper around buildWorkbook from excel.js)
// L2439 Tooltip            — showTooltip, positionTooltip, hideTooltip, showWtTooltip
// L2489 Program Dashboard  — renderProgDash, toggleTeamRow, getPhaseNames
// L2674 Weight Budget      — renderWeightBudget, showWtTooltip, hideWtTooltip
// L2814 Weight Editing     — openWeightPanel, saveWeightRow, deleteWeightRow, addWeightRow
// L2906 Specs              — renderSpecs, renderSpecTable, setSpecsCatFilter, setSpecsSearch
// L3076 Side Panel – Spec  — openSpecPanel
// L3179 Side Panel – Task  — openTaskPanel
// L3309 Side Panel – Org   — openOrgPanel, openOrgEditPanel, saveOrgPerson, deleteOrgPerson
// L3376 Org Editing        — org CRUD helpers
// L3475 Project Info       — openInfoPanel, saveInfoPanel
// L3559 Org Chart          — renderOrgChart, buildTree, calcSubW, assignPos
// L3799 Init               — initPersistedState (restores zoom, filters, work days from localStorage)
// L3875 Event Handlers     — all static addEventListener wiring

// ─── App State ────────────────────────────────────────────────────────────────
const ProjectData = { info: {}, tasks: [], specs: [], org: [], weights: [] };
let originalTasks = [];          // deep-copy at parse time for reset
let ganttWorkDays = [1,2,3,4,5];  // Mon–Fri default; overridden by Project Info or Work Days UI
let spCurrentType = null; // 'spec' | 'task' | 'org' — tracks which item the side panel is showing
let spCurrentId   = null; // specId string, taskId number, or person name string
let spOpener      = null; // element that triggered the side panel open (focus restored on close)
const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
// NOTE: TODAY is computed once at page load; reload the page if using past midnight.

const APP_VERSION = 'v3.1.0'; // also update the HTML comment on line 1 of index.html
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('app-version-label').textContent = APP_VERSION;
});


// Gantt scroll-to-today guard: only auto-scroll once per file load
let ganttScrolledToday = false;

// Bar drag state
let barDrag = { active: false, pending: false, taskId: null, mode: null, startClientX: 0,
                origStart: null, origEnd: null, startScrollLeft: 0 };
let barEls      = {}; // taskId -> { bgRect, progRect, outlineRect, diamond, midY }
let depArrowEls = []; // { el, predId, succId } — rebuilt each renderGantt()

// Row reorder state
let rowDrag = { active: false, srcIdx: null, ghost: null, indicator: null, dropIdx: null };
let undoStack = [];            // max 50 entries, LIFO; each: { label, snapshot }
let redoStack = [];            // max 50 entries; populated by applyUndo(), cleared by pushUndo()
let conflictSet = new Set();   // task IDs with scheduling conflicts; recomputed on each render
let barDragPreSnapshot = null; // full snapshot captured at bar drag start

// Org chart drag-pan state (module-level so guarded listeners share one copy)
let orgPanListenersAttached = false;
let oDragging = false, oDragX = 0, oDragY = 0, oDragSL = 0, oDragST = 0;

// ─── Work Day Utilities ───────────────────────────────────────────────────────
// (imported from ./utils.js)

// ─── Theme ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  document.body.classList.add('theme-changing');
  setTimeout(() => document.body.classList.remove('theme-changing'), 300);
  const wasDim   = document.body.classList.contains('dim-mode');
  const wasLight = document.body.classList.contains('light-mode');
  document.body.classList.remove('dim-mode', 'light-mode');
  // Cycle: dark → dim → light → dark
  let theme = 'dark';
  if (!wasDim && !wasLight)   { document.body.classList.add('dim-mode');   theme = 'dim';   }
  else if (wasDim)            { document.body.classList.add('light-mode'); theme = 'light'; }
  safeSetItem('vh-theme', theme);
  const btn = document.getElementById('theme-toggle');
  btn.textContent = theme === 'dark' ? '🌙' : theme === 'dim' ? '🌓' : '☀';
  btn.title = 'Theme: ' + theme.charAt(0).toUpperCase() + theme.slice(1);
  btn.setAttribute('aria-label', 'Switch theme (currently ' + theme.charAt(0).toUpperCase() + theme.slice(1) + ')');
  if (ProjectData.tasks.length) renderGantt();
  if (ProjectData.org.length) renderOrgChart();
}

function showLoadError(msg) {
  const el = document.getElementById('load-error');
  el.textContent = msg;
  el.style.display = '';
}
function hideLoadError() {
  const el = document.getElementById('load-error');
  if (el) el.style.display = 'none';
}

let toastTimer = null;
let toastHasUndo = false;
function showToast(msg, undoFn, duration) {
  duration = duration || 5000;
  // Don't replace an active undo toast with a non-undoable one — append briefly instead
  if (toastHasUndo && !undoFn) {
    const msgEl = document.getElementById('app-toast-msg');
    const toast = document.getElementById('app-toast');
    const prev = msgEl.textContent;
    msgEl.textContent = prev + '  ·  ' + msg;
    setTimeout(() => { if (toast.classList.contains('visible')) msgEl.textContent = prev; }, 3000);
    return;
  }
  const toast   = document.getElementById('app-toast');
  const msgEl   = document.getElementById('app-toast-msg');
  const undoBtn = document.getElementById('app-toast-undo');
  clearTimeout(toastTimer);
  toastHasUndo = !!undoFn;
  msgEl.textContent = msg;
  undoBtn.style.display = undoFn ? '' : 'none';
  undoBtn.onclick = undoFn ? () => { undoFn(); toast.classList.remove('visible'); toastHasUndo = false; } : null;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => { toast.classList.remove('visible'); toastHasUndo = false; }, duration);
}

function safeSetItem(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22) {
      showToast('⚠ Browser storage is full — preferences not saved. Export your project to preserve data.', null, 8000);
    }
  }
}

function safeRender(fn, label) {
  try { fn(); } catch (e) {
    console.error('Render error [' + label + ']:', e);
    showToast('⚠ Error rendering ' + label + ' — try reloading the file', null, 6000);
  }
}

/** @returns {object} Deep copy of all five ProjectData collections for undo/redo. */
function fullSnapshot() {
  return {
    tasks:   ProjectData.tasks.map(t => ({ ...t, start: t.start ? new Date(t.start) : null, end: t.end ? new Date(t.end) : null, deps: [...t.deps] })),
    specs:   ProjectData.specs.map(s => ({ ...s, depIds: [...s.depIds] })),
    org:     ProjectData.org.map(p => ({ ...p, reportsTo: [...(p.reportsTo || [])] })),
    weights: ProjectData.weights.map(w => ({ ...w })),
    info:    { ...ProjectData.info }
  };
}
/** @param {string} label - Human-readable description shown in undo toast. Clears redo stack. */
function pushUndo(label) {
  if (undoStack.length >= 50) undoStack.shift();
  undoStack.push({ label, snapshot: fullSnapshot() });
  redoStack = [];
  isDirty = true;
  scheduleDraftSave();
  scheduleExportReminder();
  updateUndoRedoBtns();
}

function scheduleDraftSave() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    if (!isDirty || !ProjectData.tasks.length) return;
    const draft = { snapshot: fullSnapshot(), title: ProjectData.info['Project Title'] || 'Untitled', savedAt: Date.now() };
    safeSetItem('vh-draft', JSON.stringify(draft));
  }, 3000);
}

function clearDraft() {
  clearTimeout(_draftTimer);
  clearTimeout(_exportReminderTimer);
  _exportReminderTimer = null;
  isDirty = false;
  localStorage.removeItem('vh-draft');
}
function scheduleExportReminder() {
  if (_exportReminderTimer) return; // already scheduled; don't reset the clock on every edit
  _exportReminderTimer = setTimeout(() => {
    _exportReminderTimer = null;
    if (isDirty) showToast('Heads up: you have unsaved changes. Export to Excel to make a permanent copy.', null, 10000);
  }, 15 * 60 * 1000);
}
/** @param {object} snapshot - Result of fullSnapshot(); restores state and re-renders all tabs. */
function _restoreSnapshot(snapshot) {
  ProjectData.tasks   = snapshot.tasks;
  ProjectData.specs   = snapshot.specs;
  ProjectData.org     = snapshot.org     || ProjectData.org;
  ProjectData.weights = snapshot.weights || ProjectData.weights;
  if (snapshot.info) ProjectData.info = snapshot.info;
  recalcWBS(ProjectData.tasks);
  safeRender(renderGantt,    'Gantt Chart');
  safeRender(renderSpecs,    'Specifications');
  safeRender(renderProgDash, 'Program Dashboard');
  if (ProjectData.weights.length) safeRender(renderWeightBudget, 'Weight Budget');
  if (ProjectData.org.length)     safeRender(renderOrgChart,     'Org Chart');
  if (spCurrentType === 'task') { spCurrentType = null; openTaskPanel(spCurrentId); }
  else if (spCurrentType === 'spec') { spCurrentType = null; openSpecPanel(spCurrentId); }
  else if (spCurrentType === 'org') { const n = spCurrentId; spCurrentType = null; if (ProjectData.org.find(p => p.name === n)) openOrgPanel(n); else closeSidePanel(); }
  else if (spCurrentType === 'weight' || spCurrentType === 'info') closeSidePanel();
}
/** Pops the top undo entry, pushes current state to redoStack, and restores previous state. */
function applyUndo() {
  const entry = undoStack.pop();
  if (!entry) return;
  if (redoStack.length >= 50) redoStack.shift();
  redoStack.push({ label: entry.label, snapshot: fullSnapshot() });
  _restoreSnapshot(entry.snapshot);
  showToast('Undone: ' + entry.label, null, 3000);
  updateUndoRedoBtns();
}
/** Pops the top redo entry, pushes current state back to undoStack, and re-applies the state. */
function applyRedo() {
  const entry = redoStack.pop();
  if (!entry) return;
  if (undoStack.length >= 50) undoStack.shift();
  undoStack.push({ label: entry.label, snapshot: fullSnapshot() });
  _restoreSnapshot(entry.snapshot);
  showToast('Redone: ' + entry.label, null, 3000);
  updateUndoRedoBtns();
}
function updateUndoRedoBtns() {
  const u = document.getElementById('gantt-undo-btn');
  const r = document.getElementById('gantt-redo-btn');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

let _helpOpener = null;
let _helpFocusTrapActive = false;
function toggleHelp() {
  const overlay = document.getElementById('help-overlay');
  const modal   = document.getElementById('help-modal');
  const open = overlay.style.display === 'flex';
  if (open) {
    overlay.style.display = 'none';
    modal.removeEventListener('keydown', _trapHelpFocus);
    _helpFocusTrapActive = false;
    if (_helpOpener) { _helpOpener.focus(); _helpOpener = null; }
  } else {
    _helpOpener = document.activeElement;
    overlay.style.display = 'flex';
    const first = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
    if (!_helpFocusTrapActive) {
      modal.addEventListener('keydown', _trapHelpFocus);
      _helpFocusTrapActive = true;
    }
  }
}
function _trapHelpFocus(e) {
  if (e.key !== 'Tab') return;
  const modal = document.getElementById('help-modal');
  const focusable = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input, select, textarea')) {
    e.preventDefault();
    if (e.shiftKey) { applyRedo(); } else { applyUndo(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !e.target.matches('input, select, textarea')) {
    e.preventDefault(); applyRedo(); return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.matches('input, select, textarea')) {
    if (spCurrentType === 'task') {
      const btn = document.getElementById('sp-delete-task-btn');
      if (btn) { e.preventDefault(); btn.click(); }
    } else if (spCurrentType === 'spec') {
      const btn = document.getElementById('sp-delete-spec-btn');
      if (btn) { e.preventDefault(); btn.click(); }
    }
    return;
  }
  if (e.key === 'Escape') {
    if (document.getElementById('help-overlay').style.display === 'flex') { toggleHelp(); return; }
    const picker = document.getElementById('workdays-picker');
    const wdBtn  = document.getElementById('workdays-btn');
    if (picker && picker.style.display !== 'none') {
      picker.style.display = 'none';
      if (wdBtn) { wdBtn.setAttribute('aria-expanded', 'false'); wdBtn.focus(); }
    }
    const legend = document.getElementById('gantt-legend');
    const legendBtn = document.getElementById('legend-btn');
    if (legend && legend.style.display !== 'none') {
      showGanttLegend = false;
      legend.style.display = 'none';
      if (legendBtn) { legendBtn.setAttribute('aria-expanded', 'false'); legendBtn.focus(); }
    }
    if (spCurrentType && !e.target.matches('input, select, textarea')) { closeSidePanel(); return; }
  }
});
document.getElementById('help-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('help-overlay')) toggleHelp();
});
(function applyTheme() {
  const theme = localStorage.getItem('vh-theme') || 'dark';
  const btn = document.getElementById('theme-toggle');
  if (theme === 'dim')   { document.body.classList.add('dim-mode');   btn.textContent = '🌓'; btn.title = 'Theme: Dim';   btn.setAttribute('aria-label', 'Switch theme (currently Dim)'); }
  else if (theme === 'light') { document.body.classList.add('light-mode'); btn.textContent = '☀';  btn.title = 'Theme: Light'; btn.setAttribute('aria-label', 'Switch theme (currently Light)'); }
  else                        {                                             btn.textContent = '🌙'; btn.title = 'Theme: Dark';  btn.setAttribute('aria-label', 'Switch theme (currently Dark)'); }

  // Restore saved work days before any file load (Excel key overrides on import)
  const savedWd = localStorage.getItem('vh-workdays');
  if (savedWd) {
    try {
      const parsed = JSON.parse(savedWd);
      const valid  = Array.isArray(parsed) ? parsed.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];
      if (valid.length > 0) ganttWorkDays = valid;
    } catch(e) {}
  }
})();

// ─── Category Colors ──────────────────────────────────────────────────────────
// ─── Colors (imported from ./colors.js) ──────────────────────────────────────

// ─── Tab Switching ────────────────────────────────────────────────────────────
/** @param {HTMLElement} btn - The clicked tab button. @param {string} id - Tab key ('gantt'|'specs'|'prog'|'weight'|'org'). */
function switchTab(btn, id) {
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.getElementById(id + '-panel').classList.add('active');
  closeSidePanel();
}

// ─── Drag & Drop file loading ─────────────────────────────────────────────────
const dz = document.getElementById('dropzone');
const overlay = document.getElementById('dashboard-drop-overlay');
let dashboardLoaded = false;

document.addEventListener('dragover', e => {
  e.preventDefault();
  if (dashboardLoaded) overlay.classList.add('active');
  else dz.classList.add('drag-over');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) {
    dz.classList.remove('drag-over');
    overlay.classList.remove('active');
  }
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag-over');
  overlay.classList.remove('active');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files[0]) { loadFile(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('click', e => {
  const cal = document.getElementById('gantt-calendar');
  const btn = document.getElementById('cal-toggle-btn');
  if (cal && cal.classList.contains('open') && !cal.contains(e.target) && btn && !btn.contains(e.target) && !e.target.closest('#theme-toggle')) {
    cal.classList.remove('open');
  }
});

function loadFile(file) {
  hideLoadError();
  const r = new FileReader();
  r.onload = ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
      parseWorkbook(wb);
      const missing = [];
      if (!ProjectData.tasks.length)  missing.push("'Schedule' (columns: Task ID, WBS, Task Name, Category, Start Date, End Date, % Complete, Dependencies, Responsible Team, Milestone, Notes)");
      if (!ProjectData.specs.length)  missing.push("'Specifications' (columns: Spec ID, Category, Specification Name, Value, Units, Status, Responsible Group, Notes, Dependent Task IDs)");
      if (missing.length) {
        showLoadError('Required sheets missing:\n\n' + missing.join('\n\n') + '\n\nSheet names are case-sensitive. Check that the names match exactly.');
      }
      _justLoaded = true;
      renderDashboard();
      _justLoaded = false;
    } catch(e) { showLoadError('Could not parse file: ' + e.message); }
  };
  r.readAsArrayBuffer(file);
}

// ─── Parse Workbook ───────────────────────────────────────────────────────────
/** @param {object} wb - SheetJS workbook object. Resets all ProjectData collections and populates from sheets. */
function parseWorkbook(wb) {
  ProjectData.info = {}; ProjectData.tasks = []; ProjectData.specs = []; ProjectData.org = []; ProjectData.weights = [];
  undoStack = []; redoStack = [];
  clearColorCache();

  ProjectData.info    = parseInfoSheet(wb.Sheets['Project Info']);
  ProjectData.tasks   = parseScheduleSheet(wb.Sheets['Schedule']);
  ProjectData.specs   = parseSpecsSheet(wb.Sheets['Specifications']);
  ProjectData.org     = parseOrgSheet(wb.Sheets['Org Chart']);
  ProjectData.weights = parseWeightSheet(wb.Sheets['Weight Budget']);

  const wds = extractWorkDays(ProjectData.info);
  if (wds) {
    ganttWorkDays = wds;
    const wdBtn = document.getElementById('workdays-btn');
    if (wdBtn) wdBtn.textContent = workdaysSummary(wds) + ' ▾';
  }

  // Deep-copy tasks for reset
  originalTasks = ProjectData.tasks.map(t => ({ ...t, deps: [...t.deps] }));
  clearDraft();
}


// ─── Render Dashboard ─────────────────────────────────────────────────────────
/** Entry point after file load — updates topbar metadata and re-renders all visible tabs. */
function renderDashboard() {
  const title    = ProjectData.info['Project Title']      || 'Vehicle Design Dashboard';
  const subtitle = ProjectData.info['Project Subtitle']   || '';
  const admin    = ProjectData.info['File Administrator'] || '';
  const subParts = [subtitle, admin ? 'File Admin: ' + admin : ''].filter(Boolean);
  document.getElementById('project-title').textContent    = title;
  document.getElementById('project-subtitle').textContent = subParts.join(' · ') || 'Project Dashboard';
  document.title = title + ' — Program Dashboard';
  document.getElementById('dropzone').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  document.getElementById('tabs').style.display = 'flex';
  document.getElementById('org-tab-btn').style.display = ProjectData.org.length ? '' : 'none';
  document.getElementById('weight-tab-btn').style.display = ProjectData.weights.length ? '' : 'none';
  document.getElementById('generate-sample-btn').style.display = 'none';
  document.getElementById('save-excel-btn').style.display = '';
  document.getElementById('proj-info-btn').style.display = '';
  dashboardLoaded = true;
  ganttScrolledToday = false;
  ganttPhaseFilter = 'all';
  ganttTeamFilter  = 'all';
  specSearchQuery  = '';
  collapsedPhases.clear();
  ['vh-filter-phase','vh-filter-team','vh-filter-specs-cat','vh-filter-specs-search','vh-collapsed-phases']
    .forEach(k => localStorage.removeItem(k));
  const ssInput = document.getElementById('specs-search');
  if (ssInput) ssInput.value = '';
  const ssClearFile = document.getElementById('specs-search-clear');
  if (ssClearFile) ssClearFile.style.display = 'none';
  orgSearchQuery = '';
  const osInput2 = document.getElementById('org-search');
  if (osInput2) { osInput2.value = ''; const osClear2 = document.getElementById('org-search-clear'); if (osClear2) osClear2.style.display = 'none'; }
  safeRender(renderGantt,        'Gantt Chart');
  safeRender(renderSpecs,        'Specifications');
  safeRender(renderProgDash,     'Program Dashboard');
  safeRender(renderWeightBudget, 'Weight Budget');
  safeRender(renderOrgChart,     'Org Chart');
  updateUndoRedoBtns();
  if (_justLoaded && ProjectData.tasks.length) {
    const badDates   = ProjectData.tasks.filter(t => !t.milestone && (!t.start || !t.end));
    const dupTaskIds = (() => { const seen = new Set(), dups = new Set(); ProjectData.tasks.forEach(t => { if (seen.has(t.id)) dups.add(t.id); seen.add(t.id); }); return dups; })();
    const dupSpecIds = (() => { const seen = new Set(), dups = new Set(); ProjectData.specs.forEach(s => { if (seen.has(s.id)) dups.add(s.id); seen.add(s.id); }); return dups; })();
    const parts = [`${ProjectData.tasks.length} task${ProjectData.tasks.length !== 1 ? 's' : ''}`];
    if (ProjectData.specs.length)   parts.push(`${ProjectData.specs.length} spec${ProjectData.specs.length !== 1 ? 's' : ''}`);
    if (ProjectData.org.length)     parts.push(`${ProjectData.org.length} ${ProjectData.org.length === 1 ? 'person' : 'people'}`);
    if (ProjectData.weights.length) parts.push(`${ProjectData.weights.length} weight row${ProjectData.weights.length !== 1 ? 's' : ''}`);
    if (badDates.length)  parts.push(`⚠ ${badDates.length} task${badDates.length !== 1 ? 's' : ''} missing dates`);
    if (dupTaskIds.size)  parts.push(`⚠ ${dupTaskIds.size} duplicate task ID${dupTaskIds.size !== 1 ? 's' : ''}`);
    if (dupSpecIds.size)  parts.push(`⚠ ${dupSpecIds.size} duplicate spec ID${dupSpecIds.size !== 1 ? 's' : ''}`);
    const hasWarnings = badDates.length || dupTaskIds.size || dupSpecIds.size;
    showToast('Loaded: ' + parts.join(' · '), null, hasWarnings ? 10000 : 6000);
  }
}

// ─── GANTT ────────────────────────────────────────────────────────────────────
// ZOOM_STEPS, RH, HH imported from ./constants.js
let zoomIdx = 3;                                 // default: 4px/day = 100%
let ganttZoom = ZOOM_STEPS[zoomIdx];
let ganttMinDateRef = null;                      // set during renderGantt for adjustZoom scroll math
let ganttTodayX    = null;                       // px offset of Today line; null when Today is out of range
let ganttPhaseFilter  = 'all';
let ganttTeamFilter   = 'all';
let collapsedPhases   = new Set(); // phase numbers (ints) whose sub-tasks are hidden
let isDirty      = false;  // true when ProjectData has unsaved edits since last load/export
let _draftTimer  = null;   // debounce handle for auto-draft save
let _exportReminderTimer = null; // fires after 15 min of unsaved edits to nudge Export
let specSortState      = { col: null, dir: 'asc' };
let specSearchQuery    = '';
let showCriticalPath   = false;
let showGanttLegend    = false;
let _justLoaded        = false; // gates load toast: true only during file parse → renderDashboard()
let orgSearchQuery     = '';
let calDisplayMonth  = null; // { year, month } currently visible in the mini calendar
let ganttKeyFocusIdx = -1;   // keyboard-focused row index in the current visible task list (-1 = none)
function setGanttPhaseFilter(val) { ganttPhaseFilter = val; safeSetItem('vh-filter-phase', val); renderGantt(); }
function setGanttTeamFilter(val)  { ganttTeamFilter  = val; safeSetItem('vh-filter-team', val);  renderGantt(); }
function clearGanttFilters() {
  document.getElementById('gantt-phase-filter').value = 'all';
  document.getElementById('gantt-team-filter').value  = 'all';
  ganttPhaseFilter = 'all'; ganttTeamFilter = 'all';
  renderGantt();
}
function togglePhaseCollapse(phaseNum) {
  if (collapsedPhases.has(phaseNum)) collapsedPhases.delete(phaseNum); else collapsedPhases.add(phaseNum);
  safeSetItem('vh-collapsed-phases', JSON.stringify([...collapsedPhases]));
  renderGantt();
}

// Drag-pan state for gantt-right
let ganttDragging = false, ganttDragDidMove = false, ganttDragStartX, ganttDragScrollLeft;

function getBarZone(svgX, t) {
  const barX = daysBetween(ganttMinDateRef, t.start) * ganttZoom;
  const barW = Math.max(daysBetween(t.start, t.end) * ganttZoom, ganttZoom);
  if (t.milestone) {
    const mx = barX + barW, sz = 7;
    return (svgX >= mx - sz - 8 && svgX <= mx + sz + 8) ? 'milestone' : null;
  }
  if (svgX < barX - 4 || svgX > barX + barW + 4) return null;
  const EDGE = Math.min(10, Math.max(4, barW * 0.2));
  if (svgX <= barX + EDGE) return 'resize-left';
  if (svgX >= barX + barW - EDGE) return 'resize-right';
  return 'move';
}

function startBarDrag(e, taskId) {
  const right = document.getElementById('gantt-right');
  const t = ProjectData.tasks.find(t => t.id === taskId);
  if (!t || !t.start || !t.end) { startPanDrag(e); return; }
  const svgX = e.clientX - right.getBoundingClientRect().left + right.scrollLeft;
  const zone = getBarZone(svgX, t);
  if (!zone) { startPanDrag(e); return; }
  barDragPreSnapshot = fullSnapshot();
  barDrag.pending = true; barDrag.taskId = taskId; barDrag.mode = zone;
  barDrag.startClientX = e.clientX; barDrag.startScrollLeft = right.scrollLeft;
  barDrag.origStart = new Date(t.start); barDrag.origEnd = new Date(t.end);
  barDrag.downTime = Date.now();
  const isMoveZone = zone === 'move' || zone === 'milestone';
  barDrag.holdReady = !isMoveZone; // resize zones activate on movement; move requires a hold first
  if (isMoveZone) {
    barDrag.holdTimer = setTimeout(() => {
      barDrag.holdReady = true;
      document.getElementById('gantt-right').style.cursor = 'grabbing';
    }, 300);
  }
  hideTooltip(); e.preventDefault();
}

function startPanDrag(e) {
  const right = document.getElementById('gantt-right');
  ganttDragging = true; ganttDragDidMove = false;
  ganttDragStartX = e.pageX; ganttDragScrollLeft = right.scrollLeft;
  right.classList.add('dragging'); e.preventDefault();
}

function updateBarElementsDirect(taskId, newStart, newEnd) {
  const els = barEls[taskId];
  if (!els || !ganttMinDateRef) return;
  const x = daysBetween(ganttMinDateRef, newStart) * ganttZoom;
  const w = Math.max(daysBetween(newStart, newEnd) * ganttZoom, ganttZoom);
  const t = ProjectData.tasks.find(t => t.id === taskId);
  if (!t) return;
  if (t.milestone) {
    if (els.diamond) {
      const mx = x + w, sz = 7, my = els.midY;
      els.diamond.setAttribute('points', `${mx},${my-sz} ${mx+sz},${my} ${mx},${my+sz} ${mx-sz},${my}`);
    }
  } else {
    if (els.bgRect)      { els.bgRect.setAttribute('x', x); els.bgRect.setAttribute('width', w); }
    if (els.progRect)    { els.progRect.setAttribute('x', x); }
    if (els.outlineRect) { els.outlineRect.setAttribute('x', x); els.outlineRect.setAttribute('width', w); }
  }
}

function doBarDragMove(e) {
  if (barDrag.pending) {
    const isMoveZone = barDrag.mode === 'move' || barDrag.mode === 'milestone';
    const spatialOk  = Math.abs(e.clientX - barDrag.startClientX) > (isMoveZone ? 4 : 8);
    const temporalOk = isMoveZone ? barDrag.holdReady : (Date.now() - barDrag.downTime) > 80;
    if (spatialOk && temporalOk) {
      barDrag.pending = false; barDrag.active = true;
      const right = document.getElementById('gantt-right');
      right.style.cursor = isMoveZone ? 'grabbing' : 'ew-resize';
    }
  }
  if (!barDrag.active) return;
  const right = document.getElementById('gantt-right');
  const scrollDelta = right.scrollLeft - barDrag.startScrollLeft;
  const pixelDelta  = (e.clientX - barDrag.startClientX) + scrollDelta;
  const rawDays     = pixelDelta / ganttZoom;

  let newStart = new Date(barDrag.origStart);
  let newEnd   = new Date(barDrag.origEnd);

  if (barDrag.mode === 'move' || barDrag.mode === 'milestone') {
    const dur = daysBetween(barDrag.origStart, barDrag.origEnd);
    newStart = snapToWorkDay(addDays(barDrag.origStart, Math.round(rawDays)), ganttWorkDays, 1);
    newEnd   = addDays(newStart, dur);
    if (!isWorkDay(newEnd, ganttWorkDays)) newEnd = snapToWorkDay(newEnd, ganttWorkDays, 1);
  } else if (barDrag.mode === 'resize-left') {
    newStart = snapToWorkDay(addDays(barDrag.origStart, Math.round(rawDays)), ganttWorkDays, 1);
    // Enforce min 1 work-day gap
    if (daysBetween(newStart, newEnd) < 1) newStart = snapToWorkDay(addDays(newEnd, -1), ganttWorkDays, -1);
  } else if (barDrag.mode === 'resize-right') {
    newEnd = snapToWorkDay(addDays(barDrag.origEnd, Math.round(rawDays)), ganttWorkDays, 1);
    if (daysBetween(newStart, newEnd) < 1) newEnd = snapToWorkDay(addDays(newStart, 1), ganttWorkDays, 1);
  }

  const t = ProjectData.tasks.find(t => t.id === barDrag.taskId);
  if (t) { t.start = newStart; t.end = newEnd; }
  updateBarElementsDirect(barDrag.taskId, newStart, newEnd);

  const label = document.getElementById('gantt-drag-label');
  const total = countWorkDays(newStart, newEnd, ganttWorkDays);
  const rem   = workDaysRemaining(newEnd, ganttWorkDays, TODAY);
  label.textContent = `${fmt(newStart)} → ${fmt(newEnd)}  ·  ${total} wd total  ·  ${rem} wd left`;
  label.style.display = 'block';
  label.style.left = Math.min(e.clientX + 16, window.innerWidth - label.offsetWidth - 10) + 'px';
  label.style.top  = (e.clientY - 34) + 'px';
}

function endBarDrag() {
  if (!barDrag.active && !barDrag.pending) return;
  if (barDrag.holdTimer) { clearTimeout(barDrag.holdTimer); barDrag.holdTimer = null; }
  barDrag.holdReady = false;
  const wasActive = barDrag.active;
  barDrag.active = false; barDrag.pending = false;
  document.getElementById('gantt-drag-label').style.display = 'none';
  document.getElementById('gantt-right').style.cursor = '';
  if (wasActive) {
    const t = ProjectData.tasks.find(t => t.id === barDrag.taskId);
    if (t && t.end <= t.start) {
      t.start = barDrag.origStart;
      t.end   = barDrag.origEnd;
      barDragPreSnapshot = null;
      renderGantt();
      showToast('End date cannot be before start date', null, 3500);
    } else {
      if (barDragPreSnapshot) {
        undoStack.push({ label: 'date adjusted', snapshot: barDragPreSnapshot });
        if (undoStack.length > 50) undoStack.shift();
        redoStack = [];
        updateUndoRedoBtns();
      }
      barDragPreSnapshot = null;
      const _movedId = barDrag.taskId;
      renderGantt();
      if (conflictSet.has(_movedId)) {
        showToast('⚠ Conflict: task now starts before a predecessor ends', applyUndo, 12000);
      } else {
        showToast('Date adjusted', applyUndo, 12000);
      }
    }
  }
}

function initGanttPan() {
  const right = document.getElementById('gantt-right');
  right.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const tid = e.target.dataset && e.target.dataset.taskid ? +e.target.dataset.taskid : null;
    if (tid !== null) { startBarDrag(e, tid); return; }
    startPanDrag(e);
  });
  right.addEventListener('mousemove', e => {
    if (barDrag.active || ganttDragging) return;
    const tid = e.target.dataset && e.target.dataset.taskid ? +e.target.dataset.taskid : null;
    if (tid !== null && ganttMinDateRef) {
      const t = ProjectData.tasks.find(t => t.id === tid);
      if (t) {
        const svgX = e.clientX - right.getBoundingClientRect().left + right.scrollLeft;
        const zone = getBarZone(svgX, t);
        right.style.cursor = (zone === 'resize-left' || zone === 'resize-right') ? 'ew-resize' : (zone ? 'grab' : '');
        return;
      }
    }
    right.style.cursor = 'grab';
  });
  document.addEventListener('mousemove', e => {
    if (ganttDragging) {
      const dx = e.pageX - ganttDragStartX;
      if (Math.abs(dx) > 4) ganttDragDidMove = true;
      right.scrollLeft = ganttDragScrollLeft - dx;
    }
    if (barDrag.active || barDrag.pending) doBarDragMove(e);
    if (rowDrag.active) doRowDragMove(e);
  });
  document.addEventListener('mouseup', e => {
    if (ganttDragging) {
      ganttDragging = false;
      right.classList.remove('dragging');
      document.getElementById('gantt-header-wrap').classList.remove('dragging');
    }
    if (barDrag.active || barDrag.pending) endBarDrag();
    if (rowDrag.active) endRowDrag(e);
  });

  document.getElementById('gantt-header-wrap').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    document.getElementById('gantt-header-wrap').classList.add('dragging');
    startPanDrag(e);
  });
}
initGanttPan();

function openGanttDatePicker(t, clientX, clientY) {
  const picker = document.getElementById('gantt-date-picker');
  const fields = document.getElementById('gdp-fields');
  const label  = document.getElementById('gdp-label');

  label.textContent = t.milestone ? 'Milestone Date' : 'Task Dates';
  const toVal = d => d ? d.toISOString().slice(0, 10) : '';

  if (t.milestone) {
    fields.innerHTML = `<label class="sp-form-label" for="gdp-start">Date</label>
      <input class="sp-form-input" id="gdp-start" type="date" value="${toVal(t.start)}">`;
  } else {
    fields.innerHTML = `<label class="sp-form-label" for="gdp-start">Start</label>
      <input class="sp-form-input" id="gdp-start" type="date" value="${toVal(t.start)}">
      <label class="sp-form-label" for="gdp-end" style="margin-top:2px">End</label>
      <input class="sp-form-input" id="gdp-end" type="date" value="${toVal(t.end)}">`;
  }

  // Position near cursor, keep within viewport
  const pw = 210, ph = t.milestone ? 130 : 185;
  let left = clientX + 12, top = clientY - 20;
  if (left + pw > window.innerWidth  - 8) left = clientX - pw - 12;
  if (top  + ph > window.innerHeight - 8) top  = clientY - ph;
  picker.style.left = left + 'px'; picker.style.top = top + 'px';
  picker.style.display = 'block';

  const apply = () => {
    const startEl = document.getElementById('gdp-start');
    const endEl   = document.getElementById('gdp-end');
    const newStart = startEl ? new Date(startEl.value) : null;
    const newEnd   = endEl   ? new Date(endEl.value)   : newStart;
    if (!newStart || isNaN(newStart)) { picker.style.display = 'none'; return; }
    pushUndo('edit dates');
    t.start = snapToWorkDay(newStart, ganttWorkDays, 1);
    t.end   = t.milestone ? t.start : (newEnd && !isNaN(newEnd) && newEnd >= t.start ? snapToWorkDay(newEnd, ganttWorkDays, -1) : t.start);
    if (!t.milestone && t.end < t.start) t.end = t.start;
    picker.style.display = 'none';
    renderGantt();
  };

  document.getElementById('gdp-apply').onclick = apply;
  document.getElementById('gdp-close').onclick  = () => { picker.style.display = 'none'; };
  fields.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') picker.style.display = 'none'; }));
  fields.querySelector('#gdp-start')?.focus();
}

// Dismiss date picker on outside click
document.addEventListener('click', e => {
  const picker = document.getElementById('gantt-date-picker');
  if (picker && picker.style.display !== 'none' && !picker.contains(e.target)) picker.style.display = 'none';
}, true);

function initGanttColumnResize() {
  const handle = document.getElementById('gantt-resize-handle');
  const left   = document.getElementById('gantt-left');
  if (!handle || !left) return;

  const saved = localStorage.getItem('vh-gantt-left-width');
  if (saved) left.style.width = saved;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = left.getBoundingClientRect().width;
    handle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const newW = Math.max(150, Math.min(700, startW + e.clientX - startX));
      left.style.width = newW + 'px';
    }
    function onUp() {
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      safeSetItem('vh-gantt-left-width', left.style.width);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
initGanttColumnResize();

function initGanttNameColResize() {
  const handle = document.getElementById('gantt-name-col-handle');
  if (!handle) return;

  const saved = localStorage.getItem('vh-gantt-name-col-width');
  if (saved) document.documentElement.style.setProperty('--gantt-name-col-w', saved);

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    handle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const startX = e.clientX;
    const startW = handle.parentElement.getBoundingClientRect().width;
    let lastW = startW;

    function onMove(e) {
      lastW = Math.max(80, Math.min(400, startW + e.clientX - startX));
      document.documentElement.style.setProperty('--gantt-name-col-w', lastW + 'px');
    }
    function onUp() {
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      safeSetItem('vh-gantt-name-col-width', lastW + 'px');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
initGanttNameColResize();

// Clean up drag ghosts if user alt-tabs or the window loses focus mid-drag
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (rowDrag.active) endRowDrag();
    if (barDrag.active || barDrag.pending) endBarDrag();
  }
});
window.addEventListener('blur', () => {
  if (rowDrag.active) endRowDrag();
  if (barDrag.active || barDrag.pending) endBarDrag();
});

function updateGanttKeyFocus(delta) {
  const lb = document.getElementById('gantt-left-body');
  if (!lb) return;
  const rows = lb.querySelectorAll('.gantt-row');
  if (!rows.length) return;
  lb.querySelectorAll('.gantt-row.kb-focus').forEach(r => { r.classList.remove('kb-focus'); r.setAttribute('aria-selected', 'false'); });
  ganttKeyFocusIdx = Math.max(0, Math.min(rows.length - 1, ganttKeyFocusIdx + delta));
  rows[ganttKeyFocusIdx].classList.add('kb-focus');
  rows[ganttKeyFocusIdx].setAttribute('aria-selected', 'true');
  rows[ganttKeyFocusIdx].focus();
  rows[ganttKeyFocusIdx].scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('gantt-panel').classList.contains('active')) return;
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (ganttKeyFocusIdx < 0) ganttKeyFocusIdx = -1;
    updateGanttKeyFocus(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    updateGanttKeyFocus(-1);
  } else if (e.key === 'Enter' && ganttKeyFocusIdx >= 0) {
    const lb = document.getElementById('gantt-left-body');
    const rows = lb ? lb.querySelectorAll('.gantt-row') : [];
    if (rows[ganttKeyFocusIdx]) {
      const tid = +rows[ganttKeyFocusIdx].dataset.taskid;
      if (tid) openTaskPanel(tid);
    }
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault(); adjustZoom(1);
  } else if (e.key === '-') {
    e.preventDefault(); adjustZoom(-1);
  }
});

let _zoomSaveTimer = null;
function adjustZoom(dir) {
  const right = document.getElementById('gantt-right');
  const oldPx = ganttZoom;
  const oldScroll = right.scrollLeft;
  zoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomIdx + dir));
  ganttZoom = ZOOM_STEPS[zoomIdx];
  document.getElementById('zoom-label').textContent = Math.round((ganttZoom / 4) * 100) + '%';
  renderGantt();
  // Scale scroll position proportionally so the view stays anchored to the same date
  right.scrollLeft = Math.round(oldScroll * (ganttZoom / oldPx));
  clearTimeout(_zoomSaveTimer);
  _zoomSaveTimer = setTimeout(() => safeSetItem('vh-zoom-gantt', zoomIdx), 500);
}

document.getElementById('gantt-right').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  adjustZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

function toggleGanttCalendar() {
  const cal = document.getElementById('gantt-calendar');
  const btn = document.getElementById('cal-toggle-btn');
  if (!cal) return;
  const isOpen = cal.classList.toggle('open');
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) {
    const today = new Date();
    calDisplayMonth = { year: today.getFullYear(), month: today.getMonth() };
    renderGanttCalendar();
  }
}

const WD_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const WD_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function workdaysSummary(wds) {
  const days = [1,2,3,4,5,6,0].filter(d => wds.includes(d)); // Mon-first display order
  if (days.length === 0) return 'No work days';
  if (JSON.stringify([...wds].sort()) === JSON.stringify([1,2,3,4,5])) return 'Mon–Fri';
  if (JSON.stringify([...wds].sort()) === JSON.stringify([1,2,3,4])) return 'Mon–Thu';
  return days.map(d => WD_NAMES[d]).join(',');
}

let _wdRenderTimer = null;
function applyWorkDays(wds) {
  ganttWorkDays = wds;
  safeSetItem('vh-workdays', JSON.stringify(wds));
  const btn = document.getElementById('workdays-btn');
  if (btn) btn.textContent = workdaysSummary(wds) + ' ▾';
  clearTimeout(_wdRenderTimer);
  _wdRenderTimer = setTimeout(() => { if (ProjectData.tasks.length) renderGantt(); }, 300);
}

function toggleWorkdaysPicker() {
  const picker = document.getElementById('workdays-picker');
  const btn    = document.getElementById('workdays-btn');
  if (!picker) return;
  const isOpen = picker.style.display !== 'none';
  if (isOpen) {
    picker.style.display = 'none';
    if (btn) btn.setAttribute('aria-expanded', 'false');
    return;
  }
  // Build checkboxes
  const dayOrder = [1,2,3,4,5,6,0]; // Mon–Sun
  picker.innerHTML = `<fieldset style="border:none;padding:0;margin:0">
    <legend style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px;padding:0">Work Days</legend>` +
    dayOrder.map(d => `
      <label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;margin-bottom:6px">
        <input type="checkbox" data-dow="${d}" ${ganttWorkDays.includes(d) ? 'checked' : ''} style="accent-color:var(--accent)">
        ${WD_LABELS[d]}
      </label>`).join('') +
    `</fieldset>`;
  picker.style.display = 'block';
  if (btn) btn.setAttribute('aria-expanded', 'true');
  picker.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = Array.from(picker.querySelectorAll('input[type="checkbox"]:checked')).map(c => +c.dataset.dow);
      if (checked.length === 0) { cb.checked = true; return; } // require at least 1
      applyWorkDays(checked);
      if (btn) btn.textContent = workdaysSummary(ganttWorkDays) + ' ▾';
    });
  });
}

// Close work days picker when clicking outside
document.addEventListener('click', e => {
  const picker = document.getElementById('workdays-picker');
  const btn    = document.getElementById('workdays-btn');
  if (picker && picker.style.display !== 'none' && !picker.contains(e.target) && btn && !btn.contains(e.target)) {
    picker.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  }
  const legend    = document.getElementById('gantt-legend');
  const legendBtn = document.getElementById('legend-btn');
  if (legend && legend.style.display !== 'none' && !legend.contains(e.target) && legendBtn && !legendBtn.contains(e.target)) {
    showGanttLegend = false;
    legend.style.display = 'none';
    legendBtn.setAttribute('aria-expanded', 'false');
  }
});

function navigateCalendar(delta) {
  if (!calDisplayMonth) return;
  calDisplayMonth.month += delta;
  if (calDisplayMonth.month > 11) { calDisplayMonth.month = 0; calDisplayMonth.year++; }
  if (calDisplayMonth.month < 0)  { calDisplayMonth.month = 11; calDisplayMonth.year--; }
  renderGanttCalendar();
}

function renderGanttCalendar() {
  const cal = document.getElementById('gantt-calendar');
  if (!cal || !calDisplayMonth) return;
  const { year, month } = calDisplayMonth;

  const msMap = {};
  ProjectData.tasks.filter(t => t.milestone).forEach(t => {
    const d = t.end || t.start;
    if (!d) return;
    const key = d.toISOString().slice(0, 10);
    if (!msMap[key]) msMap[key] = [];
    msMap[key].push({ color: phaseColor(t.wbs), name: t.name });
  });

  const phStartMap = {};
  const phaseNames = getPhaseNames();
  ProjectData.tasks.filter(t => !t.wbs.includes('.') || t.wbs.endsWith('.0')).forEach(t => {
    if (!t.start) return;
    const key = t.start.toISOString().slice(0, 10);
    const phNum = parseInt(t.wbs);
    const phName = phaseNames[phNum] || PHASE_NAMES_FALLBACK[phNum - 1] || ('Phase ' + phNum);
    phStartMap[key] = { color: phaseColor(t.wbs.includes('.') ? t.wbs : t.wbs + '.0'), name: phName };
  });

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow    = new Date(year, month, 1).getDay();
  const today       = new Date();

  let html = `<div class="cal-nav">
    <button class="zoom-btn" data-nav="-1">&#8249;</button>
    <span>${MONTHS[month]} ${year}</span>
    <div style="display:flex;gap:4px">
      <button class="zoom-btn" data-nav="1">&#8250;</button>
      <button class="zoom-btn" data-close-cal title="Close calendar">&#215;</button>
    </div>
  </div><div class="cal-grid">`;

  DAYS.forEach((d, i) => {
    const off = !ganttWorkDays.includes(i);
    html += `<div class="cal-dh${off ? ' cal-dh-off' : ''}">${d}</div>`;
  });
  for (let i = 0; i < startDow; i++) html += `<div class="cal-d cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds      = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow     = new Date(year, month, d).getDay();
    const isOff   = !ganttWorkDays.includes(dow);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const entries = msMap[ds] || [];
    const phEntry = phStartMap[ds];

    const tipParts = [];
    if (phEntry) tipParts.push('Phase start: ' + phEntry.name);
    entries.forEach(m => tipParts.push('◆ ' + m.name));
    const tipAttr = tipParts.length ? ` data-cal-tip="${esc(tipParts.join('\n'))}"` : '';

    let markerHtml = '';
    if (entries.length === 1) {
      markerHtml = `<span class="cal-dot" style="background:${entries[0].color}"></span>`;
    } else if (entries.length > 1) {
      markerHtml = `<span class="cal-badge" style="background:${entries[0].color}">${entries.length}</span>`;
    }

    const phStyle = phEntry ? `border-top:2px solid ${phEntry.color};padding-top:1px;` : '';
    const cls     = 'cal-d' + (isToday ? ' cal-today' : '') + (isOff ? ' cal-off' : '');
    const inner   = `<div>${d}</div><div class="cal-marker">${markerHtml}</div>`;
    html += `<button type="button" class="${cls}" style="${phStyle}"${tipAttr} data-date="${ds}">${inner}</button>`;
  }

  const endDow = new Date(year, month, daysInMonth).getDay();
  for (let i = endDow + 1; i < 7; i++) html += `<div class="cal-d cal-empty"></div>`;
  html += `</div>`;

  const legendColor = phaseColor('1.0');
  html += `<div class="cal-legend">
    <span><span class="cal-dot" style="background:${legendColor};display:inline-block"></span>&nbsp;Milestone</span>
    <span style="border-top:2px solid ${legendColor};display:inline-block;padding:1px 4px 0">Phase start</span>
  </div>`;

  cal.innerHTML = html;
  cal.querySelectorAll('button[data-date]').forEach(btn => {
    btn.addEventListener('click', () => jumpToGanttDate(btn.dataset.date));
  });
  cal.querySelectorAll('button[data-nav]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); navigateCalendar(+btn.dataset.nav); });
  });
  cal.querySelector('button[data-close-cal]')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('gantt-calendar').classList.remove('open');
  });
}

function jumpToGanttDate(dateStr) {
  if (!ganttMinDateRef) return;
  const target = new Date(dateStr + 'T12:00:00');
  const msPerDay = 86400000;
  const dayOffset = (target - ganttMinDateRef) / msPerDay;
  const right = document.getElementById('gantt-right');
  if (!right) return;
  right.scrollLeft = Math.max(0, dayOffset * ganttZoom - right.clientWidth / 2);
}

// ── Specs zoom ────────────────────────────────────────────────────────────────
// SPECS_ZOOM_STEPS imported from ./constants.js
let specsZoomIdx = 2; // default 0.84rem = 100%
let _specsZoomSaveTimer = null;
function adjustSpecsZoom(dir) {
  specsZoomIdx = Math.max(0, Math.min(SPECS_ZOOM_STEPS.length - 1, specsZoomIdx + dir));
  const scale = SPECS_ZOOM_STEPS[specsZoomIdx];
  document.getElementById('specs-zoom-label').textContent = Math.round((scale / 0.84) * 100) + '%';
  const tbl = document.querySelector('.specs-table');
  if (tbl) tbl.style.fontSize = scale + 'rem';
  clearTimeout(_specsZoomSaveTimer);
  _specsZoomSaveTimer = setTimeout(() => safeSetItem('vh-zoom-specs', specsZoomIdx), 500);
}
document.getElementById('specs-body').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  adjustSpecsZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ── Org zoom ──────────────────────────────────────────────────────────────────
// ORG_ZOOM_STEPS imported from ./constants.js
let orgZoomIdx = 4; // default 1.0 = 100%
let _orgZoomSaveTimer = null;
function adjustOrgZoom(dir) {
  orgZoomIdx = Math.max(0, Math.min(ORG_ZOOM_STEPS.length - 1, orgZoomIdx + dir));
  const scale = ORG_ZOOM_STEPS[orgZoomIdx];
  document.getElementById('org-zoom-label').textContent = Math.round(scale * 100) + '%';
  const wrap = document.getElementById('org-svg-wrap');
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  svg.style.transformOrigin = 'top left';
  svg.style.transform = `scale(${scale})`;
  // Update wrapper dimensions so the container scrolls the full scaled area
  wrap.style.width  = Math.round(parseFloat(svg.getAttribute('width'))  * scale) + 'px';
  wrap.style.height = Math.round(parseFloat(svg.getAttribute('height')) * scale) + 'px';
  clearTimeout(_orgZoomSaveTimer);
  _orgZoomSaveTimer = setTimeout(() => safeSetItem('vh-zoom-org', orgZoomIdx), 500);
}
document.getElementById('org-container').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  adjustOrgZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// Scroll sync (set up once)
document.getElementById('gantt-right').addEventListener('scroll', () => {
  const right = document.getElementById('gantt-right');
  document.getElementById('gantt-left-body').scrollTop = right.scrollTop;
  const hw = document.getElementById('gantt-header-svg-wrap');
  if (hw) hw.style.transform = `translateX(-${right.scrollLeft}px)`;
  updateTodayFloat();
}, { passive: true });
document.getElementById('gantt-left-body').addEventListener('scroll', () => {
  document.getElementById('gantt-right').scrollTop = document.getElementById('gantt-left-body').scrollTop;
}, { passive: true });

function updateTodayFloat() {
  const floatEl = document.getElementById('gantt-today-float');
  const right   = document.getElementById('gantt-right');
  if (!floatEl || !right || ganttTodayX === null) { if (floatEl) floatEl.style.display = 'none'; return; }
  const visLeft  = right.scrollLeft;
  const visRight = right.scrollLeft + right.clientWidth;
  // Show float only when Today line is off the left edge (header label is visible when in view)
  if (ganttTodayX >= visLeft && ganttTodayX <= visRight) {
    floatEl.style.display = 'none';
    return;
  }
  floatEl.style.display = 'block';
  // Position horizontally: clamp to visible area edge
  const clampedX = Math.max(visLeft + 30, Math.min(ganttTodayX, visRight - 30));
  floatEl.style.left = (clampedX - visLeft) + 'px';
  // Position vertically: just below the header, above the body rows
  floatEl.style.top = '66px';
}

// computeCriticalPath, computeConflicts imported from ./compute/

function toggleCriticalPath() {
  showCriticalPath = !showCriticalPath;
  safeSetItem('vh-show-cp', showCriticalPath ? '1' : '');
  const btn = document.getElementById('gantt-cp-btn');
  if (btn) btn.setAttribute('aria-pressed', showCriticalPath ? 'true' : 'false');
  renderGantt();
}

function toggleGanttLegend() {
  showGanttLegend = !showGanttLegend;
  const btn = document.getElementById('legend-btn');
  const panel = document.getElementById('gantt-legend');
  if (!btn || !panel) return;
  btn.setAttribute('aria-expanded', showGanttLegend ? 'true' : 'false');
  panel.style.display = showGanttLegend ? 'block' : 'none';
  if (showGanttLegend) renderGanttLegend();
}

function renderGanttLegend() {
  const panel = document.getElementById('gantt-legend');
  if (!panel) return;
  const phaseNamesMap = getPhaseNames();
  const allPhases = [...new Set(ProjectData.tasks.map(t => parseInt(String(t.wbs).split('.')[0]) || 1))].sort((a,b) => a-b);
  const phaseRows = allPhases.map(ph => {
    const color = phaseColor(ph + '.0');
    const name  = phaseNamesMap[ph] || PHASE_NAMES_FALLBACK[ph - 1] || ('Phase ' + ph);
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.8rem">
      <div style="width:12px;height:12px;border-radius:2px;background:${color};flex-shrink:0"></div>
      <span>${ph}. ${esc(name)}</span>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div style="font-weight:700;font-size:0.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">Phases</div>
    ${phaseRows}
    <div style="border-top:1px solid var(--border);margin:8px 0"></div>
    <div style="font-weight:700;font-size:0.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">Symbols</div>
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.8rem"><span style="color:#d29922;font-size:0.9rem">◆</span><span>Milestone</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.8rem"><span style="color:var(--muted)">→</span><span>Dependency arrow</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.8rem"><span style="display:inline-block;width:14px;height:10px;border:1.5px dashed #f85149;border-radius:2px"></span><span>Overdue task</span></div>
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.8rem"><span style="display:inline-block;width:14px;height:10px;border:2px solid #e06c75;border-radius:2px"></span><span>Critical path</span></div>`;
}

function exportGanttSVG() {
  const hWrap = document.getElementById('gantt-header-svg-wrap');
  const bWrap = document.getElementById('gantt-svg-wrap');
  if (!hWrap || !bWrap) return;
  const hsvg = hWrap.querySelector('svg');
  const bsvg = bWrap.querySelector('svg');
  if (!hsvg || !bsvg) return;
  const W  = +hsvg.getAttribute('width');
  const hH = +hsvg.getAttribute('height');
  const bH = +bsvg.getAttribute('height');
  const NS = 'http://www.w3.org/2000/svg';
  const combined = document.createElementNS(NS, 'svg');
  combined.setAttribute('width', W);
  combined.setAttribute('height', hH + bH);
  combined.setAttribute('viewBox', `0 0 ${W} ${hH + bH}`);
  combined.setAttribute('xmlns', NS);
  // Clone defs first so marker references resolve
  const defs = bsvg.querySelector('defs');
  if (defs) combined.appendChild(defs.cloneNode(true));
  // Header children
  Array.from(hsvg.childNodes).forEach(n => combined.appendChild(n.cloneNode(true)));
  // Body children wrapped in translate group
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(0,${hH})`);
  Array.from(bsvg.childNodes).forEach(n => {
    if (n.tagName !== 'defs') g.appendChild(n.cloneNode(true));
  });
  combined.appendChild(g);
  const xml  = new XMLSerializer().serializeToString(combined);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${ProjectData.info['Project Title'] || 'Gantt'} - Gantt - ${new Date().toISOString().slice(0,10)}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportGanttPNG() {
  const hWrap = document.getElementById('gantt-header-svg-wrap');
  const bWrap = document.getElementById('gantt-svg-wrap');
  if (!hWrap || !bWrap) return;
  const hsvg = hWrap.querySelector('svg');
  const bsvg = bWrap.querySelector('svg');
  if (!hsvg || !bsvg) return;
  const W  = +hsvg.getAttribute('width');
  const hH = +hsvg.getAttribute('height');
  const bH = +bsvg.getAttribute('height');
  const NS = 'http://www.w3.org/2000/svg';
  const combined = document.createElementNS(NS, 'svg');
  combined.setAttribute('width', W); combined.setAttribute('height', hH + bH);
  combined.setAttribute('viewBox', `0 0 ${W} ${hH + bH}`);
  combined.setAttribute('xmlns', NS);
  const defs = bsvg.querySelector('defs');
  if (defs) combined.appendChild(defs.cloneNode(true));
  Array.from(hsvg.childNodes).forEach(n => combined.appendChild(n.cloneNode(true)));
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(0,${hH})`);
  Array.from(bsvg.childNodes).forEach(n => { if (n.tagName !== 'defs') g.appendChild(n.cloneNode(true)); });
  combined.appendChild(g);
  const svgXml  = new XMLSerializer().serializeToString(combined);
  const svgBlob = new Blob([svgXml], { type: 'image/svg+xml' });
  const svgUrl  = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = hH + bH;
    const ctx = canvas.getContext('2d');
    const isDim   = document.body.classList.contains('dim-mode');
    const isLight = document.body.classList.contains('light-mode');
    ctx.fillStyle = isLight ? '#edecea' : isDim ? '#22272e' : '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(pngBlob => {
      const url = URL.createObjectURL(pngBlob);
      const a   = document.createElement('a');
      a.href    = url;
      a.download = `${ProjectData.info['Project Title'] || 'Gantt'} - Gantt - ${new Date().toISOString().slice(0,10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(svgUrl);
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(svgUrl);
  img.src = svgUrl;
}

/** Full re-render of the Gantt chart (left task list + SVG bars + header). Called after every data mutation. */
function renderGantt() {
  const data = prepareGanttData();
  if (!data) return;
  renderGanttLeft(data);
  renderGanttSVG(data);
}

function prepareGanttData() {
  if (!ProjectData.tasks.length) {
    if (dashboardLoaded) {
      const lb = document.getElementById('gantt-left-body');
      if (lb) {
        lb.innerHTML = `<div role="status" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:10px;color:var(--muted);text-align:center">
          <div style="font-size:2rem">📋</div>
          <div style="font-weight:700;color:var(--text)">No tasks found</div>
          <div style="font-size:0.82rem">Check that your Excel file includes a <code style="background:var(--bg);padding:1px 5px;border-radius:3px">Schedule</code> sheet with at least one task row.</div>
          <button class="empty-help-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.82rem;text-decoration:underline;padding:0;margin-top:4px">Open help guide</button>
        </div>`;
        lb.querySelector('.empty-help-btn').addEventListener('click', toggleHelp);
      }
    }
    return null;
  }

  // ── Populate filter dropdowns ──────────────────────
  const phaseNamesMap = getPhaseNames();
  const allPhases = [...new Set(ProjectData.tasks.map(t => parseInt(String(t.wbs).split('.')[0]) || 1))].sort((a,b)=>a-b);
  const allTeams  = [...new Set(ProjectData.tasks.map(t => t.team || 'Unassigned'))].sort();

  const phaseSel  = document.getElementById('gantt-phase-filter');
  if (phaseSel) {
    phaseSel.innerHTML = '<option value="all">All</option>';
    allPhases.forEach(ph => {
      const label = phaseNamesMap[ph] || PHASE_NAMES_FALLBACK[ph-1] || 'Phase ' + ph;
      phaseSel.innerHTML += `<option value="${ph}">${ph}. ${esc(label)}</option>`;
    });
    if (!allPhases.map(String).includes(ganttPhaseFilter)) {
      ganttPhaseFilter = 'all';
      localStorage.removeItem('vh-filter-phase');
    }
    phaseSel.value = ganttPhaseFilter;
  }

  const teamSel   = document.getElementById('gantt-team-filter');
  if (teamSel) {
    teamSel.innerHTML = '<option value="all">All</option>';
    allTeams.forEach(tm => { teamSel.innerHTML += `<option value="${esc(tm)}">${esc(tm)}</option>`; });
    if (!allTeams.includes(ganttTeamFilter) && ganttTeamFilter !== 'all') {
      ganttTeamFilter = 'all';
      localStorage.removeItem('vh-filter-team');
    }
    teamSel.value = ganttTeamFilter;
  }

  // ── Build filtered task list ───────────────────────
  const visibleTasks = ProjectData.tasks.filter(t => {
    const phNum = parseInt(String(t.wbs).split('.')[0]) || 1;
    const ph    = String(phNum);
    if (ganttPhaseFilter !== 'all' && ph !== ganttPhaseFilter) return false;
    if (ganttTeamFilter  !== 'all' && (t.team || 'Unassigned') !== ganttTeamFilter) return false;
    if (ganttPhaseFilter === 'all' && collapsedPhases.has(phNum)) {
      const isPhaseHeader = !t.wbs.includes('.') || t.wbs.endsWith('.0');
      if (!isPhaseHeader) return false;
    }
    return true;
  });

  const lb = document.getElementById('gantt-left-body');
  if (!visibleTasks.length) {
    lb.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:0.82rem;text-align:center">No tasks match the current filters. <button class="gantt-clear-filter-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;text-decoration:underline;padding:0">Clear filters</button></div>';
    lb.querySelector('.gantt-clear-filter-btn').addEventListener('click', clearGanttFilters);
    document.getElementById('gantt-svg-wrap').innerHTML = '';
    document.getElementById('gantt-header-svg-wrap').innerHTML = '';
    return null;
  }

  // Use full task set for date axis so the time range stays stable when filtering
  const dates = ProjectData.tasks.flatMap(t => [t.start, t.end]).filter(Boolean);
  const minD = new Date(Math.min(...dates)); minD.setDate(minD.getDate() - 7);
  const maxD = new Date(Math.max(...dates)); maxD.setDate(maxD.getDate() + 21);
  ganttMinDateRef = minD;
  const totalDays = daysBetween(minD, maxD);
  const W = totalDays * ganttZoom;
  const bodyH = visibleTasks.length * RH;
  const cpSet = showCriticalPath ? computeCriticalPath(ProjectData.tasks) : new Set();
  conflictSet = computeConflicts(ProjectData.tasks);
  const exportBtn = document.getElementById('gantt-export-svg-btn');
  if (exportBtn) exportBtn.disabled = false;
  const exportPngBtn = document.getElementById('gantt-export-png-btn');
  if (exportPngBtn) exportPngBtn.disabled = false;

  const tx = daysBetween(minD, TODAY) * ganttZoom;
  ganttTodayX = (tx > 0 && tx < W) ? tx : null;

  const isFiltered = ganttPhaseFilter !== 'all' || ganttTeamFilter !== 'all';

  return { visibleTasks, isFiltered, minD, maxD, W, bodyH, cpSet, conflictSet, tx };
}

function renderGanttLeft({ visibleTasks, isFiltered, conflictSet }) {
  const lb = document.getElementById('gantt-left-body');
  lb.innerHTML = '';
  visibleTasks.forEach((t, i) => {
    const color = phaseColor(t.wbs);
    const pctColor = t.pct === 100 ? '#3fb950' : t.pct > 0 ? '#d29922' : '#484f58';
    const depth = (t.wbs.match(/\./g) || []).length;
    const wd = wdDisplay(t, ganttWorkDays, TODAY);
    const isPhaseHeader = !t.wbs.includes('.') || t.wbs.endsWith('.0');
    const phaseNum = parseInt(t.wbs.split('.')[0]) || 1;
    const isCollapsed = isPhaseHeader && collapsedPhases.has(phaseNum);
    const showHandle = !isFiltered && !isPhaseHeader;
    const showCollapseBtn = isPhaseHeader && ganttPhaseFilter === 'all';
    const div = document.createElement('div');
    div.className = 'gantt-row' + (isCollapsed ? ' phase-collapsed' : '');
    div.dataset.taskid = t.id;
    div.setAttribute('role', 'row');
    div.setAttribute('tabindex', '-1');
    div.setAttribute('aria-selected', 'false');
    const _rowStart = t.start ? t.start.toISOString().split('T')[0] : 'no date';
    const _rowEnd   = t.end   ? t.end.toISOString().split('T')[0]   : 'no date';
    div.setAttribute('aria-label', `${t.wbs}: ${t.name}, ${t.team} team, ${t.pct}% complete, ${_rowStart} to ${_rowEnd}${conflictSet.has(t.id) ? ', scheduling conflict' : ''}${isCollapsed ? ', collapsed' : ''}`);
    div.innerHTML = `
      <div class="g-wbs-wrap" style="color:${color}">
        ${showHandle ? '<span class="gantt-drag-handle" title="Drag to reorder">⠿</span>' : ''}
        ${showCollapseBtn ? `<button class="gantt-collapse-btn" aria-label="${isCollapsed ? 'Expand phase' : 'Collapse phase'}" title="${isCollapsed ? 'Expand phase' : 'Collapse phase'}">${isCollapsed ? '▶' : '▼'}</button>` : ''}
        <span class="g-wbs-text">${esc(t.wbs)}</span>
      </div>
      <span class="g-name" style="padding-left:${depth*10}px" title="${esc(t.name)}">${t.milestone ? '◆ ' : ''}${esc(t.name)}</span>
      <span class="g-team" title="${esc(t.team)}">${esc(t.team)}</span>
      <span class="g-wd ${wd.cls}">${wd.text}</span>
      <span class="g-pct" style="color:${pctColor}">${t.pct}%</span>
      <span class="g-conflict${conflictSet.has(t.id) ? ' active' : ''}" aria-label="Scheduling conflict" title="Scheduling conflict: starts before a predecessor ends">⚠</span>`;

    // WBS drag handle — whole cell is the hit target, ⠿ is visual only
    if (showHandle) {
      const wbsWrap = div.querySelector('.g-wbs-wrap');
      if (wbsWrap) {
        wbsWrap.classList.add('g-wbs-draggable');
        wbsWrap.addEventListener('mousedown', e => {
          e.stopPropagation();
          e.preventDefault();
          startRowDrag(e, i, t, div);
        });
      }
    }

    // Phase collapse toggle
    if (showCollapseBtn) {
      const colBtn = div.querySelector('.gantt-collapse-btn');
      if (colBtn) colBtn.addEventListener('click', e => { e.stopPropagation(); togglePhaseCollapse(phaseNum); });
    }

    // Task name inline edit
    const nameEl = div.querySelector('.g-name');
    nameEl.style.cursor = 'text';
    nameEl.setAttribute('tabindex', '0');
    nameEl.addEventListener('click',   e => { e.stopPropagation(); startTaskNameEdit(nameEl, t); });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); startTaskNameEdit(nameEl, t); } });

    // Team inline edit
    const teamEl = div.querySelector('.g-team');
    teamEl.style.cursor = 'pointer';
    teamEl.setAttribute('tabindex', '0');
    teamEl.addEventListener('click',   e => { e.stopPropagation(); startTaskTeamEdit(teamEl, t); });
    teamEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); startTaskTeamEdit(teamEl, t); } });

    // Pct inline edit
    const pctEl = div.querySelector('.g-pct');
    pctEl.style.cursor = 'text';
    pctEl.setAttribute('tabindex', '0');
    pctEl.addEventListener('click',   e => { e.stopPropagation(); startTaskPctEdit(pctEl, t); });
    pctEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); startTaskPctEdit(pctEl, t); } });

    div.addEventListener('click', () => openTaskPanel(t.id));
    div.addEventListener('mouseenter', e => { if (!barDrag.active && !rowDrag.active) showTooltip(t, e); });
    div.addEventListener('mouseleave', hideTooltip);
    lb.appendChild(div);
  });

  // Apply keyboard-focus highlight to the tracked row (if any)
  if (ganttKeyFocusIdx >= 0) {
    const rows = lb.querySelectorAll('.gantt-row');
    if (rows[ganttKeyFocusIdx]) rows[ganttKeyFocusIdx].classList.add('kb-focus');
  }
}

function renderGanttSVG({ visibleTasks, minD, maxD, W, bodyH, cpSet, tx }) {
  const NS = 'http://www.w3.org/2000/svg';
  const isLight = document.body.classList.contains('light-mode');
  const svgHeaderBg  = isLight ? '#e8eaed'                  : '#161b22';
  const svgRowStripe = isLight ? 'rgba(0,0,0,0.025)'        : 'rgba(255,255,255,0.015)';
  const arrowFill    = isLight ? 'rgba(99,108,118,0.5)'     : 'rgba(139,148,158,0.5)';
  const depStroke    = isLight ? 'rgba(99,108,118,0.35)'    : 'rgba(139,148,158,0.35)';
  const rowLineClr   = isLight ? 'rgba(208,215,222,0.6)'    : 'rgba(48,54,61,0.5)';

  // ── Header SVG (sticky) ────────────────────────────
  const hsvg = document.createElementNS(NS, 'svg');
  hsvg.setAttribute('width', W); hsvg.setAttribute('height', HH);
  hsvg.setAttribute('viewBox', `0 0 ${W} ${HH}`);
  hsvg.setAttribute('role', 'img');
  hsvg.setAttribute('aria-label', 'Gantt timeline header — month and week labels');
  hsvg.style.display = 'block';
  const hTitle = document.createElementNS(NS, 'title');
  hTitle.textContent = 'Gantt timeline header';
  hsvg.appendChild(hTitle);
  appendRect(hsvg, NS, 0, 0, W, HH, svgHeaderBg);
  renderHeader(hsvg, NS, minD, maxD, W);
  if (tx > 0 && tx < W) {
    appendLine(hsvg, NS, tx, tx, 0, HH, '#f85149', 1.5, '4,3');
    const htl = document.createElementNS(NS, 'text');
    htl.setAttribute('x', tx+4); htl.setAttribute('y', 13);
    htl.setAttribute('fill', '#f85149'); htl.setAttribute('font-size', '10');
    htl.setAttribute('font-weight', '700'); htl.textContent = 'Today';
    htl.style.pointerEvents = 'none';
    hsvg.appendChild(htl);
  }
  const headerWrap = document.getElementById('gantt-header-svg-wrap');
  headerWrap.innerHTML = '';
  headerWrap.appendChild(hsvg);
  headerWrap.style.transform = `translateX(-${document.getElementById('gantt-right').scrollLeft}px)`;

  // ── Body SVG ────────────────────────────────────────
  barEls      = {};
  depArrowEls = [];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', bodyH);
  svg.setAttribute('viewBox', `0 0 ${W} ${bodyH}`);
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', `Gantt chart — drag bars to adjust dates and duration. Today is ${TODAY.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`);
  svg.style.display = 'block';
  if (showCriticalPath) svg.classList.add('cp-active');

  // Arrowhead marker
  const defs = document.createElementNS(NS, 'defs');
  const mk = document.createElementNS(NS, 'marker');
  mk.setAttribute('id', 'arr'); mk.setAttribute('markerWidth', '7');
  mk.setAttribute('markerHeight', '7'); mk.setAttribute('refX', '7');
  mk.setAttribute('refY', '3.5'); mk.setAttribute('orient', 'auto');
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', '0 0, 7 3.5, 0 7');
  poly.setAttribute('fill', arrowFill);
  mk.appendChild(poly); defs.appendChild(mk); svg.appendChild(defs);

  visibleTasks.forEach((_, i) => {
    if (i % 2 === 0) appendRect(svg, NS, 0, i*RH, W, RH, svgRowStripe);
  });

  renderBodyGrid(svg, NS, minD, maxD, W, bodyH);

  for (let i = 0; i <= visibleTasks.length; i++) {
    appendLine(svg, NS, 0, W, i*RH, i*RH, rowLineClr, 1);
  }

  const barPos = {};

  visibleTasks.forEach((t, i) => {
    if (!t.start || !t.end) return;
    const x   = daysBetween(minD, t.start) * ganttZoom;
    const w   = Math.max(daysBetween(t.start, t.end) * ganttZoom, ganttZoom);
    const midY = i*RH + RH/2;
    const color = phaseColor(t.wbs);

    // Invisible hit area for the full row (carries task id for drag detection)
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', 0); hit.setAttribute('y', i*RH);
    hit.setAttribute('width', W); hit.setAttribute('height', RH);
    hit.setAttribute('fill', 'transparent');
    const _hitStart = t.start ? t.start.toISOString().split('T')[0] : '';
    const _hitEnd   = t.end   ? t.end.toISOString().split('T')[0]   : '';
    hit.setAttribute('role', 'img');
    hit.setAttribute('aria-label', `${t.milestone ? 'Milestone' : 'Task'} ${t.wbs}: ${t.name}, ${t.pct}% complete${_hitStart ? ', ' + _hitStart + ' to ' + _hitEnd : ''}`);
    hit.dataset.taskid = t.id;
    hit.addEventListener('mouseenter', e => {
      if (!barDrag.active && !rowDrag.active) {
        showTooltip(t, e);
        if (showCriticalPath) {
          Object.entries(barEls).forEach(([id, els]) => {
            const op = cpSet.has(t.id) ? (cpSet.has(+id) ? '1' : '0.2') : (+id === t.id ? '1' : '0.2');
            ['bgRect','progRect','outlineRect','diamond'].forEach(k => { if (els[k]) els[k].style.opacity = op; });
          });
          depArrowEls.forEach(({ el, predId, succId }) => {
            el.style.opacity = cpSet.has(t.id) ? ((cpSet.has(predId) && cpSet.has(succId)) ? '1' : '0.08') : '0.15';
          });
        }
      }
    });
    hit.addEventListener('mouseleave', () => {
      hideTooltip();
      if (showCriticalPath) {
        Object.entries(barEls).forEach(([id, els]) => {
          const base = cpSet.has(+id) ? '' : '0.35';
          ['bgRect','progRect','outlineRect','diamond'].forEach(k => { if (els[k]) els[k].style.opacity = base; });
        });
        depArrowEls.forEach(({ el }) => { el.style.opacity = ''; });
      }
    });
    hit.addEventListener('click', () => { if (!ganttDragDidMove && !barDrag.active) openTaskPanel(t.id); });
    hit.addEventListener('dblclick', e => { e.stopPropagation(); openGanttDatePicker(t, e.clientX, e.clientY); });
    svg.appendChild(hit);

    if (t.milestone) {
      const mx = x + w, sz = 7;
      const pts = `${mx},${midY-sz} ${mx+sz},${midY} ${mx},${midY+sz} ${mx-sz},${midY}`;
      const d = document.createElementNS(NS, 'polygon');
      d.setAttribute('points', pts); d.setAttribute('fill', color);
      d.style.pointerEvents = 'none';
      svg.appendChild(d);
      barPos[t.id] = { sx: mx - sz, ex: mx + sz, my: midY };
      barEls[t.id] = { diamond: d, midY };
      if (showCriticalPath && !cpSet.has(t.id)) d.style.opacity = '0.35';
    } else {
      const by = i*RH + RH*0.28, bh = RH*0.44;
      const bgRect = appendRect(svg, NS, x, by, w, bh, color + '30', 4);
      if (isLight) { bgRect.setAttribute('stroke', color); bgRect.setAttribute('stroke-width', '1.5'); }
      bgRect.style.pointerEvents = 'none';
      let progRect = null, outlineRect = null;
      if (t.pct > 0) {
        progRect = appendRect(svg, NS, x, by, w*(t.pct/100), bh, color, 4);
        progRect.style.pointerEvents = 'none';
      } else {
        outlineRect = document.createElementNS(NS, 'rect');
        outlineRect.setAttribute('x', x); outlineRect.setAttribute('y', by);
        outlineRect.setAttribute('width', w); outlineRect.setAttribute('height', bh);
        outlineRect.setAttribute('rx', 4); outlineRect.setAttribute('fill', 'none');
        outlineRect.setAttribute('stroke', color); outlineRect.setAttribute('stroke-width', 1.5);
        outlineRect.style.pointerEvents = 'none';
        svg.appendChild(outlineRect);
      }
      barPos[t.id] = { sx: x, ex: x + w, my: midY };
      barEls[t.id] = { bgRect, progRect, outlineRect, midY };
      if (showCriticalPath && !cpSet.has(t.id)) {
        [bgRect, progRect, outlineRect].forEach(el => { if (el) el.style.opacity = '0.35'; });
      }
      // Critical path ring overlay
      if (showCriticalPath && cpSet.has(t.id)) {
        const ring = document.createElementNS(NS, 'rect');
        ring.setAttribute('x', x - 1); ring.setAttribute('y', by - 1);
        ring.setAttribute('width', w + 2); ring.setAttribute('height', bh + 2);
        ring.setAttribute('rx', 5); ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#e06c75'); ring.setAttribute('stroke-width', 2);
        ring.style.pointerEvents = 'none';
        svg.appendChild(ring);
      }
      // Overdue ring (non-milestone, past end date, not complete)
      if (t.end && t.end < TODAY && (t.pct || 0) < 100) {
        const overRing = document.createElementNS(NS, 'rect');
        overRing.setAttribute('x', x - 1); overRing.setAttribute('y', by - 1);
        overRing.setAttribute('width', w + 2); overRing.setAttribute('height', bh + 2);
        overRing.setAttribute('rx', 5); overRing.setAttribute('fill', 'none');
        overRing.setAttribute('stroke', '#f85149');
        overRing.setAttribute('stroke-width', 1.5);
        overRing.setAttribute('stroke-dasharray', '3 2');
        overRing.style.pointerEvents = 'none';
        svg.appendChild(overRing);
      }
    }
  });

  // Dependency arrows (only between tasks both visible in current filter)
  visibleTasks.forEach(t => {
    t.deps.forEach(did => {
      const pred = barPos[did], succ = barPos[t.id];
      if (!pred || !succ) return;
      const x1 = pred.ex, y1 = pred.my, x2 = succ.sx, y2 = succ.my;
      const ox = Math.max(x1 + 8, x2 - 8);
      const pathD = `M ${x1} ${y1} L ${ox} ${y1} L ${ox} ${y2} L ${x2} ${y2}`;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', pathD); p.setAttribute('fill', 'none');
      p.setAttribute('data-pred-id', did);
      p.setAttribute('data-succ-id', t.id);
      const isCritical = showCriticalPath && cpSet.has(did) && cpSet.has(t.id);
      if (isCritical) {
        p.setAttribute('stroke', '#e06c75'); p.setAttribute('stroke-width', 2.5);
      } else {
        p.setAttribute('stroke', depStroke); p.setAttribute('stroke-width', 1.5);
        if (showCriticalPath) p.setAttribute('stroke-dasharray', '5 3');
      }
      p.setAttribute('marker-end', 'url(#arr)');
      p.setAttribute('tabindex', '0');
      p.setAttribute('role', 'button');
      const predTask = ProjectData.tasks.find(tk => tk.id === did);
      p.setAttribute('aria-label', `Open ${t.name} — depends on ${predTask ? predTask.name : did}`);
      p.style.cursor = 'pointer';
      p.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTaskPanel(t.id); }
      });
      const predTaskName = predTask ? predTask.name : 'Task ' + did;
      p.addEventListener('mouseenter', e => {
        tooltip.innerHTML = `<div style="font-weight:700;margin-bottom:4px;font-size:0.8rem">Dependency</div>
          <div style="display:flex;align-items:center;gap:8px;font-size:0.82rem">
            <span style="color:var(--muted)">${esc(predTaskName)}</span>
            <span style="color:var(--accent)">→</span>
            <span>${esc(t.name)}</span>
          </div>`;
        tooltip.style.display = 'block'; positionTooltip(e);
      });
      p.addEventListener('mousemove', positionTooltip);
      p.addEventListener('mouseleave', hideTooltip);
      depArrowEls.push({ el: p, predId: did, succId: t.id });
      svg.appendChild(p);
    });
  });

  // Today line in body (label is in header SVG above)
  if (tx > 0 && tx < W) {
    appendLine(svg, NS, tx, tx, 0, bodyH, '#f85149', 1.5, '4,3');
  }

  document.getElementById('gantt-svg-wrap').innerHTML = '';
  document.getElementById('gantt-svg-wrap').appendChild(svg);

  // Delegated click on arrows → open dependent task panel
  svg.addEventListener('click', e => {
    const p = e.target.closest('path[data-succ-id]');
    if (!p) return;
    openTaskPanel(+p.getAttribute('data-succ-id'));
  });

  const right = document.getElementById('gantt-right');
  if (!ganttScrolledToday && tx > right.clientWidth / 2) {
    right.scrollLeft = tx - right.clientWidth / 2;
    ganttScrolledToday = true;
  }
  updateTodayFloat();
}

function renderHeader(svg, NS, minD, maxD, W) {
  const isLight = document.body.classList.contains('light-mode');
  const headerBorder  = isLight ? '#d0d7de'         : '#30363d';
  const monthGridLine = isLight ? 'rgba(0,0,0,0.15)': 'rgba(48,54,61,0.6)';
  const weekGridLine  = isLight ? 'rgba(0,0,0,0.08)': 'rgba(48,54,61,0.4)';
  const monthFill     = isLight ? '#636c76'          : '#8b949e';
  const weekFill      = isLight ? '#8c959f'          : '#484f58';

  appendLine(svg, NS, 0, W, HH, HH, headerBorder, 1);
  const cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (cur <= maxD) {
    const x = daysBetween(minD, cur) * ganttZoom;
    appendLine(svg, NS, x, x, 0, HH + 9999, monthGridLine, 1);
    const ml = document.createElementNS(NS, 'text');
    ml.setAttribute('x', x+5); ml.setAttribute('y', 30);
    ml.setAttribute('fill', monthFill); ml.setAttribute('font-size', '11');
    ml.setAttribute('font-weight', '700');
    ml.textContent = cur.toLocaleString('default', { month: 'short' }) + ' ' + cur.getFullYear();
    svg.appendChild(ml);
    const nxt = new Date(cur); nxt.setMonth(nxt.getMonth()+1);
    const wk = new Date(cur); wk.setDate(wk.getDate() + (7 - wk.getDay()));
    while (wk < nxt && wk <= maxD) {
      const wx = daysBetween(minD, wk) * ganttZoom;
      appendLine(svg, NS, wx, wx, 42, HH, weekGridLine, 1);
      const dl = document.createElementNS(NS, 'text');
      dl.setAttribute('x', wx+2); dl.setAttribute('y', 54);
      dl.setAttribute('fill', weekFill); dl.setAttribute('font-size', '9');
      dl.textContent = wk.getDate();
      svg.appendChild(dl);
      wk.setDate(wk.getDate()+7);
    }
    cur.setMonth(cur.getMonth()+1);
  }
}

function renderBodyGrid(svg, NS, minD, maxD, W, bodyH) {
  const isLight = document.body.classList.contains('light-mode');
  const monthLine = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(48,54,61,0.5)';
  const weekLine  = isLight ? 'rgba(0,0,0,0.05)'  : 'rgba(48,54,61,0.22)';
  const cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (cur <= maxD) {
    const x = daysBetween(minD, cur) * ganttZoom;
    appendLine(svg, NS, x, x, 0, bodyH, monthLine, 1);
    if (ganttZoom >= 5) {
      const nxt = new Date(cur); nxt.setMonth(nxt.getMonth()+1);
      const wk = new Date(cur); wk.setDate(wk.getDate() + (7 - wk.getDay()));
      while (wk < nxt && wk <= maxD) {
        const wx = daysBetween(minD, wk) * ganttZoom;
        appendLine(svg, NS, wx, wx, 0, bodyH, weekLine, 1);
        wk.setDate(wk.getDate()+7);
      }
    }
    cur.setMonth(cur.getMonth()+1);
  }
}

function appendRect(svg, NS, x, y, w, h, fill, rx=0) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x',x); r.setAttribute('y',y);
  r.setAttribute('width',w); r.setAttribute('height',h);
  r.setAttribute('fill',fill); if (rx) r.setAttribute('rx',rx);
  svg.appendChild(r); return r;
}
function appendLine(svg, NS, x1, x2, y1, y2, stroke, sw, dash='') {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1',x1); l.setAttribute('x2',x2);
  l.setAttribute('y1',y1); l.setAttribute('y2',y2);
  l.setAttribute('stroke',stroke); l.setAttribute('stroke-width',sw);
  if (dash) l.setAttribute('stroke-dasharray',dash);
  svg.appendChild(l); return l;
}

// ─── GANTT INLINE EDITS ──────────────────────────────────────────────────────
function startTaskNameEdit(span, t) {
  if (span.querySelector('input')) return;
  const orig = t.name;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input';
  input.value = orig;
  span.textContent = '';
  span.appendChild(input);
  input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (!v) {
      t.name = orig;
      renderGantt();
      showToast('Task name cannot be empty', null, 3500);
    } else if (v !== orig) {
      pushUndo('name change');
      t.name = v;
      renderGantt();
      showToast('Name changed', applyUndo, 5000);
    } else {
      renderGantt();
    }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { t.name = orig; renderGantt(); }
  });
  input.addEventListener('blur', commit);
}

function startTaskTeamEdit(span, t) {
  if (span.querySelector('select')) return;
  const orig = t.team;
  const teams = [...new Set(ProjectData.tasks.map(x => x.team).filter(Boolean))].sort();
  const sel = document.createElement('select');
  sel.className = 'gantt-cell-select';
  teams.forEach(tm => {
    const o = document.createElement('option');
    o.value = tm; o.textContent = tm;
    if (tm === t.team) o.selected = true;
    sel.appendChild(o);
  });
  span.textContent = '';
  span.appendChild(sel);
  sel.focus();
  const commit = (save) => {
    if (save && sel.value !== orig) {
      pushUndo('team change');
      t.team = sel.value;
      renderGantt();
      showToast('Team changed', applyUndo, 5000);
    } else {
      t.team = orig;
      renderGantt();
    }
  };
  sel.addEventListener('change', () => commit(true));
  sel.addEventListener('keydown', e => { if (e.key === 'Escape') commit(false); });
  sel.addEventListener('blur', () => { if (t.team === orig) commit(false); });
}

function startTaskPctEdit(span, t) {
  if (span.querySelector('input')) return;
  const orig = t.pct;
  const input = document.createElement('input');
  input.type = 'number'; input.min = 0; input.max = 100;
  input.className = 'gantt-cell-input g-pct-edit';
  input.value = t.pct;
  span.textContent = '';
  span.appendChild(input);
  input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v === '') { t.pct = orig; renderGantt(); return; }
    const raw = +v;
    const clamped = Math.min(100, Math.max(0, Math.round(raw)));
    if (raw < 0 || raw > 100) {
      t.pct = clamped;
      renderGantt();
      showToast('Percentage must be between 0 and 100', null, 3500);
    } else if (clamped !== orig) {
      pushUndo('progress change');
      t.pct = clamped;
      renderGantt();
      showToast('Progress updated', applyUndo, 5000);
    } else {
      t.pct = orig;
      renderGantt();
    }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { t.pct = orig; renderGantt(); }
  });
  input.addEventListener('blur', commit);
}

// ─── SPEC PANEL INLINE EDITS ─────────────────────────────────────────────────
function _refreshSpecPanel(s) {
  renderSpecTable();
  spCurrentType = null;
  openSpecPanel(s.id);
}

function startSpecNameEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.name;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (!v) { s.name = orig; _refreshSpecPanel(s); showToast('Spec name cannot be empty', null, 3500); }
    else if (v !== orig) { pushUndo('spec name change'); s.name = v; _refreshSpecPanel(s); showToast('Spec name changed', applyUndo, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.name = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

function startSpecCategoryEdit(el, s) {
  if (el.querySelector('select')) return;
  const orig = s.category;
  const cats = Object.keys(SPEC_COLORS);
  const sel = document.createElement('select');
  sel.className = 'gantt-cell-select';
  cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === s.category) o.selected = true; sel.appendChild(o); });
  el.textContent = ''; el.appendChild(sel); sel.focus();
  const commit = (save) => {
    if (save && sel.value !== orig) { pushUndo('spec category change'); s.category = sel.value; _refreshSpecPanel(s); showToast('Category changed', applyUndo, 5000); }
    else { s.category = orig; _refreshSpecPanel(s); }
  };
  sel.addEventListener('change', () => commit(true));
  sel.addEventListener('keydown', e => { if (e.key === 'Escape') commit(false); });
  sel.addEventListener('blur', () => { if (s.category === orig) commit(false); });
}

function startSpecValueEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.value;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== String(orig)) { pushUndo('spec value change'); s.value = v; _refreshSpecPanel(s); showToast('Value changed', applyUndo, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.value = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

function startSpecUnitsEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.units;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('spec units change'); s.units = v; _refreshSpecPanel(s); showToast('Units changed', applyUndo, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.units = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

function startSpecGroupEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.group;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('spec group change'); s.group = v; _refreshSpecPanel(s); showToast('Group changed', applyUndo, 5000); }
    else { _refreshSpecPanel(s); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.group = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

function startSpecIdEdit(el, s) {
  if (el.querySelector('input')) return;
  const orig = s.id;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (!v) {
      s.id = orig; _refreshSpecPanel(s); showToast('Spec ID cannot be empty', null, 3500);
    } else if (v !== orig && ProjectData.specs.some(x => x.id === v)) {
      s.id = orig; _refreshSpecPanel(s); showToast('Spec ID already in use', null, 3500);
    } else if (v !== orig) {
      pushUndo('spec ID change');
      s.id = v;
      spCurrentId = v;
      _refreshSpecPanel(s);
      showToast('Spec ID changed', applyUndo, 5000);
    } else {
      _refreshSpecPanel(s);
    }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { s.id = orig; _refreshSpecPanel(s); } });
  input.addEventListener('blur', commit);
}

function startSpecNotesEdit(el, s) {
  if (el.querySelector('textarea')) return;
  const origNotes = s.notes;
  const origOpener = spOpener;
  el.innerHTML = '';
  el.removeAttribute('tabindex'); el.removeAttribute('role');
  const ta = document.createElement('textarea');
  ta.className = 'sp-notes-ta';
  ta.value = origNotes;
  ta.placeholder = 'Add notes…';
  el.appendChild(ta);
  const hint = document.createElement('div');
  hint.className = 'sp-hint';
  hint.textContent = 'Ctrl/Cmd+Enter to save · Esc to cancel';
  el.appendChild(hint);
  ta.focus();
  let done = false;
  const save = () => {
    if (done) return; done = true;
    if (ta.value !== origNotes) pushUndo('spec notes change');
    s.notes = ta.value;
    spOpener = origOpener;
    _refreshSpecPanel(s);
  };
  const cancel = () => {
    if (done) return; done = true;
    spOpener = origOpener;
    _refreshSpecPanel(s);
  };
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  ta.addEventListener('blur', save);
}

// ─── SIDE PANEL: NOTES EDIT ──────────────────────────────────────────────────
function startNotesEdit(el, t) {
  if (el.querySelector('textarea')) return;
  const origNotes = t.notes;
  const origOpener = spOpener;
  el.innerHTML = '';
  el.removeAttribute('tabindex'); el.removeAttribute('role');
  const ta = document.createElement('textarea');
  ta.className = 'sp-notes-ta';
  ta.value = origNotes;
  ta.placeholder = 'Add notes…';
  el.appendChild(ta);
  const hint = document.createElement('div');
  hint.className = 'sp-hint';
  hint.textContent = 'Ctrl/Cmd+Enter to save · Esc to cancel';
  el.appendChild(hint);
  ta.focus();
  let done = false;
  const save = () => {
    if (done) return; done = true;
    t.notes = ta.value;
    renderGantt();
    spCurrentType = null; openTaskPanel(t.id); spOpener = origOpener;
  };
  const cancel = () => {
    if (done) return; done = true;
    spCurrentType = null; openTaskPanel(t.id); spOpener = origOpener;
    const newEl = document.querySelector('.sp-notes-field');
    if (newEl) newEl.focus();
  };
  ta.addEventListener('keydown', e => {
    e.stopPropagation(); // prevent Space/Enter from bubbling to parent div's activation listener
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  ta.addEventListener('blur', save);
}

// ─── SIDE PANEL: DEPENDENCY EDITING ──────────────────────────────────────────
// wouldCreateCycle imported from ./compute/wbs.js (signature: wouldCreateCycle(tasks, taskId, candidateId))

function removeDep(t, depId) {
  const origOpener = spOpener;
  t.deps = t.deps.filter(d => d !== depId);
  renderGantt();
  spCurrentType = null; openTaskPanel(t.id); spOpener = origOpener;
}

function addDep(t, depId) {
  const origOpener = spOpener;
  if (!t.deps.includes(depId)) { t.deps.push(depId); t.deps.sort((a, b) => a - b); }
  renderGantt();
  spCurrentType = null; openTaskPanel(t.id); spOpener = origOpener;
}

function wirePicker({ btnId, pickerId, listId, buildFn, ref, itemSelector }) {
  const sel    = itemSelector || '.sp-dep-item[tabindex]';
  const btn    = document.getElementById(btnId);
  const picker = document.getElementById(pickerId);
  if (!btn || !picker) return;
  const input = picker.querySelector('.sp-dep-picker-input');
  const list  = document.getElementById(listId);
  if (!input || !list) return;
  const open = () => {
    picker.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
    buildFn(input, ref, list);
    input.focus();
  };
  const close = () => {
    picker.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => picker.style.display === 'none' ? open() : close());
  input.addEventListener('input', () => buildFn(input, ref, list));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); const f = list.querySelector(sel); if (f) f.focus(); }
    if (e.key === 'Escape') { close(); btn.focus(); }
  });
  list.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll(sel)];
    const idx   = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); if (idx < items.length - 1) items[idx + 1].focus(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx > 0) items[idx - 1].focus(); else input.focus(); }
    if (e.key === 'Escape')    { close(); btn.focus(); }
    if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); items[idx].click(); }
  });
  const _onDocClick = e => {
    if (!picker.contains(e.target) && e.target !== btn) { close(); document.removeEventListener('click', _onDocClick); }
  };
  document.addEventListener('click', _onDocClick);
}

function buildDepPickerList(input, t, listEl) {
  const q = input.value.trim().toLowerCase();
  const candidates = ProjectData.tasks.filter(c => c.id !== t.id && !t.deps.includes(c.id));
  const filtered = q ? candidates.filter(c =>
    c.name.toLowerCase().includes(q) || c.wbs.toLowerCase().includes(q) || String(c.id).includes(q)
  ) : candidates;
  listEl.innerHTML = '';
  if (!filtered.length) {
    const msg = document.createElement('div');
    msg.className = 'sp-dep-item';
    msg.style.cssText = 'color:var(--muted);pointer-events:none';
    msg.textContent = 'No tasks found';
    listEl.appendChild(msg);
    return;
  }
  filtered.forEach(c => {
    const isCycle = wouldCreateCycle(ProjectData.tasks, t.id, c.id);
    const div = document.createElement('div');
    div.className = 'sp-dep-item' + (isCycle ? ' cycle' : '');
    div.setAttribute('role', 'option');
    div.setAttribute('aria-disabled', isCycle ? 'true' : 'false');
    div.textContent = c.wbs + ' · ' + c.name + (isCycle ? ' — cycle' : '');
    if (!isCycle) {
      div.setAttribute('tabindex', '0');
      div.addEventListener('click', e => { e.stopPropagation(); addDep(t, c.id); });
    }
    listEl.appendChild(div);
  });
}

function removeSpecDep(s, taskId) {
  const origOpener = spOpener;
  s.depIds = s.depIds.filter(id => id !== taskId);
  renderSpecTable();
  spCurrentType = null; openSpecPanel(s.id); spOpener = origOpener;
}

function addSpecDep(s, taskId) {
  const origOpener = spOpener;
  if (!s.depIds.includes(taskId)) { s.depIds.push(taskId); s.depIds.sort((a,b) => a-b); }
  renderSpecTable();
  spCurrentType = null; openSpecPanel(s.id); spOpener = origOpener;
}

function buildSpecDepPickerList(input, s, listEl) {
  const q = input.value.trim().toLowerCase();
  const candidates = ProjectData.tasks.filter(c => !s.depIds.includes(c.id));
  const filtered = q ? candidates.filter(c =>
    c.name.toLowerCase().includes(q) || c.wbs.toLowerCase().includes(q) || String(c.id).includes(q)
  ) : candidates;
  listEl.innerHTML = '';
  if (!filtered.length) {
    const msg = document.createElement('div');
    msg.className = 'sp-dep-item';
    msg.style.cssText = 'color:var(--muted);pointer-events:none';
    msg.textContent = 'No tasks found';
    listEl.appendChild(msg);
    return;
  }
  filtered.forEach(c => {
    const div = document.createElement('div');
    div.className = 'sp-dep-item';
    div.setAttribute('role', 'option');
    div.setAttribute('tabindex', '0');
    div.textContent = c.wbs + ' · ' + c.name;
    div.addEventListener('click', e => { e.stopPropagation(); addSpecDep(s, c.id); });
    div.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); addSpecDep(s, c.id); } });
    listEl.appendChild(div);
  });
}

function removeSpecLink(s, taskId) {
  const origOpener = spOpener;
  s.depIds = s.depIds.filter(id => id !== taskId);
  renderSpecTable();
  spCurrentType = null; openTaskPanel(taskId); spOpener = origOpener;
}

function addSpecLink(s, taskId) {
  const origOpener = spOpener;
  if (!s.depIds.includes(taskId)) { s.depIds.push(taskId); s.depIds.sort((a,b) => a-b); }
  renderSpecTable();
  spCurrentType = null; openTaskPanel(taskId); spOpener = origOpener;
}

function buildSpecLinkPickerList(input, t, listEl) {
  const q = input.value.trim().toLowerCase();
  const candidates = ProjectData.specs.filter(s => !s.depIds.includes(t.id));
  const filtered = q ? candidates.filter(s =>
    s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
  ) : candidates;
  listEl.innerHTML = '';
  if (!filtered.length) {
    const msg = document.createElement('div');
    msg.className = 'sp-dep-item';
    msg.style.cssText = 'color:var(--muted);pointer-events:none';
    msg.textContent = 'No specs found';
    listEl.appendChild(msg);
    return;
  }
  filtered.forEach(s => {
    const div = document.createElement('div');
    div.className = 'sp-dep-item';
    div.setAttribute('role', 'option');
    div.setAttribute('tabindex', '0');
    div.textContent = s.id + ' · ' + s.category + ' · ' + s.name;
    div.addEventListener('click', e => { e.stopPropagation(); addSpecLink(s, t.id); });
    div.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); addSpecLink(s, t.id); } });
    listEl.appendChild(div);
  });
}

// ─── ROW REORDER ─────────────────────────────────────────────────────────────
function startRowDrag(e, visIdx, t, rowEl) {
  const lb = document.getElementById('gantt-left-body');
  const taskRowCount = lb.querySelectorAll('.gantt-row').length;

  rowDrag.active   = true;
  rowDrag.srcIdx   = visIdx;
  rowDrag.dropIdx  = visIdx;
  rowDrag.rowCount = taskRowCount;
  rowDrag.lb       = lb;

  const ghost = document.createElement('div');
  ghost.className = 'gantt-row-ghost';
  ghost.textContent = t.wbs + '  ' + t.name;
  ghost.style.left = (e.clientX + 10) + 'px';
  ghost.style.top  = (e.clientY - 17) + 'px';
  document.body.appendChild(ghost);
  rowDrag.ghost = ghost;

  const indicator = document.createElement('div');
  indicator.style.cssText = 'position:fixed;z-index:801;height:2px;background:var(--accent);pointer-events:none;display:none';
  document.body.appendChild(indicator);
  rowDrag.indicator = indicator;

  e.preventDefault();
}

function doRowDragMove(e) {
  if (!rowDrag.active) return;
  const lb = rowDrag.lb;

  rowDrag.ghost.style.left = (e.clientX + 10) + 'px';
  rowDrag.ghost.style.top  = (e.clientY - 17) + 'px';

  const lbRect  = lb.getBoundingClientRect();
  const relY    = e.clientY - lbRect.top + lb.scrollTop;
  const dropIdx = Math.min(Math.max(0, Math.round(relY / RH)), rowDrag.rowCount);
  rowDrag.dropIdx = dropIdx;

  const indicatorY = lbRect.top + dropIdx * RH - lb.scrollTop;
  rowDrag.indicator.style.left    = lbRect.left + 'px';
  rowDrag.indicator.style.width   = lbRect.width + 'px';
  rowDrag.indicator.style.top     = indicatorY + 'px';
  rowDrag.indicator.style.display = 'block';
}

function endRowDrag(e) {
  if (!rowDrag.active) return;
  rowDrag.active = false;
  if (rowDrag.ghost)     { rowDrag.ghost.remove();     rowDrag.ghost     = null; }
  if (rowDrag.indicator) { rowDrag.indicator.remove(); rowDrag.indicator = null; }

  const srcIdx  = rowDrag.srcIdx;
  const dropIdx = rowDrag.dropIdx;

  if (dropIdx === srcIdx || dropIdx === srcIdx + 1) { renderGantt(); return; }

  const visibleTasks = ProjectData.tasks.filter(t => {
    const ph = String(parseInt(String(t.wbs).split('.')[0]) || 1);
    if (ganttPhaseFilter !== 'all' && ph !== ganttPhaseFilter) return false;
    if (ganttTeamFilter  !== 'all' && (t.team || 'Unassigned') !== ganttTeamFilter) return false;
    return true;
  });

  const dragged = visibleTasks[srcIdx];
  if (!dragged) { renderGantt(); return; }

  pushUndo('task reorder');

  const origIdx = ProjectData.tasks.indexOf(dragged);
  ProjectData.tasks.splice(origIdx, 1);

  const adjustedDrop  = dropIdx > srcIdx ? dropIdx - 1 : dropIdx;
  const updatedVisible = ProjectData.tasks.filter(t => {
    const ph = String(parseInt(String(t.wbs).split('.')[0]) || 1);
    if (ganttPhaseFilter !== 'all' && ph !== ganttPhaseFilter) return false;
    if (ganttTeamFilter  !== 'all' && (t.team || 'Unassigned') !== ganttTeamFilter) return false;
    return true;
  });
  const targetTask = updatedVisible[adjustedDrop];
  const targetIdx  = targetTask ? ProjectData.tasks.indexOf(targetTask) : ProjectData.tasks.length;
  ProjectData.tasks.splice(targetIdx, 0, dragged);
  recalcWBS(ProjectData.tasks);
  renderGantt();
  showToast('Task reordered', applyUndo, 5000);
}


// ─── ADD / DELETE TASK & SPEC ─────────────────────────────────────────────────
/** Appends a new blank spec with auto-generated ID, opens its panel, and auto-focuses the name field. */
function addNewSpec() {
  const filterEl = document.getElementById('specs-filter');
  const activeCat = (filterEl && filterEl.value !== 'all')
    ? filterEl.value
    : (Object.keys(SPEC_COLORS)[0] || 'General');
  const prefix = activeCat.slice(0, 2).toUpperCase();
  const existingNums = ProjectData.specs
    .filter(s => s.id.toUpperCase().startsWith(prefix))
    .map(s => { const m = s.id.match(/(\d+)$/); return m ? parseInt(m[1]) : 0; });
  const nextNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;
  const newId = prefix + '-' + String(nextNum).padStart(3, '0');
  const newSpec = {
    id: newId, category: activeCat, name: 'New Specification',
    value: '', units: '—', status: 'TBD', group: '', notes: '', depIds: []
  };
  pushUndo('spec added');
  ProjectData.specs.push(newSpec);
  renderSpecs();
  openSpecPanel(newId);
  showToast('Specification added', applyUndo, 5000);
  const nameEl = document.querySelector('#sp-body .sp-name-edit');
  if (nameEl) startSpecNameEdit(nameEl, newSpec);
}

/** @param {number} taskId - Two-tap confirm delete; pushes undo, removes task and all dep references. */
function deleteTask(taskId) {
  if (!ProjectData.tasks.find(t => t.id === taskId)) return;
  const btn = document.getElementById('sp-delete-task-btn');
  if (btn && btn.dataset.confirming !== '1') {
    btn.dataset.confirming = '1';
    btn.textContent = 'Tap again to confirm delete';
    btn.style.borderColor = '#f85149'; btn.style.color = '#f85149';
    setTimeout(() => {
      if (btn && btn.dataset.confirming === '1') {
        btn.dataset.confirming = ''; btn.textContent = 'Delete Task';
        btn.style.borderColor = ''; btn.style.color = '';
      }
    }, 3000);
    return;
  }
  pushUndo('task deleted');
  ProjectData.tasks = ProjectData.tasks.filter(t => t.id !== taskId);
  ProjectData.tasks.forEach(t => { t.deps = t.deps.filter(d => d !== taskId); });
  ProjectData.specs.forEach(s => { s.depIds = s.depIds.filter(d => d !== taskId); });
  recalcWBS(ProjectData.tasks);
  safeRender(renderGantt, 'Gantt Chart');
  safeRender(renderSpecs, 'Specifications');
  closeSidePanel();
  showToast('Task deleted', applyUndo, 5000);
}

/** @param {string} specId - Two-tap confirm delete; pushes undo, removes the spec. */
function deleteSpec(specId) {
  if (!ProjectData.specs.find(s => s.id === specId)) return;
  const btn = document.getElementById('sp-delete-spec-btn');
  if (btn && btn.dataset.confirming !== '1') {
    btn.dataset.confirming = '1';
    btn.textContent = 'Tap again to confirm delete';
    btn.style.borderColor = '#f85149'; btn.style.color = '#f85149';
    setTimeout(() => {
      if (btn && btn.dataset.confirming === '1') {
        btn.dataset.confirming = ''; btn.textContent = 'Delete Specification';
        btn.style.borderColor = ''; btn.style.color = '';
      }
    }, 3000);
    return;
  }
  pushUndo('spec deleted');
  ProjectData.specs = ProjectData.specs.filter(s => s.id !== specId);
  safeRender(renderSpecs, 'Specifications');
  closeSidePanel();
  showToast('Specification deleted', applyUndo, 5000);
}

/** Appends a new blank task to the last WBS phase, selects a team from existing unique teams. */
function addGanttTask() {
  if (!ProjectData.tasks.length) return;
  const lastTask = ProjectData.tasks[ProjectData.tasks.length - 1];
  const lastPhase = parseInt(String(lastTask.wbs).split('.')[0]) || 1;
  const phaseTasks = ProjectData.tasks.filter(t => parseInt(String(t.wbs).split('.')[0]) === lastPhase && t.wbs.includes('.') && !t.wbs.endsWith('.0'));
  const nextNum = phaseTasks.length + 1;
  const newWbs = lastPhase + '.' + nextNum;

  const teams = [...new Set(ProjectData.tasks.map(t => t.team).filter(Boolean))].sort();
  const team = teams[0] || '';

  const dates = ProjectData.tasks.flatMap(t => [t.start, t.end]).filter(Boolean);
  const progStart = new Date(Math.min(...dates));
  const taskStart = snapToWorkDay(progStart, ganttWorkDays, 1);
  const taskEnd   = snapToWorkDay(addDays(taskStart, 4), ganttWorkDays, 1);

  const newId = Math.max(...ProjectData.tasks.map(t => t.id), 0) + 1;
  const newTask = {
    id: newId, wbs: newWbs,
    name: 'New Task ' + newId,
    category: lastTask.category || '',
    start: taskStart, end: taskEnd,
    pct: 0, deps: [], team, milestone: false, notes: '',
  };
  ProjectData.tasks.push(newTask);
  renderGantt();
  const phaseNames = getPhaseNames();
  showToast('Task added to ' + (phaseNames[lastPhase] || ('Phase ' + lastPhase)) + '.');
}

function resetGanttToImported() {
  if (!originalTasks.length) return;
  const snapshot = ProjectData.tasks.map(t => ({ ...t, deps: [...t.deps] }));
  ProjectData.tasks = originalTasks.map(t => ({ ...t, deps: [...t.deps] }));
  renderGantt();
  showToast('Schedule reset to imported state.', () => { ProjectData.tasks = snapshot; renderGantt(); }, 30000);
}

// ─── SAVE TO EXCEL ────────────────────────────────────────────────────────────
function saveToExcel() {
  const wb = buildWorkbook(ProjectData, getWeightUnit());
  const title = (ProjectData.info['Project Title'] || 'Dashboard').replace(/[/\\?%*:|"<>]/g, '-');
  const dateStr = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `${title} - ${dateStr}.xlsx`);
  clearDraft();
  showToast('Exported to Excel — draft cleared');
}

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');

document.getElementById('gantt-calendar').addEventListener('mouseover', e => {
  const cell = e.target.closest('[data-cal-tip]');
  if (!cell) { tooltip.style.display = 'none'; return; }
  tooltip.innerHTML = cell.dataset.calTip.split('\n')
    .map((l, i) => `<div${i === 0 ? ' class="tt-title"' : ''}>${esc(l)}</div>`).join('');
  tooltip.style.display = 'block';
  positionTooltip(e);
});
document.getElementById('gantt-calendar').addEventListener('mouseleave', () => {
  tooltip.style.display = 'none';
});

function showTooltip(t, e) {
  const color = ganttColor(t.category);
  const depNames = t.deps.map(id => {
    const dep = ProjectData.tasks.find(d => d.id === id);
    return dep ? `Task ${id}: ${esc(dep.name)}` : `Task ${id}`;
  });
  tooltip.innerHTML = `
    <div class="tt-title">${t.milestone ? '◆ ' : ''}${esc(t.name)}</div>
    <div class="tt-row"><strong style="color:${color}">${esc(t.category)}</strong></div>
    <div class="tt-row"><strong>Team:</strong>${esc(t.team) || '—'}</div>
    <div class="tt-row"><strong>Start:</strong>${fmt(t.start)}</div>
    <div class="tt-row"><strong>End:</strong>${fmt(t.end)}</div>
    <div class="tt-row"><strong>Progress:</strong>${t.pct}% complete</div>
    ${t.deps.length ? `<div class="tt-row"><strong>Depends on:</strong>${depNames.join(', ')}</div>` : ''}
    ${t.notes ? `<div class="tt-row" style="margin-top:4px;font-style:italic">${esc(t.notes)}</div>` : ''}
    <div class="tt-row" style="margin-top:6px;font-size:0.72rem;color:var(--muted)">Click for full details</div>`;
  tooltip.style.display = 'block';
  positionTooltip(e);
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

function positionTooltip(e) {
  const x = e.clientX + 18;
  const y = e.clientY - 10;
  tooltip.style.left = Math.min(x, window.innerWidth - tooltip.offsetWidth - 10) + 'px';
  tooltip.style.top  = Math.min(y, window.innerHeight - tooltip.offsetHeight - 10) + 'px';
}

document.addEventListener('mousemove', e => {
  if (tooltip.style.display === 'block') positionTooltip(e);
});

// ─── PROGRAM DASHBOARD ────────────────────────────────────────────────────────
// PHASE_NAMES_FALLBACK imported from ./constants.js
function getPhaseNames() {
  const names = {};
  for (let i = 1; i <= 20; i++) {
    const v = ProjectData.info['Phase ' + i + ' Name'];
    if (v) names[i] = String(v);
  }
  return names;
}

function toggleWtGroup(el) {
  const items   = el.nextElementSibling;
  const arrow   = el.querySelector('.wt-group-arrow');
  const open    = items.style.display !== 'none';
  const grpName = el.getAttribute('data-group-name');
  items.style.display = open ? 'none' : '';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
  el.setAttribute('aria-expanded', String(!open));
  if (grpName) {
    let collapsed = JSON.parse(localStorage.getItem('vh-wt-collapsed') || '[]');
    collapsed = open ? [...new Set([...collapsed, grpName])] : collapsed.filter(g => g !== grpName);
    safeSetItem('vh-wt-collapsed', JSON.stringify(collapsed));
  }
}
function toggleTeamRow(el) {
  const dd    = el.nextElementSibling;
  const arrow = el.querySelector('.team-row-arrow');
  const open  = dd.style.display !== 'none';
  dd.style.display       = open ? 'none' : 'block';
  arrow.style.transform  = open ? ''     : 'rotate(90deg)';
}

function renderProgDash() {
  const body = document.getElementById('prog-body');
  if (!body) return;

  const totalTasks = ProjectData.tasks.length;
  const overallPct = totalTasks
    ? Math.round(ProjectData.tasks.reduce((s, t) => s + (t.pct || 0), 0) / totalTasks)
    : 0;
  const doneTasks = ProjectData.tasks.filter(t => t.pct >= 100).length;

  const milestones = ProjectData.tasks.filter(t => t.milestone);
  const milestoneDone = milestones.filter(t => t.pct >= 100).length;
  const nextMs = milestones
    .filter(t => t.pct < 100)
    .sort((a, b) => (a.start||a.end) - (b.start||b.end))[0];
  const daysToNext = nextMs ? daysBetween(TODAY, nextMs.start) : null;

  // Final milestone — last milestone chronologically by end/start date
  const finalMs = milestones.slice().sort((a, b) => (b.end || b.start) - (a.end || a.start))[0];
  const finalMsDate = finalMs ? (finalMs.end || finalMs.start) : null;
  const finalMsDateStr = finalMsDate
    ? finalMsDate.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
    : 'TBD';
  const daysToFinal = finalMsDate ? daysBetween(TODAY, finalMsDate) : null;
  const daysToFinalStr = daysToFinal === null ? '' :
    daysToFinal > 0 ? `${daysToFinal} days remaining` :
    daysToFinal === 0 ? 'Today' : 'Completed';

  const overdueTasks = ProjectData.tasks.filter(t => t.end && t.end < TODAY && (t.pct || 0) < 100 && !t.milestone).length;

  const specAchieved = ProjectData.specs.filter(s => s.status === 'Achieved').length;
  const specTarget   = ProjectData.specs.filter(s => s.status === 'Target').length;
  const specTBD      = ProjectData.specs.filter(s => s.status === 'TBD').length;

  const phaseMap = {};
  ProjectData.tasks.forEach(t => {
    const ph = parseInt(String(t.wbs).split('.')[0]) || 1;
    if (!phaseMap[ph]) phaseMap[ph] = [];
    phaseMap[ph].push(t);
  });
  const phaseNums = Object.keys(phaseMap).map(Number).sort((a, b) => a - b);

  // Team workload: track both count and task list
  const teamTaskMap = {};
  ProjectData.tasks.forEach(t => {
    const team = t.team || 'Unassigned';
    if (!teamTaskMap[team]) teamTaskMap[team] = [];
    teamTaskMap[team].push(t);
  });
  const maxTeamCount = Math.max(...Object.values(teamTaskMap).map(v => v.length), 1);

  const pctColor = overallPct >= 75 ? '#3fb950' : overallPct >= 40 ? '#58a6ff' : '#d29922';

  let nextMsCard = '';
  if (nextMs) {
    const dLabel = daysToNext > 0 ? daysToNext + ' days away' : daysToNext === 0 ? 'Today' : Math.abs(daysToNext) + ' days ago';
    nextMsCard = `<div class="kpi-card">
      <div class="kpi-label">Next Milestone</div>
      <div class="kpi-value" style="font-size:1rem;font-weight:700;line-height:1.2">${esc(nextMs.name)}</div>
      <div class="kpi-sub">${dLabel}</div>
    </div>`;
  }

  // Build team workload rows with collapsible task dropdowns
  const teamRows = Object.entries(teamTaskMap).sort((a, b) => b[1].length - a[1].length).map(([team, tasks]) => {
    const count = tasks.length;
    const barW  = Math.round(count / maxTeamCount * 100);
    const taskItems = tasks.map(t => {
      const pct = t.pct || 0;
      const [cls, label] = pct >= 100 ? ['tts-done','Done'] : pct > 0 ? ['tts-progress', pct + '%'] : ['tts-pending','Not Started'];
      const msIcon = t.milestone ? ' <span title="Milestone" style="color:#d29922">◆</span>' : '';
      const dateStr = t.end ? t.end.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';
      return `<div class="team-task-item">
        <span class="tts ${cls}">${label}</span>
        <span style="flex:1">${esc(t.wbs)} &nbsp;${esc(t.name)}${msIcon}</span>
        <span style="color:var(--muted);font-size:0.72rem;flex-shrink:0">${dateStr}</span>
      </div>`;
    }).join('');
    return `
      <div class="team-row">
        <div class="prog-bar-label" title="${esc(team)}">${esc(team)}</div>
        <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${barW}%;background:var(--accent)"></div></div>
        <div class="prog-bar-pct">${count}</div>
        <div class="team-row-arrow">▶</div>
      </div>
      <div class="team-dropdown">${taskItems}</div>`;
  }).join('');

  body.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Overall Complete</div>
        <div class="kpi-value" style="color:${pctColor}">${overallPct}%</div>
        <div class="kpi-sub">${totalTasks} tasks · ${doneTasks} done</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Milestones</div>
        <div class="kpi-value">${milestoneDone}<span style="font-size:1rem;font-weight:400;color:var(--muted)"> / ${milestones.length}</span></div>
        <div class="kpi-sub">${milestones.length - milestoneDone} remaining</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Overdue</div>
        <div class="kpi-value" style="${overdueTasks > 0 ? 'color:#f85149' : ''}">${overdueTasks}</div>
        <div class="kpi-sub">tasks past due</div>
      </div>
      ${nextMsCard}
      <div class="kpi-card">
        <div class="kpi-label">Final Milestone</div>
        <div class="kpi-value" style="font-size:1rem;font-weight:700;line-height:1.3">${finalMs ? esc(finalMs.name) : 'None'}</div>
        <div class="kpi-sub">${finalMsDateStr}</div>
        <div class="kpi-sub" style="margin-top:2px">${daysToFinalStr}</div>
      </div>
    </div>

    <div class="two-col">
      <div class="dash-section">
        <div class="dash-section-title">Phase Progress</div>
        ${phaseNums.map(ph => {
          const pts  = phaseMap[ph];
          const avg  = Math.round(pts.reduce((s, t) => s + (t.pct || 0), 0) / pts.length);
          const phaseNames = getPhaseNames();
          const name = phaseNames[ph] || PHASE_NAMES_FALLBACK[ph - 1] || ('Phase ' + ph);
          const color = phaseColor(ph + '.0');
          return `<div class="prog-bar-row">
            <div class="prog-bar-label" title="${ph}. ${esc(name)}">${ph}. ${esc(name)}</div>
            <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${avg}%;background:${color}"></div></div>
            <div class="prog-bar-pct">${avg}%</div>
          </div>`;
        }).join('')}
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Specification Status</div>
        <div class="spec-pill-row">
          <div class="spec-pill achieved"><div class="pill-count">${specAchieved}</div>Achieved</div>
          <div class="spec-pill target"><div class="pill-count">${specTarget}</div>Target</div>
          <div class="spec-pill tbd"><div class="pill-count">${specTBD}</div>TBD</div>
        </div>
        <div style="margin-top:14px;font-size:0.8rem;color:var(--muted)">${ProjectData.specs.length} specifications total</div>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">Team Workload — click a team to see tasks</div>
      ${teamRows}
    </div>
  `;
  body.querySelectorAll('.team-row').forEach(row => {
    row.addEventListener('click', () => toggleTeamRow(row));
  });
}

// ─── WEIGHT BUDGET ────────────────────────────────────────────────────────────
function getWeightUnit() { return String(ProjectData.info['Weight Unit'] || 'lb'); }
function showWtTooltip(e, el) {
  const est    = Number(el.dataset.est);
  const tgt    = Number(el.dataset.tgt);
  const total  = Number(el.dataset.total);
  const name   = el.dataset.name;
  const unit   = getWeightUnit();
  const margin = tgt - est;
  const mSign  = margin >= 0 ? '+' : '';
  const mColor = margin >= 0 ? '#3fb950' : '#d29922';
  tooltip.innerHTML = `
    <div style="font-weight:700;margin-bottom:5px">${esc(name)}</div>
    <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">Estimated</span><strong>${est.toLocaleString()} ${esc(unit)}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">Target</span><strong>${tgt.toLocaleString()} ${esc(unit)}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">Margin</span><strong style="color:${mColor}">${mSign}${margin.toLocaleString()} ${esc(unit)}</strong></div>
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);color:var(--muted);font-size:0.75rem">Total vehicle est.: <strong style="color:var(--text)">${total.toLocaleString()} ${esc(unit)}</strong></div>
  `;
  tooltip.style.display = 'block';
  positionTooltip(e);
}
function hideWtTooltip() { tooltip.style.display = 'none'; }

function renderWeightBudget() {
  const body = document.getElementById('weight-body');
  if (!body || !ProjectData.weights.length) return;

  const unit        = getWeightUnit();
  const totalTarget = ProjectData.weights.reduce((s, w) => s + w.target, 0);
  const totalEst    = ProjectData.weights.reduce((s, w) => s + w.estimated, 0);
  const totalMargin = totalTarget - totalEst;
  const maxVal      = Math.max(...ProjectData.weights.map(w => Math.max(w.target, w.estimated)), 1);
  const marginColor = totalMargin >= 0 ? '#3fb950' : '#d29922';
  const marginSign  = totalMargin >= 0 ? '+' : '';
  const marginPct   = Math.round(Math.abs(totalMargin) / totalTarget * 100);

  body.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Total Target</div>
        <div class="kpi-value" style="font-size:1.6rem">${totalTarget.toLocaleString()} ${esc(unit)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Estimated</div>
        <div class="kpi-value" style="font-size:1.6rem">${totalEst.toLocaleString()} ${esc(unit)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Margin Remaining</div>
        <div class="kpi-value" style="font-size:1.6rem;color:${marginColor}">${marginSign}${totalMargin.toLocaleString()} ${esc(unit)}</div>
        <div class="kpi-sub">${marginPct}% of target</div>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">Subsystem Mass Budget</div>
      <div class="wt-row wt-row-header">
        <div>Subsystem / Group</div>
        <div>Estimated vs Target <span style="font-size:0.65rem;opacity:0.7">│ = target · hover for details</span></div>
        <div style="text-align:right">Est. (${esc(unit)})</div>
        <div style="text-align:right">Tgt (${esc(unit)})</div>
        <div style="text-align:right">Margin</div>
      </div>
      ${(() => {
        const grouped = {};
        ProjectData.weights.forEach(w => {
          const g = w.group || 'Other';
          if (!grouped[g]) grouped[g] = [];
          grouped[g].push(w);
        });
        const collapsedGroups = JSON.parse(localStorage.getItem('vh-wt-collapsed') || '[]');
        return Object.entries(grouped).map(([grpName, items], n) => {
          const gEst    = items.reduce((s, w) => s + w.estimated, 0);
          const gTgt    = items.reduce((s, w) => s + w.target, 0);
          const gMargin = gTgt - gEst;
          const gSign   = gMargin >= 0 ? '+' : '';
          const gClass  = gMargin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg';
          const gColor  = gMargin < 0 ? '#d29922' : '#3fb950';
          const gEstPct = Math.min(100, Math.round(gEst / maxVal * 100));
          const gTgtPct = Math.min(100, Math.round(gTgt / maxVal * 100));
          const isCollapsed = collapsedGroups.includes(grpName);
          const header  = `<div class="wt-row wt-group-header" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="wt-grp-${n}" data-group-name="${esc(grpName)}" style="cursor:pointer">
            <div style="font-weight:700"><span class="wt-group-arrow" style="margin-right:6px">${isCollapsed ? '▶' : '▼'}</span>${esc(grpName)}</div>
            <div class="wt-bar-wrap" style="cursor:crosshair"
              data-name="${esc(grpName)}" data-est="${gEst}" data-tgt="${gTgt}" data-total="${totalEst}">
              <div class="wt-bar-est" style="width:${gEstPct}%;background:${gColor}"></div>
              <div class="wt-bar-tgt" style="left:${gTgtPct}%"></div>
            </div>
            <div style="text-align:right;font-weight:700">${gEst.toLocaleString()}</div>
            <div style="text-align:right;color:var(--muted);font-weight:700">${gTgt.toLocaleString()}</div>
            <div style="text-align:right;font-weight:700" class="${gClass}">${gSign}${gMargin.toLocaleString()}</div>
          </div><div class="wt-group-items" id="wt-grp-${n}" style="${isCollapsed ? 'display:none' : ''}">`;
          const rows = items.map(w => {
            const margin   = w.target - w.estimated;
            const estPct   = Math.min(100, Math.round(w.estimated / maxVal * 100));
            const tgtPct   = Math.min(100, Math.round(w.target    / maxVal * 100));
            const barColor = margin < 0 ? '#d29922' : '#3fb950';
            const mSign    = margin >= 0 ? '+' : '';
            const mClass   = margin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg';
            return `<div class="wt-row" style="padding-left:12px;cursor:pointer" data-wt-idx="${ProjectData.weights.indexOf(w)}" title="Click to edit">
              <div title="${esc(w.subsystem)} (${esc(w.group)})">${esc(w.subsystem)}</div>
              <div class="wt-bar-wrap" style="cursor:crosshair"
                data-name="${esc(w.subsystem)}" data-est="${w.estimated}" data-tgt="${w.target}" data-total="${totalEst}">
                <div class="wt-bar-est" style="width:${estPct}%;background:${barColor}"></div>
                <div class="wt-bar-tgt" style="left:${tgtPct}%"></div>
              </div>
              <div style="text-align:right">${w.estimated.toLocaleString()}</div>
              <div style="text-align:right;color:var(--muted)">${w.target.toLocaleString()}</div>
              <div style="text-align:right" class="${mClass}">${mSign}${margin.toLocaleString()}</div>
            </div>`;
          }).join('');
          return header + rows + '</div>';
        }).join('');
      })()}
      <div class="wt-row wt-total-row">
        <div>Total</div>
        <div></div>
        <div style="text-align:right">${totalEst.toLocaleString()}</div>
        <div style="text-align:right;color:var(--muted)">${totalTarget.toLocaleString()}</div>
        <div style="text-align:right" class="${totalMargin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg'}">${totalMargin >= 0 ? '+' : ''}${totalMargin.toLocaleString()}</div>
      </div>
    </div>
  `;
  body.querySelectorAll('.wt-bar-wrap').forEach(el => {
    el.addEventListener('mouseenter', e => showWtTooltip(e, el));
    el.addEventListener('mousemove', positionTooltip);
    el.addEventListener('mouseleave', hideWtTooltip);
  });
  body.addEventListener('click', e => {
    const h = e.target.closest('.wt-group-header');
    if (h) { toggleWtGroup(h); return; }
    const row = e.target.closest('.wt-row[data-wt-idx]');
    if (row && !e.target.closest('.wt-bar-wrap')) openWeightPanel(+row.dataset.wtIdx);
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const h = e.target.closest('.wt-group-header'); if (h) { e.preventDefault(); toggleWtGroup(h); }
    }
  });
}

// ─── WEIGHT BUDGET EDITING ────────────────────────────────────────────────────
/** @param {number} idx - Index in ProjectData.weights; opens an edit form in the side panel. */
function openWeightPanel(idx) {
  if (spCurrentType === 'weight' && spCurrentId === idx) { closeSidePanel(); return; }
  spOpener = document.activeElement;
  const w = ProjectData.weights[idx];
  if (!w) return;
  document.getElementById('sp-title').textContent = w.subsystem || 'Weight Row';

  const unit = getWeightUnit();
  const statusOpts = ['On Track','Over Budget','Under Review','TBD'].map(s =>
    `<option${s === w.status ? ' selected' : ''}>${esc(s)}</option>`).join('');

  const html = `<div class="sp-meta" style="padding:14px 14px 4px">
    <div class="sp-form-group">
      <label class="sp-form-label" for="wt-edit-subsystem">Subsystem</label>
      <input class="sp-form-input" id="wt-edit-subsystem" type="text" value="${esc(w.subsystem)}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="wt-edit-group">Group</label>
      <input class="sp-form-input" id="wt-edit-group" type="text" value="${esc(w.group)}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="wt-edit-target">Target Weight (${esc(unit)})</label>
      <input class="sp-form-input" id="wt-edit-target" type="number" step="0.1" min="0" value="${w.target}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="wt-edit-est">Estimated Weight (${esc(unit)})</label>
      <input class="sp-form-input" id="wt-edit-est" type="number" step="0.1" min="0" value="${w.estimated}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="wt-edit-status">Status</label>
      <select class="sp-form-input" id="wt-edit-status">${statusOpts}</select>
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="wt-edit-notes">Notes</label>
      <textarea class="sp-form-input" id="wt-edit-notes" rows="3">${esc(w.notes || '')}</textarea>
    </div>
  </div>
  <div style="padding:0 16px">
    <button class="btn-primary" id="wt-save-btn" style="width:100%;margin-bottom:8px">Save Changes</button>
    <div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn-secondary btn-sm" id="wt-delete-btn" style="width:100%">Delete Row</button>
    </div>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  document.getElementById('wt-save-btn').addEventListener('click', () => saveWeightRow(idx));
  document.getElementById('wt-delete-btn').addEventListener('click', () => deleteWeightRow(idx));
  spCurrentType = 'weight'; spCurrentId = idx;
  showSidePanel();
}

function saveWeightRow(idx) {
  pushUndo('edit weight row');
  const w = ProjectData.weights[idx];
  w.subsystem = document.getElementById('wt-edit-subsystem').value.trim() || w.subsystem;
  w.group     = document.getElementById('wt-edit-group').value.trim();
  w.target    = parseFloat(document.getElementById('wt-edit-target').value) || 0;
  w.estimated = parseFloat(document.getElementById('wt-edit-est').value) || 0;
  w.status    = document.getElementById('wt-edit-status').value;
  w.notes     = document.getElementById('wt-edit-notes').value;
  document.getElementById('sp-title').textContent = w.subsystem || 'Weight Row';
  safeRender(renderWeightBudget, 'Weight Budget');
  showToast('Weight row saved');
}

function deleteWeightRow(idx) {
  const btn = document.getElementById('wt-delete-btn');
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1'; btn.textContent = 'Tap again to confirm delete';
    btn.style.background = 'var(--danger)'; btn.style.color = '#fff';
    setTimeout(() => { if (btn.dataset.confirming) { btn.dataset.confirming = ''; btn.textContent = 'Delete Row'; btn.style.background = ''; btn.style.color = ''; } }, 3000);
    return;
  }
  pushUndo('delete weight row');
  ProjectData.weights.splice(idx, 1);
  closeSidePanel();
  if (!ProjectData.weights.length) document.getElementById('weight-tab-btn').style.display = 'none';
  else safeRender(renderWeightBudget, 'Weight Budget');
  showToast('Weight row deleted · undo with Ctrl+Z');
}

function addWeightRow() {
  pushUndo('add weight row');
  ProjectData.weights.push({ subsystem: 'New Subsystem', group: 'Other', target: 0, estimated: 0, status: 'TBD', notes: '' });
  document.getElementById('weight-tab-btn').style.display = '';
  safeRender(renderWeightBudget, 'Weight Budget');
  openWeightPanel(ProjectData.weights.length - 1);
}

// ─── SPECS ────────────────────────────────────────────────────────────────────
/** Rebuilds the Specifications tab: repopulates category filter dropdown, then calls renderSpecTable(). */
function renderSpecs() {
  const sel = document.getElementById('specs-filter');
  sel.innerHTML = '<option value="all">All Categories</option>';
  [...new Set(ProjectData.specs.map(s => s.category))].forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  const savedCat = localStorage.getItem('vh-filter-specs-cat') || 'all';
  sel.value = [...sel.options].map(o => o.value).includes(savedCat) ? savedCat : 'all';
  renderSpecTable();
}

function specStatusRank(s) {
  if (s.status === 'TBD') {
    const risk = s.depIds.some(id => { const t = ProjectData.tasks.find(t => t.id === id); return t && t.start && t.start <= TODAY; });
    return risk ? 0 : 1;
  }
  return s.status === 'Target' ? 2 : s.status === 'Achieved' ? 3 : 4;
}

function setSpecsCategoryFilter(val) {
  safeSetItem('vh-filter-specs-cat', val);
  renderSpecTable();
}
function clearSpecsFilters() {
  document.getElementById('specs-filter').value = 'all';
  document.getElementById('specs-search').value = '';
  specSearchQuery = '';
  renderSpecTable();
}

function setSpecSort(col) {
  if (specSortState.col === col) specSortState.dir = specSortState.dir === 'asc' ? 'desc' : 'asc';
  else { specSortState.col = col; specSortState.dir = 'asc'; }
  renderSpecTable();
}

function renderSpecTable() {
  const cat  = document.getElementById('specs-filter').value;
  let list = cat === 'all' ? ProjectData.specs : ProjectData.specs.filter(s => s.category === cat);
  if (specSearchQuery.trim()) {
    const q = specSearchQuery.trim().toLowerCase();
    list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.group.toLowerCase().includes(q) ||
      s.notes.toLowerCase().includes(q)
    );
  }
  const count = list.length;
  document.getElementById('specs-count').textContent = `${count} specification${count!==1?'s':''}`;

  const SORT_COLS   = ['id','name','value','units','status','group','notes','deps'];
  const SORT_LABELS = ['Spec ID','Specification','Value','Units','Status','Responsible Group','Notes','Dep. Tasks'];
  const thHtml = SORT_COLS.map((c, i) => {
    const active  = specSortState.col === c;
    const ind     = active ? (specSortState.dir === 'asc' ? '↑' : '↓') : '↕';
    const indCls  = 'spec-sort-ind' + (active ? ' active' : '');
    const alignSt = c === 'deps' ? ' style="text-align:center"' : '';
    return `<th${alignSt} data-sort-col="${c}">${SORT_LABELS[i]}<span class="${indCls}">${ind}</span></th>`;
  }).join('');

  const specRow = (s, col) => {
    const sc = s.status==='Achieved' ? 'badge-achieved' : s.status==='Target' ? 'badge-target' : 'badge-tbd';
    const hasRisk = s.status === 'TBD' && s.depIds.some(id => {
      const t = ProjectData.tasks.find(t => t.id === id); return t && t.start && t.start <= TODAY;
    });
    const riskDesc = hasRisk ? ' — risk: dependent task already started' : '';
    const depText = s.depIds.length
      ? `<span aria-label="${s.depIds.length} dependent task${s.depIds.length!==1?'s':''}${riskDesc}" style="color:${hasRisk?'var(--danger)':'var(--muted)'};font-weight:${hasRisk?700:400}">${s.depIds.length}${hasRisk?' ⚠':''}</span>`
      : `<span aria-label="No dependent tasks" style="color:#484f58">—</span>`;
    return `<tr class="spec-row" data-spec-id="${esc(s.id)}">
      <td><code style="color:${col.text};font-size:0.78rem">${esc(s.id)}</code></td>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.value)}</td>
      <td style="color:var(--muted)">${esc(s.units)}</td>
      <td><span class="badge ${sc}" role="button" tabindex="0" data-spec-status-id="${esc(s.id)}" aria-label="Status: ${esc(s.status)} — press Enter or Space to change" title="Click to change status" style="cursor:pointer">${esc(s.status)}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${esc(s.group)}</td>
      <td style="color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem" title="${esc(s.notes)}">${esc(s.notes)||'—'}</td>
      <td style="text-align:center">${depText}</td>
    </tr>`;
  };

  let bodyHtml = '';
  if (specSortState.col) {
    const sorted = [...list].sort((a, b) => {
      let va, vb;
      switch (specSortState.col) {
        case 'id':     va = a.id;             vb = b.id;             break;
        case 'name':   va = a.name;           vb = b.name;           break;
        case 'value':  va = a.value;          vb = b.value;          break;
        case 'units':  va = a.units;          vb = b.units;          break;
        case 'status': va = specStatusRank(a); vb = specStatusRank(b); break;
        case 'group':  va = a.group;          vb = b.group;          break;
        case 'notes':  va = a.notes;          vb = b.notes;          break;
        case 'deps':   va = a.depIds.length;  vb = b.depIds.length;  break;
        default: return 0;
      }
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return specSortState.dir === 'asc' ? cmp : -cmp;
    });
    sorted.forEach(s => {
      const col = SPEC_COLORS[s.category] || { bg:'rgba(88,166,255,.1)', text:'#58a6ff' };
      bodyHtml += specRow(s, col);
    });
  } else {
    const groups = {};
    list.forEach(s => { (groups[s.category] = groups[s.category]||[]).push(s); });
    Object.entries(groups).forEach(([c, specs]) => {
      const col = SPEC_COLORS[c] || { bg:'rgba(88,166,255,.1)', text:'#58a6ff' };
      bodyHtml += `<tr class="cat-header"><td colspan="8" style="background:${col.bg};color:${col.text}">${esc(c)}</td></tr>`;
      specs.forEach(s => { bodyHtml += specRow(s, col); });
    });
  }

  const wrap = document.getElementById('specs-table-wrap');
  if (!list.length) {
    const cat = document.getElementById('specs-filter').value;
    const hasSearch = specSearchQuery.trim().length > 0;
    if (cat !== 'all' || hasSearch) {
      wrap.innerHTML = `<div style="padding:24px;color:var(--muted);font-size:0.82rem;text-align:center">No specifications match the current filter. <button class="specs-clear-filter-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;text-decoration:underline;padding:0">Clear filters</button></div>`;
      wrap.querySelector('.specs-clear-filter-btn').addEventListener('click', clearSpecsFilters);
    } else {
      wrap.innerHTML = `<div role="status" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:10px;color:var(--muted);text-align:center">
        <div style="font-size:2rem">📐</div>
        <div style="font-weight:700;color:var(--text)">No specifications found</div>
        <div style="font-size:0.82rem">Check that your Excel file includes a <code style="background:var(--bg);padding:1px 5px;border-radius:3px">Specifications</code> sheet with at least one row.</div>
        <button class="empty-help-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.82rem;text-decoration:underline;padding:0;margin-top:4px">Open help guide</button>
      </div>`;
      wrap.querySelector('.empty-help-btn').addEventListener('click', toggleHelp);
    }
    return;
  }
  wrap.innerHTML = `<table class="specs-table"><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  wrap.querySelectorAll('th[data-sort-col]').forEach(th =>
    th.addEventListener('click', () => setSpecSort(th.dataset.sortCol))
  );
  const _specRowEls = [...wrap.querySelectorAll('tr[data-spec-id]')];
  _specRowEls.forEach((row, idx) => {
    row.style.cursor = 'pointer';
    row.tabIndex = 0;
    row.addEventListener('click', e => {
      if (e.target.closest('[data-spec-status-id]')) return; // status badge handles its own click
      openSpecPanel(row.dataset.specId);
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSpecPanel(row.dataset.specId); }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (idx + 1 < _specRowEls.length) _specRowEls[idx + 1].focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx > 0) _specRowEls[idx - 1].focus(); }
    });
  });
  wrap.querySelectorAll('[data-spec-status-id]').forEach(badge => {
    badge.addEventListener('click', e => { e.stopPropagation(); cycleSpecStatus(badge.dataset.specStatusId); });
    badge.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); cycleSpecStatus(badge.dataset.specStatusId); }
    });
  });
}

function cycleSpecStatus(specId) {
  const s = ProjectData.specs.find(s => s.id === specId);
  if (!s) return;
  const cycle = { 'Achieved': 'Target', 'Target': 'TBD', 'TBD': 'Achieved' };
  s.status = cycle[s.status] || 'TBD';
  renderSpecTable();
  if (spCurrentType === 'spec' && spCurrentId === specId) openSpecPanel(specId);
}

// ─── SIDE PANEL – SPEC ───────────────────────────────────────────────────────
/** @param {string} specId - Opens the spec detail panel; second call on same ID toggles it closed. */
function openSpecPanel(specId) {
  if (spCurrentType === 'spec' && spCurrentId === specId) { closeSidePanel(); return; }
  spOpener = document.activeElement;
  const s = ProjectData.specs.find(s => s.id === specId);
  if (!s) return;
  const col = SPEC_COLORS[s.category] || { text:'#58a6ff' };
  document.getElementById('sp-title').textContent = s.name;

  const sc = s.status==='Achieved' ? 'badge-achieved' : s.status==='Target' ? 'badge-target' : 'badge-tbd';
  let html = `<div class="sp-meta">
    <div class="sp-meta-name"><span class="sp-name-edit" tabindex="0" title="Click to edit name" style="font-weight:600;cursor:text">${esc(s.name)}</span></div>
    <div class="sp-meta-id"><code class="sp-id-edit" tabindex="0" title="Click to edit spec ID" style="color:${col.text};cursor:text">${esc(s.id)}</code> · <span class="sp-cat-edit" tabindex="0" title="Click to edit category" style="color:${col.text};cursor:pointer">${esc(s.category)}</span> · <span class="sp-group-edit" tabindex="0" title="Click to edit group" style="cursor:text">${esc(s.group) || '<span style="color:var(--muted);font-style:italic">No group</span>'}</span></div>
    <div class="sp-meta-val"><span class="sp-val-edit" tabindex="0" title="Click to edit value" style="cursor:text">${s.value !== '' && s.value != null ? esc(String(s.value)) : '<span style="color:var(--muted);font-style:italic">Add value…</span>'}</span> <span class="sp-units-edit" tabindex="0" title="Click to edit units" style="font-size:0.85rem;font-weight:400;color:var(--muted);cursor:text">${esc(s.units)}</span></div>
    <span class="badge ${sc}">${esc(s.status)}</span>
    <div class="sp-notes-field${s.notes ? '' : ' empty'}" tabindex="0" role="button" aria-label="Edit spec notes">${s.notes ? esc(s.notes).replace(/\n/g,'<br>') : ''}</div>
  </div>`;

  const hasRisk = s.status === 'TBD' && s.depIds.some(id => {
    const t = ProjectData.tasks.find(t => t.id === id);
    return t && t.start && t.start <= TODAY;
  });
  if (hasRisk) html += `<div class="risk-alert">⚠ BLOCKED RISK — Spec is TBD but dependent task(s) have started</div>`;
  html += `<div class="sp-section-label">Dependent Tasks${s.depIds.length ? ` (${s.depIds.length})` : ''}</div>`;
  if (!s.depIds.length) {
    html += `<div class="no-deps">No task dependencies linked<br>to this specification.</div>`;
  } else {
    s.depIds.forEach(id => {
      const t = ProjectData.tasks.find(t => t.id === id);
      if (!t) {
        html += `<div class="task-card future"><div class="tc-id"><button class="sp-dep-rm" data-rm-spec-dep="${id}" aria-label="Remove task ${id}" title="Remove">×</button>Task ${id}</div><div class="tc-name" style="color:var(--muted)">Not found in Schedule</div></div>`;
        return;
      }
      const started = t.start && t.start <= TODAY;
      const done    = t.pct === 100;
      const cardCls = done ? 'done' : started && t.pct > 0 ? 'warn' : started ? 'risk' : 'future';
      const gc      = ganttColor(t.category);
      const showRisk = started && !done && s.status === 'TBD';
      html += `<div class="task-card clickable ${cardCls}" data-task-id="${t.id}">
        <div class="tc-id"><button class="sp-dep-rm" data-rm-spec-dep="${t.id}" aria-label="Remove task ${esc(t.wbs)} ${esc(t.name)}" title="Remove">×</button>Task ${t.id} · ${esc(t.wbs)} · <span style="color:${gc}">${esc(t.category)}</span></div>
        <div class="tc-name">${t.milestone ? '◆ ' : ''}${esc(t.name)}</div>
        <div class="tc-meta">${fmt(t.start)} → ${fmt(t.end)} · ${esc(t.team)} · ${t.pct}% complete</div>
        ${showRisk ? '<div class="tc-risk">⚠ Task active — spec not yet locked</div>' : ''}
      </div>`;
    });
  }
  html += `<button class="btn-secondary" id="sp-add-spec-dep-btn" style="width:100%;margin-top:4px;margin-bottom:4px" aria-expanded="false">+ Link task</button>
  <div id="sp-spec-dep-picker" class="sp-dep-picker" style="display:none" role="listbox" aria-label="Select a task to link">
    <input class="sp-dep-picker-input" type="text" placeholder="Search by name or WBS…" aria-label="Search tasks to link">
    <div class="sp-dep-list" id="sp-spec-dep-list"></div>
  </div>
  <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border)">
    <button class="btn-secondary btn-sm" id="sp-delete-spec-btn" style="width:100%" aria-label="Delete this specification">Delete Specification</button>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  spBody.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => openTaskPanel(+el.dataset.taskId));
  });

  // Spec dep × remove buttons
  spBody.querySelectorAll('[data-rm-spec-dep]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeSpecDep(s, +btn.dataset.rmSpecDep); });
  });

  // Inline field edits: name, id, category, value, units, group, notes
  [{ sel: '.sp-name-edit', fn: startSpecNameEdit }, { sel: '.sp-id-edit', fn: startSpecIdEdit },
   { sel: '.sp-cat-edit', fn: startSpecCategoryEdit },
   { sel: '.sp-val-edit', fn: startSpecValueEdit }, { sel: '.sp-units-edit', fn: startSpecUnitsEdit },
   { sel: '.sp-group-edit', fn: startSpecGroupEdit }]
    .forEach(({ sel, fn }) => {
      const el = spBody.querySelector(sel);
      if (!el) return;
      el.addEventListener('click', () => fn(el, s));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(el, s); });
    });
  const notesEl = spBody.querySelector('.sp-notes-field');
  if (notesEl) {
    notesEl.addEventListener('click', () => startSpecNotesEdit(notesEl, s));
    notesEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startSpecNotesEdit(notesEl, s); } });
  }

  wirePicker({ btnId: 'sp-add-spec-dep-btn', pickerId: 'sp-spec-dep-picker', listId: 'sp-spec-dep-list', buildFn: buildSpecDepPickerList, ref: s });

  const delSpecBtn = spBody.querySelector('#sp-delete-spec-btn');
  if (delSpecBtn) delSpecBtn.addEventListener('click', () => deleteSpec(s.id));

  spCurrentType = 'spec'; spCurrentId = specId;
  showSidePanel();

  // Wire title (sp-title) for name edit
  const titleEl = document.getElementById('sp-title');
  if (titleEl) {
    titleEl.style.cursor = 'text';
    titleEl.setAttribute('tabindex', '0');
    titleEl.setAttribute('title', 'Click to edit name');
    titleEl.addEventListener('click', () => startSpecNameEdit(titleEl, s));
    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') startSpecNameEdit(titleEl, s); });
  }
}

// ─── SIDE PANEL – TASK ───────────────────────────────────────────────────────
/** @param {number} taskId - Opens the task detail panel; second call on same ID toggles it closed. */
function openTaskPanel(taskId) {
  if (spCurrentType === 'task' && spCurrentId === taskId) { closeSidePanel(); return; }
  spOpener = document.activeElement;
  const t = ProjectData.tasks.find(t => t.id === taskId);
  if (!t) return;
  const gc = ganttColor(t.category);
  document.getElementById('sp-title').textContent = t.name;

  const started = t.start && t.start <= TODAY;
  const done = t.pct === 100;
  const statusBadge = done
    ? `<span class="badge badge-achieved">Complete</span>`
    : started
      ? `<span class="badge badge-target">${t.pct}% In Progress</span>`
      : `<span class="badge badge-tbd">Not Started</span>`;

  const totalWd = countWorkDays(t.start, t.end, ganttWorkDays);
  const remWd   = workDaysRemaining(t.end, ganttWorkDays, TODAY);
  let html = `<div class="sp-meta">
    <div class="sp-meta-id">
      <code style="color:${gc}">Task ${t.id}</code> · WBS ${esc(t.wbs)} · <span style="color:${gc}">${esc(t.category)}</span>
      ${t.milestone ? ' · <strong>◆ MILESTONE</strong>' : ''}
    </div>
    <div class="sp-meta-val" style="font-size:1rem">${esc(t.team)}</div>
    ${statusBadge}
    <div class="sp-meta-notes">
      <strong>Start:</strong> ${fmt(t.start)} &nbsp;·&nbsp; <strong>End:</strong> ${fmt(t.end)}<br>
      <strong>Work Days:</strong> ${totalWd} total &nbsp;·&nbsp; ${t.pct === 100 ? '<span style="color:var(--success)">Complete ✓</span>' : remWd > 0 ? remWd + ' remaining' : '<span style="color:var(--danger)">Overdue</span>'}
    </div>
    <div class="sp-notes-field${t.notes ? '' : ' empty'}" tabindex="0" role="button" aria-label="Edit task notes">${t.notes ? esc(t.notes).replace(/\n/g,'<br>') : ''}</div>
  </div>`;

  // Dependencies (tasks this one depends on)
  html += `<div class="sp-section-label">Depends On${t.deps.length ? ` (${t.deps.length})` : ''}</div>`;
  t.deps.forEach(id => {
    const dep = ProjectData.tasks.find(d => d.id === id);
    if (!dep) {
      html += `<div class="task-card future"><div class="tc-id"><button class="sp-dep-rm" data-rm-dep="${id}" aria-label="Remove dependency" title="Remove dependency">×</button>Task ${id}</div><div class="tc-name" style="color:var(--muted)">Not found</div></div>`;
      return;
    }
    const dc = ganttColor(dep.category);
    const hasConflict = dep.end && t.start && t.start < dep.end;
    html += `<div class="task-card clickable ${dep.pct===100?'done':'future'}" data-task-id="${dep.id}">
      <div class="tc-id"><button class="sp-dep-rm" data-rm-dep="${dep.id}" aria-label="Remove dependency: ${esc(dep.wbs)} ${esc(dep.name)}" title="Remove dependency">×</button>Task ${dep.id} · ${esc(dep.wbs)} · <span style="color:${dc}">${esc(dep.category)}</span></div>
      <div class="tc-name">${esc(dep.name)}</div>
      <div class="tc-meta">${fmt(dep.start)} → ${fmt(dep.end)} · ${dep.pct}% complete</div>
      ${hasConflict ? `<div class="tc-risk" style="color:var(--warning)">⚠ Starts before predecessor ends (${fmt(dep.end)})</div>` : ''}
    </div>`;
  });
  html += `<button class="btn-secondary" id="sp-add-dep-btn" style="width:100%;margin-top:4px;margin-bottom:4px" aria-expanded="false">+ Add dependency</button>
  <div id="sp-dep-picker" class="sp-dep-picker" style="display:none" role="listbox" aria-label="Select a task to add as dependency">
    <input class="sp-dep-picker-input" type="text" placeholder="Search by name or WBS…" aria-label="Search tasks to add as dependency">
    <div class="sp-dep-list" id="sp-dep-list"></div>
  </div>`;

  // Linked specs
  const linkedSpecs = ProjectData.specs.filter(s => s.depIds.includes(t.id));
  html += `<div class="sp-section-label" style="margin-top:16px">Linked Specifications${linkedSpecs.length ? ` (${linkedSpecs.length})` : ''}</div>`;
  if (!linkedSpecs.length) {
    html += `<div class="no-deps">No specifications linked<br>to this task.</div>`;
  } else {
    linkedSpecs.forEach(s => {
      const sc = s.status==='Achieved' ? 'badge-achieved' : s.status==='Target' ? 'badge-target' : 'badge-tbd';
      const col = SPEC_COLORS[s.category] || { text:'#58a6ff' };
      const hasRisk = s.status === 'TBD' && started && !done;
      html += `<div class="task-card clickable ${hasRisk?'risk':'future'}" data-spec-id="${esc(s.id)}">
        <div class="tc-id"><button class="sp-dep-rm" data-rm-spec-link="${esc(s.id)}" aria-label="Unlink ${esc(s.id)}" title="Unlink">×</button><code style="color:${col.text}">${esc(s.id)}</code> · ${esc(s.category)}</div>
        <div class="tc-name">${esc(s.name)}</div>
        <div class="tc-meta">${esc(s.value)} ${esc(s.units)} &nbsp; <span class="badge ${sc}">${esc(s.status)}</span></div>
        ${hasRisk ? '<div class="tc-risk">⚠ Spec not locked while task is active</div>' : ''}
      </div>`;
    });
  }
  html += `<button class="btn-secondary" id="sp-add-spec-link-btn" style="width:100%;margin-top:4px;margin-bottom:4px" aria-expanded="false">+ Link specification</button>
  <div id="sp-spec-link-picker" class="sp-dep-picker" style="display:none" role="listbox" aria-label="Select a specification to link">
    <input class="sp-dep-picker-input" type="text" placeholder="Search by ID, category, or name…" aria-label="Search specifications to link">
    <div class="sp-dep-list" id="sp-spec-link-list"></div>
  </div>
  <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border)">
    <button class="btn-secondary btn-sm" id="sp-delete-task-btn" style="width:100%" aria-label="Delete this task">Delete Task</button>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;

  // Task cards → open task panel
  spBody.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => openTaskPanel(+el.dataset.taskId));
  });
  // Spec cards → open spec panel (stop propagation handled by × button)
  spBody.querySelectorAll('[data-spec-id]').forEach(el => {
    el.addEventListener('click', () => openSpecPanel(el.dataset.specId));
  });

  // Notes: click or keyboard activates inline edit
  const notesEl = spBody.querySelector('.sp-notes-field');
  if (notesEl) {
    notesEl.addEventListener('click', () => startNotesEdit(notesEl, t));
    notesEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startNotesEdit(notesEl, t); }
    });
  }

  // Dep × remove buttons
  spBody.querySelectorAll('[data-rm-dep]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeDep(t, +btn.dataset.rmDep); });
  });

  // Spec link × remove buttons
  spBody.querySelectorAll('[data-rm-spec-link]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const spec = ProjectData.specs.find(s => s.id === btn.dataset.rmSpecLink);
      if (spec) removeSpecLink(spec, t.id);
    });
  });

  wirePicker({ btnId: 'sp-add-dep-btn', pickerId: 'sp-dep-picker', listId: 'sp-dep-list', buildFn: buildDepPickerList, ref: t, itemSelector: '.sp-dep-item:not(.cycle)' });

  wirePicker({ btnId: 'sp-add-spec-link-btn', pickerId: 'sp-spec-link-picker', listId: 'sp-spec-link-list', buildFn: buildSpecLinkPickerList, ref: t });

  const delTaskBtn = spBody.querySelector('#sp-delete-task-btn');
  if (delTaskBtn) delTaskBtn.addEventListener('click', () => deleteTask(t.id));

  spCurrentType = 'task'; spCurrentId = taskId;
  showSidePanel();
}

// ─── SIDE PANEL – ORG PERSON ─────────────────────────────────────────────────
/** @param {string} name - Person's name key; opens their profile panel or toggles it closed. */
function openOrgPanel(name) {
  if (spCurrentType === 'org' && spCurrentId === name) { closeSidePanel(); return; }
  spOpener = document.activeElement;
  const person = ProjectData.org.find(p => p.name === name);
  if (!person) return;
  const col = teamColor(person.team);
  document.getElementById('sp-title').textContent = person.name;

  let html = `<div class="sp-meta">
    <div class="sp-meta-id" style="color:${col};font-weight:700">${esc(person.team) || 'No Team'}</div>
    <div class="sp-meta-val" style="font-size:1rem">${esc(person.title) || '—'}</div>
    ${person.email ? `<div class="sp-meta-notes">${esc(person.email)}</div>` : ''}
    ${person.reportsTo.length ? `<div class="sp-meta-notes"><strong>Reports to:</strong> ${person.reportsTo.map(r => esc(r)).join(', ')}</div>` : ''}
  </div>`;

  // Direct reports
  const reports = ProjectData.org.filter(p => p.reportsTo.includes(name));
  if (reports.length) {
    html += `<div class="sp-section-label">Direct Reports (${reports.length})</div>`;
    reports.forEach(r => {
      const rc = teamColor(r.team);
      html += `<div class="task-card clickable future" data-org-name="${esc(r.name)}">
        <div class="tc-id" style="color:${rc}">${esc(r.team)}</div>
        <div class="tc-name">${esc(r.name)}</div>
        <div class="tc-meta">${esc(r.title)}</div>
      </div>`;
    });
  }

  // Tasks owned by this person's team
  const myTasks = ProjectData.tasks.filter(t => t.team === person.team);
  if (myTasks.length) {
    html += `<div class="sp-section-label" style="margin-top:16px">Team Tasks (${myTasks.length})</div>`;
    myTasks.forEach(t => {
      const gc = ganttColor(t.category);
      const done2 = t.pct === 100;
      const started2 = t.start && t.start <= TODAY;
      const cardCls = done2 ? 'done' : started2 && t.pct > 0 ? 'warn' : started2 ? 'risk' : 'future';
      html += `<div class="task-card clickable ${cardCls}" data-task-id="${t.id}">
        <div class="tc-id">Task ${t.id} · ${esc(t.wbs)} · <span style="color:${gc}">${esc(t.category)}</span></div>
        <div class="tc-name">${t.milestone ? '◆ ' : ''}${esc(t.name)}</div>
        <div class="tc-meta">${fmt(t.start)} → ${fmt(t.end)} · ${t.pct}% complete</div>
      </div>`;
    });
  } else {
    html += `<div class="no-deps">No tasks assigned to the ${esc(person.team)} team.</div>`;
  }

  html += `<div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border)">
    <button class="btn-secondary btn-sm" id="org-edit-person-btn" style="width:100%">Edit Person</button>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  spBody.querySelectorAll('[data-org-name]').forEach(el => {
    el.addEventListener('click', () => openOrgPanel(el.dataset.orgName));
  });
  spBody.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => openTaskPanel(+el.dataset.taskId));
  });
  spBody.querySelector('#org-edit-person-btn').addEventListener('click', () => openOrgEditPanel(name));
  spCurrentType = 'org'; spCurrentId = name;
  showSidePanel();
}

// ─── ORG CHART EDITING ────────────────────────────────────────────────────────
/** @param {string|null} name - Person's current name, or null to create a new person. */
function openOrgEditPanel(name) {
  const person = name ? ProjectData.org.find(p => p.name === name) : null;
  const isNew  = !person;
  spOpener = spOpener || document.activeElement;
  document.getElementById('sp-title').textContent = isNew ? 'Add Person' : `Edit: ${person.name}`;

  const allTeams = [...new Set(ProjectData.org.map(p => p.team).filter(Boolean))].sort();
  const teamDl   = allTeams.map(t => `<option>${esc(t)}</option>`).join('');

  const html = `<div class="sp-meta" style="padding:14px 14px 4px">
    <div class="sp-form-group">
      <label class="sp-form-label" for="org-edit-name">Name</label>
      <input class="sp-form-input" id="org-edit-name" type="text" value="${esc(person ? person.name : '')}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="org-edit-title">Title / Role</label>
      <input class="sp-form-input" id="org-edit-title" type="text" value="${esc(person ? person.title : '')}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="org-edit-team">Team</label>
      <input class="sp-form-input" id="org-edit-team" type="text" list="org-team-dl" value="${esc(person ? person.team : '')}">
      <datalist id="org-team-dl">${teamDl}</datalist>
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="org-edit-reports">Reports To <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:0.7rem">(comma-separated)</span></label>
      <input class="sp-form-input" id="org-edit-reports" type="text" value="${esc(person ? person.reportsTo.join(', ') : '')}">
    </div>
    <div class="sp-form-group">
      <label class="sp-form-label" for="org-edit-email">Email</label>
      <input class="sp-form-input" id="org-edit-email" type="email" value="${esc(person ? person.email : '')}">
    </div>
  </div>
  <div style="padding:0 16px">
    <button class="btn-primary" id="org-save-btn" style="width:100%;margin-bottom:8px">${isNew ? 'Add Person' : 'Save Changes'}</button>
    ${!isNew ? `<button class="btn-secondary btn-sm" id="org-cancel-btn" style="width:100%;margin-bottom:8px">Cancel</button>
    <div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn-secondary btn-sm" id="org-delete-btn" style="width:100%">Delete Person</button>
    </div>` : ''}
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  document.getElementById('org-save-btn').addEventListener('click', () => saveOrgPerson(name));
  if (!isNew) {
    document.getElementById('org-cancel-btn').addEventListener('click', () => openOrgPanel(name));
    document.getElementById('org-delete-btn').addEventListener('click', () => deleteOrgPerson(name));
  }

  if (!spCurrentType) { spCurrentType = 'org'; spCurrentId = name; showSidePanel(); }
}

function saveOrgPerson(oldName) {
  const newName    = document.getElementById('org-edit-name').value.trim();
  const newTitle   = document.getElementById('org-edit-title').value.trim();
  const newTeam    = document.getElementById('org-edit-team').value.trim();
  const newReports = document.getElementById('org-edit-reports').value.split(',').map(s => s.trim()).filter(Boolean);
  const newEmail   = document.getElementById('org-edit-email').value.trim();
  if (!newName) { showToast('Name is required'); return; }

  pushUndo(oldName ? 'edit org person' : 'add org person');

  if (oldName) {
    const person = ProjectData.org.find(p => p.name === oldName);
    if (!person) return;
    if (newName !== oldName) {
      ProjectData.org.forEach(p => { p.reportsTo = p.reportsTo.map(r => r === oldName ? newName : r); });
    }
    person.name = newName; person.title = newTitle; person.team = newTeam;
    person.reportsTo = newReports; person.email = newEmail;
  } else {
    ProjectData.org.push({ name: newName, title: newTitle, team: newTeam, reportsTo: newReports, email: newEmail });
    document.getElementById('org-tab-btn').style.display = '';
  }

  spCurrentType = null;
  safeRender(renderOrgChart, 'Org Chart');
  openOrgPanel(newName);
  showToast(oldName ? 'Person updated' : `${newName} added`);
}

function deleteOrgPerson(name) {
  const btn = document.getElementById('org-delete-btn');
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1'; btn.textContent = 'Tap again to confirm delete';
    btn.style.background = 'var(--danger)'; btn.style.color = '#fff';
    setTimeout(() => { if (btn.dataset.confirming) { btn.dataset.confirming = ''; btn.textContent = 'Delete Person'; btn.style.background = ''; btn.style.color = ''; } }, 3000);
    return;
  }
  pushUndo('delete org person');
  ProjectData.org = ProjectData.org.filter(p => p.name !== name);
  ProjectData.org.forEach(p => { p.reportsTo = p.reportsTo.filter(r => r !== name); });
  closeSidePanel();
  if (!ProjectData.org.length) document.getElementById('org-tab-btn').style.display = 'none';
  else safeRender(renderOrgChart, 'Org Chart');
  showToast('Person deleted · undo with Ctrl+Z');
}

// ─── PROJECT INFO EDITING ─────────────────────────────────────────────────────
/** Opens the project info editor in the side panel. Second call closes it (toggle). */
function openInfoPanel() {
  if (spCurrentType === 'info') { closeSidePanel(); return; }
  spOpener = document.activeElement;
  document.getElementById('sp-title').textContent = 'Project Info';

  const STANDARD = ['Project Title','Project Subtitle','File Administrator','Program Start','Program End','Work Days','Weight Unit'];
  const PHASES   = Array.from({ length: 10 }, (_, i) => `Phase ${i + 1} Name`);
  const extraKeys = Object.keys(ProjectData.info).filter(k => !STANDARD.includes(k) && !PHASES.includes(k));

  const field = (key) => `<div class="sp-form-group" data-info-key="${esc(key)}">
    <label class="sp-form-label">${esc(key)}</label>
    <input class="sp-form-input info-edit-input" type="text" value="${esc(String(ProjectData.info[key] || ''))}">
  </div>`;

  let html = `<div class="sp-meta" style="padding:14px 14px 4px">
    ${STANDARD.map(field).join('')}
    <div class="sp-section-label" style="margin:8px 0 6px">Phase Names</div>
    ${PHASES.map(field).join('')}
  </div>`;

  if (extraKeys.length) {
    html += `<div class="sp-section-label" style="margin:8px 16px 6px">Other Fields</div>
    <div class="sp-meta" style="padding:14px 14px 4px;margin:0 16px">
      ${extraKeys.map(field).join('')}
    </div>`;
  }

  html += `<div style="padding:0 16px;margin-top:8px">
    <button class="btn-primary" id="info-save-btn" style="width:100%">Save Changes</button>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  document.getElementById('info-save-btn').addEventListener('click', saveInfoPanel);
  spCurrentType = 'info'; spCurrentId = null;
  showSidePanel();
}

function saveInfoPanel() {
  pushUndo('edit project info');
  document.querySelectorAll('#sp-body [data-info-key]').forEach(group => {
    const key = group.dataset.infoKey;
    const val = group.querySelector('.info-edit-input').value.trim();
    if (val) ProjectData.info[key] = val; else delete ProjectData.info[key];
  });
  const wd = ProjectData.info['Work Days'];
  if (wd) { ganttWorkDays = parseWorkDays(String(wd)); safeSetItem('vh-workdays', JSON.stringify(ganttWorkDays)); }
  const title    = ProjectData.info['Project Title']      || 'Vehicle Design Dashboard';
  const subtitle = ProjectData.info['Project Subtitle']   || '';
  const admin    = ProjectData.info['File Administrator'] || '';
  const subParts = [subtitle, admin ? 'File Admin: ' + admin : ''].filter(Boolean);
  document.getElementById('project-title').textContent    = title;
  document.getElementById('project-subtitle').textContent = subParts.join(' · ') || 'Project Dashboard';
  document.title = title + ' — Program Dashboard';
  safeRender(renderGantt,    'Gantt Chart');
  safeRender(renderProgDash, 'Program Dashboard');
  showToast('Project info saved');
}

function showSidePanel() {
  document.getElementById('side-panel').classList.add('open');
  const onOrg   = document.getElementById('org-panel').classList.contains('active');
  const onGantt = document.getElementById('gantt-panel').classList.contains('active');
  document.getElementById('org-container').style.paddingRight  = onOrg   ? '440px' : '';
  document.getElementById('gantt-right-col').style.marginRight  = onGantt ? '440px' : '';
  requestAnimationFrame(() => {
    const panel = document.getElementById('side-panel');
    const first = panel.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
  });
}

function closeSidePanel() {
  document.getElementById('side-panel').classList.remove('open');
  document.getElementById('org-container').style.paddingRight = '';
  document.getElementById('gantt-right-col').style.marginRight = '';
  spCurrentType = null;
  spCurrentId   = null;
  if (spOpener && typeof spOpener.focus === 'function') { spOpener.focus(); }
  spOpener = null;
}

// ─── ORG CHART ───────────────────────────────────────────────────────────────
const NW = 180, NH = 72, HG = 28, VG = 80;

function calcSubW(node) {
  if (!node.children.length) return NW;
  const total = node.children.reduce((s, c) => s + calcSubW(c), 0);
  return Math.max(NW, total + HG * (node.children.length - 1));
}

function assignPos(node, left, depth) {
  node.y = depth * (NH + VG);
  const sw = calcSubW(node);
  node.x = left + (sw - NW) / 2;
  if (node.children.length) {
    let childLeft = left;
    node.children.forEach(c => {
      const csw = calcSubW(c);
      assignPos(c, childLeft, depth + 1);
      childLeft += csw + HG;
    });
  }
}

function renderOrgChart() {
  const empty = document.getElementById('org-empty');
  const container = document.getElementById('org-container');

  if (!ProjectData.org.length) {
    empty.style.display = 'flex';
    container.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  container.style.display = 'block';

  // Build tree (filtered by search query when active; ancestors included to preserve hierarchy)
  const q = orgSearchQuery.toLowerCase();
  let orgData = ProjectData.org;
  const matchedNames = new Set();
  if (q) {
    const matched = ProjectData.org.filter(p =>
      [p.name, p.title, p.team, p.email].some(v => v && v.toLowerCase().includes(q)));
    const ancestorSet = new Set();
    matched.forEach(p => {
      matchedNames.add(p.name);
      ancestorSet.add(p.name);
      let cur = p;
      while (cur.reportsTo && cur.reportsTo[0]) {
        const parent = ProjectData.org.find(x => x.name === cur.reportsTo[0]);
        if (!parent || ancestorSet.has(parent.name)) break;
        ancestorSet.add(parent.name);
        cur = parent;
      }
    });
    orgData = ProjectData.org.filter(p => ancestorSet.has(p.name));
  }
  const nodeMap = {};
  orgData.forEach(p => { nodeMap[p.name] = { ...p, children: [] }; });
  const roots = [];
  orgData.forEach(p => {
    const primary = p.reportsTo[0];
    if (primary && nodeMap[primary]) nodeMap[primary].children.push(nodeMap[p.name]);
    else roots.push(nodeMap[p.name]);
  });

  // Layout
  let offsetX = 20;
  roots.forEach(r => {
    const sw = calcSubW(r);
    assignPos(r, offsetX, 0);
    offsetX += sw + HG * 2;
  });

  const allNodes = Object.values(nodeMap);
  const svgW = Math.max(...allNodes.map(n => n.x + NW)) + 40;
  const svgH = Math.max(...allNodes.map(n => n.y + NH)) + 40;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.style.display = 'block';

  const isLightOrg = document.body.classList.contains('light-mode');
  const cardBg      = isLightOrg ? '#f4f2ef'           : '#161b22';
  const cardBorder  = isLightOrg ? 'rgba(0,0,0,0.08)'  : 'rgba(88,166,255,0.25)';
  const nameFill    = isLightOrg ? '#1f2328'            : '#e6edf3';
  const titleFill   = isLightOrg ? '#636c76'            : '#8b949e';

  // Drop shadow filter (light mode only)
  const defs = document.createElementNS(NS, 'defs');
  if (isLightOrg) {
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'card-shadow');
    filter.setAttribute('x', '-10%'); filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%'); filter.setAttribute('height', '130%');
    const shadow = document.createElementNS(NS, 'feDropShadow');
    shadow.setAttribute('dx', '0'); shadow.setAttribute('dy', '1');
    shadow.setAttribute('stdDeviation', '2.5');
    shadow.setAttribute('flood-color', 'rgba(0,0,0,0.10)');
    filter.appendChild(shadow);
    defs.appendChild(filter);
  }
  svg.appendChild(defs);

  // Draw primary edges
  allNodes.forEach(node => {
    node.children.forEach(child => {
      const x1 = node.x + NW/2, y1 = node.y + NH;
      const x2 = child.x + NW/2, y2 = child.y;
      const midY = (y1 + y2) / 2;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', cardBorder);
      path.setAttribute('stroke-width', '1.5');
      svg.appendChild(path);
    });
  });

  // Draw secondary (dotted-line) reporting edges
  allNodes.forEach(node => {
    node.reportsTo.slice(1).forEach(secName => {
      const parent = nodeMap[secName];
      if (!parent) return;
      const x1 = parent.x + NW/2, y1 = parent.y + NH;
      const x2 = node.x + NW/2,   y2 = node.y;
      const midY = (y1 + y2) / 2;
      const sec = document.createElementNS(NS, 'path');
      sec.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      sec.setAttribute('fill', 'none');
      sec.setAttribute('stroke', isLightOrg ? 'rgba(0,0,0,0.22)' : 'rgba(139,148,158,0.45)');
      sec.setAttribute('stroke-width', '1.5');
      sec.setAttribute('stroke-dasharray', '5,3');
      svg.appendChild(sec);
    });
  });

  // Draw nodes
  allNodes.forEach(node => {
    const nx = node.x, ny = node.y;
    const col = teamColor(node.team);

    // Card
    const card = document.createElementNS(NS, 'g');
    card.style.cursor = 'pointer';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${node.name}${node.title ? ', ' + node.title : ''}${node.team ? ', ' + node.team + ' team' : ''}`);
    card.addEventListener('click', () => openOrgPanel(node.name));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrgPanel(node.name); } });

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', nx); rect.setAttribute('y', ny);
    rect.setAttribute('width', NW); rect.setAttribute('height', NH);
    rect.setAttribute('rx', 8); rect.setAttribute('fill', cardBg);
    rect.setAttribute('stroke', col); rect.setAttribute('stroke-width', '1.5');
    if (isLightOrg) rect.setAttribute('filter', 'url(#card-shadow)');
    card.appendChild(rect);

    // Hover effect — team-color tint in light mode, dark lift in dark mode
    const cardBgHover = isLightOrg ? col + '14' : '#1c2128';
    card.addEventListener('mouseenter', () => rect.setAttribute('fill', cardBgHover));
    card.addEventListener('mouseleave', () => rect.setAttribute('fill', cardBg));

    // Name (highlight if this node matched the search query)
    const isMatch = matchedNames.has(node.name);
    const nameEl = document.createElementNS(NS, 'text');
    nameEl.setAttribute('x', nx + NW/2); nameEl.setAttribute('y', ny + 24);
    nameEl.setAttribute('text-anchor', 'middle');
    nameEl.setAttribute('fill', isMatch ? 'var(--accent)' : nameFill);
    nameEl.setAttribute('font-size', '12');
    nameEl.setAttribute('font-weight', '700');
    nameEl.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
    nameEl.textContent = node.name.length > 22 ? node.name.slice(0,21)+'…' : node.name;
    card.appendChild(nameEl);

    // Title
    const titleEl = document.createElementNS(NS, 'text');
    titleEl.setAttribute('x', nx + NW/2); titleEl.setAttribute('y', ny + 40);
    titleEl.setAttribute('text-anchor', 'middle');
    titleEl.setAttribute('fill', titleFill); titleEl.setAttribute('font-size', '10');
    titleEl.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
    titleEl.textContent = node.title.length > 26 ? node.title.slice(0,25)+'…' : node.title;
    card.appendChild(titleEl);

    // Team badge
    if (node.team) {
      const label = node.team.length > 14 ? node.team.slice(0,13)+'…' : node.team;
      const badgeW = label.length * 6.5 + 14;
      const bx = nx + NW/2 - badgeW/2, by2 = ny + NH - 20;
      const badgeBg = document.createElementNS(NS, 'rect');
      badgeBg.setAttribute('x', bx); badgeBg.setAttribute('y', by2);
      badgeBg.setAttribute('width', badgeW); badgeBg.setAttribute('height', 14);
      badgeBg.setAttribute('rx', 3);
      badgeBg.setAttribute('fill', col + '28');
      card.appendChild(badgeBg);
      const badgeT = document.createElementNS(NS, 'text');
      badgeT.setAttribute('x', nx + NW/2); badgeT.setAttribute('y', by2 + 10);
      badgeT.setAttribute('text-anchor', 'middle');
      badgeT.setAttribute('fill', col); badgeT.setAttribute('font-size', '8.5');
      badgeT.setAttribute('font-weight', '700');
      badgeT.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
      badgeT.setAttribute('letter-spacing', '0.05em');
      badgeT.textContent = label.toUpperCase();
      card.appendChild(badgeT);
    }

    svg.appendChild(card);
  });

  document.getElementById('org-svg-wrap').innerHTML = '';
  document.getElementById('org-svg-wrap').appendChild(svg);

  // Drag-pan for org container — guarded so listeners are attached once only
  if (!orgPanListenersAttached) {
    orgPanListenersAttached = true;
    container.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      oDragging = true;
      oDragX = e.pageX; oDragY = e.pageY;
      oDragSL = container.scrollLeft; oDragST = container.scrollTop;
      container.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!oDragging) return;
      container.scrollLeft = oDragSL - (e.pageX - oDragX);
      container.scrollTop  = oDragST - (e.pageY - oDragY);
    });
    document.addEventListener('mouseup', () => {
      if (!oDragging) return;
      oDragging = false;
      container.classList.remove('dragging');
    });
  }
}

// generateSampleExcel is imported from ./excel.js

// ─── Init: restore persisted zoom indices and work days button label ──────────
(function initPersistedState() {
  const savedGanttZoom = parseInt(localStorage.getItem('vh-zoom-gantt'));
  if (!isNaN(savedGanttZoom) && savedGanttZoom >= 0 && savedGanttZoom < ZOOM_STEPS.length) {
    zoomIdx   = savedGanttZoom;
    ganttZoom = ZOOM_STEPS[zoomIdx];
    document.getElementById('zoom-label').textContent = Math.round((ganttZoom / 4) * 100) + '%';
  }
  const savedSpecsZoom = parseInt(localStorage.getItem('vh-zoom-specs'));
  if (!isNaN(savedSpecsZoom) && savedSpecsZoom >= 0 && savedSpecsZoom < SPECS_ZOOM_STEPS.length) {
    specsZoomIdx = savedSpecsZoom;
    document.getElementById('specs-zoom-label').textContent = Math.round((SPECS_ZOOM_STEPS[specsZoomIdx] / 0.84) * 100) + '%';
  }
  const savedOrgZoom = parseInt(localStorage.getItem('vh-zoom-org'));
  if (!isNaN(savedOrgZoom) && savedOrgZoom >= 0 && savedOrgZoom < ORG_ZOOM_STEPS.length) {
    orgZoomIdx = savedOrgZoom;
    document.getElementById('org-zoom-label').textContent = Math.round(ORG_ZOOM_STEPS[orgZoomIdx] * 100) + '%';
  }
  // Restore CP toggle state
  if (localStorage.getItem('vh-show-cp') === '1') {
    showCriticalPath = true;
    const cpBtn = document.getElementById('gantt-cp-btn');
    if (cpBtn) cpBtn.setAttribute('aria-pressed', 'true');
  }

  // Sync work days button label
  const wdBtn = document.getElementById('workdays-btn');
  if (wdBtn) wdBtn.textContent = workdaysSummary(ganttWorkDays) + ' ▾';

  // Wire org search input
  let _orgSearchTimer = null;
  const osInput = document.getElementById('org-search');
  const osClear = document.getElementById('org-search-clear');
  if (osInput) {
    osInput.addEventListener('input', () => {
      orgSearchQuery = osInput.value;
      if (osClear) osClear.style.display = orgSearchQuery ? 'block' : 'none';
      clearTimeout(_orgSearchTimer);
      _orgSearchTimer = setTimeout(renderOrgChart, 200);
    });
    osInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { orgSearchQuery = ''; osInput.value = ''; if (osClear) osClear.style.display = 'none'; renderOrgChart(); }
    });
  }

  // Wire spec search input
  let _specSearchTimer = null;
  const ssInput = document.getElementById('specs-search');
  const ssClear = document.getElementById('specs-search-clear');
  if (ssInput) {
    ssInput.addEventListener('input', () => {
      specSearchQuery = ssInput.value;
      safeSetItem('vh-filter-specs-search', specSearchQuery);
      if (ssClear) ssClear.style.display = specSearchQuery ? 'block' : 'none';
      clearTimeout(_specSearchTimer);
      _specSearchTimer = setTimeout(renderSpecTable, 200);
    });
    ssInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        specSearchQuery = ''; ssInput.value = '';
        localStorage.removeItem('vh-filter-specs-search');
        if (ssClear) ssClear.style.display = 'none'; renderSpecTable();
      }
    });
    // Restore saved spec search query on page load
    const savedSearch = localStorage.getItem('vh-filter-specs-search') || '';
    if (savedSearch) { ssInput.value = savedSearch; specSearchQuery = savedSearch; if (ssClear) ssClear.style.display = 'block'; }
  }

  // Restore saved Gantt phase and team filter on page load
  const _savedPhase = localStorage.getItem('vh-filter-phase');
  if (_savedPhase) ganttPhaseFilter = _savedPhase;
  const _savedTeam = localStorage.getItem('vh-filter-team');
  if (_savedTeam) ganttTeamFilter = _savedTeam;
})();

// ─── WIRE STATIC UI EVENT HANDLERS ──────────────────────────────────────────
// (replaces inline onclick/onchange attributes removed from HTML in v1.26.0)

// Tab buttons — wire all at once via data-tab attribute
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn, btn.dataset.tab));
});

// Topbar buttons
document.getElementById('generate-sample-btn').addEventListener('click', generateSampleExcel);
document.getElementById('save-excel-btn').addEventListener('click', saveToExcel);
document.getElementById('help-btn').addEventListener('click', toggleHelp);
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// Gantt filters
document.getElementById('gantt-phase-filter').addEventListener('change', e => setGanttPhaseFilter(e.target.value));
document.getElementById('gantt-team-filter').addEventListener('change', e => setGanttTeamFilter(e.target.value));

// Gantt toolbar buttons
document.getElementById('gantt-zoom-out-btn').addEventListener('click', () => adjustZoom(-1));
document.getElementById('gantt-zoom-in-btn').addEventListener('click', () => adjustZoom(1));
document.getElementById('legend-btn').addEventListener('click', toggleGanttLegend);
document.getElementById('gantt-cp-btn').addEventListener('click', toggleCriticalPath);
document.getElementById('cal-toggle-btn').addEventListener('click', toggleGanttCalendar);
document.getElementById('workdays-btn').addEventListener('click', toggleWorkdaysPicker);
document.getElementById('gantt-export-svg-btn').addEventListener('click', exportGanttSVG);
document.getElementById('gantt-export-png-btn').addEventListener('click', exportGanttPNG);
document.getElementById('gantt-undo-btn').addEventListener('click', applyUndo);
document.getElementById('gantt-redo-btn').addEventListener('click', applyRedo);
document.getElementById('gantt-add-task-btn').addEventListener('click', addGanttTask);
document.getElementById('gantt-reset-btn').addEventListener('click', resetGanttToImported);

// Specs toolbar
document.getElementById('specs-filter').addEventListener('change', e => setSpecsCategoryFilter(e.target.value));
document.getElementById('specs-search-clear').addEventListener('click', () => {
  specSearchQuery = '';
  document.getElementById('specs-search').value = '';
  renderSpecTable();
});
document.getElementById('specs-add-btn').addEventListener('click', addNewSpec);
document.getElementById('specs-zoom-out-btn').addEventListener('click', () => adjustSpecsZoom(-1));
document.getElementById('specs-zoom-in-btn').addEventListener('click', () => adjustSpecsZoom(1));

// Org toolbar
document.getElementById('org-zoom-out-btn').addEventListener('click', () => adjustOrgZoom(-1));
document.getElementById('org-zoom-in-btn').addEventListener('click', () => adjustOrgZoom(1));
document.getElementById('org-search-clear').addEventListener('click', () => {
  orgSearchQuery = '';
  document.getElementById('org-search').value = '';
  renderOrgChart();
});

// Weight budget, org chart, and project info editing
document.getElementById('weight-add-btn').addEventListener('click', addWeightRow);
document.getElementById('org-add-btn').addEventListener('click', () => openOrgEditPanel(null));
document.getElementById('proj-info-btn').addEventListener('click', openInfoPanel);

// Side panel and modals
document.getElementById('sp-close').addEventListener('click', closeSidePanel);
document.getElementById('help-modal-close-btn').addEventListener('click', toggleHelp);

// Focus trap for side panel — keeps Tab/Shift+Tab within the panel while it is open
document.getElementById('side-panel').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const panel = document.getElementById('side-panel');
  if (!panel.classList.contains('open')) return;
  const focusable = [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// Warn before closing with unsaved edits
window.addEventListener('beforeunload', e => {
  if (isDirty) { e.preventDefault(); return (e.returnValue = ''); }
});

// Draft restore on page load
(function checkForDraft() {
  const raw = localStorage.getItem('vh-draft');
  if (!raw) return;
  let draft;
  try { draft = JSON.parse(raw); } catch { localStorage.removeItem('vh-draft'); return; }
  if (!draft.snapshot || !draft.snapshot.tasks) { localStorage.removeItem('vh-draft'); return; }

  const banner = document.getElementById('draft-banner');
  const mins = Math.round((Date.now() - draft.savedAt) / 60000);
  const timeStr = mins < 1 ? 'just now' : mins < 60 ? mins + 'm ago' : Math.round(mins / 60) + 'h ago';
  document.getElementById('draft-title').textContent = draft.title || 'Untitled';
  document.getElementById('draft-time').textContent  = '— saved ' + timeStr;
  banner.style.display = 'flex';

  document.getElementById('draft-restore-btn').addEventListener('click', () => {
    const snap = draft.snapshot;
    snap.tasks.forEach(t => {
      if (t.start) t.start = new Date(t.start);
      if (t.end)   t.end   = new Date(t.end);
    });
    ProjectData.tasks   = snap.tasks;
    ProjectData.specs   = snap.specs   || [];
    ProjectData.org     = snap.org     || [];
    ProjectData.weights = snap.weights || [];
    ProjectData.info    = snap.info    || {};
    originalTasks = ProjectData.tasks.map(t => ({ ...t, deps: [...(t.deps || [])] }));
    recalcWBS(ProjectData.tasks);
    isDirty = true;
    renderDashboard();
    banner.style.display = 'none';
    showToast('Draft restored — export to Excel to save permanently');
  });

  document.getElementById('draft-dismiss-btn').addEventListener('click', () => {
    localStorage.removeItem('vh-draft');
    banner.style.display = 'none';
  });
})();

// Browser compatibility check
(function() {
  const supported = typeof Promise !== 'undefined' && !!window.CSS && !!Array.prototype.includes && typeof fetch !== 'undefined';
  if (!supported) {
    const b = document.createElement('div');
    b.setAttribute('role', 'alert');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#d29922;color:#000;padding:10px 16px;font-size:0.88rem;display:flex;align-items:center;justify-content:space-between;gap:12px';
    const msg = document.createElement('span');
    msg.innerHTML = '&#9888; <strong>Unsupported browser.</strong> This tool requires Chrome 90+, Firefox 88+, Safari 14+, or Edge 90+. Some features may not work correctly.';
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.style.cssText = 'background:rgba(0,0,0,0.15);border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:0.82rem;flex-shrink:0';
    dismiss.addEventListener('click', () => b.remove());
    b.appendChild(msg);
    b.appendChild(dismiss);
    document.body.appendChild(b);
  }
})();
