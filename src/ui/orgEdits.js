import { state } from '../state.js';
import { renderOrgChart } from '../render/orgChart.js';
import { pushUndo } from '../core/undo.js';
import { showToast } from './toast.js';

// Nulling spCurrentType before re-opening forces openOrgPanel to treat this as a fresh
// open rather than a toggle-close, so the panel re-renders with the updated field value.
function _refreshOrgPanel(person) {
  renderOrgChart();
  state.spCurrentType = null;
  if (state.handlers.openOrgPanel) state.handlers.openOrgPanel(person.name);
}

export function startOrgNameEdit(el, person) {
  if (el.querySelector('input')) return;
  const orig = person.name;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (!v) {
      person.name = orig; _refreshOrgPanel(person); showToast('Name cannot be empty', null, 3500);
    } else if (v !== orig && state.ProjectData.org.some(p => p.name === v)) {
      person.name = orig; _refreshOrgPanel(person); showToast('Name already in use', null, 3500);
    } else if (v !== orig) {
      pushUndo('edit org person name');
      // Cascade rename to all reportsTo arrays so the tree stays consistent.
      state.ProjectData.org.forEach(p => { p.reportsTo = p.reportsTo.map(r => r === orig ? v : r); });
      person.name = v;
      // spCurrentId must track the new name so the panel toggle check stays consistent.
      state.spCurrentId = v;
      _refreshOrgPanel(person);
      showToast('Name updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
    } else {
      _refreshOrgPanel(person);
    }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { person.name = orig; _refreshOrgPanel(person); } });
  input.addEventListener('blur', commit);
}

export function startOrgTitleEdit(el, person) {
  if (el.querySelector('input')) return;
  const orig = person.title;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('edit org person title'); person.title = v; _refreshOrgPanel(person); showToast('Title updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshOrgPanel(person); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { person.title = orig; _refreshOrgPanel(person); } });
  input.addEventListener('blur', commit);
}

export function startOrgTeamEdit(el, person) {
  if (el.querySelector('input')) return;
  const orig = person.team;
  const allTeams = [...new Set(state.ProjectData.org.map(p => p.team).filter(Boolean))].sort();
  const dlId = 'org-team-inline-dl';
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig; input.setAttribute('list', dlId);
  const dl = document.createElement('datalist');
  dl.id = dlId;
  allTeams.forEach(t => { const opt = document.createElement('option'); opt.value = t; dl.appendChild(opt); });
  el.textContent = ''; el.appendChild(dl); el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('edit org person team'); person.team = v; _refreshOrgPanel(person); showToast('Team updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshOrgPanel(person); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { person.team = orig; _refreshOrgPanel(person); } });
  input.addEventListener('blur', commit);
}

export function startOrgReportsEdit(el, person) {
  if (el.querySelector('input')) return;
  const orig = person.reportsTo.slice();
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.value = orig.join(', '); input.placeholder = 'Comma-separated names';
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const newArr = input.value.trim() ? input.value.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (JSON.stringify(newArr) !== JSON.stringify(orig)) {
      pushUndo('edit org person reports-to'); person.reportsTo = newArr; _refreshOrgPanel(person);
      showToast('Reports To updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
    } else { _refreshOrgPanel(person); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { person.reportsTo = orig; _refreshOrgPanel(person); } });
  input.addEventListener('blur', commit);
}

export function startOrgEmailEdit(el, person) {
  if (el.querySelector('input')) return;
  const orig = person.email;
  const input = document.createElement('input');
  input.className = 'gantt-cell-input'; input.type = 'email'; input.value = orig;
  el.textContent = ''; el.appendChild(input); input.focus(); input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v !== orig) { pushUndo('edit org person email'); person.email = v; _refreshOrgPanel(person); showToast('Email updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000); }
    else { _refreshOrgPanel(person); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { person.email = orig; _refreshOrgPanel(person); } });
  input.addEventListener('blur', commit);
}
