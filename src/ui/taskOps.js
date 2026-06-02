import { state } from '../state.js';
import { SPEC_COLORS } from '../colors.js';
import { addDays, snapToWorkDay, getToday } from '../utils.js';
import { renderGantt } from '../render/gantt.js';
import { renderSpecs } from '../render/specs.js';
import { getPhaseNames } from '../render/progDash.js';
import { pushUndo } from '../core/undo.js';
import { showToast, safeRender } from './toast.js';
import { closeSidePanel } from './panelBase.js';
import { recalcWBS } from '../compute/wbs.js';

export function addNewSpec() {
  const filterEl = document.getElementById('specs-filter');
  const activeCat = (filterEl && filterEl.value !== 'all')
    ? filterEl.value
    : (Object.keys(SPEC_COLORS)[0] || 'General');
  const prefix = activeCat.slice(0, 2).toUpperCase();
  const existingNums = state.ProjectData.specs
    .filter(s => s.id.toUpperCase().startsWith(prefix))
    .map(s => { const m = s.id.match(/(\d+)$/); return m ? parseInt(m[1]) : 0; });
  const nextNum = existingNums.length ? Math.max(...existingNums) + 1 : 1;
  const newId = prefix + '-' + String(nextNum).padStart(3, '0');
  const newSpec = {
    id: newId, category: activeCat, name: 'New Specification',
    value: '', units: '—', status: 'TBD', group: '', notes: '', depIds: []
  };
  pushUndo('spec added');
  state.ProjectData.specs.push(newSpec);
  renderSpecs();
  // Open the edit form directly so the user can fill in the name and details immediately.
  if (state.handlers.openSpecEditPanel) state.handlers.openSpecEditPanel(newId);
  else if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(newId);
}

export function deleteTask(taskId) {
  taskId = Number(taskId);
  if (!state.ProjectData.tasks.find(t => t.id === taskId)) return;
  const btn = document.getElementById('sp-delete-task-btn');
  if (btn && btn.dataset.confirming !== '1') {
    btn.dataset.confirming = '1';
    btn.textContent = 'Click again to confirm';
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
  state.ProjectData.tasks = state.ProjectData.tasks.filter(t => t.id !== taskId);
  state.ProjectData.tasks.forEach(t => { t.deps = t.deps.filter(d => d !== taskId); });
  state.ProjectData.specs.forEach(s => { s.depIds = s.depIds.filter(d => d !== taskId); });
  recalcWBS(state.ProjectData.tasks);
  safeRender(renderGantt, 'Gantt Chart');
  safeRender(renderSpecs, 'Specifications');
  closeSidePanel();
  showToast('Task deleted', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
}

export function deleteSpec(specId) {
  if (!state.ProjectData.specs.find(s => s.id === specId)) return;
  const btn = document.getElementById('sp-delete-spec-btn');
  if (btn && btn.dataset.confirming !== '1') {
    btn.dataset.confirming = '1';
    btn.textContent = 'Click again to confirm';
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
  state.ProjectData.specs = state.ProjectData.specs.filter(s => s.id !== specId);
  safeRender(renderSpecs, 'Specifications');
  closeSidePanel();
  showToast('Specification deleted', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
}

export function addGanttTask() {
  if (!state.ProjectData.tasks.length) return;
  // When a phase filter is active, add to that phase; otherwise add to the last phase
  const filteredPhase = state.ganttPhaseFilter !== 'all' ? parseInt(state.ganttPhaseFilter) : null;
  const lastTask = state.ProjectData.tasks[state.ProjectData.tasks.length - 1];
  const lastPhase = filteredPhase || (parseInt(String(lastTask.wbs).split('.')[0]) || 1);
  const phaseTasks = state.ProjectData.tasks.filter(t => parseInt(String(t.wbs).split('.')[0]) === lastPhase && t.wbs.includes('.') && !t.wbs.endsWith('.0'));
  const nextNum = phaseTasks.length + 1;
  const newWbs = lastPhase + '.' + nextNum;

  const teams = [...new Set(state.ProjectData.tasks.map(t => t.team).filter(Boolean))].sort();
  const team = teams[0] || '';

  const taskStart = snapToWorkDay(getToday(), state.ganttWorkDays, 1);
  const taskEnd   = snapToWorkDay(addDays(taskStart, 4), state.ganttWorkDays, 1);

  const newId = Math.max(...state.ProjectData.tasks.map(t => t.id), 0) + 1;
  const newTask = {
    id: newId, wbs: newWbs,
    name: 'New Task ' + newId,
    category: lastTask.category || '',
    start: taskStart, end: taskEnd,
    pct: 0, deps: [], team, milestone: false, notes: '',
  };
  pushUndo('task added');
  state.ProjectData.tasks.push(newTask);
  safeRender(renderGantt, 'Gantt Chart');
  const phaseNames = getPhaseNames();
  showToast('Task added to ' + (phaseNames[lastPhase] || ('Phase ' + lastPhase)) + '.');
}

export function resetGanttToImported() {
  if (!state.originalTasks.length) return;
  if (!state.isDirty) { showToast('No changes to reset — schedule matches imported state.', null, 3000); return; }
  const btn = document.getElementById('gantt-reset-btn');
  if (btn && btn.dataset.confirming !== '1') {
    const origText = btn.textContent;
    btn.dataset.confirming = '1';
    btn.textContent = '↺ Click again to confirm';
    btn.style.borderColor = '#f85149'; btn.style.color = '#f85149';
    setTimeout(() => {
      if (btn && btn.dataset.confirming === '1') {
        btn.dataset.confirming = ''; btn.textContent = origText;
        btn.style.borderColor = ''; btn.style.color = '';
      }
    }, 3000);
    return;
  }
  if (btn) { btn.dataset.confirming = ''; btn.textContent = '↺ Reset to Imported'; btn.style.borderColor = ''; btn.style.color = ''; }
  const cloneTask = t => ({ ...t, start: t.start ? new Date(t.start) : null, end: t.end ? new Date(t.end) : null, deps: [...t.deps] });
  const snapshot = state.ProjectData.tasks.map(cloneTask);
  state.ProjectData.tasks = state.originalTasks.map(cloneTask);
  safeRender(renderGantt, 'Gantt Chart');
  showToast('Schedule reset to imported state.', () => { state.ProjectData.tasks = snapshot; safeRender(renderGantt, 'Gantt Chart'); }, 30000);
}
