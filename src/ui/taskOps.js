import { state } from '../state.js';
import { SPEC_COLORS } from '../colors.js';
import { addDays, snapToWorkDay } from '../utils.js';
import { renderGantt } from '../render/gantt.js';
import { renderSpecs } from '../render/specs.js';
import { getPhaseNames } from '../render/progDash.js';
import { pushUndo } from '../core/undo.js';
import { showToast, safeRender } from './toast.js';
import { closeSidePanel } from './panelBase.js';
import { recalcWBS } from '../compute/wbs.js';
import { startSpecNameEdit } from './specEdits.js';

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
  if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(newId);
  showToast('Specification added', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
  const nameEl = document.querySelector('#sp-body .sp-name-edit');
  if (nameEl) startSpecNameEdit(nameEl, newSpec);
}

export function deleteTask(taskId) {
  if (!state.ProjectData.tasks.find(t => t.id === taskId)) return;
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
  state.ProjectData.specs = state.ProjectData.specs.filter(s => s.id !== specId);
  safeRender(renderSpecs, 'Specifications');
  closeSidePanel();
  showToast('Specification deleted', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
}

export function addGanttTask() {
  if (!state.ProjectData.tasks.length) return;
  const lastTask = state.ProjectData.tasks[state.ProjectData.tasks.length - 1];
  const lastPhase = parseInt(String(lastTask.wbs).split('.')[0]) || 1;
  const phaseTasks = state.ProjectData.tasks.filter(t => parseInt(String(t.wbs).split('.')[0]) === lastPhase && t.wbs.includes('.') && !t.wbs.endsWith('.0'));
  const nextNum = phaseTasks.length + 1;
  const newWbs = lastPhase + '.' + nextNum;

  const teams = [...new Set(state.ProjectData.tasks.map(t => t.team).filter(Boolean))].sort();
  const team = teams[0] || '';

  const dates = state.ProjectData.tasks.flatMap(t => [t.start, t.end]).filter(Boolean);
  const progStart = new Date(Math.min(...dates));
  const taskStart = snapToWorkDay(progStart, state.ganttWorkDays, 1);
  const taskEnd   = snapToWorkDay(addDays(taskStart, 4), state.ganttWorkDays, 1);

  const newId = Math.max(...state.ProjectData.tasks.map(t => t.id), 0) + 1;
  const newTask = {
    id: newId, wbs: newWbs,
    name: 'New Task ' + newId,
    category: lastTask.category || '',
    start: taskStart, end: taskEnd,
    pct: 0, deps: [], team, milestone: false, notes: '',
  };
  state.ProjectData.tasks.push(newTask);
  renderGantt();
  const phaseNames = getPhaseNames();
  showToast('Task added to ' + (phaseNames[lastPhase] || ('Phase ' + lastPhase)) + '.');
}

export function resetGanttToImported() {
  if (!state.originalTasks.length) return;
  const snapshot = state.ProjectData.tasks.map(t => ({ ...t, deps: [...t.deps] }));
  state.ProjectData.tasks = state.originalTasks.map(t => ({ ...t, deps: [...t.deps] }));
  renderGantt();
  showToast('Schedule reset to imported state.', () => { state.ProjectData.tasks = snapshot; renderGantt(); }, 30000);
}
