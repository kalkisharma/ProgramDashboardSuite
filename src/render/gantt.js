import { state } from '../state.js';
import { esc, fmt, parseDate, daysBetween, parseWorkDays, isWorkDay, addDays, snapToWorkDay, countWorkDays, workDaysRemaining, wdDisplay, getToday } from '../utils.js';
import { ZOOM_STEPS, SPECS_ZOOM_STEPS, ORG_ZOOM_STEPS, RH, HH, PHASE_NAMES_FALLBACK } from '../constants.js';
import { phaseColor, PHASE_COLORS } from '../colors.js';
import { computeCriticalPath } from '../compute/criticalPath.js';
import { computeConflicts } from '../compute/conflicts.js';
import { recalcHierarchy } from '../compute/hierarchy.js';
import { childrenOf, descendantsOf } from '../compute/wbs.js';
import { buildOrgIndex, resolveNames } from '../compute/orgLookup.js';
import { getPhaseNames } from './progDash.js';
import { showTooltip, hideTooltip, positionTooltip } from '../ui/tooltip.js';
import { showToast, safeSetItem } from '../ui/toast.js';
import { pushUndo, pushUndoSnapshot, fullSnapshot } from '../core/undo.js';
import { startRowDrag, doRowDragMove, endRowDrag } from '../ui/rowReorder.js';

// ZOOM_STEPS, RH, HH imported from ./constants.js
// ganttMinDateRef, ganttTodayX — moved to state.js
// _draftTimer, _exportReminderTimer — managed in ./core/undo.js
export function setGanttPhaseFilter(val) { state.ganttPhaseFilter = val; safeSetItem('vh-filter-phase', val); renderGantt(); }
export function setGanttTeamFilter(val)  { state.ganttTeamFilter  = val; safeSetItem('vh-filter-team', val);  renderGantt(); }
export function clearGanttFilters() {
  document.getElementById('gantt-phase-filter').value = 'all';
  document.getElementById('gantt-team-filter').value  = 'all';
  const depthSel = document.getElementById('gantt-depth-filter');
  if (depthSel) depthSel.value = 'all';
  state.ganttPhaseFilter = 'all'; state.ganttTeamFilter = 'all'; state.ganttDepthFilter = null;
  renderGantt();
}
export function toggleTaskCollapse(taskId) {
  if (state.collapsedTasks.has(taskId)) state.collapsedTasks.delete(taskId); else state.collapsedTasks.add(taskId);
  safeSetItem('vh-collapsed-tasks', JSON.stringify([...state.collapsedTasks]));
  renderGantt();
}

export function setGanttDepthFilter(val) {
  state.ganttDepthFilter = (val === 'all' || val == null) ? null : parseInt(val);
  safeSetItem('vh-gantt-depth', JSON.stringify(state.ganttDepthFilter));
  renderGantt();
}

// Drag-pan state for gantt-right
let ganttDragging = false, ganttDragDidMove = false, ganttDragStartX, ganttDragScrollLeft;
// Tracks whether a bar drag actually moved — persists through the post-mouseup click event
let _barDragWasActive = false;
// Delay timer for Gantt tooltip — prevents tooltip firing during quick scans
let _tooltipTimer = null;

