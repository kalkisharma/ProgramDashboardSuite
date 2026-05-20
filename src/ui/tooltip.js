import { esc, fmt } from '../utils.js';
import { ganttColor } from '../colors.js';
import { state } from '../state.js';

function el() { return document.getElementById('tooltip'); }

export function showTooltip(t, e) {
  const color = ganttColor(t.category);
  const depNames = t.deps.map(id => {
    const dep = state.ProjectData.tasks.find(d => d.id === id);
    return dep ? `Task ${id}: ${esc(dep.name)}` : `Task ${id}`;
  });
  el().innerHTML = `
    <div class="tt-title">${t.milestone ? '◆ ' : ''}${esc(t.name)}</div>
    <div class="tt-row"><strong style="color:${color}">${esc(t.category)}</strong></div>
    <div class="tt-row"><strong>Team:</strong>${esc(t.team) || '—'}</div>
    <div class="tt-row"><strong>Start:</strong>${fmt(t.start)}</div>
    <div class="tt-row"><strong>End:</strong>${fmt(t.end)}</div>
    <div class="tt-row"><strong>Progress:</strong>${t.pct}% complete</div>
    ${t.deps.length ? `<div class="tt-row"><strong>Depends on:</strong>${depNames.join(', ')}</div>` : ''}
    ${t.notes ? `<div class="tt-row" style="margin-top:4px;font-style:italic">${esc(t.notes)}</div>` : ''}
    <div class="tt-row" style="margin-top:6px;font-size:0.72rem;color:var(--muted)">Click for full details</div>`;
  el().style.display = 'block';
  positionTooltip(e);
}

export function hideTooltip() {
  el().style.display = 'none';
}

export function positionTooltip(e) {
  const x = e.clientX + 18;
  const y = e.clientY - 10;
  el().style.left = Math.min(x, window.innerWidth - el().offsetWidth - 10) + 'px';
  el().style.top  = Math.min(y, window.innerHeight - el().offsetHeight - 10) + 'px';
}
