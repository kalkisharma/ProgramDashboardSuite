import * as XLSX from "xlsx";
import "./styles.css";
import { ZOOM_STEPS, SPECS_ZOOM_STEPS, ORG_ZOOM_STEPS, RH, HH, PHASE_NAMES_FALLBACK } from './constants.js';
import { GANTT_COLORS, PHASE_COLORS, SPEC_COLORS, TEAM_COLORS, phaseColor, ganttColor, teamColor, clearColorCache } from './colors.js';
import { esc, parseDate, parseDeps, fmt, daysBetween, parseWorkDays, isWorkDay, addDays, snapToWorkDay, countWorkDays, workDaysRemaining, wdDisplay, getToday } from './utils.js';
import { computeCriticalPath } from './compute/criticalPath.js';
import { computeConflicts } from './compute/conflicts.js';
import { recalcWBS, wouldCreateCycle } from './compute/wbs.js';
import { parseInfoSheet, parseScheduleSheet, parseSpecsSheet, parseOrgSheet, parseWeightSheet, extractWorkDays } from './parse.js';
import { buildWorkbook, generateSampleExcel } from './excel.js';
import { state } from './state.js';
import { showToast, safeSetItem, safeRender } from './ui/toast.js';
import { showTooltip, hideTooltip, positionTooltip } from './ui/tooltip.js';
import { pushUndo, fullSnapshot, updateUndoRedoBtns, scheduleDraftSave, scheduleExportReminder, clearDraft } from './core/undo.js';
import { showSidePanel, closeSidePanel } from './ui/panelBase.js';
import { renderProgDash, getPhaseNames } from './render/progDash.js';
import { renderWeightBudget, getWeightUnit } from './render/weightBudget.js';
import { renderOrgChart } from './render/orgChart.js';
import { renderRequirements } from './render/requirements.js';
import { renderStatusReport } from './render/statusReport.js';
import { renderSpecs, renderSpecTable, setSpecsCategoryFilter, clearSpecsFilters, cycleSpecStatus } from './render/specs.js';
import {
  renderGantt, setGanttPhaseFilter, setGanttTeamFilter, clearGanttFilters, togglePhaseCollapse,
  startBarDrag, endBarDrag, openGanttDatePicker, getBarZone,
  initGanttPan, initGanttColumnResize, initGanttNameColResize, updateGanttKeyFocus,
  adjustZoom, adjustSpecsZoom, adjustOrgZoom,
  toggleGanttCalendar, workdaysSummary, applyWorkDays, toggleWorkdaysPicker,
  navigateCalendar, renderGanttCalendar, jumpToGanttDate,
  toggleCriticalPath, toggleGanttLegend, exportGanttSVG, exportGanttPNG,
  startTaskNameEdit, startTaskTeamEdit, startTaskPctEdit,
  startPanDrag, updateTodayFloat,
} from './render/gantt.js';
import { addNewSpec, deleteTask, deleteSpec, addGanttTask, resetGanttToImported } from './ui/taskOps.js';

// ─── Function Index ───────────────────────────────────────────────────────────
// L66   App State          — state.* (see src/state.js); APP_VERSION
// L163  Help Modal         — toggleHelp
// L324  Tab Switching      — switchTab, renderDashboard
// L335  File Loading       — parseWorkbook, drag-drop + file input wiring
// L412  Side Panel Notes   — startNotesEdit
// L465  Dep Editing        — openDepEdit, addDepLink, removeDepLink, addSpecLink
// L617  Save to Excel      — saveToExcel
// L658  Weight Editing     — openWeightPanel, saveWeightRow, deleteWeightRow, addWeightRow
// L750  Side Panel – Spec  — openSpecPanel
// L853  Side Panel – Task  — openTaskPanel
// L983  Side Panel – Org   — openOrgPanel, openOrgEditPanel, saveOrgPerson, deleteOrgPerson
// L1149 Project Info       — openInfoPanel, saveInfoPanel
// L1212 Init               — initPersistedState (zoom, filters, work days from localStorage)
// L~1270 Event Handlers    — all static addEventListener wiring
//
// Extracted modules:
//   render/gantt.js         — renderGantt + all Gantt render/edit functions
//   render/specs.js         — renderSpecs, renderSpecTable, cycleSpecStatus
//   render/progDash.js      — renderProgDash, getPhaseNames
//   render/weightBudget.js  — renderWeightBudget, getWeightUnit
//   render/orgChart.js      — renderOrgChart
//   render/statusReport.js  — renderStatusReport; RAG task table, PowerPoint export (pptxgenjs)
//   render/requirements.js  — renderRequirements; CSV viewer, filter popover, column visibility
//   ui/rowReorder.js        — startRowDrag, doRowDragMove, endRowDrag
//   ui/taskOps.js           — addNewSpec, deleteTask, deleteSpec, addGanttTask, resetGanttToImported
//   ui/panelBase.js         — showSidePanel, closeSidePanel
//   ui/tooltip.js           — showTooltip, hideTooltip, positionTooltip
//   ui/toast.js             — showToast, safeSetItem, safeRender
//   core/undo.js            — pushUndo, fullSnapshot, applyUndo/Redo, draft save

// ─── App State ────────────────────────────────────────────────────────────────
// state.ProjectData, state.originalTasks, state.ganttWorkDays, state.spCurrent*, state.undoStack, state.redoStack,
// state.isDirty, state.barDrag, state.barEls, state.rowDrag, zoom indices, filters, and view state
// are all in src/state.js — import { state } from './state.js'
// getToday() imported from ./utils.js

const APP_VERSION = 'v4.7.1'; // also update the HTML comment on line 1 of index.html
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('help-version').textContent = 'Program Dashboard Suite ' + APP_VERSION;
});


// Gantt scroll-to-today guard: only auto-scroll once per file load
let ganttScrolledToday = false;

// depArrowEls, conflictSet — moved to state.js
let _justLoaded = false; // gates load toast: true only during file parse → renderDashboard()

// Org chart pan state — moved to ./render/orgChart.js

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
  if (state.ProjectData.tasks.length) renderGantt();
  if (state.ProjectData.org.length) renderOrgChart();
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

// showToast, safeSetItem, safeRender — imported from ./ui/toast.js