export function getBarZone(svgX, t) {
  const barX = daysBetween(state.ganttMinDateRef, t.start) * state.ganttZoom;
  const barW = Math.max(daysBetween(t.start, t.end) * state.ganttZoom, state.ganttZoom);
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

export function startBarDrag(e, taskId) {
  const right = document.getElementById('gantt-right');
  const t = state.ProjectData.tasks.find(t => t.id === taskId);
  if (!t || !t.start || !t.end) { startPanDrag(e); return; }
  const svgX = e.clientX - right.getBoundingClientRect().left + right.scrollLeft;
  const zone = getBarZone(svgX, t);
  if (!zone) { startPanDrag(e); return; }
  _barDragWasActive = false;
  state.barDragPreSnapshot = fullSnapshot();
  state.barDrag.pending = true; state.barDrag.taskId = taskId; state.barDrag.mode = zone;
  state.barDrag.startClientX = e.clientX; state.barDrag.startScrollLeft = right.scrollLeft;
  state.barDrag.origStart = new Date(t.start); state.barDrag.origEnd = new Date(t.end);
  state.barDrag.downTime = Date.now();
  const isMoveZone = zone === 'move' || zone === 'milestone';
  state.barDrag.holdReady = !isMoveZone; // resize zones activate on movement; move requires a hold first
  if (isMoveZone) {
    state.barDrag.holdTimer = setTimeout(() => {
      state.barDrag.holdReady = true;
      document.getElementById('gantt-right').style.cursor = 'grabbing';
    }, 300);
  }
  hideTooltip(); e.preventDefault();
}

export function startPanDrag(e) {
  const right = document.getElementById('gantt-right');
  ganttDragging = true; ganttDragDidMove = false;
  ganttDragStartX = e.pageX; ganttDragScrollLeft = right.scrollLeft;
  right.classList.add('dragging'); e.preventDefault();
}

function updateBarElementsDirect(taskId, newStart, newEnd) {
  const els = state.barEls[taskId];
  if (!els || !state.ganttMinDateRef) return;
  const x = daysBetween(state.ganttMinDateRef, newStart) * state.ganttZoom;
  const w = Math.max(daysBetween(newStart, newEnd) * state.ganttZoom, state.ganttZoom);
  const t = state.ProjectData.tasks.find(t => t.id === taskId);
  if (!t) return;
  if (t.milestone) {
    if (els.diamond) {
      const mx = x + w, sz = 7, my = els.midY;
      els.diamond.setAttribute('points', `${mx},${my-sz} ${mx+sz},${my} ${mx},${my+sz} ${mx-sz},${my}`);
    }
  } else {
    if (els.bgRect)      { els.bgRect.setAttribute('x', x); els.bgRect.setAttribute('width', w); }
    if (els.progRect)    { els.progRect.setAttribute('x', x); els.progRect.setAttribute('width', w * (t.pct / 100)); }
    if (els.outlineRect) { els.outlineRect.setAttribute('x', x); els.outlineRect.setAttribute('width', w); }
    if (els.cpRing)      { els.cpRing.setAttribute('x', x - 1); els.cpRing.setAttribute('width', w + 2); }
    if (els.overRing)    { els.overRing.setAttribute('x', x - 1); els.overRing.setAttribute('width', w + 2); }
  }
}

function updateDepArrowsDirect() {
  state.depArrowEls.forEach(({ el, predId, succId }) => {
    const predEls = state.barEls[predId];
    const succEls = state.barEls[succId];
    if (!predEls || !succEls) return;
    let x1, x2;
    if (predEls.diamond) {
      const pts = predEls.diamond.getAttribute('points').split(' ');
      x1 = parseFloat(pts[1].split(',')[0]); // rightmost point = mx+sz
    } else if (predEls.bgRect) {
      x1 = parseFloat(predEls.bgRect.getAttribute('x')) + parseFloat(predEls.bgRect.getAttribute('width'));
    }
    if (succEls.diamond) {
      const pts = succEls.diamond.getAttribute('points').split(' ');
      x2 = parseFloat(pts[3].split(',')[0]); // leftmost point = mx-sz
    } else if (succEls.bgRect) {
      x2 = parseFloat(succEls.bgRect.getAttribute('x'));
    }
    if (x1 == null || x2 == null) return;
    const ox = Math.max(x1 + 8, x2 - 8);
    el.setAttribute('d', `M ${x1} ${predEls.midY} L ${ox} ${predEls.midY} L ${ox} ${succEls.midY} L ${x2} ${succEls.midY}`);
  });
}

function doBarDragMove(e) {
  if (state.barDrag.pending) {
    const isMoveZone = state.barDrag.mode === 'move' || state.barDrag.mode === 'milestone';
    const spatialOk  = Math.abs(e.clientX - state.barDrag.startClientX) > (isMoveZone ? 4 : 8);
    const temporalOk = isMoveZone ? state.barDrag.holdReady : (Date.now() - state.barDrag.downTime) > 80;
    if (spatialOk && temporalOk) {
      state.barDrag.pending = false; state.barDrag.active = true; _barDragWasActive = true;
      const right = document.getElementById('gantt-right');
      right.style.cursor = isMoveZone ? 'grabbing' : 'ew-resize';
    }
  }
  if (!state.barDrag.active) return;
  const right = document.getElementById('gantt-right');
  const scrollDelta = right.scrollLeft - state.barDrag.startScrollLeft;
  const pixelDelta  = (e.clientX - state.barDrag.startClientX) + scrollDelta;
  const rawDays     = pixelDelta / state.ganttZoom;

  let newStart = new Date(state.barDrag.origStart);
  let newEnd   = new Date(state.barDrag.origEnd);

  if (state.barDrag.mode === 'move' || state.barDrag.mode === 'milestone') {
    const dur = daysBetween(state.barDrag.origStart, state.barDrag.origEnd);
    newStart = snapToWorkDay(addDays(state.barDrag.origStart, Math.round(rawDays)), state.ganttWorkDays, 1);
    newEnd   = addDays(newStart, dur);
    if (!isWorkDay(newEnd, state.ganttWorkDays)) newEnd = snapToWorkDay(newEnd, state.ganttWorkDays, 1);
  } else if (state.barDrag.mode === 'resize-left') {
    newStart = snapToWorkDay(addDays(state.barDrag.origStart, Math.round(rawDays)), state.ganttWorkDays, 1);
    // Enforce min 1 work-day gap
    if (daysBetween(newStart, newEnd) < 1) newStart = snapToWorkDay(addDays(newEnd, -1), state.ganttWorkDays, -1);
  } else if (state.barDrag.mode === 'resize-right') {
    newEnd = snapToWorkDay(addDays(state.barDrag.origEnd, Math.round(rawDays)), state.ganttWorkDays, 1);
    if (daysBetween(newStart, newEnd) < 1) newEnd = snapToWorkDay(addDays(newStart, 1), state.ganttWorkDays, 1);
  }

  const t = state.ProjectData.tasks.find(t => t.id === state.barDrag.taskId);
  if (t) { t.start = newStart; t.end = newEnd; }
  updateBarElementsDirect(state.barDrag.taskId, newStart, newEnd);
  updateDepArrowsDirect();

  const label = document.getElementById('gantt-drag-label');
  const total = countWorkDays(newStart, newEnd, state.ganttWorkDays);
  const rem   = workDaysRemaining(newEnd, state.ganttWorkDays, getToday());
  label.textContent = `${fmt(newStart)} → ${fmt(newEnd)}  ·  ${total} wd total  ·  ${rem} wd left`;
  label.style.display = 'block';
  label.style.left = Math.min(e.clientX + 16, window.innerWidth - label.offsetWidth - 10) + 'px';
  label.style.top  = (e.clientY - 34) + 'px';
}

export function endBarDrag() {
  if (!state.barDrag.active && !state.barDrag.pending) return;
  if (state.barDrag.holdTimer) { clearTimeout(state.barDrag.holdTimer); state.barDrag.holdTimer = null; }
  state.barDrag.holdReady = false;
  const wasActive = state.barDrag.active;
  state.barDrag.active = false; state.barDrag.pending = false;
  document.getElementById('gantt-drag-label').style.display = 'none';
  document.getElementById('gantt-right').style.cursor = '';
  if (wasActive) {
    const t = state.ProjectData.tasks.find(t => t.id === state.barDrag.taskId);
    if (t && t.end <= t.start) {
      t.start = state.barDrag.origStart;
      t.end   = state.barDrag.origEnd;
      state.barDragPreSnapshot = null;
      renderGantt();
      showToast('End date cannot be before start date', null, 3500);
    } else {
      // Route the pre-drag snapshot through the shared path so the edit also marks the
      // project dirty (autosave draft + beforeunload guard) and refreshes the undo buttons.
      if (state.barDragPreSnapshot) {
        pushUndoSnapshot('date adjusted', state.barDragPreSnapshot);
      }
      state.barDragPreSnapshot = null;
      const _movedId = state.barDrag.taskId;
      renderGantt();
      if (state.conflictSet.has(_movedId)) {
        showToast('⚠ Conflict: task now starts before a predecessor ends', state.handlers.applyUndo, 12000);
      } else {
        showToast('Date adjusted', state.handlers.applyUndo, 12000);
      }
    }
    // Defer reset so the immediate post-drag click event is handled first,
    // then the flag clears for all subsequent clicks (e.g. after a filter change).
    setTimeout(() => { _barDragWasActive = false; }, 0);
  }
}

export function initGanttPan() {
  const right = document.getElementById('gantt-right');
  right.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const tid = e.target.dataset && e.target.dataset.taskid ? +e.target.dataset.taskid : null;
    if (tid !== null) { startBarDrag(e, tid); return; }
    startPanDrag(e);
  });
  right.addEventListener('mousemove', e => {
    if (state.barDrag.active || ganttDragging) return;
    const tid = e.target.dataset && e.target.dataset.taskid ? +e.target.dataset.taskid : null;
    if (tid !== null && state.ganttMinDateRef) {
      const t = state.ProjectData.tasks.find(t => t.id === tid);
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
    if (state.barDrag.active || state.barDrag.pending) doBarDragMove(e);
    if (state.rowDrag.active) doRowDragMove(e);
  });
  document.addEventListener('mouseup', e => {
    if (ganttDragging) {
      ganttDragging = false;
      right.classList.remove('dragging');
      document.getElementById('gantt-header-wrap').classList.remove('dragging');
    }
    if (state.barDrag.active || state.barDrag.pending) endBarDrag();
    if (state.rowDrag.active) endRowDrag(e);
  });

  document.getElementById('gantt-header-wrap').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    document.getElementById('gantt-header-wrap').classList.add('dragging');
    startPanDrag(e);
  });
}
initGanttPan();

