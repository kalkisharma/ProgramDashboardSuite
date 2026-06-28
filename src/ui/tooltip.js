import { esc, fmt } from '../utils.js';

function el() { return document.getElementById('tooltip'); }

export function showTooltip(t, e) {
  const depText = t.deps.length ? ` · ${t.deps.length} dep${t.deps.length === 1 ? '' : 's'}` : '';
  const poc  = t.poc      ? `<span style="color:var(--muted)">POC:</span> ${esc(t.poc)}` : '';
  const cust = t.customer ? `<span style="color:var(--muted)">Cust:</span> ${esc(t.customer)}` : '';
  const people = (poc || cust)
    ? `<div class="tt-row">${[poc, cust].filter(Boolean).join('<span style="margin:0 4px;color:var(--border)">·</span>')}</div>`
    : '';
  el().innerHTML = `
    <div class="tt-title">${t.milestone ? '◆ ' : ''}${esc(t.name)}</div>
    ${people}
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