// fullSnapshot, pushUndo, scheduleDraftSave, clearDraft, scheduleExportReminder — imported from ./core/undo.js
/** @param {object} snapshot - Result of fullSnapshot(); restores state and re-renders all tabs. */
function _restoreSnapshot(snapshot) {
  state.ProjectData.tasks   = snapshot.tasks;
  state.ProjectData.specs   = snapshot.specs;
  state.ProjectData.org     = snapshot.org     || state.ProjectData.org;
  state.ProjectData.weights = snapshot.weights || state.ProjectData.weights;
  if (snapshot.info) state.ProjectData.info = snapshot.info;
  recalcWBS(state.ProjectData.tasks);
  safeRender(renderGantt,    'Gantt Chart');
  safeRender(renderSpecs,    'Specifications');
  safeRender(renderProgDash, 'Program Dashboard');
  if (state.ProjectData.weights.length) safeRender(renderWeightBudget, 'Weight Budget');
  if (state.ProjectData.org.length)     safeRender(renderOrgChart,     'Org Chart');
  safeRender(renderStatusReport, 'Status Report');
  if (state.spCurrentType === 'task') { state.spCurrentType = null; openTaskPanel(state.spCurrentId); }
  else if (state.spCurrentType === 'spec') { state.spCurrentType = null; openSpecPanel(state.spCurrentId); }
  else if (state.spCurrentType === 'org') { const n = state.spCurrentId; state.spCurrentType = null; if (state.ProjectData.org.find(p => p.name === n)) openOrgPanel(n); else closeSidePanel(); }
  else if (state.spCurrentType === 'weight' || state.spCurrentType === 'info') closeSidePanel();
}
/** Pops the top undo entry, pushes current state to state.redoStack, and restores previous state. */
function applyUndo() {
  const entry = state.undoStack.pop();
  if (!entry) return;
  if (state.redoStack.length >= 50) state.redoStack.shift();
  state.redoStack.push({ label: entry.label, snapshot: fullSnapshot() });
  _restoreSnapshot(entry.snapshot);
  showToast('Undone: ' + entry.label, null, 3000);
  updateUndoRedoBtns();
}
/** Pops the top redo entry, pushes current state back to state.undoStack, and re-applies the state. */
function applyRedo() {
  const entry = state.redoStack.pop();
  if (!entry) return;
  if (state.undoStack.length >= 50) state.undoStack.shift();
  state.undoStack.push({ label: entry.label, snapshot: fullSnapshot() });
  _restoreSnapshot(entry.snapshot);
  showToast('Redone: ' + entry.label, null, 3000);
  updateUndoRedoBtns();
}
// updateUndoRedoBtns — imported from ./core/undo.js

let _helpOpener = null;
let _helpFocusTrapActive = false;
function toggleHelp() {
  const overlay = document.getElementById('help-overlay');
  const modal   = document.getElementById('help-modal');
  const open = overlay.classList.contains('open');
  if (open) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    modal.removeEventListener('keydown', _trapHelpFocus);
    _helpFocusTrapActive = false;
    if (_helpOpener) { _helpOpener.focus(); _helpOpener = null; }
  } else {
    _helpOpener = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
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
    if (state.spCurrentType === 'task') {
      const btn = document.getElementById('sp-delete-task-btn');
      if (btn) { e.preventDefault(); btn.click(); }
    } else if (state.spCurrentType === 'spec') {
      const btn = document.getElementById('sp-delete-spec-btn');
      if (btn) { e.preventDefault(); btn.click(); }
    }
    return;
  }
  if (e.key === 'Escape') {
    if (document.getElementById('help-overlay').classList.contains('open')) { toggleHelp(); return; }
    const picker = document.getElementById('workdays-picker');
    const wdBtn  = document.getElementById('workdays-btn');
    if (picker && picker.style.display !== 'none') {
      picker.style.display = 'none';
      if (wdBtn) { wdBtn.setAttribute('aria-expanded', 'false'); wdBtn.focus(); }
    }
    const legend = document.getElementById('gantt-legend');
    const legendBtn = document.getElementById('legend-btn');
    if (legend && legend.style.display !== 'none') {
      state.showGanttLegend = false;
      legend.style.display = 'none';
      if (legendBtn) { legendBtn.setAttribute('aria-expanded', 'false'); legendBtn.focus(); }
    }
    if (state.spCurrentType && !e.target.matches('input, select, textarea')) { closeSidePanel(); return; }
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
      if (valid.length > 0) state.ganttWorkDays = valid;
    } catch(e) {}
  }
})();

