import { state } from '../state.js';
import { esc, getToday } from '../utils.js';
import { SPEC_COLORS } from '../colors.js';
import { safeSetItem, showToast } from '../ui/toast.js';
import { pushUndo } from '../core/undo.js';
import { editCell, wireCellEdit } from '../ui/editCell.js';

export function renderSpecs() {
  const sel = document.getElementById('specs-filter');
  sel.innerHTML = '<option value="all">All Categories</option>';
  [...new Set(state.ProjectData.specs.map(s => s.category))].forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  const savedCat = localStorage.getItem('vh-filter-specs-cat') || 'all';
  sel.value = [...sel.options].map(o => o.value).includes(savedCat) ? savedCat : 'all';
  renderSpecTable();
}

function specStatusRank(s) {
  if (s.status === 'TBD') {
    const risk = s.depIds.some(id => { const t = state.ProjectData.tasks.find(t => t.id === id); return t && t.start && t.start <= getToday(); });
    return risk ? 0 : 1;
  }
  return s.status === 'Target' ? 2 : s.status === 'Achieved' ? 3 : 4;
}

export function setSpecsCategoryFilter(val) {
  safeSetItem('vh-filter-specs-cat', val);
  renderSpecTable();
}

export function clearSpecsFilters() {
  document.getElementById('specs-filter').value = 'all';
  document.getElementById('specs-search').value = '';
  state.specSearchQuery = '';
  renderSpecTable();
}

function setSpecSort(col) {
  if (state.specSortState.col === col) state.specSortState.dir = state.specSortState.dir === 'asc' ? 'desc' : 'asc';
  else { state.specSortState.col = col; state.specSortState.dir = 'asc'; }
  renderSpecTable();
}

