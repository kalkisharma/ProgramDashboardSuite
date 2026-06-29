import PptxGenJS from 'pptxgenjs';
import { state } from '../state.js';
import { esc, fmt, workDaysRemaining, countWorkDays, getToday, daysBetween } from '../utils.js';
import { phaseColor } from '../colors.js';
import { PHASE_NAMES_FALLBACK } from '../constants.js';
import { computeConflicts } from '../compute/conflicts.js';
import { buildOrgIndex, resolveNames } from '../compute/orgLookup.js';
import { childrenOf, ancestorsOf } from '../compute/wbs.js';
import { getPhaseNames } from './progDash.js';
import { showToast, safeSetItem } from '../ui/toast.js';
import { toggleCheckboxDropdown, closeCheckboxDropdown } from '../ui/checkboxDropdown.js';

// Column order for the Status Report table. POC/Customer Team are derived from the org
// chart at render time. All columns are user-toggleable; everything except Notes sorts.
const SR_COLS = ['wbs','name','poc','pocTeam','customer','customerTeam','start','end','pct','wd','rag','notes'];
const SR_LABELS = {
  wbs:'WBS', name:'Task Name', poc:'POC', pocTeam:'POC Team', customer:'Customer',
  customerTeam:'Customer Team', start:'Start Date', end:'End Date', pct:'%', wd:'WD Left',
  rag:'Status', notes:'Notes',
};
const SR_NOSORT = new Set(['notes']);
function srVisibleCols() { return SR_COLS.filter(c => !state.statusReportHiddenCols.includes(c)); }

// ── Persisted Status Report preferences (column visibility + phase/team filters) ──
// Restored once at module load; survive page reload. Reset on new file load (main.js).
(function restoreSrPrefs() {
  try {
    const g = k => { const v = localStorage.getItem(k); return v == null ? undefined : JSON.parse(v); };
    const cols = g('vh-sr-cols');         if (Array.isArray(cols)) state.statusReportHiddenCols = cols;
    const ph   = g('vh-sr-phases');       if (ph   !== undefined)  state.statusReportPhases = ph;
    const pt   = g('vh-sr-poc-teams');    if (pt   !== undefined)  state.statusReportPocTeams = pt;
    const ct   = g('vh-sr-cust-teams');   if (ct   !== undefined)  state.statusReportCustomerTeams = ct;
    const dp   = g('vh-sr-depth');         if (dp   !== undefined)  state.statusReportDepthFilter = dp;
  } catch { /* ignore malformed prefs */ }
})();

function persistSrPrefs() {
  safeSetItem('vh-sr-cols',       JSON.stringify(state.statusReportHiddenCols));
  safeSetItem('vh-sr-phases',     JSON.stringify(state.statusReportPhases));
  safeSetItem('vh-sr-poc-teams',  JSON.stringify(state.statusReportPocTeams));
  safeSetItem('vh-sr-cust-teams', JSON.stringify(state.statusReportCustomerTeams));
  safeSetItem('vh-sr-depth',      JSON.stringify(state.statusReportDepthFilter));
}

// Toggle a parent's collapse from the Status Report (shares state.collapsedTasks with Gantt).
function toggleSrCollapse(id) {
  if (state.collapsedTasks.has(id)) state.collapsedTasks.delete(id); else state.collapsedTasks.add(id);
  safeSetItem('vh-collapsed-tasks', JSON.stringify([...state.collapsedTasks]));
  refreshStatusTable();
}

// Distinct phase numbers / POC teams / Customer teams across non-header tasks. Tasks with
// no resolvable team contribute 'Unassigned' so they remain filterable.
function srUniverses(orgIndex) {
  const phases = new Set(), poc = new Set(), cust = new Set();
  state.ProjectData.tasks.filter(t => !isPhaseHeader(t)).forEach(t => {
    phases.add(String(parseInt(String(t.wbs).split('.')[0]) || 1));
    const pt = resolveNames(t.poc, orgIndex).teams;      (pt.length ? pt : ['Unassigned']).forEach(x => poc.add(x));
    const ct = resolveNames(t.customer, orgIndex).teams; (ct.length ? ct : ['Unassigned']).forEach(x => cust.add(x));
  });
  return {
    phases:    [...phases].sort((a, b) => +a - +b),
    pocTeams:  [...poc].sort(),
    custTeams: [...cust].sort(),
  };
}