// ─── Tab Switching ────────────────────────────────────────────────────────────
/** @param {HTMLElement} btn - The clicked tab button. @param {string} id - Tab key ('gantt'|'specs'|'prog'|'weight'|'org'). */
function switchTab(btn, id) {
  const saveBtn = document.querySelector('#sp-body [id$="-save-btn"]');
  if (saveBtn) { showToast('Unsaved changes — save or cancel before switching tabs.', null, 3500); return; }
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
  if (state.isDirty && !window.confirm('You have unsaved edits. Load this file and discard your changes?')) return;
  hideLoadError();
  const r = new FileReader();
  r.onload = ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
      parseWorkbook(wb);
      const missing = [];
      if (!state.ProjectData.tasks.length)  missing.push("'Schedule' (columns: Task ID, WBS, Task Name, Category, Start Date, End Date, % Complete, Dependencies, Responsible Team, Milestone, Notes)");
      if (!state.ProjectData.specs.length)  missing.push("'Specifications' (columns: Spec ID, Category, Specification Name, Value, Units, Status, Responsible Group, Notes, Dependent Task IDs)");
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
/** @param {object} wb - SheetJS workbook object. Resets all state.ProjectData collections and populates from sheets. */
function parseWorkbook(wb) {
  state.ProjectData.info = {}; state.ProjectData.tasks = []; state.ProjectData.specs = []; state.ProjectData.org = []; state.ProjectData.weights = [];
  state.undoStack = []; state.redoStack = [];
  state.collapsedPhases  = new Set();
  state.calDisplayMonth  = null;
  state.ganttKeyFocusIdx = -1;
  state.barDrag = { active: false, pending: false, taskId: null, mode: null, startClientX: 0, origStart: null, origEnd: null, startScrollLeft: 0 };
  state.barDragPreSnapshot = null;
  state.barEls  = {};
  state.rowDrag = { active: false, srcIdx: null, ghost: null, indicator: null, dropIdx: null };
  clearColorCache();

  state.ProjectData.info    = parseInfoSheet(wb.Sheets['Project Info']);
  state.ProjectData.tasks   = parseScheduleSheet(wb.Sheets['Schedule']);
  state.ProjectData.specs   = parseSpecsSheet(wb.Sheets['Specifications']);
  state.ProjectData.org     = parseOrgSheet(wb.Sheets['Org Chart']);
  state.ProjectData.weights = parseWeightSheet(wb.Sheets['Weight Budget']);

  const wds = extractWorkDays(state.ProjectData.info);
  if (wds) {
    state.ganttWorkDays = wds;
    const wdBtn = document.getElementById('workdays-btn');
    if (wdBtn) wdBtn.textContent = workdaysSummary(wds) + ' ▾';
  }

  // Deep-copy tasks for reset
  state.originalTasks = state.ProjectData.tasks.map(t => ({ ...t, deps: [...t.deps] }));
  clearDraft();
}


// ─── Render Dashboard ─────────────────────────────────────────────────────────
/** Entry point after file load — updates topbar metadata and re-renders all visible tabs. */
function renderDashboard() {
  const title    = state.ProjectData.info['Project Title']      || 'Vehicle Design Dashboard';
  const subtitle = state.ProjectData.info['Project Subtitle']   || '';
  const admin    = state.ProjectData.info['File Administrator'] || '';
  const subParts = [subtitle, admin ? 'File Admin: ' + admin : ''].filter(Boolean);
  const titleEl = document.getElementById('project-title');
  titleEl.textContent = title;
  titleEl.setAttribute('title', title);
  document.getElementById('project-subtitle').textContent = subParts.join(' · ') || 'Project Dashboard';
  document.title = title + ' — Program Dashboard';
  document.getElementById('dropzone').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  document.getElementById('tab-nav').style.display = 'flex';
  document.getElementById('org-tab-btn').style.display = state.ProjectData.org.length ? '' : 'none';
  document.getElementById('weight-tab-btn').style.display = state.ProjectData.weights.length ? '' : 'none';
  document.getElementById('status-tab-btn').style.display = '';
  document.getElementById('generate-sample-btn').style.display = 'none';
  document.getElementById('save-excel-btn').style.display = '';
  document.getElementById('proj-info-btn').style.display = '';
  dashboardLoaded = true;
  ganttScrolledToday = false;
  state.ganttPhaseFilter = 'all';
  state.ganttTeamFilter  = 'all';
  state.specSearchQuery  = '';
  state.collapsedPhases.clear();
  ['vh-filter-phase','vh-filter-team','vh-filter-specs-cat','vh-filter-specs-search','vh-collapsed-phases']
    .forEach(k => localStorage.removeItem(k));
  const ssInput = document.getElementById('specs-search');
  if (ssInput) ssInput.value = '';
  const ssClearFile = document.getElementById('specs-search-clear');
  if (ssClearFile) ssClearFile.style.display = 'none';
  state.orgSearchQuery = '';
  const osInput2 = document.getElementById('org-search');
  if (osInput2) { osInput2.value = ''; const osClear2 = document.getElementById('org-search-clear'); if (osClear2) osClear2.style.display = 'none'; }
  safeRender(renderGantt,        'Gantt Chart');
  safeRender(renderSpecs,        'Specifications');
  safeRender(renderProgDash,     'Program Dashboard');
  safeRender(renderWeightBudget,  'Weight Budget');
  safeRender(renderOrgChart,      'Org Chart');
  safeRender(renderStatusReport,  'Status Report');
  safeRender(renderRequirements, 'Requirements');
  updateUndoRedoBtns();
  if (_justLoaded && state.ProjectData.tasks.length) {
    const badDates   = state.ProjectData.tasks.filter(t => !t.milestone && (!t.start || !t.end));
    const dupTaskIds = (() => { const seen = new Set(), dups = new Set(); state.ProjectData.tasks.forEach(t => { if (seen.has(t.id)) dups.add(t.id); seen.add(t.id); }); return dups; })();
    const dupSpecIds = (() => { const seen = new Set(), dups = new Set(); state.ProjectData.specs.forEach(s => { if (seen.has(s.id)) dups.add(s.id); seen.add(s.id); }); return dups; })();
    const parts = [`${state.ProjectData.tasks.length} task${state.ProjectData.tasks.length !== 1 ? 's' : ''}`];
    if (state.ProjectData.specs.length)   parts.push(`${state.ProjectData.specs.length} spec${state.ProjectData.specs.length !== 1 ? 's' : ''}`);
    if (state.ProjectData.org.length)     parts.push(`${state.ProjectData.org.length} ${state.ProjectData.org.length === 1 ? 'person' : 'people'}`);
    if (state.ProjectData.weights.length) parts.push(`${state.ProjectData.weights.length} weight row${state.ProjectData.weights.length !== 1 ? 's' : ''}`);
    if (badDates.length)  parts.push(`⚠ ${badDates.length} task${badDates.length !== 1 ? 's' : ''} missing dates`);
    if (dupTaskIds.size)  parts.push(`⚠ ${dupTaskIds.size} duplicate task ID${dupTaskIds.size !== 1 ? 's' : ''}`);
    if (dupSpecIds.size)  parts.push(`⚠ ${dupSpecIds.size} duplicate spec ID${dupSpecIds.size !== 1 ? 's' : ''}`);
    const hasWarnings = badDates.length || dupTaskIds.size || dupSpecIds.size;
    showToast('Loaded: ' + parts.join(' · '), null, hasWarnings ? 10000 : 6000);
  }
}

// renderGantt and all gantt functions — imported from ./render/gantt.js

// ─── SIDE PANEL: DEPENDENCY EDITING ──────────────────────────────────────────
// wouldCreateCycle imported from ./compute/wbs.js (signature: wouldCreateCycle(tasks, taskId, candidateId))

function removeDep(t, depId) {
  const origOpener = state.spOpener;
  t.deps = t.deps.filter(d => d !== depId);
  renderGantt();
  state.spCurrentType = null; openTaskPanel(t.id); state.spOpener = origOpener;
}

function addDep(t, depId) {
  const origOpener = state.spOpener;
  if (!t.deps.includes(depId)) { t.deps.push(depId); t.deps.sort((a, b) => a - b); }
  renderGantt();
  state.spCurrentType = null; openTaskPanel(t.id); state.spOpener = origOpener;
}

// Active dependency-picker outside-click handlers. A single panel can wire more than
// one picker (e.g. openTaskPanel: deps + spec-link), so this is a list, not a scalar.
let _pickerDocClicks = []; // [{ handler, picker }]

function wirePicker({ btnId, pickerId, listId, buildFn, ref, itemSelector }) {
  // Drop handlers whose picker is no longer in the DOM — these were stranded by a prior
  // panel render or a close path (Escape / toggle-shut) that never fired outside-click.
  // Sibling pickers from the *current* render stay in the DOM, so they are preserved.
  _pickerDocClicks = _pickerDocClicks.filter(({ handler, picker }) => {
    if (!document.body.contains(picker)) { document.removeEventListener('click', handler); return false; }
    return true;
  });
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
    _pickerDocClicks = _pickerDocClicks.filter(({ handler }) => {
      if (handler === onDocClick) { document.removeEventListener('click', handler); return false; }
      return true;
    });
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
  const onDocClick = e => {
    if (!picker.contains(e.target) && e.target !== btn) { close(); }
  };
  document.addEventListener('click', onDocClick);
  _pickerDocClicks.push({ handler: onDocClick, picker });
}

function buildDepPickerList(input, t, listEl) {
  const q = input.value.trim().toLowerCase();
  const candidates = state.ProjectData.tasks.filter(c => c.id !== t.id && !t.deps.includes(c.id));
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
    const isCycle = wouldCreateCycle(state.ProjectData.tasks, t.id, c.id);
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
  const origOpener = state.spOpener;
  s.depIds = s.depIds.filter(id => id !== taskId);
  renderSpecTable();
  state.spCurrentType = null; openSpecPanel(s.id); state.spOpener = origOpener;
}

function addSpecDep(s, taskId) {
  const origOpener = state.spOpener;
  if (!s.depIds.includes(taskId)) { s.depIds.push(taskId); s.depIds.sort((a,b) => a-b); }
  renderSpecTable();
  state.spCurrentType = null; openSpecPanel(s.id); state.spOpener = origOpener;
}

function buildSpecDepPickerList(input, s, listEl) {
  const q = input.value.trim().toLowerCase();
  const candidates = state.ProjectData.tasks.filter(c => !s.depIds.includes(c.id));
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
  const origOpener = state.spOpener;
  s.depIds = s.depIds.filter(id => id !== taskId);
  renderSpecTable();
  state.spCurrentType = null; openTaskPanel(taskId); state.spOpener = origOpener;
}

function addSpecLink(s, taskId) {
  const origOpener = state.spOpener;
  if (!s.depIds.includes(taskId)) { s.depIds.push(taskId); s.depIds.sort((a,b) => a-b); }
  renderSpecTable();
  state.spCurrentType = null; openTaskPanel(taskId); state.spOpener = origOpener;
}

function buildSpecLinkPickerList(input, t, listEl) {
  const q = input.value.trim().toLowerCase();
  const candidates = state.ProjectData.specs.filter(s => !s.depIds.includes(t.id));
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

// ─── SAVE TO EXCEL ────────────────────────────────────────────────────────────
function saveToExcel() {
  const wb = buildWorkbook(state.ProjectData, getWeightUnit());
  const title = (state.ProjectData.info['Project Title'] || 'Dashboard').replace(/[/\\?%*:|"<>]/g, '-');
  const dateStr = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `${title} - ${dateStr}.xlsx`);
  clearDraft();
  showToast('Exported to Excel — draft cleared');
}

const tooltip = document.getElementById('tooltip'); // local alias used by weight/dep tooltip handlers

document.getElementById('gantt-calendar').addEventListener('mouseover', e => {
  const cell = e.target.closest('[data-cal-tip]');
  const tt = document.getElementById('tooltip');
  if (!cell) { tt.style.display = 'none'; return; }
  tt.innerHTML = cell.dataset.calTip.split('\n')
    .map((l, i) => `<div${i === 0 ? ' class="tt-title"' : ''}>${esc(l)}</div>`).join('');
  tt.style.display = 'block';
  positionTooltip(e);
});
document.getElementById('gantt-calendar').addEventListener('mouseleave', () => {
  document.getElementById('tooltip').style.display = 'none';
});

document.addEventListener('mousemove', e => {
  const tt = document.getElementById('tooltip');
  if (tt.style.display === 'block') positionTooltip(e);
});

// ─── WEIGHT BUDGET EDITING ────────────────────────────────────────────────────
/** @param {number} idx - Index in state.ProjectData.weights; opens an edit form in the side panel. */
function openWeightPanel(idx) {
  if (state.spCurrentType === 'weight' && state.spCurrentId === idx) { closeSidePanel(); return; }
  state.spOpener = document.activeElement;
  const w = state.ProjectData.weights[idx];
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
  state.spCurrentType = 'weight'; state.spCurrentId = idx;
  showSidePanel();
}

function saveWeightRow(idx) {
  pushUndo('edit weight row');
  const w = state.ProjectData.weights[idx];
  w.subsystem = document.getElementById('wt-edit-subsystem').value.trim() || w.subsystem;
  w.group     = document.getElementById('wt-edit-group').value.trim();
  w.target    = parseFloat(document.getElementById('wt-edit-target').value) || 0;
  w.estimated = parseFloat(document.getElementById('wt-edit-est').value) || 0;
  w.status    = document.getElementById('wt-edit-status').value;
  w.notes     = document.getElementById('wt-edit-notes').value;
  document.getElementById('sp-title').textContent = w.subsystem || 'Weight Row';
  safeRender(renderWeightBudget, 'Weight Budget');
  showToast('Weight row saved');
  const btn = document.getElementById('wt-save-btn');
  if (btn) {
    btn.textContent = '✓ Saved'; btn.style.background = '#238636'; btn.style.color = '#fff'; btn.disabled = true;
    setTimeout(() => { btn.textContent = 'Save Changes'; btn.style.background = ''; btn.style.color = ''; btn.disabled = false; }, 1500);
  }
}

function deleteWeightRow(idx) {
  const btn = document.getElementById('wt-delete-btn');
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1'; btn.textContent = 'Click again to confirm';
    btn.style.background = 'var(--danger)'; btn.style.color = '#fff';
    setTimeout(() => { if (btn.dataset.confirming) { btn.dataset.confirming = ''; btn.textContent = 'Delete Row'; btn.style.background = ''; btn.style.color = ''; } }, 3000);
    return;
  }
  pushUndo('delete weight row');
  state.ProjectData.weights.splice(idx, 1);
  closeSidePanel();
  if (!state.ProjectData.weights.length) document.getElementById('weight-tab-btn').style.display = 'none';
  else safeRender(renderWeightBudget, 'Weight Budget');
  showToast('Weight row deleted', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
}

function addWeightRow() {
  pushUndo('add weight row');
  state.ProjectData.weights.push({ subsystem: 'New Subsystem', group: 'Other', target: 0, estimated: 0, status: 'TBD', notes: '' });
  document.getElementById('weight-tab-btn').style.display = '';
  safeRender(renderWeightBudget, 'Weight Budget');
  openWeightPanel(state.ProjectData.weights.length - 1);
}

// ─── SIDE PANEL – SPEC ───────────────────────────────────────────────────────
/** @param {string} specId - Opens the spec detail panel; second call on same ID toggles it closed. */
function openSpecPanel(specId) {
  if (state.spCurrentType === 'spec' && state.spCurrentId === specId) { closeSidePanel(); return; }
  state.spOpener = document.activeElement;
  const s = state.ProjectData.specs.find(s => s.id === specId);
  if (!s) return;
  const col = SPEC_COLORS[s.category] || { text:'#58a6ff' };
  document.getElementById('sp-title').textContent = s.name;

  const sc = s.status==='Achieved' ? 'badge-achieved' : s.status==='Target' ? 'badge-target' : 'badge-tbd';
  let html = `<div class="sp-meta">
    <div class="sp-meta-name" style="font-weight:600">${esc(s.name)}</div>
    <div class="sp-meta-id"><code style="color:${col.text}">${esc(s.id)}</code> · <span style="color:${col.text}">${esc(s.category)}</span> · ${esc(s.group) || '<span style="color:var(--muted);font-style:italic">No group</span>'}</div>
    <div class="sp-meta-val">${s.value !== '' && s.value != null ? esc(String(s.value)) : '<span style="color:var(--muted);font-style:italic">No value</span>'} <span style="font-size:0.85rem;font-weight:400;color:var(--muted)">${esc(s.units)}</span></div>
    <span class="badge ${sc}">${esc(s.status)}</span>
    ${s.notes ? `<div class="sp-meta-notes" style="white-space:pre-wrap;margin-top:8px">${esc(s.notes)}</div>` : ''}
  </div>`;

  const hasRisk = s.status === 'TBD' && s.depIds.some(id => {
    const t = state.ProjectData.tasks.find(t => t.id === id);
    return t && t.start && t.start <= getToday();
  });
  if (hasRisk) html += `<div class="risk-alert">⚠ BLOCKED RISK — Spec is TBD but dependent task(s) have started</div>`;
  html += `<div class="sp-section-label">Dependent Tasks${s.depIds.length ? ` (${s.depIds.length})` : ''}</div>`;
  if (!s.depIds.length) {
    html += `<div class="no-deps">No task dependencies linked<br>to this specification.</div>`;
  } else {
    s.depIds.forEach(id => {
      const t = state.ProjectData.tasks.find(t => t.id === id);
      if (!t) {
        html += `<div class="task-card future"><div class="tc-id"><button class="sp-dep-rm" data-rm-spec-dep="${id}" aria-label="Remove task ${id}" title="Remove">×</button>Task ${id}</div><div class="tc-name" style="color:var(--muted)">Not found in Schedule</div></div>`;
        return;
      }
      const started = t.start && t.start <= getToday();
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
    <button class="btn-secondary btn-sm" id="sp-edit-spec-btn" style="width:100%;margin-bottom:8px">Edit Spec</button>
    <button class="btn-secondary btn-sm" id="sp-delete-spec-btn" style="width:100%" aria-label="Delete this specification">Delete Specification</button>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  spBody.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => openTaskPanel(+el.dataset.taskId));
  });
  spBody.querySelectorAll('[data-rm-spec-dep]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeSpecDep(s, +btn.dataset.rmSpecDep); });
  });
  wirePicker({ btnId: 'sp-add-spec-dep-btn', pickerId: 'sp-spec-dep-picker', listId: 'sp-spec-dep-list', buildFn: buildSpecDepPickerList, ref: s });
  spBody.querySelector('#sp-edit-spec-btn').addEventListener('click', () => openSpecEditPanel(specId));
  const delSpecBtn = spBody.querySelector('#sp-delete-spec-btn');
  if (delSpecBtn) delSpecBtn.addEventListener('click', () => deleteSpec(s.id));

  state.spCurrentType = 'spec'; state.spCurrentId = specId;
  showSidePanel();
}

// ─── SPEC EDIT FORM ──────────────────────────────────────────────────────────
function openSpecEditPanel(specId) {
  const s = state.ProjectData.specs.find(s => s.id === specId);
  if (!s) return;
  state.spOpener = state.spOpener || document.activeElement;
  document.getElementById('sp-title').textContent = `Edit: ${s.name}`;
  const cats = Object.keys(SPEC_COLORS);
  const catOpts = cats.map(c => `<option value="${esc(c)}"${c === s.category ? ' selected' : ''}>${esc(c)}</option>`).join('');
  const statusOpts = ['Achieved','Target','TBD'].map(st => `<option value="${esc(st)}"${st === s.status ? ' selected' : ''}>${esc(st)}</option>`).join('');
  const html = `<div class="sp-meta" style="padding:14px 14px 4px">
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-name">Name</label>
      <input class="sp-form-input" id="spec-edit-name" type="text" value="${esc(s.name)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-id">Spec ID</label>
      <input class="sp-form-input" id="spec-edit-id" type="text" value="${esc(s.id)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-cat">Category</label>
      <select class="sp-form-input" id="spec-edit-cat">${catOpts}</select></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-val">Value</label>
      <input class="sp-form-input" id="spec-edit-val" type="text" value="${esc(String(s.value ?? ''))}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-units">Units</label>
      <input class="sp-form-input" id="spec-edit-units" type="text" value="${esc(s.units)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-group">Group</label>
      <input class="sp-form-input" id="spec-edit-group" type="text" value="${esc(s.group)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-status">Status</label>
      <select class="sp-form-input" id="spec-edit-status">${statusOpts}</select></div>
    <div class="sp-form-group"><label class="sp-form-label" for="spec-edit-notes">Notes</label>
      <textarea class="sp-form-input" id="spec-edit-notes" rows="4">${esc(s.notes || '')}</textarea></div>
  </div>
  <div style="padding:0 16px">
    <button class="btn-primary" id="spec-save-btn" style="width:100%;margin-bottom:8px">Save Changes</button>
    <button class="btn-secondary btn-sm" id="spec-cancel-btn" style="width:100%;margin-bottom:8px">Cancel</button>
    <div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn-secondary btn-sm" id="spec-edit-delete-btn" style="width:100%">Delete Specification</button>
    </div>
  </div>`;
  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  document.getElementById('spec-save-btn').addEventListener('click', () => saveSpecEdits(specId));
  document.getElementById('spec-cancel-btn').addEventListener('click', () => { state.spCurrentType = null; openSpecPanel(specId); });
  document.getElementById('spec-edit-delete-btn').addEventListener('click', () => deleteSpec(specId));
  if (!state.spCurrentType) { state.spCurrentType = 'spec'; state.spCurrentId = specId; showSidePanel(); }
}

function saveSpecEdits(specId) {
  const s = state.ProjectData.specs.find(s => s.id === specId);
  if (!s) return;
  const newName   = document.getElementById('spec-edit-name').value.trim();
  const newId     = document.getElementById('spec-edit-id').value.trim();
  const newCat    = document.getElementById('spec-edit-cat').value;
  const newVal    = document.getElementById('spec-edit-val').value.trim();
  const newUnits  = document.getElementById('spec-edit-units').value.trim();
  const newGroup  = document.getElementById('spec-edit-group').value.trim();
  const newStatus = document.getElementById('spec-edit-status').value;
  const newNotes  = document.getElementById('spec-edit-notes').value;
  if (!newName)  { showToast('Spec name cannot be empty', null, 3500); return; }
  if (!newId)    { showToast('Spec ID cannot be empty', null, 3500); return; }
  if (newId !== specId && state.ProjectData.specs.some(x => x.id === newId)) { showToast('Spec ID already in use', null, 3500); return; }
  pushUndo('edit spec');
  s.name = newName; s.id = newId; s.category = newCat; s.value = newVal;
  s.units = newUnits; s.group = newGroup; s.status = newStatus; s.notes = newNotes;
  if (newId !== specId) state.spCurrentId = newId;
  renderSpecTable();
  showToast('Spec updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
  const btn = document.getElementById('spec-save-btn');
  if (btn) { btn.textContent = '✓ Saved'; btn.style.background = '#238636'; btn.style.color = '#fff'; btn.disabled = true; }
  setTimeout(() => { state.spCurrentType = null; openSpecPanel(newId); }, 600);
}

// ─── SIDE PANEL – TASK ───────────────────────────────────────────────────────
/** @param {number} taskId - Opens the task detail panel; second call on same ID toggles it closed. */
function openTaskPanel(taskId) {
  if (state.spCurrentType === 'task' && state.spCurrentId === taskId) { closeSidePanel(); return; }
  state.spOpener = document.activeElement;
  const t = state.ProjectData.tasks.find(t => t.id === taskId);
  if (!t) return;
  const gc = ganttColor(t.category);
  document.getElementById('sp-title').textContent = t.name;

  const started = t.start && t.start <= getToday();
  const done = t.pct === 100;
  const statusBadge = done
    ? `<span class="badge badge-achieved">Complete</span>`
    : started
      ? `<span class="badge badge-target">${t.pct}% In Progress</span>`
      : `<span class="badge badge-tbd">Not Started</span>`;

  const totalWd = countWorkDays(t.start, t.end, state.ganttWorkDays);
  const remWd   = workDaysRemaining(t.end, state.ganttWorkDays, getToday());
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
    ${t.notes ? `<div class="sp-meta-notes" style="white-space:pre-wrap;margin-top:8px">${esc(t.notes)}</div>` : ''}
  </div>`;

  // Dependencies (tasks this one depends on)
  html += `<div class="sp-section-label">Depends On${t.deps.length ? ` (${t.deps.length})` : ''}</div>`;
  t.deps.forEach(id => {
    const dep = state.ProjectData.tasks.find(d => d.id === id);
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
  const linkedSpecs = state.ProjectData.specs.filter(s => s.depIds.includes(t.id));
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
    <button class="btn-secondary btn-sm" id="sp-edit-task-btn" style="width:100%;margin-bottom:8px">Edit Task</button>
    <button class="btn-secondary btn-sm" id="sp-delete-task-btn" style="width:100%" aria-label="Delete this task">Delete Task</button>
  </div>`;

  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;

  spBody.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => openTaskPanel(+el.dataset.taskId));
  });
  spBody.querySelectorAll('[data-spec-id]').forEach(el => {
    el.addEventListener('click', () => openSpecPanel(el.dataset.specId));
  });
  spBody.querySelectorAll('[data-rm-dep]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeDep(t, +btn.dataset.rmDep); });
  });
  spBody.querySelectorAll('[data-rm-spec-link]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const spec = state.ProjectData.specs.find(s => s.id === btn.dataset.rmSpecLink);
      if (spec) removeSpecLink(spec, t.id);
    });
  });
  wirePicker({ btnId: 'sp-add-dep-btn', pickerId: 'sp-dep-picker', listId: 'sp-dep-list', buildFn: buildDepPickerList, ref: t, itemSelector: '.sp-dep-item:not(.cycle)' });
  wirePicker({ btnId: 'sp-add-spec-link-btn', pickerId: 'sp-spec-link-picker', listId: 'sp-spec-link-list', buildFn: buildSpecLinkPickerList, ref: t });
  spBody.querySelector('#sp-edit-task-btn').addEventListener('click', () => openTaskEditPanel(taskId));
  const delTaskBtn = spBody.querySelector('#sp-delete-task-btn');
  if (delTaskBtn) delTaskBtn.addEventListener('click', () => deleteTask(t.id));

  state.spCurrentType = 'task'; state.spCurrentId = taskId;
  showSidePanel();
}