export function openGanttDatePicker(t, clientX, clientY) {
  const picker = document.getElementById('gantt-date-picker');
  const fields = document.getElementById('gdp-fields');
  const label  = document.getElementById('gdp-label');

  label.textContent = t.milestone ? 'Milestone Date' : 'Task Dates';
  const toVal = d => d ? fmt(d) : '';   // local calendar (no UTC off-by-one in the picker)

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
    const newStart = startEl ? parseDate(startEl.value) : null;
    const newEnd   = endEl   ? parseDate(endEl.value)   : newStart;
    if (!newStart || isNaN(newStart)) { picker.style.display = 'none'; return; }
    pushUndo('edit dates');
    t.start = snapToWorkDay(newStart, state.ganttWorkDays, 1);
    t.end   = t.milestone ? t.start : (newEnd && !isNaN(newEnd) && newEnd >= t.start ? snapToWorkDay(newEnd, state.ganttWorkDays, -1) : t.start);
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

export function initGanttColumnResize() {
  const handle = document.getElementById('gantt-resize-handle');
  const left   = document.getElementById('gantt-left');
  if (!handle || !left) return;

  const saved = localStorage.getItem('vh-gantt-left-width');
  if (saved && /^\d+px$/.test(saved)) left.style.width = saved;

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

export function initGanttNameColResize() {
  const handle = document.getElementById('gantt-name-col-handle');
  if (!handle) return;

  const saved = localStorage.getItem('vh-gantt-name-col-width');
  if (saved && /^\d+px$/.test(saved)) document.documentElement.style.setProperty('--gantt-name-col-w', saved);

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

export function initGanttWbsColResize() {
  const handle = document.getElementById('gantt-wbs-col-handle');
  if (!handle) return;

  const saved = localStorage.getItem('vh-gantt-wbs-col-width');
  if (saved && /^\d+px$/.test(saved)) document.documentElement.style.setProperty('--gantt-wbs-col-w', saved);

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
      lastW = Math.max(44, Math.min(240, startW + e.clientX - startX));
      document.documentElement.style.setProperty('--gantt-wbs-col-w', lastW + 'px');
    }
    function onUp() {
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      safeSetItem('vh-gantt-wbs-col-width', lastW + 'px');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
initGanttWbsColResize();

// Clean up drag ghosts if user alt-tabs or the window loses focus mid-drag
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.rowDrag.active) endRowDrag();
    if (state.barDrag.active || state.barDrag.pending) endBarDrag();
  }
});
window.addEventListener('blur', () => {
  if (state.rowDrag.active) endRowDrag();
  if (state.barDrag.active || state.barDrag.pending) endBarDrag();
});

export function updateGanttKeyFocus(delta) {
  const lb = document.getElementById('gantt-left-body');
  if (!lb) return;
  const rows = lb.querySelectorAll('.gantt-row');
  if (!rows.length) return;
  lb.querySelectorAll('.gantt-row.kb-focus').forEach(r => { r.classList.remove('kb-focus'); r.setAttribute('aria-selected', 'false'); });
  state.ganttKeyFocusIdx = Math.max(0, Math.min(rows.length - 1, state.ganttKeyFocusIdx + delta));
  const row = rows[state.ganttKeyFocusIdx];
  row.classList.add('kb-focus');
  row.setAttribute('aria-selected', 'true');
  row.focus();
  row.scrollIntoView({ block: 'nearest' });
  const announce = document.getElementById('gantt-row-announce');
  if (announce) {
    const label = row.getAttribute('aria-label') || row.textContent.trim().replace(/\s+/g, ' ');
    announce.textContent = '';
    requestAnimationFrame(() => { announce.textContent = `Row ${state.ganttKeyFocusIdx + 1} of ${rows.length}: ${label}`; });
  }
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('gantt-panel').classList.contains('active')) return;
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.ganttKeyFocusIdx < 0) state.ganttKeyFocusIdx = -1;
    updateGanttKeyFocus(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    updateGanttKeyFocus(-1);
  } else if (e.key === 'Enter' && state.ganttKeyFocusIdx >= 0) {
    const lb = document.getElementById('gantt-left-body');
    const rows = lb ? lb.querySelectorAll('.gantt-row') : [];
    if (rows[state.ganttKeyFocusIdx]) {
      const tid = +rows[state.ganttKeyFocusIdx].dataset.taskid;
      if (tid && state.handlers.openTaskPanel) state.handlers.openTaskPanel(tid);
    }
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault(); adjustZoom(1);
  } else if (e.key === '-') {
    e.preventDefault(); adjustZoom(-1);
  }
});

let _zoomSaveTimer = null;
export function adjustZoom(dir) {
  const right = document.getElementById('gantt-right');
  const oldPx = state.ganttZoom;
  const oldScroll = right.scrollLeft;
  state.zoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, state.zoomIdx + dir));
  state.ganttZoom = ZOOM_STEPS[state.zoomIdx];
  document.getElementById('zoom-label').textContent = Math.round((state.ganttZoom / 4) * 100) + '%';
  renderGantt();
  // Scale scroll position proportionally so the view stays anchored to the same date
  right.scrollLeft = Math.round(oldScroll * (state.ganttZoom / oldPx));
  clearTimeout(_zoomSaveTimer);
  _zoomSaveTimer = setTimeout(() => safeSetItem('vh-zoom-gantt', state.zoomIdx), 500);
}

document.getElementById('gantt-right').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  adjustZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

export function toggleGanttCalendar() {
  const cal = document.getElementById('gantt-calendar');
  const btn = document.getElementById('cal-toggle-btn');
  if (!cal) return;
  const isOpen = cal.classList.toggle('open');
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) {
    const today = new Date();
    state.calDisplayMonth = { year: today.getFullYear(), month: today.getMonth() };
    renderGanttCalendar();
  }
}

const WD_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const WD_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function workdaysSummary(wds) {
  const days = [1,2,3,4,5,6,0].filter(d => wds.includes(d)); // Mon-first display order
  if (days.length === 0) return 'No work days';
  if (JSON.stringify([...wds].sort()) === JSON.stringify([1,2,3,4,5])) return 'Mon–Fri';
  if (JSON.stringify([...wds].sort()) === JSON.stringify([1,2,3,4])) return 'Mon–Thu';
  return days.map(d => WD_NAMES[d]).join(',');
}

