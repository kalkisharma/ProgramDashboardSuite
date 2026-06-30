import { state } from '../state.js';
import { esc } from '../utils.js';
import { positionTooltip } from '../ui/tooltip.js';
import { pushUndo } from '../core/undo.js';
import { showToast } from '../ui/toast.js';
import { editCell, wireCellEdit } from '../ui/editCell.js';

export function getWeightUnit() { return String(state.ProjectData.info['Weight Unit'] || 'lb'); }

function showWtTooltip(e, el) {
  const est    = Number(el.dataset.est);
  const tgt    = Number(el.dataset.tgt);
  const total  = Number(el.dataset.total);
  const cont   = Number(el.dataset.cont) || 0;
  const predRaw = el.dataset.pred;
  const predicted = predRaw !== '' && predRaw != null ? Number(predRaw) : est;
  const name   = el.dataset.name;
  const unit   = getWeightUnit();
  const margin = tgt - predicted;
  const mSign  = margin >= 0 ? '+' : '';
  const mColor = margin >= 0 ? '#3fb950' : '#f85149';
  const row = (label, val, opt = '') => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:var(--muted)">${label}</span><strong${opt}>${val}</strong></div>`;
  const tt = document.getElementById('tooltip');
  tt.innerHTML = `
    <div style="font-weight:700;margin-bottom:5px">${esc(name)}</div>
    ${row('Estimated (CBE)', `${est.toLocaleString()} ${esc(unit)}`)}
    ${cont > 0 ? row('Contingency', `+${cont}%`) + row('Predicted', `${predicted.toLocaleString()} ${esc(unit)}`) : ''}
    ${row('Target', `${tgt.toLocaleString()} ${esc(unit)}`)}
    ${row('Margin', `${mSign}${Math.round(margin).toLocaleString()} ${esc(unit)}`, ` style="color:${mColor}"`)}
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);color:var(--muted);font-size:0.75rem">Total vehicle est.: <strong style="color:var(--text)">${total.toLocaleString()} ${esc(unit)}</strong></div>
  `;
  tt.style.display = 'block';
  positionTooltip(e);
}
function hideWtTooltip() { document.getElementById('tooltip').style.display = 'none'; }

