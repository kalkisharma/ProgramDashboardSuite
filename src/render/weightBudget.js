import { state } from '../state.js';
import { esc } from '../utils.js';
import { positionTooltip } from '../ui/tooltip.js';

export function getWeightUnit() { return String(state.ProjectData.info['Weight Unit'] || 'lb'); }

function showWtTooltip(e, el) {
  const est    = Number(el.dataset.est);
  const tgt    = Number(el.dataset.tgt);
  const total  = Number(el.dataset.total);
  const name   = el.dataset.name;
  const unit   = getWeightUnit();
  const margin = tgt - est;
  const mSign  = margin >= 0 ? '+' : '';
  const mColor = margin >= 0 ? '#3fb950' : '#d29922';
  const tt = document.getElementById('tooltip');
  tt.innerHTML = `
    <div style="font-weight:700;margin-bottom:5px">${esc(name)}</div>
    <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">Estimated</span><strong>${est.toLocaleString()} ${esc(unit)}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">Target</span><strong>${tgt.toLocaleString()} ${esc(unit)}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">Margin</span><strong style="color:${mColor}">${mSign}${margin.toLocaleString()} ${esc(unit)}</strong></div>
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);color:var(--muted);font-size:0.75rem">Total vehicle est.: <strong style="color:var(--text)">${total.toLocaleString()} ${esc(unit)}</strong></div>
  `;
  tt.style.display = 'block';
  positionTooltip(e);
}
function hideWtTooltip() { document.getElementById('tooltip').style.display = 'none'; }

function toggleWtGroup(el) {
  const items   = el.nextElementSibling;
  const arrow   = el.querySelector('.wt-group-arrow');
  const open    = items.style.display !== 'none';
  const grpName = el.getAttribute('data-group-name');
  items.style.display = open ? 'none' : '';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
  el.setAttribute('aria-expanded', String(!open));
  if (grpName) {
    let collapsed = JSON.parse(localStorage.getItem('vh-wt-collapsed') || '[]');
    collapsed = open ? [...new Set([...collapsed, grpName])] : collapsed.filter(g => g !== grpName);
    localStorage.setItem('vh-wt-collapsed', JSON.stringify(collapsed));
  }
}

