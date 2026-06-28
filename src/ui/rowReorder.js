import { state } from '../state.js';
import { RH } from '../constants.js';
import { renderGantt } from '../render/gantt.js';
import { pushUndo } from '../core/undo.js';
import { recalcHierarchy } from '../compute/hierarchy.js';
import { buildOrgIndex, resolveNames } from '../compute/orgLookup.js';
import { showToast } from './toast.js';

// Same POC-team derivation the Gantt filter uses, so reorder index math matches the view.
function matchesTeamFilter(t, orgIndex) {
  if (state.ganttTeamFilter === 'all') return true;
  const tm = resolveNames(t.poc, orgIndex).teams;
  return (tm.length ? tm : ['Unassigned']).includes(state.ganttTeamFilter);
}

export function startRowDrag(e, visIdx, t, rowEl) {
  const lb = document.getElementById('gantt-left-body');
  const taskRowCount = lb.querySelectorAll('.gantt-row').length;

  state.rowDrag.active   = true;
  state.rowDrag.srcIdx   = visIdx;
  state.rowDrag.dropIdx  = visIdx;
  state.rowDrag.rowCount = taskRowCount;
  state.rowDrag.lb       = lb;

  const ghost = document.createElement('div');
  ghost.className = 'gantt-row-ghost';
  ghost.textContent = t.wbs + '  ' + t.name;
  ghost.style.left = (e.clientX + 10) + 'px';
  ghost.style.top  = (e.clientY - 17) + 'px';
  document.body.appendChild(ghost);
  state.rowDrag.ghost = ghost;

  const indicator = document.createElement('div');
  indicator.style.cssText = 'position:fixed;z-index:801;height:2px;background:var(--accent);pointer-events:none;display:none';
  document.body.appendChild(indicator);
  state.rowDrag.indicator = indicator;

  e.preventDefault();
}

export function doRowDragMove(e) {
  if (!state.rowDrag.active) return;
  const lb = state.rowDrag.lb;

  state.rowDrag.ghost.style.left = (e.clientX + 10) + 'px';
  state.rowDrag.ghost.style.top  = (e.clientY - 17) + 'px';

  const lbRect  = lb.getBoundingClientRect();
  const relY    = e.clientY - lbRect.top + lb.scrollTop;
  const dropIdx = Math.min(Math.max(0, Math.round(relY / RH)), state.rowDrag.rowCount);
  state.rowDrag.dropIdx = dropIdx;

  const indicatorY = lbRect.top + dropIdx * RH - lb.scrollTop;
  state.rowDrag.indicator.style.left    = lbRect.left + 'px';
  state.rowDrag.indicator.style.width   = lbRect.width + 'px';
  state.rowDrag.indicator.style.top     = indicatorY + 'px';
  state.rowDrag.indicator.style.display = 'block';
}

export function endRowDrag(e) {
  if (!state.rowDrag.active) return;
  state.rowDrag.active = false;
  if (state.rowDrag.ghost)     { state.rowDrag.ghost.remove();     state.rowDrag.ghost     = null; }
  if (state.rowDrag.indicator) { state.rowDrag.indicator.remove(); state.rowDrag.indicator = null; }

  const srcIdx  = state.rowDrag.srcIdx;
  const dropIdx = state.rowDrag.dropIdx;

  if (dropIdx === srcIdx || dropIdx === srcIdx + 1) { renderGantt(); return; }

  // Use the exact rows the Gantt rendered (collapse + depth applied) so indices line up.
  const visible = state.ganttVisibleTasks || [];
  const dragged = visible[srcIdx];
  if (!dragged) { renderGantt(); return; }
  // Row to insert before (dropIdx === visible.length → append). Skip if it's the dragged row.
  const targetTask = visible[dropIdx] && visible[dropIdx] !== dragged ? visible[dropIdx] : null;

  pushUndo('task reorder');
  // Move the dragged row; its descendants follow automatically because recalcHierarchy
  // re-sorts the flat array into DFS order by parentId (drag never changes parentId, so a
  // subtask can only be reordered within its own parent).
  const origIdx = state.ProjectData.tasks.indexOf(dragged);
  state.ProjectData.tasks.splice(origIdx, 1);
  let insertIdx = targetTask ? state.ProjectData.tasks.indexOf(targetTask) : state.ProjectData.tasks.length;
  if (insertIdx < 0) insertIdx = state.ProjectData.tasks.length;
  state.ProjectData.tasks.splice(insertIdx, 0, dragged);
  recalcHierarchy(state.ProjectData.tasks, state.ganttWorkDays);
  renderGantt();
  showToast('Task reordered', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
}
