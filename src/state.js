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
};