function commitWeightField(idx, field, raw) {
  const w = state.ProjectData.weights[idx];
  if (!w) return;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0) { renderWeightBudget(); showToast('Enter a weight of 0 or more.', null, 3000); return; }
  pushUndo('edit weight');
  w[field] = v;
  renderWeightBudget();
  showToast('Weight updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
  if (state.spCurrentType === 'weight' && state.spCurrentId === idx && state.handlers.openWeightPanel) state.handlers.openWeightPanel(idx);
}

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
  // Predicted = current best estimate + maturity contingency (MGA). Margin is measured
  // against predicted, so contingency consumes margin (aerospace mass-management convention).
  const pred        = w => w.estimated * (1 + (w.contingency || 0) / 100);
  const anyCont     = state.ProjectData.weights.some(w => (w.contingency || 0) > 0);
  const totalTarget = state.ProjectData.weights.reduce((s, w) => s + w.target, 0);
  const totalEst    = state.ProjectData.weights.reduce((s, w) => s + w.estimated, 0);
  const totalPred   = state.ProjectData.weights.reduce((s, w) => s + pred(w), 0);
  const totalMargin = totalTarget - totalPred;
  const marginColor = totalMargin >= 0 ? '#3fb950' : '#f85149';   // over budget → red everywhere
  const marginSign  = totalMargin >= 0 ? '+' : '';
  const marginPct   = totalTarget ? Math.round(Math.abs(totalMargin) / totalTarget * 100) : 0;
  // Fixed target-reference scaling: the target tick sits at a constant position on every
  // row, and the predicted bar extends relative to it — so a bar short of the tick reads as
  // under budget and past the tick as over, instantly and per-row regardless of magnitude.
  const TGT_REF = 66;
  const barEstPct = (val, tgt) => tgt > 0 ? Math.min(99, Math.round(val / tgt * TGT_REF)) : (val > 0 ? 99 : 0);

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
        <div class="kpi-sub">${marginPct}% of target${anyCont ? ' · incl. contingency' : ''}</div>
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
          const gPred   = items.reduce((s, w) => s + pred(w), 0);
          const gMargin = gTgt - gPred;
          const gSign   = gMargin >= 0 ? '+' : '';
          const gClass  = gMargin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg';
          const gColor  = gMargin < 0 ? '#f85149' : '#3fb950';
          const gEstPct = barEstPct(gPred, gTgt);  // bar = predicted (CBE + contingency)
          const gTgtPct = TGT_REF;                  // target tick fixed across rows
          const isCollapsed = collapsedGroups.includes(grpName);
          const header  = `<div class="wt-row wt-group-header" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="wt-grp-${n}" data-group-name="${esc(grpName)}" style="cursor:pointer">
            <div style="font-weight:700"><span class="wt-group-arrow" style="margin-right:6px">${isCollapsed ? '▶' : '▼'}</span>${esc(grpName)}</div>
            <div class="wt-bar-wrap" style="cursor:crosshair"
              data-name="${esc(grpName)}" data-est="${gEst}" data-pred="${Math.round(gPred)}" data-cont="" data-tgt="${gTgt}" data-total="${totalEst}">
              <div class="wt-bar-est" style="width:${gEstPct}%;background:${gColor}"></div>
              <div class="wt-bar-tgt" style="left:${gTgtPct}%"></div>
            </div>
            <div style="text-align:right;font-weight:700">${gEst.toLocaleString()}</div>
            <div style="text-align:right;color:var(--muted);font-weight:700">${gTgt.toLocaleString()}</div>
            <div style="text-align:right;font-weight:700" class="${gClass}">${gSign}${gMargin.toLocaleString()}</div>
          </div><div class="wt-group-items" id="wt-grp-${n}" style="${isCollapsed ? 'display:none' : ''}">`;
          const rows = items.map(w => {
            const wPred    = pred(w);
            const margin   = w.target - wPred;
            const estPct   = barEstPct(wPred, w.target);
            const tgtPct   = TGT_REF;
            const barColor = margin < 0 ? '#f85149' : '#3fb950';
            const mSign    = margin >= 0 ? '+' : '';
            const mClass   = margin >= 0 ? 'wt-margin-pos' : 'wt-margin-neg';
            return `<div class="wt-row" style="padding-left:12px;cursor:pointer" data-wt-idx="${state.ProjectData.weights.indexOf(w)}" title="Click to edit">
              <div title="${esc(w.subsystem)} (${esc(w.group)})">${esc(w.subsystem)}</div>
              <div class="wt-bar-wrap" style="cursor:crosshair"
                data-name="${esc(w.subsystem)}" data-est="${w.estimated}" data-pred="${Math.round(wPred)}" data-cont="${w.contingency || 0}" data-tgt="${w.target}" data-total="${totalEst}">
                <div class="wt-bar-est" style="width:${estPct}%;background:${barColor}"></div>
                <div class="wt-bar-tgt" style="left:${tgtPct}%"></div>
              </div>
              <div class="editable-cell" data-edit-field="estimated" tabindex="0" title="Double-click or Enter to edit" style="text-align:right">${w.estimated.toLocaleString()}</div>
              <div class="editable-cell" data-edit-field="target" tabindex="0" title="Double-click or Enter to edit" style="text-align:right;color:var(--muted)">${w.target.toLocaleString()}</div>
              <div style="text-align:right" class="${mClass}">${mSign}${Math.round(margin).toLocaleString()}</div>
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
  // Inline editing of the estimated / target numbers: single-click opens the panel,
  // double-click / Enter edits in place. The bar + margin are derived → stay read-only.
  body.querySelectorAll('.editable-cell[data-edit-field]').forEach(cell => {
    const idx = +cell.closest('.wt-row[data-wt-idx]').dataset.wtIdx;
    const field = cell.dataset.editField;
    const open = () => { if (state.handlers.openWeightPanel) state.handlers.openWeightPanel(idx); };
    wireCellEdit(cell, open, () => {
      const w = state.ProjectData.weights[idx];
      if (!w) return;
      editCell(cell, { value: w[field], type: 'number', step: '0.1', min: '0', onCommit: raw => commitWeightField(idx, field, raw) });
    });
  });
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
