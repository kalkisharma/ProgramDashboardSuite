import { esc, fmt } from '../utils.js';
import { ganttColor } from '../colors.js';
import { state } from '../state.js';

function el() { return document.getElementById('tooltip'); }

export function showTooltip(t, e) {
  const color = ganttColor(t.category);
  const depText = t.deps.length ? ` · ${t.deps.length} dep${t.deps.length === 1 ? '' : 's'}` : '';
  el().innerHTML = `
    <div class="tt-title">${t.milestone ? '◆ ' : ''}${esc(t.name)}</div>
    <div class="tt-row"><strong style="color:${color}">${esc(t.category)}</strong>${t.team ? `<span style="margin:0 4px;color:var(--border)">·</span>${esc(t.team)}` : ''}</div>
    <div class="tt-row">${fmt(t.start)} → ${fmt(t.end)}</div>
    <div class="tt-row">${t.pct}% complete${depText}</div>`;
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