export function renderSpecTable() {
  const cat  = document.getElementById('specs-filter').value;
  let list = cat === 'all' ? state.ProjectData.specs : state.ProjectData.specs.filter(s => s.category === cat);
  if (state.specSearchQuery.trim()) {
    const q = state.specSearchQuery.trim().toLowerCase();
    list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.group.toLowerCase().includes(q) ||
      s.notes.toLowerCase().includes(q)
    );
  }
  const count = list.length;
  document.getElementById('specs-count').textContent = `${count} specification${count!==1?'s':''}`;

  const SORT_COLS   = ['id','name','value','units','status','group','notes','deps'];
  const SORT_LABELS = ['Spec ID','Specification','Value','Units','Status','Responsible Group','Notes','Dep. Tasks'];
  const thHtml = SORT_COLS.map((c, i) => {
    const active  = state.specSortState.col === c;
    const ind     = active ? (state.specSortState.dir === 'asc' ? '↑' : '↓') : '↕';
    const indCls  = 'spec-sort-ind' + (active ? ' active' : '');
    const alignSt = c === 'deps' ? ' style="text-align:center"' : '';
    return `<th${alignSt} data-sort-col="${c}">${SORT_LABELS[i]}<span class="${indCls}">${ind}</span></th>`;
  }).join('');

  const specRow = (s, col) => {
    const sc = s.status==='Achieved' ? 'badge-achieved' : s.status==='Target' ? 'badge-target' : 'badge-tbd';
    const hasRisk = s.status === 'TBD' && s.depIds.some(id => {
      const t = state.ProjectData.tasks.find(t => t.id === id); return t && t.start && t.start <= getToday();
    });
    const riskDesc = hasRisk ? ' — risk: dependent task already started' : '';
    const depText = s.depIds.length
      ? `<span aria-label="${s.depIds.length} dependent task${s.depIds.length!==1?'s':''}${riskDesc}" style="color:${hasRisk?'var(--danger)':'var(--muted)'};font-weight:${hasRisk?700:400}">${s.depIds.length}${hasRisk?' ⚠':''}</span>`
      : `<span aria-label="No dependent tasks" style="color:#484f58">—</span>`;
    const ed = 'class="editable-cell" tabindex="0" title="Double-click or Enter to edit"';
    return `<tr class="spec-row" data-spec-id="${esc(s.id)}">
      <td><code style="color:${col.text};font-size:0.78rem">${esc(s.id)}</code></td>
      <td ${ed} data-edit-field="name"><strong>${esc(s.name)}</strong></td>
      <td ${ed} data-edit-field="value">${esc(s.value)}</td>
      <td ${ed} data-edit-field="units" style="color:var(--muted)">${esc(s.units)}</td>
      <td><span class="badge ${sc}" role="button" tabindex="0" data-spec-status-id="${esc(s.id)}" aria-label="Status: ${esc(s.status)} — press Enter or Space to change" title="Click to change status" style="cursor:pointer">${esc(s.status)}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${esc(s.group)}</td>
      <td class="editable-cell" data-edit-field="notes" tabindex="0" style="color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem" title="${esc(s.notes)}">${esc(s.notes)||'—'}</td>
      <td style="text-align:center">${depText}</td>
    </tr>`;
  };

  let bodyHtml = '';
  if (state.specSortState.col) {
    const sorted = [...list].sort((a, b) => {
      let va, vb;
      switch (state.specSortState.col) {
        case 'id':     va = a.id;             vb = b.id;             break;
        case 'name':   va = a.name;           vb = b.name;           break;
        case 'value':  va = a.value;          vb = b.value;          break;
        case 'units':  va = a.units;          vb = b.units;          break;
        case 'status': va = specStatusRank(a); vb = specStatusRank(b); break;
        case 'group':  va = a.group;          vb = b.group;          break;
        case 'notes':  va = a.notes;          vb = b.notes;          break;
        case 'deps':   va = a.depIds.length;  vb = b.depIds.length;  break;
        default: return 0;
      }
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return state.specSortState.dir === 'asc' ? cmp : -cmp;
    });
    sorted.forEach(s => {
      const col = SPEC_COLORS[s.category] || { bg:'rgba(88,166,255,.1)', text:'#58a6ff' };
      bodyHtml += specRow(s, col);
    });
  } else {
    const groups = {};
    list.forEach(s => { (groups[s.category] = groups[s.category]||[]).push(s); });
    Object.entries(groups).forEach(([c, specs]) => {
      const col = SPEC_COLORS[c] || { bg:'rgba(88,166,255,.1)', text:'#58a6ff' };
      bodyHtml += `<tr class="cat-header"><td colspan="8" style="background:${col.bg};color:${col.text}">${esc(c)}</td></tr>`;
      specs.forEach(s => { bodyHtml += specRow(s, col); });
    });
  }

  const wrap = document.getElementById('specs-table-wrap');
  if (!list.length) {
    const cat = document.getElementById('specs-filter').value;
    const hasSearch = state.specSearchQuery.trim().length > 0;
    if (cat !== 'all' || hasSearch) {
      wrap.innerHTML = `<div style="padding:24px;color:var(--muted);font-size:0.82rem;text-align:center">No specifications match the current filter. <button class="specs-clear-filter-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;text-decoration:underline;padding:0">Clear filters</button></div>`;
      wrap.querySelector('.specs-clear-filter-btn').addEventListener('click', clearSpecsFilters);
    } else {
      wrap.innerHTML = `<div role="status" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:10px;color:var(--muted);text-align:center">
        <div style="font-size:2rem">📐</div>
        <div style="font-weight:700;color:var(--text)">No specifications found</div>
        <div style="font-size:0.82rem">Check that your Excel file includes a <code style="background:var(--bg);padding:1px 5px;border-radius:3px">Specifications</code> sheet with at least one row.</div>
        <button class="empty-help-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.82rem;text-decoration:underline;padding:0;margin-top:4px">Open help guide</button>
      </div>`;
      wrap.querySelector('.empty-help-btn').addEventListener('click', () => { if (state.handlers.toggleHelp) state.handlers.toggleHelp(); });
    }
    return;
  }
  wrap.innerHTML = `<table class="specs-table"><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  wrap.querySelectorAll('th[data-sort-col]').forEach(th =>
    th.addEventListener('click', () => setSpecSort(th.dataset.sortCol))
  );
  const _specRowEls = [...wrap.querySelectorAll('tr[data-spec-id]')];
  _specRowEls.forEach((row, idx) => {
    row.style.cursor = 'pointer';
    row.tabIndex = 0;
    row.addEventListener('click', e => {
      if (e.target.closest('[data-spec-status-id]')) return;
      if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(row.dataset.specId);
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(row.dataset.specId); }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (idx + 1 < _specRowEls.length) _specRowEls[idx + 1].focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx > 0) _specRowEls[idx - 1].focus(); }
    });
  });
  wrap.querySelectorAll('[data-spec-status-id]').forEach(badge => {
    badge.addEventListener('click', e => { e.stopPropagation(); cycleSpecStatus(badge.dataset.specStatusId); });
    badge.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); cycleSpecStatus(badge.dataset.specStatusId); }
    });
  });

  // Inline editing: single-click opens the spec panel, double-click / Enter edits in place.
  wrap.querySelectorAll('.editable-cell[data-edit-field]').forEach(cell => {
    const id = cell.closest('tr[data-spec-id]').dataset.specId;
    const field = cell.dataset.editField;
    const open = () => { if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(id); };
    wireCellEdit(cell, open, () => {
      const s = state.ProjectData.specs.find(x => x.id === id);
      if (!s) return;
      editCell(cell, { value: s[field], type: 'text', onCommit: raw => commitSpecField(s, field, raw) });
    });
  });
}

function commitSpecField(s, field, raw) {
  const v = raw.trim();
  if (field === 'name' && !v) { renderSpecTable(); showToast('Specification name cannot be empty', null, 3000); return; }
  pushUndo('edit spec');
  if (field === 'units') s.units = v || '—';
  else s[field] = v;
  renderSpecTable();
  showToast('Specification updated', () => { if (state.handlers.applyUndo) state.handlers.applyUndo(); }, 5000);
  if (state.spCurrentType === 'spec' && state.spCurrentId === s.id && state.handlers.openSpecPanel) state.handlers.openSpecPanel(s.id);
}

export function cycleSpecStatus(specId) {
  const s = state.ProjectData.specs.find(s => s.id === specId);
  if (!s) return;
  pushUndo('spec status');
  const cycle = { 'Achieved': 'Target', 'Target': 'TBD', 'TBD': 'Achieved' };
  s.status = cycle[s.status] || 'TBD';
  renderSpecTable();
  if (state.spCurrentType === 'spec' && state.spCurrentId === specId) {
    if (state.handlers.openSpecPanel) state.handlers.openSpecPanel(specId);
  }
}