// ─── TASK EDIT FORM ───────────────────────────────────────────────────────────
function openTaskEditPanel(taskId) {
  const t = state.ProjectData.tasks.find(t => t.id === taskId);
  if (!t) return;
  state.spOpener = state.spOpener || document.activeElement;
  document.getElementById('sp-title').textContent = `Edit: ${t.name}`;
  const toDateInput = d => { if (!d) return ''; const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dy = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dy}`; };
  const allTeams = [...new Set(state.ProjectData.tasks.map(t => t.team).filter(Boolean))].sort();
  const teamDl = allTeams.map(tm => `<option>${esc(tm)}</option>`).join('');
  const html = `<div class="sp-meta" style="padding:14px 14px 4px">
    <div class="sp-form-group"><label class="sp-form-label" for="task-edit-name">Name</label>
      <input class="sp-form-input" id="task-edit-name" type="text" value="${esc(t.name)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="task-edit-team">Team</label>
      <input class="sp-form-input" id="task-edit-team" type="text" list="task-team-dl" value="${esc(t.team)}">
      <datalist id="task-team-dl">${teamDl}</datalist></div>
    <div class="sp-form-group"><label class="sp-form-label" for="task-edit-start">Start Date</label>
      <input class="sp-form-input" id="task-edit-start" type="date" value="${toDateInput(t.start)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="task-edit-end">End Date</label>
      <input class="sp-form-input" id="task-edit-end" type="date" value="${toDateInput(t.end)}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="task-edit-pct">% Complete</label>
      <input class="sp-form-input" id="task-edit-pct" type="number" min="0" max="100" value="${t.pct}"></div>
    <div class="sp-form-group"><label class="sp-form-label" for="task-edit-notes">Notes</label>
      <textarea class="sp-form-input" id="task-edit-notes" rows="4">${esc(t.notes || '')}</textarea></div>
  </div>
  <div style="padding:0 16px">
    <button class="btn-primary" id="task-save-btn" style="width:100%;margin-bottom:8px">Save Changes</button>
    <button class="btn-secondary btn-sm" id="task-cancel-btn" style="width:100%;margin-bottom:8px">Cancel</button>
    <div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn-secondary btn-sm" id="task-edit-delete-btn" style="width:100%">Delete Task</button>
    </div>
  </div>`;
  const spBody = document.getElementById('sp-body');
  spBody.innerHTML = html;
  document.getElementById('task-save-btn').addEventListener('click', () => saveTaskEdits(taskId));
  document.getElementById('task-cancel-btn').addEventListener('click', () => { state.spCurrentType = null; openTaskPanel(taskId); });
  document.getElementById('task-edit-delete-btn').addEventListener('click', () => deleteTask(taskId));
  if (!state.spCurrentType) { state.spCurrentType = 'task'; state.spCurrentId = taskId; showSidePanel(); }
}

function saveTaskEdits(taskId) {
  const t = state.ProjectData.tasks.find(t => t.id === taskId);
  if (!t) return;
  const name = document.getElementById('task-edit-name').value.trim();
  if (!name) { showToast('Task name cannot be empty', null, 3500); return; }
  const team     = document.getElementById('task-edit-team').value.trim();
  const startStr = document.getElementById('task-edit-start').value;
  const endStr   = document.getElementById('task-edit-end').value;
  const pct      = Math.max(0, Math.min(100, Math.round(parseFloat(document.getElementById('task-edit-pct').value) || 0)));
  const notes    = document.getElementById('task-edit-notes').value;
  const parseD   = s => { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
  const newStart = startStr ? snapToWorkDay(parseD(startStr), state.ganttWorkDays, 1) : t.start;
  const newEnd   = endStr   ? snapToWorkDay(parseD(endStr),   state.ganttWorkDays, 1) : t.end;
  if (newStart && newEnd && newEnd < newStart) { showToast('End date must be on or after start date', null, 3500); return; }
  pushUndo('edit task');
  t.name = name; t.team = team; t.start = newStart; t.end = newEnd; t.pct = pct; t.notes = notes;
  renderGantt();
  showToast('Task updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
  const btn = document.getElementById('task-save-btn');
  if (btn) { btn.textContent = '✓ Saved'; btn.style.background = '#238636'; btn.style.color = '#fff'; btn.disabled = true; }
  setTimeout(() => { state.spCurrentType = null; openTaskPanel(taskId); }, 600);
}

// ─── SIDE PANEL – ORG PERSON ─────────────────────────────────────────────────
/** @param {string} name - Person's name key; opens their profile panel or toggles it closed. */
function openOrgPanel(name) {
  if (state.spCurrentType === 'org' && state.spCurrentId === name) { closeSidePanel(); return; }
  state.spOpener = document.activeElement;
  const person = state.ProjectData.org.find(p => p.name === name);
  if (!person) return;
  const col = teamColor(person.team);
  document.getElementById('sp-title').textContent = person.name;

  let html = `<div class="sp-meta">
    <div class="sp-meta-id" style="color:${col};font-weight:700">${esc(person.team) || 'No Team'}</div>
    <div class="sp-meta-val" style="font-size:1rem">${esc(person.title) || '—'}</div>
    ${person.email ? `<div class="sp-meta-notes">${esc(person.email)}</div>` : ''}
    ${person.reportsTo.length ? `<div class="sp-meta-notes"><strong>Reports to:</strong> ${person.reportsTo.map(r => esc(r)).join(', ')}</div>` : ''}
  </div>`;

  const reports = state.ProjectData.org.filter(p => p.reportsTo.includes(name));
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

  const myTasks = state.ProjectData.tasks.filter(t => t.team === person.team);
  if (myTasks.length) {
    html += `<div class="sp-section-label" style="margin-top:16px">Team Tasks (${myTasks.length})</div>`;
    myTasks.forEach(t => {
      const gc = ganttColor(t.category);
      const done2 = t.pct === 100;
      const started2 = t.start && t.start <= getToday();
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
  state.spCurrentType = 'org'; state.spCurrentId = name;
  showSidePanel();
}

// ─── ORG CHART EDITING ────────────────────────────────────────────────────────
/** @param {string|null} name - Person's current name, or null to add a new person. */
function openOrgEditPanel(name) {
  const person = name ? state.ProjectData.org.find(p => p.name === name) : null;
  const isNew  = !person;
  state.spOpener = state.spOpener || document.activeElement;
  document.getElementById('sp-title').textContent = isNew ? 'Add Person' : `Edit: ${person.name}`;

  const allTeams = [...new Set(state.ProjectData.org.map(p => p.team).filter(Boolean))].sort();
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
    document.getElementById('org-cancel-btn').addEventListener('click', () => { state.spCurrentType = null; openOrgPanel(name); });
    document.getElementById('org-delete-btn').addEventListener('click', () => deleteOrgPerson(name));
  }
  if (!state.spCurrentType) { state.spCurrentType = 'org'; state.spCurrentId = name; showSidePanel(); }
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
    const person = state.ProjectData.org.find(p => p.name === oldName);
    if (!person) return;
    if (newName !== oldName) {
      state.ProjectData.org.forEach(p => { p.reportsTo = p.reportsTo.map(r => r === oldName ? newName : r); });
    }
    person.name = newName; person.title = newTitle; person.team = newTeam;
    person.reportsTo = newReports; person.email = newEmail;
  } else {
    state.ProjectData.org.push({ name: newName, title: newTitle, team: newTeam, reportsTo: newReports, email: newEmail });
    document.getElementById('org-tab-btn').style.display = '';
  }

  state.spCurrentType = null;
  safeRender(renderOrgChart, 'Org Chart');
  openOrgPanel(newName);
  showToast(oldName ? 'Person updated' : `${newName} added`);
}

function deleteOrgPerson(name) {
  const btn = document.getElementById('org-delete-btn');
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1'; btn.textContent = 'Click again to confirm';
    btn.style.background = 'var(--danger)'; btn.style.color = '#fff';
    setTimeout(() => { if (btn.dataset.confirming) { btn.dataset.confirming = ''; btn.textContent = 'Delete Person'; btn.style.background = ''; btn.style.color = ''; } }, 3000);
    return;
  }
  pushUndo('delete org person');
  state.ProjectData.org = state.ProjectData.org.filter(p => p.name !== name);
  state.ProjectData.org.forEach(p => { p.reportsTo = p.reportsTo.filter(r => r !== name); });
  closeSidePanel();
  if (!state.ProjectData.org.length) document.getElementById('org-tab-btn').style.display = 'none';
  else safeRender(renderOrgChart, 'Org Chart');
  showToast('Person deleted', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
}

// ─── PROJECT INFO EDITING ─────────────────────────────────────────────────────
/** Opens the project info editor in the side panel. Second call closes it (toggle). */
function openInfoPanel() {
  if (state.spCurrentType === 'info') { closeSidePanel(); return; }
  state.spOpener = document.activeElement;
  document.getElementById('sp-title').textContent = 'Project Info';

  const STANDARD = ['Project Title','Project Subtitle','File Administrator','Program Start','Program End','Work Days','Weight Unit'];
  const PHASES   = Array.from({ length: 20 }, (_, i) => `Phase ${i + 1} Name`);
  const extraKeys = Object.keys(state.ProjectData.info).filter(k => !STANDARD.includes(k) && !PHASES.includes(k));

  const field = (key) => `<div class="sp-form-group" data-info-key="${esc(key)}">
    <label class="sp-form-label">${esc(key)}</label>
    <input class="sp-form-input info-edit-input" type="text" value="${esc(String(state.ProjectData.info[key] || ''))}">
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
  state.spCurrentType = 'info'; state.spCurrentId = null;
  showSidePanel();
}