let _wdRenderTimer = null;
export function applyWorkDays(wds) {
  state.ganttWorkDays = wds;
  safeSetItem('vh-workdays', JSON.stringify(wds));
  const btn = document.getElementById('workdays-btn');
  if (btn) btn.textContent = workdaysSummary(wds) + ' ▾';
  clearTimeout(_wdRenderTimer);
  _wdRenderTimer = setTimeout(() => { if (state.ProjectData.tasks.length) renderGantt(); }, 300);
}

export function toggleWorkdaysPicker() {
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
        <input type="checkbox" data-dow="${d}" ${state.ganttWorkDays.includes(d) ? 'checked' : ''} style="accent-color:var(--accent)">
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
      if (btn) btn.textContent = workdaysSummary(state.ganttWorkDays) + ' ▾';
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
    state.showGanttLegend = false;
    legend.style.display = 'none';
    legendBtn.setAttribute('aria-expanded', 'false');
  }
});

export function navigateCalendar(delta) {
  if (!state.calDisplayMonth) return;
  state.calDisplayMonth.month += delta;
  if (state.calDisplayMonth.month > 11) { state.calDisplayMonth.month = 0; state.calDisplayMonth.year++; }
  if (state.calDisplayMonth.month < 0)  { state.calDisplayMonth.month = 11; state.calDisplayMonth.year--; }
  renderGanttCalendar();
}

