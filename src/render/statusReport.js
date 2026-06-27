import PptxGenJS from 'pptxgenjs';
import { state } from '../state.js';
import { esc, fmt, workDaysRemaining, countWorkDays, getToday, daysBetween } from '../utils.js';
import { phaseColor } from '../colors.js';
import { PHASE_NAMES_FALLBACK } from '../constants.js';
import { computeConflicts } from '../compute/conflicts.js';
import { buildOrgIndex, resolveNames } from '../compute/orgLookup.js';
import { getPhaseNames } from './progDash.js';
import { showToast } from '../ui/toast.js';
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
  if (t.end && t.end < today) return 'red';
  if (conflictSet.has(t.id))   return 'amber';
  const wdLeft = t.end ? workDaysRemaining(t.end, state.ganttWorkDays, today) : Infinity;
  if (wdLeft <= 10 && t.pct < 50) return 'amber';
  return 'green';
}

function ragLabel(rag) {
  return rag === 'red' ? 'Overdue' : rag === 'amber' ? 'At Risk' : 'On Track';
}

function ragOrder(rag) {
  return rag === 'red' ? 0 : rag === 'amber' ? 1 : 2;
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

function renderStatusToolbar(toolbar, openCount, concernCount) {
  toolbar.innerHTML = `
    ${srFilterBtn('sr-filter-open', 'open', 'All open', openCount)}
    ${srFilterBtn('sr-filter-concerns', 'concerns', 'Concerns only', concernCount,
      'title="Overdue + at-risk tasks" aria-label="Concerns only — overdue and at-risk tasks"')}
    <span style="margin-left:auto"></span>
    <button class="btn-secondary btn-sm" id="sr-cols-btn" aria-haspopup="true" aria-expanded="false">Columns (${srVisibleCols().length}/${SR_COLS.length})</button>
    <button class="btn-secondary" id="sr-export-btn">Export to PowerPoint</button>`;

  const setFilter = v => { state.statusReportFilter = v; closeCheckboxDropdown(); renderStatusReport(); };
  toolbar.querySelector('#sr-filter-open').addEventListener('click', () => setFilter('open'));
  toolbar.querySelector('#sr-filter-concerns').addEventListener('click', () => setFilter('concerns'));
  toolbar.querySelector('#sr-export-btn').addEventListener('click', exportStatusReportPPTX);

  const colsBtn = toolbar.querySelector('#sr-cols-btn');
  colsBtn.addEventListener('click', () => toggleCheckboxDropdown(colsBtn, {
    title: 'Columns',
    items: SR_COLS.map(c => ({ value: c, label: SR_LABELS[c] })),
    selected: srVisibleCols(),
    onChange: sel => {
      state.statusReportHiddenCols = SR_COLS.filter(c => !sel.includes(c));
      refreshStatusTable();
    },
  }));
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderStatusTable(body, tasks, conflictSet, orgIndex) {
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
      const attrs = res.hasUnknown ? ' class="sr-invalid" title="Person not defined in org chart"' : '';
      return `<td${attrs}>${esc(text || '—')}</td>`;
    };
    const cell = c => {
      switch (c) {
        case 'wbs':  return `<td><code style="color:${color};font-size:0.75rem">${esc(t.wbs)}</code></td>`;
        case 'name': return `<td style="font-weight:${t.milestone ? '700' : '400'}">${t.milestone ? '◆ ' : ''}${esc(t.name)}</td>`;
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
  const allOpen     = state.ProjectData.tasks.filter(t => t.pct < 100 && !isPhaseHeader(t));
  const concerns    = allOpen.filter(t => ragStatus(t, conflictSet) !== 'green');
  const base        = state.statusReportFilter === 'concerns' ? concerns : allOpen;
  const display     = sortTasks(base, conflictSet, orgIndex);
  return { conflictSet, orgIndex, allOpen, concerns, display };
}

// Re-render just the table (and the Columns button label) without rebuilding the toolbar,
// so an open Columns popover survives a column toggle.
function refreshStatusTable() {
  const body = document.getElementById('status-body');
  if (!body) return;
  const { conflictSet, orgIndex, display } = srComputeDisplay();
  renderStatusTable(body, display, conflictSet, orgIndex);
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

  const { conflictSet, orgIndex, allOpen, concerns, display } = srComputeDisplay();
  renderStatusToolbar(toolbar, allOpen.length, concerns.length);
  renderStatusTable(body, display, conflictSet, orgIndex);
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

function pptxHeaderRow(title, subtitle) {
  return [[
    { text: title,    options: { bold: true, color: 'FFFFFF', fontSize: 15, align: 'left',  valign: 'middle' } },
    { text: subtitle, options: { color: 'D1D5DB',  fontSize: 10, align: 'right', valign: 'middle' } },
  ]];
}

async function buildPPTX() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inches

  const projectTitle = state.ProjectData.info['Project Title'] || 'Program';
  const today        = getToday();
  const dateStr      = today.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const phaseNames   = getPhaseNames();

  const allTasks   = state.ProjectData.tasks;
  const nonHeaders = allTasks.filter(t => !isPhaseHeader(t));
  const conflictSet = computeConflicts(allTasks);
  const orgIndex    = buildOrgIndex(state.ProjectData.org);

  const overallPct   = weightedPct(nonHeaders);
  const openTasks    = nonHeaders.filter(t => t.pct < 100);
  const overdueTasks = nonHeaders.filter(t => t.end && t.end < today && t.pct < 100);
  const atRiskTasks  = openTasks.filter(t => ragStatus(t, conflictSet) === 'amber');
  const milestones   = nonHeaders.filter(t => t.milestone);
  const nextMs       = milestones.filter(t => t.pct < 100)
    .sort((a, b) => (a.start || a.end) - (b.start || b.end))[0];

  // Build phase data
  const phaseMap = {};
  nonHeaders.forEach(t => {
    const ph = parseInt(String(t.wbs).split('.')[0]) || 1;
    if (!phaseMap[ph]) phaseMap[ph] = [];
    phaseMap[ph].push(t);
  });
  const phaseNums = Object.keys(phaseMap).map(Number).sort((a, b) => a - b);

  // ── Slide 1: KPI Summary ──────────────────────────────────────────────────
  const s1 = pptx.addSlide();
  s1.background = { color: 'FFFFFF' };

  // Header bar
  s1.addTable(pptxHeaderRow(`${projectTitle} — Program Status`, `Generated: ${dateStr}`), {
    x: 0, y: 0, w: 13.33, h: 0.6,
    colW: [9, 4.33],
    fill: { color: '1F2937' },
    border: { type: 'none' },
    margin: [0.1, 0.25, 0.1, 0.25],
  });

  // KPI table (2 rows: value + label)
  const pctCol   = overallPct >= 75 ? '3FB950' : overallPct >= 40 ? '58A6FF' : 'D29922';
  const overdueCol = overdueTasks.length > 0 ? 'F85149' : '6B7280';
  const atRiskCol  = atRiskTasks.length  > 0 ? 'D29922' : '6B7280';
  const nextMsText = nextMs
    ? `${fmt(nextMs.start || nextMs.end)}\n${(nextMs.name || '').slice(0, 28)}`
    : 'None';

  const kpiValueRow = [
    { text: `${overallPct}%`,         options: { fontSize: 28, bold: true, color: pctCol,    align: 'center', valign: 'bottom', fill: { color: 'F9FAFB' } } },
    { text: String(openTasks.length), options: { fontSize: 28, bold: true, color: '374151',  align: 'center', valign: 'bottom', fill: { color: 'F9FAFB' } } },
    { text: String(overdueTasks.length), options: { fontSize: 28, bold: true, color: overdueCol, align: 'center', valign: 'bottom', fill: { color: 'F9FAFB' } } },
    { text: String(atRiskTasks.length),  options: { fontSize: 28, bold: true, color: atRiskCol,  align: 'center', valign: 'bottom', fill: { color: 'F9FAFB' } } },
    { text: nextMsText,               options: { fontSize: 12, bold: false, color: '1F2937', align: 'center', valign: 'bottom', fill: { color: 'F9FAFB' } } },
  ];
  const kpiLabelRow = [
    { text: 'Overall Complete',  options: { fontSize: 9, color: '6B7280', align: 'center', valign: 'top', fill: { color: 'F3F4F6' } } },
    { text: 'Open Tasks',        options: { fontSize: 9, color: '6B7280', align: 'center', valign: 'top', fill: { color: 'F3F4F6' } } },
    { text: 'Overdue',           options: { fontSize: 9, color: '6B7280', align: 'center', valign: 'top', fill: { color: 'F3F4F6' } } },
    { text: 'At Risk',           options: { fontSize: 9, color: '6B7280', align: 'center', valign: 'top', fill: { color: 'F3F4F6' } } },
    { text: 'Next Milestone',    options: { fontSize: 9, color: '6B7280', align: 'center', valign: 'top', fill: { color: 'F3F4F6' } } },
  ];
  s1.addTable([kpiValueRow, kpiLabelRow], {
    x: 0.3, y: 0.8, w: 12.73, h: 2.0,
    colW: [2.546, 2.546, 2.546, 2.546, 2.546],
    rowH: [1.3, 0.6],
    border: { type: 'solid', pt: 1, color: 'E5E7EB' },
    margin: [0.1, 0.1, 0.05, 0.1],
  });

  // Phase summary table on slide 1
  const phaseHeaderRow = [
    { text: 'Phase', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9 } },
    { text: 'Phase Name', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9 } },
    { text: 'Tasks', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: 'center' } },
    { text: 'Complete', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: 'center' } },
    { text: 'Overdue', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: 'center' } },
    { text: '% Done', options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: 'center' } },
  ];
  const phaseRows = phaseNums.map((ph, idx) => {
    const tasks    = phaseMap[ph];
    const pName    = phaseNames[ph] || PHASE_NAMES_FALLBACK[ph - 1] || `Phase ${ph}`;
    const total    = tasks.length;
    const done     = tasks.filter(t => t.pct >= 100).length;
    const overdue  = tasks.filter(t => t.end && t.end < today && t.pct < 100).length;
    const pct      = weightedPct(tasks);
    const rowFill  = idx % 2 === 0 ? 'FFFFFF' : 'F9FAFB';
    const pctColHex = pct >= 75 ? '3FB950' : pct >= 40 ? '58A6FF' : 'D29922';
    const phColor  = phaseColor(`${ph}.1`).replace('#', '');
    return [
      { text: `Phase ${ph}`, options: { fontSize: 9, color: phColor, bold: true, fill: { color: rowFill } } },
      { text: pName,          options: { fontSize: 9, color: '374151', fill: { color: rowFill } } },
      { text: String(total),  options: { fontSize: 9, color: '374151', align: 'center', fill: { color: rowFill } } },
      { text: String(done),   options: { fontSize: 9, color: '374151', align: 'center', fill: { color: rowFill } } },
      { text: overdue > 0 ? String(overdue) : '—', options: { fontSize: 9, color: overdue > 0 ? 'F85149' : '9CA3AF', align: 'center', fill: { color: rowFill } } },
      { text: `${pct}%`,      options: { fontSize: 9, bold: true, color: pctColHex, align: 'center', fill: { color: rowFill } } },
    ];
  });
  s1.addTable([phaseHeaderRow, ...phaseRows], {
    x: 0.3, y: 3.05, w: 12.73,
    colW: [1.0, 4.5, 1.0, 1.0, 1.0, 1.23],
    border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
    fontSize: 9,
    margin: [0.05, 0.1, 0.05, 0.1],
  });

  s1.addText('Phase Progress', {
    x: 0.3, y: 2.9, w: 6, h: 0.2,
    fontSize: 10, bold: true, color: '374151',
  });

  // ── Slide 2: Phase Breakdown ──────────────────────────────────────────────
  const s2 = pptx.addSlide();
  s2.background = { color: 'FFFFFF' };

  s2.addTable(pptxHeaderRow(`${projectTitle} — Phase Breakdown`, `Generated: ${dateStr}`), {
    x: 0, y: 0, w: 13.33, h: 0.6,
    colW: [9, 4.33],
    fill: { color: '1F2937' },
    border: { type: 'none' },
    margin: [0.1, 0.25, 0.1, 0.25],
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
    const pctColHex  = pct >= 75 ? '3FB950' : pct >= 40 ? '58A6FF' : 'D29922';
    const phColor    = phaseColor(`${ph}.1`).replace('#', '');
    return [
      { text: `Phase ${ph}`, options: { fontSize: 10, color: phColor, bold: true, fill: { color: rowFill } } },
      { text: pName,          options: { fontSize: 10, color: '374151', fill: { color: rowFill } } },
      { text: String(total),  options: { fontSize: 10, color: '374151', align: 'center', fill: { color: rowFill } } },
      { text: String(done),   options: { fontSize: 10, color: done > 0 ? '3FB950' : '9CA3AF', align: 'center', bold: done > 0, fill: { color: rowFill } } },
      { text: String(inProg), options: { fontSize: 10, color: inProg > 0 ? '58A6FF' : '9CA3AF', align: 'center', fill: { color: rowFill } } },
      { text: String(notStart), options: { fontSize: 10, color: '9CA3AF', align: 'center', fill: { color: rowFill } } },
      { text: overdue > 0 ? String(overdue) : '—', options: { fontSize: 10, color: overdue > 0 ? 'F85149' : '9CA3AF', align: 'center', bold: overdue > 0, fill: { color: rowFill } } },
      { text: `${pct}%`,      options: { fontSize: 10, bold: true, color: pctColHex, align: 'center', fill: { color: rowFill } } },
    ];
  });
  s2.addTable([phDetailHeader, ...phDetailRows], {
    x: 0.3, y: 0.85, w: 12.73,
    colW: [1.0, 3.73, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
    fontSize: 10,
    margin: [0.08, 0.12, 0.08, 0.12],
  });

  // ── Slide 3: Task Table ───────────────────────────────────────────────────
  const s3 = pptx.addSlide();
  s3.background = { color: 'FFFFFF' };

  const filter = state.statusReportFilter;
  const base = filter === 'concerns' ? openTasks.filter(t => ragStatus(t, conflictSet) !== 'green')
             : filter === 'tasks'    ? nonHeaders
             : openTasks;
  const exportTasks  = sortTasks(base, conflictSet, orgIndex);
  const filterDesc   = filter === 'concerns' ? 'Concerns only (overdue + at risk)'
                     : filter === 'tasks'    ? 'All tasks'
                     : 'All open (incomplete) tasks';
  // Mirror the on-screen visible columns (fall back to all if the user hid everything).
  const cols = srVisibleCols().length ? srVisibleCols() : SR_COLS;
  const PPTX_W = { wbs:0.7, name:2.6, poc:1.4, pocTeam:1.2, customer:1.4, customerTeam:1.2,
                   start:1.0, end:1.0, pct:0.6, wd:0.8, rag:1.0, notes:2.6 };
  const centered = new Set(['start','end','pct','wd','rag']);

  s3.addTable(pptxHeaderRow(`${projectTitle} — Tasks`, `Generated: ${dateStr}`), {
    x: 0, y: 0, w: 13.33, h: 0.6,
    colW: [9, 4.33],
    fill: { color: '1F2937' },
    border: { type: 'none' },
    margin: [0.1, 0.25, 0.1, 0.25],
  });

  s3.addText(`${filterDesc} · ${exportTasks.length} task${exportTasks.length !== 1 ? 's' : ''}`, {
    x: 0.3, y: 0.7, w: 12.73, h: 0.2,
    fontSize: 9, color: '6B7280', italic: true,
  });

  const taskTableHeader = cols.map(c => ({
    text: SR_LABELS[c],
    options: { bold: true, color: 'FFFFFF', fill: { color: '374151' }, fontSize: 9, align: centered.has(c) ? 'center' : 'left' },
  }));

  const taskRows = exportTasks.map((t, idx) => {
    const rag      = ragStatus(t, conflictSet);
    const rowFill  = idx % 2 === 0 ? 'FFFFFF' : 'F9FAFB';
    const ragFill  = rag === 'red' ? 'FEE2E2' : rag === 'amber' ? 'FEF3C7' : 'D1FAE5';
    const ragText  = rag === 'red' ? 'DC2626' : rag === 'amber' ? 'D97706' : '059669';
    const overdue  = t.end && t.end < today && t.pct < 100;
    const endColor = overdue ? 'DC2626' : '374151';
    const phColor  = phaseColor(t.wbs).replace('#', '');
    const pocTeams = resolveNames(t.poc, orgIndex).teams.join(', ');
    const custTeams = resolveNames(t.customer, orgIndex).teams.join(', ');
    const wdText   = t.pct >= 100 ? '✓' : t.milestone ? '◆' :
                     !t.end ? '—' : overdue ? '0 wd' :
                     workDaysRemaining(t.end, state.ganttWorkDays, today) + ' wd';
    const wdColor  = overdue ? 'DC2626' : '374151';
    const notes    = (t.notes || '').slice(0, 60) + ((t.notes || '').length > 60 ? '…' : '');
    const base8    = { fontSize: 8, fill: { color: rowFill } };
    const txt      = (text, opt) => ({ text: text || '—', options: { ...base8, ...opt } });
    const map = {
      wbs:          txt(t.wbs, { color: phColor, bold: true }),
      name:         txt(t.name, { color: '1F2937' }),
      poc:          txt(t.poc, { color: '374151' }),
      pocTeam:      txt(pocTeams, { color: '6B7280' }),
      customer:     txt(t.customer, { color: '374151' }),
      customerTeam: txt(custTeams, { color: '6B7280' }),
      start:        txt(fmt(t.start), { color: '374151', align: 'center' }),
      end:          txt(fmt(t.end), { color: endColor, align: 'center' }),
      pct:          txt(`${t.pct}%`, { color: '374151', align: 'center' }),
      wd:           txt(wdText, { color: wdColor, align: 'center' }),
      rag:          { text: ragLabel(rag), options: { ...base8, bold: true, color: ragText, align: 'center', fill: { color: ragFill } } },
      notes:        txt(notes, { color: '6B7280' }),
    };
    return cols.map(c => map[c]);
  });

  if (taskRows.length) {
    const totalW = cols.reduce((s, c) => s + (PPTX_W[c] || 1), 0);
    const colW   = cols.map(c => +((PPTX_W[c] || 1) / totalW * 12.73).toFixed(2));
    s3.addTable([taskTableHeader, ...taskRows], {
      x: 0.3, y: 1.05, w: 12.73,
      colW,
      border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
      fontSize: 8,
      margin: [0.04, 0.08, 0.04, 0.08],
    });
  } else {
    s3.addText('No open tasks match the current filter.', {
      x: 0.3, y: 2, w: 12.73, h: 0.4,
      fontSize: 12, color: '6B7280', align: 'center',
    });
  }

  // Write file
  const safeTitle = projectTitle.replace(/[/\\?%*:|"<>]/g, '-');
  const fileDateStr = today.toISOString().slice(0, 10);
  await pptx.writeFile({ fileName: `${safeTitle} - Status Report - ${fileDateStr}.pptx` });
  showToast('PowerPoint exported successfully.');
}