function saveInfoPanel() {
  pushUndo('edit project info');
  document.querySelectorAll('#sp-body [data-info-key]').forEach(group => {
    const key = group.dataset.infoKey;
    const val = group.querySelector('.info-edit-input').value.trim();
    if (val) state.ProjectData.info[key] = val; else delete state.ProjectData.info[key];
  });
  const wd = state.ProjectData.info['Work Days'];
  if (wd) { state.ganttWorkDays = parseWorkDays(String(wd)); safeSetItem('vh-workdays', JSON.stringify(state.ganttWorkDays)); }
  const title    = state.ProjectData.info['Project Title']      || 'Vehicle Design Dashboard';
  const subtitle = state.ProjectData.info['Project Subtitle']   || '';
  const admin    = state.ProjectData.info['File Administrator'] || '';
  const subParts = [subtitle, admin ? 'File Admin: ' + admin : ''].filter(Boolean);
  const titleEl2 = document.getElementById('project-title');
  titleEl2.textContent = title;
  titleEl2.setAttribute('title', title);
  document.getElementById('project-subtitle').textContent = subParts.join(' · ') || 'Project Dashboard';
  document.title = title + ' — Program Dashboard';
  safeRender(renderGantt,    'Gantt Chart');
  safeRender(renderProgDash, 'Program Dashboard');
  showToast('Project info saved');
}