export function renderWeightBudget() {
  const body = document.getElementById('weight-body');
  if (!body || !state.ProjectData.weights.length) return;

  const unit        = getWeightUnit();
  const totalTarget = state.ProjectData.weights.reduce((s, w) => s + w.target, 0);
  const totalEst    = state.ProjectData.weights.reduce((s, w) => s + w.estimated, 0);
  const totalMargin = totalTarget - totalEst;
  const maxVal      = Math.max(...state.ProjectData.weights.map(w => Math.max(w.target, w.estimated)), 1);
  const marginColor = totalMargin >= 0 ? '#3fb950' : '#d29922';
  const marginSign  = totalMargin >= 0 ? '+' : '';
  const marginPct   = Math.round(Math.abs(totalMargin) / totalTarget * 100);

  body.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Total Target</div>
        <div class="kpi-value" style="font-size:1.6rem">${totalTarget.toLocaleString()} ${esc(unit)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Estimated</div>
        <div class="kpi-value" style="font-size:1.6rem">${totalEst.toLocaleString()} ${esc(unit)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Margin Remaining</div>
        <div class="kpi-value" style="font-size:1.6rem;color:${marginColor}">${marginSign}${totalMargin.toLocaleString()} ${esc(unit)}</div>
        <div class="kpi-sub">${marginPct}% of target</div>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">Subsystem Mass Budget</div>
      <div class="wt-row wt-row-header">
        <div>Subsystem / Group</div>
        <div>Estimated vs Target <span style="font-size:0.65rem;opacity:0.7">│ = target · hover for details</span></div>
        <div style="text-align:right">Est. (${esc(unit)})</div>
        <div style="text-align:right">Tgt (${esc(unit)})</div>
        <div style="text-align:right">Margin</div>
      </div>
      ${(() => {
        const grouped = {};
        state.ProjectData.weights.forEach(w => {
          const g = w.group || 'Other';
          if (!grouped[g]) grouped[g] = [];
          grouped[g].push(w);
        });
        const _wtParsed = (() => { try { return JSON.parse(localStorage.getItem('vh-wt-collapsed') || '[]'); } catch { return []; } })();
        const collapsedGroups = Array.isArray(_wtParsed) ? _wtParsed : [];
        return Object.entries(grouped).map(([grpName, items], n) => {
          const gEst    = items.reduce((s, w) => s + w.estimated, 0);
          const gTgt    = items.reduce((s, w) => s + w.target, 0);
          const gMargin = gTgt - gEst;
          const gSign   = gMargin >= 0 ? '+' : '';
          const gClass  = gMargin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg';
          const gColor  = gMargin < 0 ? '#d29922' : '#3fb950';
          const gEstPct = Math.min(100, Math.round(gEst / maxVal * 100));
          const gTgtPct = Math.min(100, Math.round(gTgt / maxVal * 100));
          const isCollapsed = collapsedGroups.includes(grpName);
          const header  = `<div class="wt-row wt-group-header" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="wt-grp-${n}" data-group-name="${esc(grpName)}" style="cursor:pointer">
            <div style="font-weight:700"><span class="wt-group-arrow" style="margin-right:6px">${isCollapsed ? '▶' : '▼'}</span>${esc(grpName)}</div>
            <div class="wt-bar-wrap" style="cursor:crosshair"
              data-name="${esc(grpName)}" data-est="${gEst}" data-tgt="${gTgt}" data-total="${totalEst}">
              <div class="wt-bar-est" style="width:${gEstPct}%;background:${gColor}"></div>
              <div class="wt-bar-tgt" style="left:${gTgtPct}%"></div>
            </div>
            <div style="text-align:right;font-weight:700">${gEst.toLocaleString()}</div>
            <div style="text-align:right;color:var(--muted);font-weight:700">${gTgt.toLocaleString()}</div>
            <div style="text-align:right;font-weight:700" class="${gClass}">${gSign}${gMargin.toLocaleString()}</div>
          </div><div class="wt-group-items" id="wt-grp-${n}" style="${isCollapsed ? 'display:none' : ''}">`;
          const rows = items.map(w => {
            const margin   = w.target - w.estimated;
            const estPct   = Math.min(100, Math.round(w.estimated / maxVal * 100));
            const tgtPct   = Math.min(100, Math.round(w.target    / maxVal * 100));
            const barColor = margin < 0 ? '#d29922' : '#3fb950';
            const mSign    = margin >= 0 ? '+' : '';
            const mClass   = margin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg';
            return `<div class="wt-row" style="padding-left:12px;cursor:pointer" data-wt-idx="${state.ProjectData.weights.indexOf(w)}" title="Click to edit">
              <div title="${esc(w.subsystem)} (${esc(w.group)})">${esc(w.subsystem)}</div>
              <div class="wt-bar-wrap" style="cursor:crosshair"
                data-name="${esc(w.subsystem)}" data-est="${w.estimated}" data-tgt="${w.target}" data-total="${totalEst}">
                <div class="wt-bar-est" style="width:${estPct}%;background:${barColor}"></div>
                <div class="wt-bar-tgt" style="left:${tgtPct}%"></div>
              </div>
              <div style="text-align:right">${w.estimated.toLocaleString()}</div>
              <div style="text-align:right;color:var(--muted)">${w.target.toLocaleString()}</div>
              <div style="text-align:right" class="${mClass}">${mSign}${margin.toLocaleString()}</div>
            </div>`;
          }).join('');
          return header + rows + '</div>';
        }).join('');
      })()}
      <div class="wt-row wt-total-row">
        <div>Total</div>
        <div></div>
        <div style="text-align:right">${totalEst.toLocaleString()}</div>
        <div style="text-align:right;color:var(--muted)">${totalTarget.toLocaleString()}</div>
        <div style="text-align:right" class="${totalMargin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg'}">${totalMargin >= 0 ? '+' : ''}${totalMargin.toLocaleString()}</div>
      </div>
    </div>
  `;
  body.querySelectorAll('.wt-bar-wrap').forEach(el => {
    el.addEventListener('mouseenter', e => showWtTooltip(e, el));
    el.addEventListener('mousemove', positionTooltip);
    el.addEventListener('mouseleave', hideWtTooltip);
  });
  body.addEventListener('click', e => {
    const h = e.target.closest('.wt-group-header');
    if (h) { toggleWtGroup(h); return; }
    const row = e.target.closest('.wt-row[data-wt-idx]');
    if (row && !e.target.closest('.wt-bar-wrap')) {
      if (state.handlers.openWeightPanel) state.handlers.openWeightPanel(+row.dataset.wtIdx);
    }
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const h = e.target.closest('.wt-group-header'); if (h) { e.preventDefault(); toggleWtGroup(h); }
    }
  });
}