export function renderGanttCalendar() {
  const cal = document.getElementById('gantt-calendar');
  if (!cal || !state.calDisplayMonth) return;
  const { year, month } = state.calDisplayMonth;

  const msMap = {};
  state.ProjectData.tasks.filter(t => t.milestone).forEach(t => {
    const d = t.end || t.start;
    if (!d) return;
    const key = fmt(d);   // local key to match the day-cell key built below
    if (!msMap[key]) msMap[key] = [];
    msMap[key].push({ color: phaseColor(t.wbs), name: t.name });
  });

  const phStartMap = {};
  const phaseNames = getPhaseNames();
  state.ProjectData.tasks.filter(t => !t.wbs.includes('.') || t.wbs.endsWith('.0')).forEach(t => {
    if (!t.start) return;
    const key = fmt(t.start);   // local key to match the day-cell key
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
    const off = !state.ganttWorkDays.includes(i);
    html += `<div class="cal-dh${off ? ' cal-dh-off' : ''}">${d}</div>`;
  });
  for (let i = 0; i < startDow; i++) html += `<div class="cal-d cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds      = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow     = new Date(year, month, d).getDay();
    const isOff   = !state.ganttWorkDays.includes(dow);
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

export function jumpToGanttDate(dateStr) {
  if (!state.ganttMinDateRef) return;
  const target = new Date(dateStr + 'T12:00:00');
  const msPerDay = 86400000;
  const dayOffset = (target - state.ganttMinDateRef) / msPerDay;
  const right = document.getElementById('gantt-right');
  if (!right) return;
  right.scrollLeft = Math.max(0, dayOffset * state.ganttZoom - right.clientWidth / 2);
}

// ── Specs zoom ────────────────────────────────────────────────────────────────
// SPECS_ZOOM_STEPS imported from ./constants.js
let _specsZoomSaveTimer = null;
export function adjustSpecsZoom(dir) {
  state.specsZoomIdx = Math.max(0, Math.min(SPECS_ZOOM_STEPS.length - 1, state.specsZoomIdx + dir));
  const scale = SPECS_ZOOM_STEPS[state.specsZoomIdx];
  document.getElementById('specs-zoom-label').textContent = Math.round((scale / 0.84) * 100) + '%';
  const tbl = document.querySelector('.specs-table');
  if (tbl) tbl.style.fontSize = scale + 'rem';
  clearTimeout(_specsZoomSaveTimer);
  _specsZoomSaveTimer = setTimeout(() => safeSetItem('vh-zoom-specs', state.specsZoomIdx), 500);
}
document.getElementById('specs-body').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  adjustSpecsZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ── Org zoom ──────────────────────────────────────────────────────────────────
// ORG_ZOOM_STEPS imported from ./constants.js
let _orgZoomSaveTimer = null;
export function adjustOrgZoom(dir) {
  state.orgZoomIdx = Math.max(0, Math.min(ORG_ZOOM_STEPS.length - 1, state.orgZoomIdx + dir));
  const scale = ORG_ZOOM_STEPS[state.orgZoomIdx];
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
  _orgZoomSaveTimer = setTimeout(() => safeSetItem('vh-zoom-org', state.orgZoomIdx), 500);
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

export function updateTodayFloat() {
  const floatEl = document.getElementById('gantt-today-float');
  const right   = document.getElementById('gantt-right');
  if (!floatEl || !right || state.ganttTodayX === null) { if (floatEl) floatEl.style.display = 'none'; return; }
  const visLeft  = right.scrollLeft;
  const visRight = right.scrollLeft + right.clientWidth;
  // Show float only when Today line is off the left edge (header label is visible when in view)
  if (state.ganttTodayX >= visLeft && state.ganttTodayX <= visRight) {
    floatEl.style.display = 'none';
    return;
  }
  floatEl.style.display = 'block';
  // Position horizontally: clamp to visible area edge
  const clampedX = Math.max(visLeft + 30, Math.min(state.ganttTodayX, visRight - 30));
  floatEl.style.left = (clampedX - visLeft) + 'px';
  // Position vertically: just below the header, above the body rows
  floatEl.style.top = '66px';
}

// computeCriticalPath, computeConflicts imported from ./compute/

export function toggleCriticalPath() {
  state.showCriticalPath = !state.showCriticalPath;
  safeSetItem('vh-show-cp', state.showCriticalPath ? '1' : '');
  const btn = document.getElementById('gantt-cp-btn');
  if (btn) btn.setAttribute('aria-pressed', state.showCriticalPath ? 'true' : 'false');
  renderGantt();
}

export function toggleGanttLegend() {
  state.showGanttLegend = !state.showGanttLegend;
  safeSetItem('vh-gantt-legend', state.showGanttLegend ? '1' : '');
  const btn = document.getElementById('legend-btn');
  const panel = document.getElementById('gantt-legend');
  if (!btn || !panel) return;
  btn.setAttribute('aria-expanded', state.showGanttLegend ? 'true' : 'false');
  panel.style.display = state.showGanttLegend ? 'block' : 'none';
  if (state.showGanttLegend) renderGanttLegend();
}

export function renderGanttLegend() {
  const panel = document.getElementById('gantt-legend');
  if (!panel) return;
  const phaseNamesMap = getPhaseNames();
  const allPhases = [...new Set(state.ProjectData.tasks.map(t => parseInt(String(t.wbs).split('.')[0]) || 1))].sort((a,b) => a-b);
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

export function exportGanttSVG() {
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
  a.download = `${state.ProjectData.info['Project Title'] || 'Gantt'} - Gantt - ${fmt(getToday())}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportGanttPNG() {
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
      a.download = `${state.ProjectData.info['Project Title'] || 'Gantt'} - Gantt - ${fmt(getToday())}.png`;
      a.click();
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(svgUrl);
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(svgUrl);
  img.src = svgUrl;
}

/** Full re-render of the Gantt chart (left task list + SVG bars + header). Called after every data mutation. */
export function renderGantt() {
  const right = document.getElementById('gantt-right');
  const lb    = document.getElementById('gantt-left-body');
  const savedScrollLeft = right ? right.scrollLeft : 0;
  const savedScrollTop  = lb   ? lb.scrollTop      : 0;

  const data = prepareGanttData();
  if (!data) return;
  renderGanttLeft(data);
  renderGanttSVG(data);

  if (right) right.scrollLeft = savedScrollLeft;
  if (lb)    lb.scrollTop     = savedScrollTop;
}

export function prepareGanttData() {
  // Chokepoint: keep the tree normalized + parent rollups current before every render.
  // Idempotent when nothing changed (stable DFS order, derived parent values).
  recalcHierarchy(state.ProjectData.tasks, state.ganttWorkDays);
  if (!state.ProjectData.tasks.length) {
    if (state.dashboardLoaded) {
      const lb = document.getElementById('gantt-left-body');
      if (lb) {
        lb.innerHTML = `<div role="status" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:10px;color:var(--muted);text-align:center">
          <div style="font-size:2rem">📋</div>
          <div style="font-weight:700;color:var(--text)">No tasks found</div>
          <div style="font-size:0.82rem">Check that your Excel file includes a <code style="background:var(--bg);padding:1px 5px;border-radius:3px">Schedule</code> sheet with at least one task row.</div>
          <button class="empty-help-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.82rem;text-decoration:underline;padding:0;margin-top:4px">Open help guide</button>
        </div>`;
        lb.querySelector('.empty-help-btn').addEventListener('click', () => state.handlers.toggleHelp && state.handlers.toggleHelp());
      }
    }
    return null;
  }

  // ── Populate filter dropdowns ──────────────────────
  const orgIndex = buildOrgIndex(state.ProjectData.org);
  // A task's POC team(s), derived from the org chart; 'Unassigned' when none resolve.
  const pocTeamsOf = t => { const tm = resolveNames(t.poc, orgIndex).teams; return tm.length ? tm : ['Unassigned']; };
  const phaseNamesMap = getPhaseNames();
  const allPhases = [...new Set(state.ProjectData.tasks.map(t => parseInt(String(t.wbs).split('.')[0]) || 1))].sort((a,b)=>a-b);
  const allTeams  = [...new Set(state.ProjectData.tasks.flatMap(pocTeamsOf))].sort();

  const phaseSel  = document.getElementById('gantt-phase-filter');
  if (phaseSel) {
    phaseSel.innerHTML = '<option value="all">All</option>';
    allPhases.forEach(ph => {
      const label = phaseNamesMap[ph] || PHASE_NAMES_FALLBACK[ph-1] || 'Phase ' + ph;
      phaseSel.innerHTML += `<option value="${ph}">${ph}. ${esc(label)}</option>`;
    });
    if (!allPhases.map(String).includes(state.ganttPhaseFilter)) {
      state.ganttPhaseFilter = 'all';
      localStorage.removeItem('vh-filter-phase');
    }
    phaseSel.value = state.ganttPhaseFilter;
  }

  const teamSel   = document.getElementById('gantt-team-filter');
  if (teamSel) {
    teamSel.innerHTML = '<option value="all">All</option>';
    allTeams.forEach(tm => { teamSel.innerHTML += `<option value="${esc(tm)}">${esc(tm)}</option>`; });
    if (!allTeams.includes(state.ganttTeamFilter) && state.ganttTeamFilter !== 'all') {
      state.ganttTeamFilter = 'all';
      localStorage.removeItem('vh-filter-team');
    }
    teamSel.value = state.ganttTeamFilter;
  }

  // Depth filter (hard ceiling): options All / Level 1..maxDepth present in the tree.
  const maxDepth = Math.max(1, ...state.ProjectData.tasks.map(t => t.level || 1));
  const depthSel = document.getElementById('gantt-depth-filter');
  if (depthSel) {
    let opts = '<option value="all">All</option>';
    for (let n = 1; n <= maxDepth; n++) opts += `<option value="${n}">Level ${n}</option>`;
    depthSel.innerHTML = opts;
    if (state.ganttDepthFilter != null && state.ganttDepthFilter > maxDepth) state.ganttDepthFilter = null;
    depthSel.value = state.ganttDepthFilter == null ? 'all' : String(state.ganttDepthFilter);
  }

  // ── Build filtered + collapsed task list ───────────
  const byId = {}; state.ProjectData.tasks.forEach(t => { byId[t.id] = t; });
  const collapsed = state.collapsedTasks;
  const depthCeil = state.ganttDepthFilter;        // null = no ceiling
  const hiddenByCollapse = t => {
    let p = t.parentId != null ? byId[t.parentId] : null; const seen = new Set();
    while (p && !seen.has(p.id)) { seen.add(p.id); if (collapsed.has(p.id)) return true; p = p.parentId != null ? byId[p.parentId] : null; }
    return false;
  };
  const visibleTasks = state.ProjectData.tasks.filter(t => {
    const ph = String(parseInt(String(t.wbs).split('.')[0]) || 1);
    if (state.ganttPhaseFilter !== 'all' && ph !== state.ganttPhaseFilter) return false;
    if (state.ganttTeamFilter  !== 'all' && !pocTeamsOf(t).includes(state.ganttTeamFilter)) return false;
    if (depthCeil && (t.level || 1) > depthCeil) return false;   // hard ceiling (D6)
    if (hiddenByCollapse(t)) return false;
    return true;
  });
  state.ganttVisibleTasks = visibleTasks; // shared with rowReorder so drag indices align

  const lb = document.getElementById('gantt-left-body');
  if (!visibleTasks.length) {
    lb.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:0.82rem;text-align:center">No tasks match the current filters. <button class="gantt-clear-filter-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;text-decoration:underline;padding:0">Clear filters</button></div>';
    lb.querySelector('.gantt-clear-filter-btn').addEventListener('click', clearGanttFilters);
    document.getElementById('gantt-svg-wrap').innerHTML = '';
    document.getElementById('gantt-header-svg-wrap').innerHTML = '';
    return null;
  }

  // Use full task set for date axis so the time range stays stable when filtering
  const dates = state.ProjectData.tasks.flatMap(t => [t.start, t.end]).filter(Boolean);
  const minD = new Date(Math.min(...dates)); minD.setDate(minD.getDate() - 7);
  const maxD = new Date(Math.max(...dates)); maxD.setDate(maxD.getDate() + 21);
  state.ganttMinDateRef = minD;
  const totalDays = daysBetween(minD, maxD);
  const W = totalDays * state.ganttZoom;
  const bodyH = visibleTasks.length * RH;
  // CPM runs at leaf level (Phase 3). For collapsed parents, surface criticality on the
  // parent row if any hidden descendant is critical (D4).
  const cpLeaves = state.showCriticalPath ? computeCriticalPath(state.ProjectData.tasks) : new Set();
  const cpSet = new Set(cpLeaves);
  if (state.showCriticalPath) {
    state.ProjectData.tasks.forEach(t => {
      if (collapsed.has(t.id) && descendantsOf(state.ProjectData.tasks, t.id).some(d => cpLeaves.has(d.id))) cpSet.add(t.id);
    });
  }
  state.conflictSet = computeConflicts(state.ProjectData.tasks);
  const exportBtn = document.getElementById('gantt-export-svg-btn');
  if (exportBtn) exportBtn.disabled = false;
  const exportPngBtn = document.getElementById('gantt-export-png-btn');
  if (exportPngBtn) exportPngBtn.disabled = false;

  const tx = daysBetween(minD, getToday()) * state.ganttZoom;
  state.ganttTodayX = (tx > 0 && tx < W) ? tx : null;

  const isFiltered = state.ganttPhaseFilter !== 'all' || state.ganttTeamFilter !== 'all';

  return { visibleTasks, isFiltered, minD, maxD, W, bodyH, cpSet, conflictSet: state.conflictSet, tx };
}

export function renderGanttLeft({ visibleTasks, isFiltered, conflictSet }) {
  const lb = document.getElementById('gantt-left-body');
  const orgIndex = buildOrgIndex(state.ProjectData.org);
  lb.innerHTML = '';
  visibleTasks.forEach((t, i) => {
    const color = phaseColor(t.wbs);
    const pocTeam = resolveNames(t.poc, orgIndex).teams.join(', ');
    const pctColor = t.pct === 100 ? '#3fb950' : t.pct > 0 ? '#d29922' : '#484f58';
    const level = t.level || 1;
    const depth = level - 1;                       // 0 for phases, 1 task, 2 subtask, …
    const wd = t.milestone ? { text: '◆', cls: '' } : wdDisplay(t, state.ganttWorkDays, getToday());
    const isPhaseHeader = level === 1;
    const hasChildren = childrenOf(state.ProjectData.tasks, t.id).length > 0;
    const isCollapsed = state.collapsedTasks.has(t.id);
    // A parent whose children are hidden by the depth ceiling (not by manual collapse).
    const cappedByDepth = hasChildren && state.ganttDepthFilter != null && level >= state.ganttDepthFilter;
    const showHandle = !isFiltered && level > 1;   // reorder subtasks/tasks; phases stay put
    const showCollapseBtn = hasChildren;
    const div = document.createElement('div');
    div.className = 'gantt-row' + (isPhaseHeader ? ' gantt-phase-hdr' : '') + (isCollapsed ? ' phase-collapsed' : '');
    div.dataset.taskid = t.id;
    div.setAttribute('role', 'row');
    div.setAttribute('tabindex', '-1');
    div.setAttribute('aria-selected', 'false');
    if (hasChildren) div.setAttribute('aria-expanded', String(!isCollapsed));
    const _rowStart = t.start ? fmt(t.start) : 'no date';
    const _rowEnd   = t.end   ? fmt(t.end)   : 'no date';
    div.setAttribute('aria-label', `${t.wbs}: ${t.name}, ${pocTeam ? pocTeam + ' POC team' : 'no POC team'}, ${t.pct}% complete, ${_rowStart} to ${_rowEnd}${state.conflictSet.has(t.id) ? ', scheduling conflict' : ''}${isCollapsed ? ', collapsed' : ''}`);
    const toggleIcon = cappedByDepth ? '▾' : (isCollapsed ? '▶' : '▼');
    const toggleTitle = cappedByDepth ? 'Subtasks hidden by depth filter' : (isCollapsed ? 'Expand' : 'Collapse');
    div.innerHTML = `
      <div class="g-wbs-wrap" role="gridcell" style="color:${color};padding-left:${depth * 12}px">
        ${showHandle ? '<span class="gantt-drag-handle" title="Drag to reorder">⠿</span>' : ''}
        ${showCollapseBtn ? `<button class="gantt-collapse-btn${cappedByDepth ? ' capped' : ''}" ${cappedByDepth ? 'disabled' : ''} aria-label="${toggleTitle}" title="${toggleTitle}">${toggleIcon}</button>` : ''}
        <span class="g-wbs-text">${esc(t.wbs)}</span>
      </div>
      <span class="g-name" role="gridcell" style="padding-left:${depth*12}px" title="${esc(t.name)}">${t.milestone ? '◆ ' : ''}${esc(t.name)}</span>
      <span class="g-team" role="gridcell" title="${esc(pocTeam)}">${esc(pocTeam)}</span>
      <span class="g-wd ${wd.cls}" role="gridcell">${wd.text}</span>
      <span class="g-pct" role="gridcell" style="color:${pctColor}">${t.pct}%</span>
      <span class="g-conflict${state.conflictSet.has(t.id) ? ' active' : ''}" role="gridcell" aria-hidden="${state.conflictSet.has(t.id) ? 'false' : 'true'}" aria-label="Schedule overlap: starts before predecessor ends" title="Schedule overlap: starts before a predecessor ends">⚠</span>`;

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

    // Collapse/expand toggle (any task with children, unless capped by the depth ceiling)
    if (showCollapseBtn && !cappedByDepth) {
      const colBtn = div.querySelector('.gantt-collapse-btn');
      if (colBtn) {
        // The toggle lives inside the draggable WBS cell — stop its mousedown from
        // starting a row drag, otherwise the click is swallowed.
        colBtn.addEventListener('mousedown', e => e.stopPropagation());
        colBtn.addEventListener('click', e => { e.stopPropagation(); toggleTaskCollapse(t.id); });
      }
    }

    if (!isPhaseHeader) {
      // Task name inline edit
      const nameEl = div.querySelector('.g-name');
      nameEl.style.cursor = 'text';
      nameEl.setAttribute('tabindex', '0');
      nameEl.addEventListener('click',   e => { e.stopPropagation(); startTaskNameEdit(nameEl, t); });
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); startTaskNameEdit(nameEl, t); } });

      // (POC Team column is read-only — derived from the org chart; edit POC via the task panel)

      // Pct inline edit — leaf tasks only (parents' % is rolled up from children)
      if (!hasChildren) {
        const pctEl = div.querySelector('.g-pct');
        pctEl.style.cursor = 'text';
        pctEl.setAttribute('tabindex', '0');
        pctEl.addEventListener('click',   e => { e.stopPropagation(); startTaskPctEdit(pctEl, t); });
        pctEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); startTaskPctEdit(pctEl, t); } });
      }

      div.addEventListener('click', () => { if (state.handlers.openTaskPanel) state.handlers.openTaskPanel(t.id); });
    }
    div.addEventListener('mouseenter', e => {
      clearTimeout(_tooltipTimer);
      _tooltipTimer = setTimeout(() => { if (!state.barDrag.active && !state.rowDrag.active) showTooltip(t, e); }, 400);
    });
    div.addEventListener('mouseleave', () => { clearTimeout(_tooltipTimer); _tooltipTimer = null; hideTooltip(); });
    lb.appendChild(div);
  });

  // Apply keyboard-focus highlight to the tracked row (if any)
  if (state.ganttKeyFocusIdx >= 0) {
    const rows = lb.querySelectorAll('.gantt-row');
    if (rows[state.ganttKeyFocusIdx]) rows[state.ganttKeyFocusIdx].classList.add('kb-focus');
  }
}

