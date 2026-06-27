import { ZOOM_STEPS } from './constants.js';

/**
 * Single source of truth for all cross-module mutable state.
 * Import this object in any module that needs to read or write app state.
 * Never declare module-level duplicates of these fields elsewhere.
 */
export const state = {
  // ── Core program data ───────────────────────────────────────────────────────
  ProjectData:   { info: {}, tasks: [], specs: [], org: [], weights: [] },
  originalTasks: [],          // deep-copy at parse time; used by resetGanttToImported()
  ganttWorkDays: [1,2,3,4,5], // Mon–Fri default; overridden by Project Info or Work Days UI

  // ── Undo / redo ─────────────────────────────────────────────────────────────
  undoStack: [], // max 50 entries, LIFO; each: { label, snapshot }
  redoStack: [], // max 50 entries; populated by applyUndo(), cleared by pushUndo()
  isDirty:   false, // true when ProjectData has unsaved edits since last load/export

  // ── Side panel ──────────────────────────────────────────────────────────────
  spCurrentType: null, // 'spec' | 'task' | 'org' | 'weight' | 'info'
  spCurrentId:   null, // specId string, taskId number, person name, weight index, or null
  spOpener:      null, // element that opened the panel; focus restored on close

  // ── Gantt view ──────────────────────────────────────────────────────────────
  zoomIdx:          3,            // index into ZOOM_STEPS; default 4px/day
  ganttZoom:        ZOOM_STEPS[3],
  ganttPhaseFilter: 'all',
  ganttTeamFilter:  'all',
  collapsedPhases:  new Set(),    // phase numbers (ints) whose sub-tasks are hidden
  calDisplayMonth:  null,         // { year, month } visible in the mini calendar
  ganttKeyFocusIdx: -1,           // keyboard-focused row index (-1 = none)
  showCriticalPath: false,
  showGanttLegend:  false,

  // ── Gantt render state ──────────────────────────────────────────────────────
  ganttMinDateRef: null, // set by renderGantt; used by adjustZoom scroll math
  ganttTodayX:     null, // px offset of Today line; null when out of range
  depArrowEls:     [],   // { el, predId, succId } — rebuilt each renderGantt()
  conflictSet:     new Set(), // task IDs with scheduling conflicts

  // ── Bar drag ────────────────────────────────────────────────────────────────
  barDrag: {
    active: false, pending: false, taskId: null, mode: null,
    startClientX: 0, origStart: null, origEnd: null, startScrollLeft: 0,
  },
  barDragPreSnapshot: null, // full snapshot captured at drag start for undo
  barEls: {},               // taskId → { bgRect, progRect, outlineRect, diamond, midY }

  // ── Row reorder ─────────────────────────────────────────────────────────────
  rowDrag: { active: false, srcIdx: null, ghost: null, indicator: null, dropIdx: null },

  // ── Specs view ──────────────────────────────────────────────────────────────
  specsZoomIdx:    2, // index into SPECS_ZOOM_STEPS; default 0.84rem
  specSortState:   { col: null, dir: 'asc' },
  specSearchQuery: '',

  // ── Org view ────────────────────────────────────────────────────────────────
  orgZoomIdx:    4, // index into ORG_ZOOM_STEPS; default 1.0
  orgSearchQuery: '',

  // ── Status Report view ──────────────────────────────────────────────────────
  statusReportFilter: 'open',         // 'tasks' | 'open' | 'concerns'
  statusReportSort:   { col: null, dir: 'asc' },
  statusReportHiddenCols:     [],     // array of hidden column keys (e.g. 'pocTeam')
  statusReportPhases:         null,   // null = all phases; else array of selected phase numbers (as strings)
  statusReportPocTeams:       null,   // null = all; else array of selected POC team names
  statusReportCustomerTeams:  null,   // null = all; else array of selected Customer team names

  // ── Requirements view ───────────────────────────────────────────────────────
  reqsData:  { headers: [], rows: [] }, // raw parsed CSV: headers string[], rows string[][]
  reqsState: {
    sortCol:     null,  // column index (number) or null
    sortDir:     'asc',
    searchQuery: '',
    hiddenCols:  [],    // array of column indices that are hidden
    colFilters:  {},    // { colIdx: { type:'select', values:string[] } | { type:'text', value:string } }
  },

  // ── Handler registry (avoids circular imports between render/* and ui/*) ────
  // Populated by main.js after all functions are defined. Render modules call
  // these instead of importing from main.js directly.
  handlers: {
    openWeightPanel: null,
    openTaskPanel:   null,
    openSpecPanel:   null,
    openOrgPanel:    null,
    toggleHelp:      null,
    applyUndo:       null,
  },
};

/**
 * Resets all state fields to their initial values.
 * Call in beforeEach in any test that touches state to prevent bleed-through.
 */
export function resetState() {
  state.ProjectData   = { info: {}, tasks: [], specs: [], org: [], weights: [] };
  state.originalTasks = [];
  state.ganttWorkDays = [1, 2, 3, 4, 5];
  state.undoStack     = [];
  state.redoStack     = [];
  state.isDirty       = false;
  state.spCurrentType = null;
  state.spCurrentId   = null;
  state.spOpener      = null;
  state.zoomIdx          = 3;
  state.ganttZoom        = ZOOM_STEPS[3];
  state.ganttPhaseFilter = 'all';
  state.ganttTeamFilter  = 'all';
  state.collapsedPhases  = new Set();
  state.calDisplayMonth  = null;
  state.ganttKeyFocusIdx = -1;
  state.showCriticalPath = false;
  state.showGanttLegend  = false;
  state.barDrag = {
    active: false, pending: false, taskId: null, mode: null,
    startClientX: 0, origStart: null, origEnd: null, startScrollLeft: 0,
  };
  state.barDragPreSnapshot = null;
  state.barEls  = {};
  state.rowDrag = { active: false, srcIdx: null, ghost: null, indicator: null, dropIdx: null };
  state.specsZoomIdx    = 2;
  state.specSortState   = { col: null, dir: 'asc' };
  state.specSearchQuery = '';
  state.orgZoomIdx    = 4;
  state.orgSearchQuery = '';
  state.reqsData  = { headers: [], rows: [] };
  state.reqsState = { sortCol: null, sortDir: 'asc', searchQuery: '', hiddenCols: [], colFilters: {} };
  state.statusReportFilter = 'open';
  state.statusReportSort   = { col: null, dir: 'asc' };
  state.statusReportHiddenCols    = [];
  state.statusReportPhases        = null;
  state.statusReportPocTeams      = null;
  state.statusReportCustomerTeams = null;
  state.ganttMinDateRef = null;
  state.ganttTodayX     = null;
  state.depArrowEls     = [];
  state.conflictSet     = new Set();
  state.handlers = { openWeightPanel: null, openTaskPanel: null, openSpecPanel: null, openOrgPanel: null, toggleHelp: null, applyUndo: null };
}