// showSidePanel, closeSidePanel — imported from ./ui/panelBase.js


// ─── Init: restore persisted zoom indices and work days button label ──────────
(function initPersistedState() {
  const savedGanttZoom = parseInt(localStorage.getItem('vh-zoom-gantt'));
  if (!isNaN(savedGanttZoom) && savedGanttZoom >= 0 && savedGanttZoom < ZOOM_STEPS.length) {
    state.zoomIdx   = savedGanttZoom;
    state.ganttZoom = ZOOM_STEPS[state.zoomIdx];
    document.getElementById('zoom-label').textContent = Math.round((state.ganttZoom / 4) * 100) + '%';
  }
  const savedSpecsZoom = parseInt(localStorage.getItem('vh-zoom-specs'));
  if (!isNaN(savedSpecsZoom) && savedSpecsZoom >= 0 && savedSpecsZoom < SPECS_ZOOM_STEPS.length) {
    state.specsZoomIdx = savedSpecsZoom;
    document.getElementById('specs-zoom-label').textContent = Math.round((SPECS_ZOOM_STEPS[state.specsZoomIdx] / 0.84) * 100) + '%';
  }
  const savedOrgZoom = parseInt(localStorage.getItem('vh-zoom-org'));
  if (!isNaN(savedOrgZoom) && savedOrgZoom >= 0 && savedOrgZoom < ORG_ZOOM_STEPS.length) {
    state.orgZoomIdx = savedOrgZoom;
    document.getElementById('org-zoom-label').textContent = Math.round(ORG_ZOOM_STEPS[state.orgZoomIdx] * 100) + '%';
  }
  // Restore CP toggle state
  if (localStorage.getItem('vh-show-cp') === '1') {
    state.showCriticalPath = true;
    const cpBtn = document.getElementById('gantt-cp-btn');
    if (cpBtn) cpBtn.setAttribute('aria-pressed', 'true');
  }
  // Restore legend toggle state
  if (localStorage.getItem('vh-gantt-legend') === '1') {
    state.showGanttLegend = true;
    const legendBtn = document.getElementById('legend-btn');
    if (legendBtn) legendBtn.setAttribute('aria-expanded', 'true');
  }

  // Sync work days button label
  const wdBtn = document.getElementById('workdays-btn');
  if (wdBtn) wdBtn.textContent = workdaysSummary(state.ganttWorkDays) + ' ▾';

  // Wire org search input
  let _orgSearchTimer = null;
  const osInput = document.getElementById('org-search');
  const osClear = document.getElementById('org-search-clear');
  if (osInput) {
    osInput.addEventListener('input', () => {
      state.orgSearchQuery = osInput.value;
      if (osClear) osClear.style.display = state.orgSearchQuery ? 'block' : 'none';
      clearTimeout(_orgSearchTimer);
      _orgSearchTimer = setTimeout(renderOrgChart, 200);
    });
    osInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { state.orgSearchQuery = ''; osInput.value = ''; if (osClear) osClear.style.display = 'none'; renderOrgChart(); }
    });
  }

  // Wire spec search input
  let _specSearchTimer = null;
  const ssInput = document.getElementById('specs-search');
  const ssClear = document.getElementById('specs-search-clear');
  if (ssInput) {
    ssInput.addEventListener('input', () => {
      state.specSearchQuery = ssInput.value;
      safeSetItem('vh-filter-specs-search', state.specSearchQuery);
      if (ssClear) ssClear.style.display = state.specSearchQuery ? 'block' : 'none';
      clearTimeout(_specSearchTimer);
      _specSearchTimer = setTimeout(renderSpecTable, 200);
    });
    ssInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        state.specSearchQuery = ''; ssInput.value = '';
        localStorage.removeItem('vh-filter-specs-search');
        if (ssClear) ssClear.style.display = 'none'; renderSpecTable();
      }
    });
    // Restore saved spec search query on page load
    const savedSearch = localStorage.getItem('vh-filter-specs-search') || '';
    if (savedSearch) { ssInput.value = savedSearch; state.specSearchQuery = savedSearch; if (ssClear) ssClear.style.display = 'block'; }
  }

  // Restore saved Gantt phase and team filter on page load
  const _savedPhase = localStorage.getItem('vh-filter-phase');
  if (_savedPhase) state.ganttPhaseFilter = _savedPhase;
  const _savedTeam = localStorage.getItem('vh-filter-team');
  if (_savedTeam) state.ganttTeamFilter = _savedTeam;

  // Register handler callbacks for render modules (avoids circular imports)
  state.handlers.openWeightPanel  = openWeightPanel;
  state.handlers.openTaskPanel    = openTaskPanel;
  state.handlers.openSpecPanel    = openSpecPanel;
  state.handlers.openSpecEditPanel = openSpecEditPanel;
  state.handlers.openTaskEditPanel = openTaskEditPanel;
  state.handlers.openOrgPanel     = openOrgPanel;
  state.handlers.toggleHelp      = toggleHelp;
  state.handlers.applyUndo       = applyUndo;
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
  state.specSearchQuery = '';
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
  state.orgSearchQuery = '';
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
  if (state.isDirty) { e.preventDefault(); return (e.returnValue = ''); }
});

// Draft restore on page load
(function checkForDraft() {
  const raw = localStorage.getItem('vh-draft');
  if (!raw) return;
  let draft;
  try { draft = JSON.parse(raw); } catch { localStorage.removeItem('vh-draft'); return; }
  if (!draft.snapshot || !Array.isArray(draft.snapshot.tasks)) { localStorage.removeItem('vh-draft'); return; }
  // Basic schema guard — each task must have a numeric id and a name string
  const tasksValid = draft.snapshot.tasks.every(t => typeof t.id === 'number' && typeof t.name === 'string');
  if (!tasksValid) { localStorage.removeItem('vh-draft'); return; }

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
    state.ProjectData.tasks   = snap.tasks;
    state.ProjectData.specs   = snap.specs   || [];
    state.ProjectData.org     = snap.org     || [];
    state.ProjectData.weights = snap.weights || [];
    state.ProjectData.info    = snap.info    || {};
    state.originalTasks = state.ProjectData.tasks.map(t => ({ ...t, deps: [...(t.deps || [])] }));
    recalcWBS(state.ProjectData.tasks);
    state.isDirty = true;
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