export function renderGanttSVG({ visibleTasks, minD, maxD, W, bodyH, cpSet, tx }) {
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
  state.barEls      = {};
  state.depArrowEls = [];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', bodyH);
  svg.setAttribute('viewBox', `0 0 ${W} ${bodyH}`);
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', `Gantt chart — drag bars to adjust dates and duration. Today is ${getToday().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`);
  svg.style.display = 'block';
  if (state.showCriticalPath) svg.classList.add('cp-active');

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
    const x   = daysBetween(minD, t.start) * state.ganttZoom;
    const w   = Math.max(daysBetween(t.start, t.end) * state.ganttZoom, state.ganttZoom);
    const midY = i*RH + RH/2;
    const color = phaseColor(t.wbs);

    // Invisible hit area for the full row (carries task id for drag detection)
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', 0); hit.setAttribute('y', i*RH);
    hit.setAttribute('width', W); hit.setAttribute('height', RH);
    hit.setAttribute('fill', 'transparent');
    const _hitStart = t.start ? fmt(t.start) : '';
    const _hitEnd   = t.end   ? fmt(t.end)   : '';
    hit.setAttribute('role', 'img');
    hit.setAttribute('aria-label', `${t.milestone ? 'Milestone' : 'Task'} ${t.wbs}: ${t.name}, ${t.pct}% complete${_hitStart ? ', ' + _hitStart + ' to ' + _hitEnd : ''}`);
    hit.dataset.taskid = t.id;
    hit.addEventListener('mouseenter', e => {
      clearTimeout(_tooltipTimer);
      _tooltipTimer = setTimeout(() => {
        if (!state.barDrag.active && !state.rowDrag.active) {
          showTooltip(t, e);
          if (state.showCriticalPath) {
            Object.entries(state.barEls).forEach(([id, els]) => {
              const op = cpSet.has(t.id) ? (cpSet.has(+id) ? '1' : '0.2') : (+id === t.id ? '1' : '0.2');
              ['bgRect','progRect','outlineRect','diamond'].forEach(k => { if (els[k]) els[k].style.opacity = op; });
            });
            state.depArrowEls.forEach(({ el, predId, succId }) => {
              el.style.opacity = cpSet.has(t.id) ? ((cpSet.has(predId) && cpSet.has(succId)) ? '1' : '0.08') : '0.15';
            });
          }
        }
      }, 400);
    });
    hit.addEventListener('mouseleave', () => {
      clearTimeout(_tooltipTimer);
      _tooltipTimer = null;
      hideTooltip();
      if (state.showCriticalPath) {
        Object.entries(state.barEls).forEach(([id, els]) => {
          const base = cpSet.has(+id) ? '' : '0.35';
          ['bgRect','progRect','outlineRect','diamond'].forEach(k => { if (els[k]) els[k].style.opacity = base; });
        });
        state.depArrowEls.forEach(({ el }) => { el.style.opacity = ''; });
      }
    });
    const _isPhaseHeader = !t.wbs.includes('.') || t.wbs.endsWith('.0');
    let _clickTimer = null;
    hit.addEventListener('click', () => {
      if (_isPhaseHeader || ganttDragDidMove || _barDragWasActive || !state.handlers.openTaskPanel) return;
      clearTimeout(_clickTimer);
      _clickTimer = setTimeout(() => { _clickTimer = null; state.handlers.openTaskPanel(t.id); }, 220);
    });
    hit.addEventListener('dblclick', e => {
      e.stopPropagation();
      clearTimeout(_clickTimer); _clickTimer = null;
      if (!_isPhaseHeader) openGanttDatePicker(t, e.clientX, e.clientY);
    });
    svg.appendChild(hit);

    if (t.milestone) {
      const mx = x + w, sz = 7;
      const pts = `${mx},${midY-sz} ${mx+sz},${midY} ${mx},${midY+sz} ${mx-sz},${midY}`;
      const d = document.createElementNS(NS, 'polygon');
      d.setAttribute('points', pts); d.setAttribute('fill', color);
      d.style.pointerEvents = 'none';
      svg.appendChild(d);
      barPos[t.id] = { sx: mx - sz, ex: mx + sz, my: midY };
      state.barEls[t.id] = { diamond: d, midY };
      if (state.showCriticalPath && !cpSet.has(t.id)) d.style.opacity = '0.35';
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
      state.barEls[t.id] = { bgRect, progRect, outlineRect, midY };
      if (state.showCriticalPath && !cpSet.has(t.id)) {
        [bgRect, progRect, outlineRect].forEach(el => { if (el) el.style.opacity = '0.35'; });
      }
      // Critical path ring overlay
      if (state.showCriticalPath && cpSet.has(t.id)) {
        const ring = document.createElementNS(NS, 'rect');
        ring.setAttribute('x', x - 1); ring.setAttribute('y', by - 1);
        ring.setAttribute('width', w + 2); ring.setAttribute('height', bh + 2);
        ring.setAttribute('rx', 5); ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#e06c75'); ring.setAttribute('stroke-width', 2);
        ring.style.pointerEvents = 'none';
        svg.appendChild(ring);
        state.barEls[t.id].cpRing = ring;
      }
      // Overdue ring (non-milestone, past end date, not complete)
      if (t.end && t.end < getToday() && (t.pct || 0) < 100) {
        const overRing = document.createElementNS(NS, 'rect');
        overRing.setAttribute('x', x - 1); overRing.setAttribute('y', by - 1);
        overRing.setAttribute('width', w + 2); overRing.setAttribute('height', bh + 2);
        overRing.setAttribute('rx', 5); overRing.setAttribute('fill', 'none');
        overRing.setAttribute('stroke', '#f85149');
        overRing.setAttribute('stroke-width', 1.5);
        overRing.setAttribute('stroke-dasharray', '3 2');
        overRing.style.pointerEvents = 'none';
        svg.appendChild(overRing);
        state.barEls[t.id].overRing = overRing;
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
      const isCritical = state.showCriticalPath && cpSet.has(did) && cpSet.has(t.id);
      if (isCritical) {
        p.setAttribute('stroke', '#e06c75'); p.setAttribute('stroke-width', 2.5);
      } else {
        p.setAttribute('stroke', depStroke); p.setAttribute('stroke-width', 1.5);
        if (state.showCriticalPath) p.setAttribute('stroke-dasharray', '5 3');
      }
      p.setAttribute('marker-end', 'url(#arr)');
      p.setAttribute('tabindex', '0');
      p.setAttribute('role', 'button');
      const predTask = state.ProjectData.tasks.find(tk => tk.id === did);
      p.setAttribute('aria-label', `Open ${t.name} — depends on ${predTask ? predTask.name : did}`);
      p.style.cursor = 'pointer';
      p.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (state.handlers.openTaskPanel) state.handlers.openTaskPanel(t.id); }
      });
      const predTaskName = predTask ? predTask.name : 'Task ' + did;
      p.addEventListener('mouseenter', e => {
        clearTimeout(_tooltipTimer);
        _tooltipTimer = setTimeout(() => {
          const tip = document.getElementById('tooltip');
          if (!tip) return;
          tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px;font-size:0.8rem">Dependency</div>
            <div style="display:flex;align-items:center;gap:8px;font-size:0.82rem">
              <span style="color:var(--muted)">${esc(predTaskName)}</span>
              <span style="color:var(--accent)">→</span>
              <span>${esc(t.name)}</span>
            </div>`;
          tip.style.display = 'block'; positionTooltip(e);
        }, 400);
      });
      p.addEventListener('mousemove', positionTooltip);
      p.addEventListener('mouseleave', () => { clearTimeout(_tooltipTimer); _tooltipTimer = null; hideTooltip(); });
      state.depArrowEls.push({ el: p, predId: did, succId: t.id });
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
    if (state.handlers.openTaskPanel) state.handlers.openTaskPanel(+p.getAttribute('data-succ-id'));
  });

  // Only auto-scroll when the panel is actually visible (clientWidth > 0). When the Gantt
  // isn't the default tab it renders hidden, so defer the scroll to scrollGanttToToday()
  // on first switch to the tab (see switchTab) rather than burning the one-shot here.
  const right = document.getElementById('gantt-right');
  if (!state.ganttScrolledToday && right.clientWidth > 0 && tx > right.clientWidth / 2) {
    right.scrollLeft = tx - right.clientWidth / 2;
    state.ganttScrolledToday = true;
  }
  updateTodayFloat();
}

// Scroll the Gantt to the Today line the first time its tab becomes visible. Uses the
// today offset cached by the prepare pass (state.ganttTodayX). One-shot per file load.
export function scrollGanttToToday() {
  if (state.ganttScrolledToday) return;
  const right = document.getElementById('gantt-right');
  const tx = state.ganttTodayX;
  if (!right || right.clientWidth === 0) return;
  if (tx != null && tx > right.clientWidth / 2) right.scrollLeft = tx - right.clientWidth / 2;
  state.ganttScrolledToday = true;
  updateTodayFloat();
}

export function renderHeader(svg, NS, minD, maxD, W) {
  const isLight = document.body.classList.contains('light-mode');
  const headerBorder  = isLight ? '#d0d7de'         : '#30363d';
  const monthGridLine = isLight ? 'rgba(0,0,0,0.15)': 'rgba(48,54,61,0.6)';
  const weekGridLine  = isLight ? 'rgba(0,0,0,0.08)': 'rgba(48,54,61,0.4)';
  const monthFill     = isLight ? '#636c76'          : '#8b949e';
  const weekFill      = isLight ? '#8c959f'          : '#484f58';

  appendLine(svg, NS, 0, W, HH, HH, headerBorder, 1);
  const cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (cur <= maxD) {
    const x = daysBetween(minD, cur) * state.ganttZoom;
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
      const wx = daysBetween(minD, wk) * state.ganttZoom;
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

export function renderBodyGrid(svg, NS, minD, maxD, W, bodyH) {
  const isLight = document.body.classList.contains('light-mode');
  const monthLine = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(48,54,61,0.5)';
  const weekLine  = isLight ? 'rgba(0,0,0,0.05)'  : 'rgba(48,54,61,0.22)';
  const cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (cur <= maxD) {
    const x = daysBetween(minD, cur) * state.ganttZoom;
    appendLine(svg, NS, x, x, 0, bodyH, monthLine, 1);
    if (state.ganttZoom >= 5) {
      const nxt = new Date(cur); nxt.setMonth(nxt.getMonth()+1);
      const wk = new Date(cur); wk.setDate(wk.getDate() + (7 - wk.getDay()));
      while (wk < nxt && wk <= maxD) {
        const wx = daysBetween(minD, wk) * state.ganttZoom;
        appendLine(svg, NS, wx, wx, 0, bodyH, weekLine, 1);
        wk.setDate(wk.getDate()+7);
      }
    }
    cur.setMonth(cur.getMonth()+1);
  }
}

export function appendRect(svg, NS, x, y, w, h, fill, rx=0) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x',x); r.setAttribute('y',y);
  r.setAttribute('width',w); r.setAttribute('height',h);
  r.setAttribute('fill',fill); if (rx) r.setAttribute('rx',rx);
  svg.appendChild(r); return r;
}
export function appendLine(svg, NS, x1, x2, y1, y2, stroke, sw, dash='') {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1',x1); l.setAttribute('x2',x2);
  l.setAttribute('y1',y1); l.setAttribute('y2',y2);
  l.setAttribute('stroke',stroke); l.setAttribute('stroke-width',sw);
  if (dash) l.setAttribute('stroke-dasharray',dash);
  svg.appendChild(l); return l;
}

// ─── GANTT INLINE EDITS ──────────────────────────────────────────────────────
export function startTaskNameEdit(span, t) {
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
      showToast('Name changed', state.handlers.applyUndo, 5000);
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

export function startTaskPctEdit(span, t) {
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
      showToast('Progress updated', state.handlers.applyUndo, 5000);
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