// A task passes the phase/team multi-selects (null selection = all; OR within a control,
// AND across the three controls).
function srPassesFilters(t, orgIndex) {
  const ph = String(parseInt(String(t.wbs).split('.')[0]) || 1);
  if (state.statusReportPhases && !state.statusReportPhases.includes(ph)) return false;
  if (state.statusReportPocTeams) {
    const tm = resolveNames(t.poc, orgIndex).teams; const eff = tm.length ? tm : ['Unassigned'];
    if (!eff.some(x => state.statusReportPocTeams.includes(x))) return false;
  }
  if (state.statusReportCustomerTeams) {
    const tm = resolveNames(t.customer, orgIndex).teams; const eff = tm.length ? tm : ['Unassigned'];
    if (!eff.some(x => state.statusReportCustomerTeams.includes(x))) return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPhaseHeader(t) {
  return !t.wbs.includes('.') || t.wbs.endsWith('.0');
}

function weightedPct(tasks) {
  if (!tasks.length) return 0;
  let sumW = 0, sumP = 0;
  tasks.forEach(t => {
    const w = (t.start && t.end) ? countWorkDays(t.start, t.end, state.ganttWorkDays) : 1;
    const weight = Math.max(1, w);
    sumW += weight; sumP += (t.pct || 0) * weight;
  });
  return sumW ? Math.round(sumP / sumW) : 0;
}

function ragStatus(t, conflictSet) {
  const today = getToday();
  if (t.pct >= 100) return 'done';                 // completed → never overdue/at-risk
  if (t.end && t.end < today) return 'red';
  if (conflictSet.has(t.id))   return 'amber';
  const wdLeft = t.end ? workDaysRemaining(t.end, state.ganttWorkDays, today) : Infinity;
  if (wdLeft <= 10 && t.pct < 50) return 'amber';
  return 'green';
}

function ragLabel(rag) {
  return rag === 'red' ? 'Overdue' : rag === 'amber' ? 'At Risk' : rag === 'done' ? 'Done' : 'On Track';
}

function ragOrder(rag) {
  return rag === 'red' ? 0 : rag === 'amber' ? 1 : rag === 'green' ? 2 : 3;
}

function sortTasks(tasks, conflictSet, orgIndex) {
  const { col, dir } = state.statusReportSort;
  if (!col) {
    // Default: sort by RAG (red first), then by end date
    return tasks.slice().sort((a, b) => {
      const rd = ragOrder(ragStatus(a, conflictSet)) - ragOrder(ragStatus(b, conflictSet));
      if (rd !== 0) return rd;
      return (a.end || new Date(9e15)) - (b.end || new Date(9e15));
    });
  }
  const teamsStr = poc => resolveNames(poc, orgIndex).teams.join(', ');
  return tasks.slice().sort((a, b) => {
    let va, vb;
    const today = getToday();
    switch (col) {
      case 'wbs':          va = a.wbs;  vb = b.wbs;  break;
      case 'name':         va = a.name; vb = b.name; break;
      case 'poc':          va = a.poc || ''; vb = b.poc || ''; break;
      case 'pocTeam':      va = teamsStr(a.poc); vb = teamsStr(b.poc); break;
      case 'customer':     va = a.customer || ''; vb = b.customer || ''; break;
      case 'customerTeam': va = teamsStr(a.customer); vb = teamsStr(b.customer); break;
      case 'start': va = a.start || new Date(9e15); vb = b.start || new Date(9e15); break;
      case 'end':   va = a.end   || new Date(9e15); vb = b.end   || new Date(9e15); break;
      case 'pct':  va = a.pct; vb = b.pct; break;
      case 'wd':   va = a.end ? workDaysRemaining(a.end, state.ganttWorkDays, today) : Infinity;
                   vb = b.end ? workDaysRemaining(b.end, state.ganttWorkDays, today) : Infinity; break;
      case 'rag':  va = ragOrder(ragStatus(a, conflictSet)); vb = ragOrder(ragStatus(b, conflictSet)); break;
      default: return 0;
    }
    const cmp = typeof va === 'number' ? va - vb :
                va instanceof Date     ? va - vb :
                String(va).localeCompare(String(vb));
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function srFilterBtn(id, value, label, count, extra) {
  const active = state.statusReportFilter === value;
  return `<button class="btn-secondary btn-sm" id="${id}" ${extra || ''}
    style="${active ? 'border-color:var(--accent);color:var(--accent)' : ''}">${label} (${count})</button>`;
}

function srMultiBtnHtml(id, label, selected, universe) {
  const all = !selected || selected.length === universe.length;
  const txt = all ? label : `${label} (${selected.length}/${universe.length})`;
  return `<button class="btn-secondary btn-sm" id="${id}" aria-haspopup="true" aria-expanded="false"
    style="${all ? '' : 'border-color:var(--accent);color:var(--accent)'}">${esc(txt)}</button>`;
}

function srDepthSelectHtml() {
  const maxDepth = Math.max(1, ...state.ProjectData.tasks.map(t => t.level || 1));
  let opts = '<option value="all">Depth: All</option>';
  for (let n = 1; n <= maxDepth; n++) opts += `<option value="${n}" ${state.statusReportDepthFilter === n ? 'selected' : ''}>Depth: Level ${n}</option>`;
  return `<select id="sr-depth-filter" class="btn-secondary btn-sm" aria-label="Limit visible subtask depth" title="Hide tasks deeper than this level" style="padding:4px 6px">${opts}</select>`;
}

function renderStatusToolbar(toolbar, tasksCount, openCount, concernCount, orgIndex) {
  const uni = srUniverses(orgIndex);
  toolbar.innerHTML = `
    ${srFilterBtn('sr-filter-tasks', 'tasks', 'All tasks', tasksCount,
      'title="Every task regardless of completion or status"')}
    ${srFilterBtn('sr-filter-open', 'open', 'All open', openCount,
      'title="Incomplete tasks only"')}
    ${srFilterBtn('sr-filter-concerns', 'concerns', 'Concerns only', concernCount,
      'title="Overdue + at-risk tasks" aria-label="Concerns only — overdue and at-risk tasks"')}
    <span style="width:1px;height:18px;background:var(--border);margin:0 4px"></span>
    ${srMultiBtnHtml('sr-phase-btn', 'Phase', state.statusReportPhases, uni.phases)}
    ${srMultiBtnHtml('sr-poc-btn', 'POC Team', state.statusReportPocTeams, uni.pocTeams)}
    ${srMultiBtnHtml('sr-cust-btn', 'Customer Team', state.statusReportCustomerTeams, uni.custTeams)}
    ${srDepthSelectHtml()}
    <span style="margin-left:auto"></span>
    <button class="btn-secondary btn-sm" id="sr-cols-btn" aria-haspopup="true" aria-expanded="false">Columns (${srVisibleCols().length}/${SR_COLS.length})</button>
    <button class="btn-secondary" id="sr-export-btn">Export to PowerPoint</button>`;

  const setFilter = v => { state.statusReportFilter = v; closeCheckboxDropdown(); renderStatusReport(); };
  toolbar.querySelector('#sr-filter-tasks').addEventListener('click', () => setFilter('tasks'));
  toolbar.querySelector('#sr-filter-open').addEventListener('click', () => setFilter('open'));
  toolbar.querySelector('#sr-filter-concerns').addEventListener('click', () => setFilter('concerns'));
  toolbar.querySelector('#sr-export-btn').addEventListener('click', exportStatusReportPPTX);
  const depthSel = toolbar.querySelector('#sr-depth-filter');
  if (depthSel) depthSel.addEventListener('change', e => {
    state.statusReportDepthFilter = e.target.value === 'all' ? null : parseInt(e.target.value);
    persistSrPrefs(); closeCheckboxDropdown(); renderStatusReport();
  });

  const colsBtn = toolbar.querySelector('#sr-cols-btn');
  colsBtn.addEventListener('click', () => toggleCheckboxDropdown(colsBtn, {
    title: 'Columns',
    items: SR_COLS.map(c => ({ value: c, label: SR_LABELS[c] })),
    selected: srVisibleCols(),
    onChange: sel => {
      state.statusReportHiddenCols = SR_COLS.filter(c => !sel.includes(c));
      persistSrPrefs();
      refreshStatusTable();
    },
  }));

  wireSrMultiSelect(toolbar, orgIndex);
}

// Wire the Phase / POC Team / Customer Team multi-select dropdown buttons. Selection of
// `null` means "all"; once narrowed it holds an explicit array. OR within, AND across.
function wireSrMultiSelect(toolbar, orgIndex) {
  const uni = srUniverses(orgIndex);
  const defs = [
    { id: 'sr-phase-btn', title: 'Phase', universe: uni.phases,
      items: uni.phases.map(p => ({ value: p, label: `${p}. ${esc(srPhaseName(p))}` })),
      get: () => state.statusReportPhases, set: v => state.statusReportPhases = v },
    { id: 'sr-poc-btn', title: 'POC Team', universe: uni.pocTeams,
      items: uni.pocTeams.map(x => ({ value: x, label: x })),
      get: () => state.statusReportPocTeams, set: v => state.statusReportPocTeams = v },
    { id: 'sr-cust-btn', title: 'Customer Team', universe: uni.custTeams,
      items: uni.custTeams.map(x => ({ value: x, label: x })),
      get: () => state.statusReportCustomerTeams, set: v => state.statusReportCustomerTeams = v },
  ];
  defs.forEach(d => {
    const btn = toolbar.querySelector('#' + d.id);
    if (!btn) return;
    btn.addEventListener('click', () => toggleCheckboxDropdown(btn, {
      title: d.title,
      items: d.items,
      selected: d.get() || d.universe,   // null = all selected
      onChange: sel => {
        d.set(sel.length === d.universe.length ? null : sel);
        persistSrPrefs();
        refreshStatusTable();
      },
    }));
  });
}

function srPhaseName(ph) {
  const names = getPhaseNames();
  return names[ph] || PHASE_NAMES_FALLBACK[ph - 1] || ('Phase ' + ph);
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderStatusTable(body, tasks, conflictSet, orgIndex, treeMode) {
  if (!tasks.length) {
    const msg = state.statusReportFilter === 'concerns'
      ? 'No concerns — all open tasks are on track.'
      : 'No tasks match the current filters.';
    body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:60px 20px;gap:12px;color:var(--muted);text-align:center">
      <div style="font-size:2rem">✅</div>
      <div style="font-weight:700;color:var(--text)">${msg}</div>
    </div>`;
    return;
  }

  const cols = srVisibleCols();
  const { col: sortCol, dir: sortDir } = state.statusReportSort;
  const today = getToday();

  const headerCells = cols.map(c => {
    const noSort = SR_NOSORT.has(c);
    const isSorted = sortCol === c;
    const ind = isSorted ? (sortDir === 'asc' ? '↑' : '↓') : '<span style="opacity:0.3">↕</span>';
    const ariaSort = noSort ? '' : ` aria-sort="${isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"`;
    return `<th${ariaSort} ${noSort ? '' : `data-sort="${c}" style="cursor:pointer;user-select:none"`}
      title="${noSort ? '' : 'Click to sort'}">${SR_LABELS[c]}${noSort ? '' : ' ' + ind}</th>`;
  }).join('');

  const rowsHTML = tasks.map(t => {
    const rag       = ragStatus(t, conflictSet);
    const color     = phaseColor(t.wbs);
    const isOverdue = t.end && t.end < today && t.pct < 100;
    const pctColor  = t.pct >= 75 ? '#3fb950' : t.pct >= 40 ? '#d29922' : '#f85149';
    const pocRes    = resolveNames(t.poc, orgIndex);
    const custRes   = resolveNames(t.customer, orgIndex);
    const wdObj     = t.pct >= 100 ? { text: '✓', cls: 'done' } :
                      t.milestone ? { text: '◆', cls: '' } :
                      !t.end ? { text: '—', cls: '' } :
                      isOverdue ? { text: '0 wd', cls: 'overdue' } :
                      { text: workDaysRemaining(t.end, state.ganttWorkDays, today) + ' wd', cls: '' };
    const wdColor   = wdObj.cls === 'overdue' ? '#f85149' : wdObj.cls === 'done' ? '#3fb950' : 'var(--text)';

    const validCell = (text, res) => {
      if (res.hasUnknown) {
        // Persistent ⚠ marker (not color-alone) + accessible label, plus hover tooltip.
        return `<td class="sr-invalid" title="Person not defined in org chart" aria-label="${esc(text)} — person not defined in org chart">${esc(text || '—')} <span class="sr-warn" aria-hidden="true">⚠</span></td>`;
      }
      return `<td>${esc(text || '—')}</td>`;
    };
    const cell = c => {
      switch (c) {
        case 'wbs':  return `<td><code style="color:${color};font-size:0.75rem">${esc(t.wbs)}</code></td>`;
        case 'name': {
          const indent = treeMode ? (((t.level || 1) - 1) * 16) : 0;
          let toggle = '';
          if (treeMode) {
            if (childrenOf(state.ProjectData.tasks, t.id).length) {
              const isColl = state.collapsedTasks.has(t.id);
              toggle = `<button class="sr-tree-toggle" data-toggle-id="${t.id}" aria-label="${isColl ? 'Expand' : 'Collapse'}" title="${isColl ? 'Expand' : 'Collapse'}">${isColl ? '▶' : '▼'}</button>`;
            } else {
              toggle = '<span class="sr-tree-spacer"></span>';
            }
          }
          return `<td style="font-weight:${t.milestone ? '700' : '400'};padding-left:${indent}px">${toggle}${t.milestone ? '◆ ' : ''}${esc(t.name)}</td>`;
        }
        case 'poc':  return validCell(t.poc, pocRes);
        case 'pocTeam': return `<td style="color:var(--muted)">${esc(pocRes.teams.join(', ') || '—')}</td>`;
        case 'customer': return validCell(t.customer, custRes);
        case 'customerTeam': return `<td style="color:var(--muted)">${esc(custRes.teams.join(', ') || '—')}</td>`;
        case 'start': return `<td>${fmt(t.start)}</td>`;
        case 'end':  return `<td style="color:${isOverdue ? '#f85149' : 'var(--text)'}">${fmt(t.end)}</td>`;
        case 'pct':  return `<td><div style="display:flex;align-items:center;gap:6px">
            <span style="min-width:32px;text-align:right;font-size:0.78rem">${t.pct}%</span>
            <div style="flex:1;height:5px;background:rgba(88,166,255,0.12);border-radius:3px;min-width:40px">
              <div style="height:5px;width:${t.pct}%;background:${pctColor};border-radius:3px"></div>
            </div></div></td>`;
        case 'wd':   return `<td style="color:${wdColor};font-size:0.8rem">${esc(wdObj.text)}</td>`;
        case 'rag':  return `<td><span class="rag-badge rag-${rag}" aria-label="${ragLabel(rag)}">${ragLabel(rag)}</span></td>`;
        case 'notes': return `<td style="color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem"
            title="${esc(t.notes || '')}">${esc(t.notes || '—')}</td>`;
        default: return '<td></td>';
      }
    };

    return `<tr class="sr-row" data-task-id="${t.id}" style="cursor:pointer">${cols.map(cell).join('')}</tr>`;
  }).join('');

  body.innerHTML = `
    <table class="status-table" role="table" aria-label="Status Report">
      <thead><tr role="row">${headerCells}</tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>`;

  // Sort clicks
  body.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const c = th.dataset.sort;
      if (state.statusReportSort.col === c) {
        state.statusReportSort.dir = state.statusReportSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.statusReportSort.col = c;
        state.statusReportSort.dir = 'asc';
      }
      renderStatusReport();
    });
  });

  // Collapse/expand toggles (tree mode) — don't trigger the row click
  body.querySelectorAll('.sr-tree-toggle').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleSrCollapse(+btn.dataset.toggleId); });
  });

  // Row click → side panel
  body.querySelectorAll('.sr-row').forEach(row => {
    row.addEventListener('click', () => {
      if (state.handlers.openTaskPanel) state.handlers.openTaskPanel(+row.dataset.taskId);
    });
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Compute the filtered + sorted display set and the supporting indexes. Shared by the
// full render and the table-only refresh (column toggle) so the popover stays open.
function srComputeDisplay() {
  const conflictSet = computeConflicts(state.ProjectData.tasks);
  const orgIndex    = buildOrgIndex(state.ProjectData.org);
  const tasks       = state.ProjectData.tasks;
  const nonHeaders  = tasks.filter(t => !isPhaseHeader(t));
  const allOpen     = nonHeaders.filter(t => t.pct < 100);
  const concerns    = allOpen.filter(t => { const r = ragStatus(t, conflictSet); return r === 'red' || r === 'amber'; });
  const treeMode    = !state.statusReportSort.col;   // default order = tree; column sort = flat (D5)

  // Does a task pass the active task-filter button + the Phase/POC-Team/Customer-Team selects?
  const matches = t => {
    const r = ragStatus(t, conflictSet);
    const passFilter = state.statusReportFilter === 'tasks' ? true
      : state.statusReportFilter === 'concerns' ? (r === 'red' || r === 'amber')
      : t.pct < 100;
    return passFilter && srPassesFilters(t, orgIndex);
  };

  let display;
  if (treeMode) {
    // Indented tree in WBS order: matches + their ancestors (so the tree stays connected),
    // minus rows hidden by collapse or the depth ceiling.
    const matchAll = tasks.filter(matches);
    const keep = new Set(matchAll.map(t => t.id));
    matchAll.forEach(t => ancestorsOf(tasks, t.id).forEach(a => keep.add(a.id)));
    const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
    const depthCeil = state.statusReportDepthFilter;
    const hiddenByCollapse = t => {
      let p = t.parentId != null ? byId[t.parentId] : null; const s = new Set();
      while (p && !s.has(p.id)) { s.add(p.id); if (state.collapsedTasks.has(p.id)) return true; p = p.parentId != null ? byId[p.parentId] : null; }
      return false;
    };
    display = tasks.filter(t => keep.has(t.id) && (!depthCeil || (t.level || 1) <= depthCeil) && !hiddenByCollapse(t));
  } else {
    display = sortTasks(nonHeaders.filter(matches), conflictSet, orgIndex);
  }
  return { conflictSet, orgIndex, nonHeaders, allOpen, concerns, display, treeMode };
}

// Re-render just the table (and the Columns button label) without rebuilding the toolbar,
// so an open Columns popover survives a column toggle.
function setSrMultiLabel(id, label, selected, universe) {
  const b = document.getElementById(id);
  if (!b) return;
  const all = !selected || selected.length === universe.length;
  b.textContent = all ? label : `${label} (${selected.length}/${universe.length})`;
  b.style.borderColor = all ? '' : 'var(--accent)';
  b.style.color = all ? '' : 'var(--accent)';
}

function refreshStatusTable() {
  const body = document.getElementById('status-body');
  if (!body) return;
  const { conflictSet, orgIndex, display, treeMode } = srComputeDisplay();
  renderStatusTable(body, display, conflictSet, orgIndex, treeMode);
  // Toolbar isn't rebuilt (so open popovers survive) — sync the dropdown labels in place.
  const uni = srUniverses(orgIndex);
  setSrMultiLabel('sr-phase-btn', 'Phase', state.statusReportPhases, uni.phases);
  setSrMultiLabel('sr-poc-btn', 'POC Team', state.statusReportPocTeams, uni.pocTeams);
  setSrMultiLabel('sr-cust-btn', 'Customer Team', state.statusReportCustomerTeams, uni.custTeams);
  const colsBtn = document.getElementById('sr-cols-btn');
  if (colsBtn) colsBtn.textContent = `Columns (${srVisibleCols().length}/${SR_COLS.length})`;
}

export function renderStatusReport() {
  const toolbar = document.getElementById('status-toolbar');
  const body    = document.getElementById('status-body');
  if (!toolbar || !body) return;
  closeCheckboxDropdown();

  if (!state.ProjectData.tasks.length) {
    toolbar.innerHTML = '';
    body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:60px 20px;gap:12px;color:var(--muted);text-align:center">
      <div style="font-size:2rem">📋</div>
      <div style="font-weight:700;color:var(--text)">No project loaded</div>
      <div style="font-size:0.83rem">Load an Excel file to view the status report.</div>
    </div>`;
    return;
  }

  const { conflictSet, orgIndex, nonHeaders, allOpen, concerns, display, treeMode } = srComputeDisplay();
  renderStatusToolbar(toolbar, nonHeaders.length, allOpen.length, concerns.length, orgIndex);
  renderStatusTable(body, display, conflictSet, orgIndex, treeMode);
}

// ── PowerPoint export ─────────────────────────────────────────────────────────

async function exportStatusReportPPTX() {
  const btn = document.getElementById('sr-export-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  try {
    await buildPPTX();
  } catch (e) {
    showToast('Export failed: ' + e.message, null, 5000);
  } finally {
    if (btn) { btn.textContent = 'Export to PowerPoint'; btn.disabled = false; }
  }
}

// Title + date text placed over the dark header bar (the bar itself lives in the slide
// master so it — and the slide number — repeat on auto-paginated continuation slides).
function pptxAddHeader(slide, title, subtitle) {
  slide.addText(title,    { x: 0.25, y: 0, w: 9,    h: 0.6, bold: true, color: 'FFFFFF', fontSize: 15, align: 'left',  valign: 'middle' });
  slide.addText(subtitle, { x: 9,    y: 0, w: 4.08, h: 0.6, color: 'D1D5DB', fontSize: 10, align: 'right', valign: 'middle' });
}

// Truncate on a word boundary with an ellipsis (avoids mid-word cuts on exec slides).
function truncWords(s, max) {
  s = String(s || '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/\s+$/, '') + '…';
}

async function buildPPTX() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inches

  // Master: white background, dark header bar, and a slide number — all repeat on the
  // continuation slides that auto-pagination creates for long tables.
  pptx.defineSlideMaster({
    title: 'SR_MASTER',
    background: { color: 'FFFFFF' },
    objects: [{ rect: { x: 0, y: 0, w: 13.33, h: 0.6, fill: { color: '1F2937' } } }],
    slideNumber: { x: 12.4, y: 7.12, w: 0.8, h: 0.3, fontSize: 8, color: '9CA3AF', align: 'right' },
  });

  const projectTitle = state.ProjectData.info['Project Title'] || 'Program';
  const today        = getToday();
  const dateStr      = today.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const phaseNames   = getPhaseNames();

  const allTasks   = state.ProjectData.tasks;
  // Metrics run over LEAF tasks only — parent rows hold rolled-up values, so counting
  // both a parent and its children would double-count work (and over-weight deep branches).
  const parentIds  = new Set(allTasks.filter(t => t.parentId != null).map(t => t.parentId));
  const leafTasks  = allTasks.filter(t => !parentIds.has(t.id) && !isPhaseHeader(t));
  const conflictSet = computeConflicts(allTasks);
  const orgIndex    = buildOrgIndex(state.ProjectData.org);

  const overallPct   = weightedPct(leafTasks);
  const openTasks    = leafTasks.filter(t => t.pct < 100);
  const overdueTasks = leafTasks.filter(t => t.end && t.end < today && t.pct < 100);
  const atRiskTasks  = openTasks.filter(t => ragStatus(t, conflictSet) === 'amber');
  const milestones   = leafTasks.filter(t => t.milestone);
  const nextMs       = milestones.filter(t => t.pct < 100)
    .sort((a, b) => (a.start || a.end || new Date(9e15)) - (b.start || b.end || new Date(9e15)))[0];

  // Build phase data (leaf tasks grouped by top-level phase)
  const phaseMap = {};
  leafTasks.forEach(t => {
    const ph = parseInt(String(t.wbs).split('.')[0]) || 1;
    if (!phaseMap[ph]) phaseMap[ph] = [];
    phaseMap[ph].push(t);
  });
  const phaseNums = Object.keys(phaseMap).map(Number).sort((a, b) => a - b);

  // ── Slide 1: KPI Summary ──────────────────────────────────────────────────
  const s1 = pptx.addSlide({ masterName: 'SR_MASTER' });
  pptxAddHeader(s1, `${projectTitle} — Program Status`, `Status as of ${dateStr}`);
  // Scope caption — slides 1–2 summarize the whole program (slide 3 mirrors the filtered view).
  s1.addText(`Entire program · ${leafTasks.length} task${leafTasks.length !== 1 ? 's' : ''}`, {
    x: 0.3, y: 0.6, w: 12.73, h: 0.18, fontSize: 9, italic: true, color: '6B7280',
  });

  // Executive summary sentence
  const slipped = (state.originalTasks || []).length
    ? leafTasks.filter(t => {
        const o = state.originalTasks.find(x => x.id === t.id);
        return o && o.end && t.end && t.end > new Date(o.end) && t.pct < 100;
      }).length
    : 0;
  const nextMsLabel = nextMs ? `${fmt(nextMs.start || nextMs.end)} (${truncWords(nextMs.name, 36)})` : 'none scheduled';
  const summary = `Program is ${overallPct}% complete · ${openTasks.length} open · ${overdueTasks.length} overdue · ${atRiskTasks.length} at risk · next milestone ${nextMsLabel}` +
    (slipped ? ` · ${slipped} task${slipped !== 1 ? 's' : ''} slipped vs baseline.` : '.');
  s1.addText(summary, { x: 0.3, y: 0.84, w: 12.73, h: 0.3, fontSize: 11, color: '374151' });

  // KPI cards (rounded shapes, not a spreadsheet grid)
  const kpis = [
    { val: `${overallPct}%`, label: 'Overall Complete', color: overallPct >= 75 ? '047857' : overallPct >= 40 ? '0369A1' : 'B45309', fs: 30 },
    { val: String(openTasks.length),    label: 'Open Tasks', color: '1F2937', fs: 30 },
    { val: String(overdueTasks.length), label: 'Overdue',  color: overdueTasks.length ? 'DC2626' : '6B7280', fs: 30 },
    { val: String(atRiskTasks.length),  label: 'At Risk',   color: atRiskTasks.length  ? 'B45309' : '6B7280', fs: 30 },
    { val: nextMs ? fmt(nextMs.start || nextMs.end) : 'None', label: 'Next Milestone', color: '1F2937', fs: 16 },
  ];
  const cardY = 1.25, cardH = 1.3, gap = 0.2;
  const cardW = (12.73 - gap * 4) / 5;
  kpis.forEach((k, i) => {
    const cx = 0.3 + i * (cardW + gap);
    s1.addShape(pptx.ShapeType.roundRect, { x: cx, y: cardY, w: cardW, h: cardH, fill: { color: 'F9FAFB' }, line: { color: 'E5E7EB', width: 1 }, rectRadius: 0.06 });
    s1.addText(k.val,   { x: cx, y: cardY + 0.08, w: cardW, h: cardH - 0.5, fontSize: k.fs, bold: true, color: k.color, align: 'center', valign: 'middle' });
    s1.addText(k.label, { x: cx, y: cardY + cardH - 0.42, w: cardW, h: 0.32, fontSize: 9, color: '4B5563', align: 'center', valign: 'top' });
  });

  // Top Concerns — the worst open red/amber tasks (replaces the slide-2-duplicate phase table)
  s1.addText('Top Concerns', { x: 0.3, y: 2.78, w: 6, h: 0.25, fontSize: 12, bold: true, color: '1F2937' });
  const concerns = leafTasks
    .filter(t => t.pct < 100)
    .map(t => ({ t, rag: ragStatus(t, conflictSet) }))
    .filter(o => o.rag === 'red' || o.rag === 'amber')
    .map(o => {
      const overdue  = o.t.end && o.t.end < today;
      const daysLate = overdue ? Math.max(1, Math.round((today - o.t.end) / 86400000)) : 0;
      return { ...o, overdue, daysLate };
    })
    .sort((a, b) => (b.overdue - a.overdue) || (b.daysLate - a.daysLate) || (a.t.pct - b.t.pct))
    .slice(0, 8);

  if (concerns.length) {
    const cHeader = ['Status', 'Task', 'POC', 'End', 'Detail'].map((h, i) => ({
      text: h, options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: i >= 3 ? 'center' : 'left' },
    }));
    const cRows = concerns.map(({ t, rag, overdue, daysLate }) => {
      const fill  = rag === 'red' ? 'FEE2E2' : 'FEF3C7';
      const stTxt = rag === 'red' ? 'Overdue' : 'At Risk';
      const stCol = rag === 'red' ? 'B91C1C' : 'B45309';
      const detail = overdue
        ? `${daysLate} day${daysLate !== 1 ? 's' : ''} late`
        : `${t.pct}% · ${t.end ? workDaysRemaining(t.end, state.ganttWorkDays, today) + ' wd left' : 'no end date'}`;
      const base = { fontSize: 9, fill: { color: fill } };
      return [
        { text: stTxt,                       options: { ...base, bold: true, color: stCol } },
        { text: truncWords(t.name, 52),      options: { ...base, color: '1F2937' } },
        { text: truncWords(t.poc || '—', 24),options: { ...base, color: '374151' } },
        { text: t.end ? fmt(t.end) : '—',    options: { ...base, color: overdue ? 'B91C1C' : '374151', align: 'center' } },
        { text: detail,                      options: { ...base, color: '4B5563', align: 'center' } },
      ];
    });
    s1.addTable([cHeader, ...cRows], {
      x: 0.3, y: 3.05, w: 12.73,
      colW: [1.2, 5.6, 2.2, 1.4, 2.33],
      border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
      fontSize: 9, margin: [0.05, 0.1, 0.05, 0.1],
      autoPage: true, autoPageRepeatHeader: true, autoPageSlideStartY: 0.85, masterName: 'SR_MASTER',
    });
  } else {
    s1.addText('✓  No overdue or at-risk tasks — all open work is on track.', {
      x: 0.3, y: 3.05, w: 12.73, h: 0.4, fontSize: 12, bold: true, color: '047857',
    });
  }

  // Footnote: methodology + as-of date
  s1.addText('% complete is schedule-duration-weighted. "At Risk" = ≤10 work-days to end and <50% complete, or a scheduling conflict. Status as of ' + dateStr + '.', {
    x: 0.3, y: 7.05, w: 12.73, h: 0.3, fontSize: 8, italic: true, color: '6B7280',
  });

  // ── Slide 2: Phase Breakdown ──────────────────────────────────────────────
  const s2 = pptx.addSlide({ masterName: 'SR_MASTER' });
  pptxAddHeader(s2, `${projectTitle} — Phase Breakdown`, `Status as of ${dateStr}`);
  s2.addText(`Entire program · ${leafTasks.length} task${leafTasks.length !== 1 ? 's' : ''}`, {
    x: 0.3, y: 0.6, w: 12.73, h: 0.18, fontSize: 9, italic: true, color: '6B7280',
  });

  const phDetailHeader = [
    { text: 'Phase',      options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10 } },
    { text: 'Phase Name', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10 } },
    { text: 'Total Tasks',options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10, align: 'center' } },
    { text: 'Complete',   options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10, align: 'center' } },
    { text: 'In Progress',options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10, align: 'center' } },
    { text: 'Not Started',options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10, align: 'center' } },
    { text: 'Overdue',    options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10, align: 'center' } },
    { text: '% Complete', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 10, align: 'center' } },
  ];
  const phDetailRows = phaseNums.map((ph, idx) => {
    const tasks      = phaseMap[ph];
    const pName      = phaseNames[ph] || PHASE_NAMES_FALLBACK[ph - 1] || `Phase ${ph}`;
    const total      = tasks.length;
    const done       = tasks.filter(t => t.pct >= 100).length;
    const inProg     = tasks.filter(t => t.pct > 0 && t.pct < 100).length;
    const notStart   = tasks.filter(t => t.pct === 0).length;
    const overdue    = tasks.filter(t => t.end && t.end < today && t.pct < 100).length;
    const pct        = weightedPct(tasks);
    const rowFill    = idx % 2 === 0 ? 'FFFFFF' : 'F3F4F6';
    const pctColHex  = pct >= 75 ? '047857' : '4B5563';   // green when on/ahead; neutral otherwise (no categorical blue)
    const phColor    = phaseColor(`${ph}.1`).replace('#', '');
    return [
      { text: `Phase ${ph}`, options: { fontSize: 10, color: phColor, bold: true, fill: { color: rowFill } } },
      { text: pName,          options: { fontSize: 10, color: '374151', fill: { color: rowFill } } },
      { text: String(total),  options: { fontSize: 10, color: '374151', align: 'center', fill: { color: rowFill } } },
      { text: String(done),   options: { fontSize: 10, color: done > 0 ? '047857' : '6B7280', align: 'center', bold: done > 0, fill: { color: rowFill } } },
      { text: String(inProg), options: { fontSize: 10, color: inProg > 0 ? '0369A1' : '6B7280', align: 'center', fill: { color: rowFill } } },
      { text: String(notStart), options: { fontSize: 10, color: '6B7280', align: 'center', fill: { color: rowFill } } },
      { text: overdue > 0 ? String(overdue) : '—', options: { fontSize: 10, color: overdue > 0 ? 'B91C1C' : '6B7280', align: 'center', bold: overdue > 0, fill: { color: rowFill } } },
      { text: `${pct}%`,      options: { fontSize: 10, bold: true, color: pctColHex, align: 'center', fill: { color: rowFill } } },
    ];
  });
  // Program totals row
  const tTotal = leafTasks.length;
  const tDone  = leafTasks.filter(t => t.pct >= 100).length;
  const tProg  = leafTasks.filter(t => t.pct > 0 && t.pct < 100).length;
  const tNot   = leafTasks.filter(t => t.pct === 0).length;
  const tOver  = overdueTasks.length;
  const totalRow = [
    { text: 'Program', options: { fontSize: 10, bold: true, color: 'FFFFFF', fill: { color: '1F2937' } } },
    { text: 'All phases', options: { fontSize: 10, bold: true, color: 'FFFFFF', fill: { color: '1F2937' } } },
    ...[tTotal, tDone, tProg, tNot, tOver === 0 ? '—' : tOver, `${overallPct}%`].map(v =>
      ({ text: String(v), options: { fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', fill: { color: '1F2937' } } })),
  ];
  s2.addTable([phDetailHeader, ...phDetailRows, totalRow], {
    x: 0.3, y: 0.95, w: 12.73,
    colW: [1.0, 3.73, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
    fontSize: 10,
    margin: [0.08, 0.12, 0.08, 0.12],
    autoPage: true, autoPageRepeatHeader: true, autoPageSlideStartY: 0.85, masterName: 'SR_MASTER',
  });

  // ── Slide 3: Task Table ───────────────────────────────────────────────────
  const s3 = pptx.addSlide({ masterName: 'SR_MASTER' });

  const filter = state.statusReportFilter;
  // Mirror exactly what's visible on screen: same rows (filters + collapse + depth, tree or
  // flat) the table shows (D5/D6) — collapsed subtasks are not exported.
  const exportTasks  = srComputeDisplay().display;
  const filterDesc   = filter === 'concerns' ? 'Concerns only (overdue + at risk)'
                     : filter === 'tasks'    ? 'All tasks'
                     : 'All open (incomplete) tasks';
  // Mirror the on-screen visible columns (fall back to all if the user hid everything).
  const cols = srVisibleCols().length ? srVisibleCols() : SR_COLS;
  const PPTX_W = { wbs:0.7, name:2.6, poc:1.4, pocTeam:1.2, customer:1.4, customerTeam:1.2,
                   start:1.0, end:1.0, pct:0.6, wd:0.8, rag:1.0, notes:2.6 };
  const centered = new Set(['start','end','pct','wd','rag']);

  pptxAddHeader(s3, `${projectTitle} — Tasks`, `Status as of ${dateStr}`);

  s3.addText(`${filterDesc} · ${exportTasks.length} task${exportTasks.length !== 1 ? 's' : ''}`, {
    x: 0.3, y: 0.66, w: 12.73, h: 0.2,
    fontSize: 9, color: '6B7280', italic: true,
  });

  // RAG legend (colored chips) + org-validation key — on the first task slide.
  s3.addText([
    { text: '■ ', options: { color: 'B91C1C' } }, { text: 'Overdue    ', options: { color: '4B5563' } },
    { text: '■ ', options: { color: 'B45309' } }, { text: 'At Risk (≤10 work-days left & <50%, or a conflict)    ', options: { color: '4B5563' } },
    { text: '■ ', options: { color: '047857' } }, { text: 'On Track    ', options: { color: '4B5563' } },
    { text: '■ ', options: { color: '1D4ED8' } }, { text: 'Done', options: { color: '4B5563' } },
    { text: '        ⚠ = name not in org chart', options: { color: 'B45309' } },
  ], { x: 0.3, y: 0.88, w: 12.73, h: 0.2, fontSize: 8 });

  const taskTableHeader = cols.map(c => ({
    text: SR_LABELS[c],
    options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: centered.has(c) ? 'center' : 'left' },
  }));

  const taskRows = exportTasks.map((t, idx) => {
    const rag      = ragStatus(t, conflictSet);
    const rowFill  = idx % 2 === 0 ? 'FFFFFF' : 'F9FAFB';
    // 4 distinct states (Done is blue, not lumped with On Track).
    const ragFill  = rag === 'red' ? 'FEE2E2' : rag === 'amber' ? 'FEF3C7' : rag === 'done' ? 'DBEAFE' : 'D1FAE5';
    const ragText  = rag === 'red' ? 'B91C1C' : rag === 'amber' ? 'B45309' : rag === 'done' ? '1D4ED8' : '047857';
    const overdue  = t.end && t.end < today && t.pct < 100;
    const endColor = overdue ? 'B91C1C' : '374151';
    const phColor  = phaseColor(t.wbs).replace('#', '');
    const pocRes   = resolveNames(t.poc, orgIndex);
    const custRes  = resolveNames(t.customer, orgIndex);
    const mark     = (val, res) => (val || '') + (res.hasUnknown ? '  ⚠' : '');  // flag names not in the org chart
    const wdText   = t.pct >= 100 ? '✓' : t.milestone ? '◆' :
                     !t.end ? '—' : overdue ? '0 wd' :
                     workDaysRemaining(t.end, state.ganttWorkDays, today) + ' wd';
    const wdColor  = overdue ? 'B91C1C' : '374151';
    const notes    = truncWords(t.notes, 60);
    // Convey the WBS tree: indent by depth, mark milestones, bold parent (summary) rows.
    const isParent = parentIds.has(t.id);
    const indent   = '  '.repeat(Math.max(0, (t.level || 1) - 1));
    const nameTxt  = indent + (t.milestone ? '◆ ' : '') + (t.name || '');
    const base8    = { fontSize: 8, fill: { color: rowFill } };
    const txt      = (text, opt) => ({ text: text || '—', options: { ...base8, ...opt } });
    const map = {
      wbs:          txt(t.wbs, { color: phColor, bold: true }),
      name:         txt(nameTxt, { color: '1F2937', bold: isParent }),
      poc:          txt(mark(t.poc, pocRes), { color: pocRes.hasUnknown ? 'B45309' : '374151' }),
      pocTeam:      txt(pocRes.teams.join(', '), { color: '4B5563' }),
      customer:     txt(mark(t.customer, custRes), { color: custRes.hasUnknown ? 'B45309' : '374151' }),
      customerTeam: txt(custRes.teams.join(', '), { color: '4B5563' }),
      start:        txt(fmt(t.start), { color: '374151', align: 'center' }),
      end:          txt(fmt(t.end), { color: endColor, align: 'center' }),
      pct:          txt(`${t.pct}%`, { color: '374151', align: 'center' }),
      wd:           txt(wdText, { color: wdColor, align: 'center' }),
      rag:          { text: ragLabel(rag), options: { ...base8, bold: true, color: ragText, align: 'center', fill: { color: ragFill } } },
      notes:        txt(notes, { color: '4B5563' }),
    };
    return cols.map(c => map[c]);
  });

  if (taskRows.length) {
    const totalW = cols.reduce((s, c) => s + (PPTX_W[c] || 1), 0);
    const colW   = cols.map(c => +((PPTX_W[c] || 1) / totalW * 12.73).toFixed(2));
    s3.addTable([taskTableHeader, ...taskRows], {
      x: 0.3, y: 1.15, w: 12.73,
      colW,
      border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
      fontSize: 8,
      margin: [0.04, 0.08, 0.04, 0.08],
      // Paginate long task lists across slides instead of running off the bottom edge.
      autoPage: true, autoPageRepeatHeader: true, autoPageSlideStartY: 1.15, masterName: 'SR_MASTER',
    });
  } else {
    s3.addText('No open tasks match the current filter.', {
      x: 0.3, y: 2, w: 12.73, h: 0.4,
      fontSize: 12, color: '6B7280', align: 'center',
    });
  }

  // Write file — local calendar date (matches the in-deck date; avoids the UTC off-by-one).
  const safeTitle = projectTitle.replace(/[/\\?%*:|"<>]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || 'Program';
  const fileDateStr = fmt(today);
  await pptx.writeFile({ fileName: `${safeTitle} - Status Report - ${fileDateStr}.pptx` });
  showToast('PowerPoint exported successfully.');
}
