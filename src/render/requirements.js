import Papa from 'papaparse';
import { state } from '../state.js';
import { esc } from '../utils.js';

// ── CSV parsing ──────────────────────────────────────────────────────────────

function parseReqsCSV(text) {
  const result = Papa.parse(text, { header: false, skipEmptyLines: true });
  if (!result.data.length) return { headers: [], rows: [], error: 'CSV is empty.' };
  if (result.errors.length && !result.data.length) {
    return { headers: [], rows: [], error: result.errors[0].message };
  }
  const [headerRow, ...rows] = result.data;
  return { headers: headerRow.map(String), rows, error: null };
}

// ── Type inference (shared by sorting and cardinality check) ─────────────────

function inferColType(colValues) {
  const nonEmpty = colValues.filter(v => v != null && String(v).trim() !== '');
  if (!nonEmpty.length) return 'text';
  if (nonEmpty.every(v => !isNaN(Number(v)) && String(v).trim() !== '')) return 'number';
  if (nonEmpty.every(v => !isNaN(Date.parse(v)))) return 'date';
  return 'text';
}

function getDistinctValues(colValues) {
  const distinct = [...new Set(colValues.map(v => String(v ?? '')).filter(v => v !== ''))];
  return distinct.length <= 20 ? distinct.sort() : null;
}

function colValues(rows, idx) {
  return rows.map(r => String(r[idx] ?? ''));
}

// ── File loading ─────────────────────────────────────────────────────────────

function loadReqsFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    const { headers, rows, error } = parseReqsCSV(ev.target.result);
    if (error || !headers.length) {
      renderReqsError(error || 'No columns found in CSV.');
      return;
    }
    state.reqsData  = { headers, rows };
    state.reqsState = { sortCol: null, sortDir: 'asc', searchQuery: '', hiddenCols: [], colFilters: {} };
    renderRequirements();
  };
  r.readAsText(file);
}

// ── Empty / error states ─────────────────────────────────────────────────────

function renderReqsEmpty() {
  const toolbar = document.getElementById('reqs-toolbar');
  const body    = document.getElementById('reqs-body');
  toolbar.innerHTML = '';
  body.innerHTML = `
    <div class="reqs-drop-zone" id="reqs-drop-zone">
      <div class="drop-icon">📋</div>
      <div class="drop-title">Drop a CSV file to load requirements</div>
      <div class="drop-sub">Any CSV — headers are read from row 1, all columns rendered as-is</div>
      <div id="reqs-load-error" class="reqs-load-error" style="display:none"></div>
      <label for="reqs-file-input" class="btn-primary" style="margin-top:12px">Browse for CSV</label>
      <input type="file" id="reqs-file-input" accept=".csv" style="display:none">
    </div>`;
  wireDropZone();
}

function renderReqsError(msg) {
  const err = document.getElementById('reqs-load-error');
  if (err) { err.textContent = msg; err.style.display = 'block'; }
}

function wireDropZone() {
  const zone  = document.getElementById('reqs-drop-zone');
  const input = document.getElementById('reqs-file-input');
  if (!zone || !input) return;

  zone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { e.stopPropagation(); zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
    loadReqsFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files[0]) { loadReqsFile(e.target.files[0]); e.target.value = ''; }
  });
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function renderReqsToolbar() {
  const toolbar = document.getElementById('reqs-toolbar');
  const { headers } = state.reqsData;
  const { hiddenCols, searchQuery } = state.reqsState;
  const visibleCount = headers.length - hiddenCols.length;

  toolbar.innerHTML = `
    <div style="position:relative;display:flex;align-items:center">
      <input id="reqs-search" type="text" placeholder="Search all columns…" aria-label="Search requirements"
        value="${esc(searchQuery)}"
        style="background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);
               font-size:0.79rem;padding:4px 24px 4px 8px;outline:none;width:180px">
      <button id="reqs-search-clear" aria-label="Clear search"
        style="display:${searchQuery ? 'block' : 'none'};position:absolute;right:5px;background:none;border:none;
               color:var(--muted);cursor:pointer;font-size:0.85rem;padding:0;line-height:1">×</button>
    </div>
    <div style="position:relative">
      <button class="btn-secondary btn-sm" id="reqs-cols-btn" aria-expanded="false"
        aria-haspopup="true">Columns (${visibleCount}/${headers.length})</button>
      <div id="reqs-cols-panel" style="display:none;position:absolute;top:100%;left:0;z-index:200;
        background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;
        box-shadow:0 4px 16px rgba(0,0,0,0.3);min-width:180px;max-height:280px;overflow-y:auto;margin-top:4px">
        ${headers.map((h, i) => `
          <label style="display:flex;align-items:center;gap:7px;padding:3px 0;cursor:pointer;font-size:0.8rem">
            <input type="checkbox" data-col-idx="${i}" ${hiddenCols.includes(i) ? '' : 'checked'}
              style="cursor:pointer"> ${esc(h || '(empty)')}
          </label>`).join('')}
      </div>
    </div>
    <button class="btn-secondary btn-sm" id="reqs-clear-btn">Clear filters</button>
    <button class="btn-secondary btn-sm" id="reqs-reload-btn">Load different CSV</button>
    <span id="reqs-row-count" style="margin-left:auto;color:var(--muted);font-size:0.79rem"></span>`;

  // Search
  const searchEl = toolbar.querySelector('#reqs-search');
  const clearEl  = toolbar.querySelector('#reqs-search-clear');
  searchEl.addEventListener('input', () => {
    state.reqsState.searchQuery = searchEl.value;
    clearEl.style.display = searchEl.value ? 'block' : 'none';
    renderReqsTable();
  });
  clearEl.addEventListener('click', () => {
    state.reqsState.searchQuery = '';
    searchEl.value = '';
    clearEl.style.display = 'none';
    renderReqsTable();
  });

  // Columns toggle panel
  const colsBtn   = toolbar.querySelector('#reqs-cols-btn');
  const colsPanel = toolbar.querySelector('#reqs-cols-panel');
  colsBtn.addEventListener('click', () => {
    const open = colsPanel.style.display !== 'none';
    colsPanel.style.display = open ? 'none' : 'block';
    colsBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', function onOutside(e) {
    if (!colsBtn.contains(e.target) && !colsPanel.contains(e.target)) {
      colsPanel.style.display = 'none';
      colsBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onOutside);
    }
  });
  colsPanel.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = +cb.dataset.colIdx;
      if (cb.checked) state.reqsState.hiddenCols = state.reqsState.hiddenCols.filter(i => i !== idx);
      else            state.reqsState.hiddenCols = [...state.reqsState.hiddenCols, idx];
      colsBtn.textContent = `Columns (${headers.length - state.reqsState.hiddenCols.length}/${headers.length})`;
      renderReqsTable();
    });
  });

  // Clear filters
  toolbar.querySelector('#reqs-clear-btn').addEventListener('click', () => {
    state.reqsState.searchQuery = '';
    state.reqsState.sortCol     = null;
    state.reqsState.sortDir     = 'asc';
    state.reqsState.colFilters  = {};
    renderRequirements();
  });

  // Load different CSV
  toolbar.querySelector('#reqs-reload-btn').addEventListener('click', () => {
    state.reqsData  = { headers: [], rows: [] };
    state.reqsState = { sortCol: null, sortDir: 'asc', searchQuery: '', hiddenCols: [], colFilters: {} };
    renderRequirements();
  });
}

// ── Table ────────────────────────────────────────────────────────────────────

function renderReqsTable() {
  const body = document.getElementById('reqs-body');
  if (!body) return;
  const { headers, rows } = state.reqsData;
  const { sortCol, sortDir, searchQuery, hiddenCols, colFilters } = state.reqsState;
  const visibleCols = headers.map((_, i) => i).filter(i => !hiddenCols.includes(i));

  // Precompute column metadata (type + cardinality) from full unfiltered data
  const colMeta = headers.map((_, i) => {
    const vals    = colValues(rows, i);
    const type    = inferColType(vals);
    const distinct = getDistinctValues(vals);
    return { type, distinct }; // distinct===null means high-cardinality
  });

  // Filter rows
  const q = searchQuery.trim().toLowerCase();
  let filtered = rows.filter(row => {
    // Global search across visible columns
    if (q && !visibleCols.some(i => String(row[i] ?? '').toLowerCase().includes(q))) return false;
    // Per-column filters (AND)
    for (const [idxStr, filter] of Object.entries(colFilters)) {
      const i = +idxStr;
      const cell = String(row[i] ?? '');
      if (filter.type === 'select') {
        if (filter.values.length && !filter.values.includes(cell)) return false;
      } else {
        if (filter.value && !cell.toLowerCase().includes(filter.value.toLowerCase())) return false;
      }
    }
    return true;
  });

  // Sort
  if (sortCol !== null) {
    const type = colMeta[sortCol].type;
    filtered = filtered.slice().sort((a, b) => {
      const va = String(a[sortCol] ?? '');
      const vb = String(b[sortCol] ?? '');
      let cmp;
      if (type === 'number') cmp = Number(va) - Number(vb);
      else if (type === 'date') cmp = Date.parse(va) - Date.parse(vb);
      else cmp = va.localeCompare(vb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  // Update row count
  const countEl = document.getElementById('reqs-row-count');
  if (countEl) countEl.textContent = `${filtered.length} of ${rows.length} rows`;

  // Build header cells
  const headerCells = visibleCols.map(i => {
    const isSorted = sortCol === i;
    const ind = isSorted ? (sortDir === 'asc' ? '↑' : '↓') : '<span style="opacity:0.3">↕</span>';
    return `<th data-col-idx="${i}" style="cursor:pointer;user-select:none" title="Click to sort">${esc(headers[i] || '(empty)')} ${ind}</th>`;
  }).join('');

  // Build per-column filter cells
  const filterCells = visibleCols.map(i => {
    const filter  = colFilters[i];
    const { distinct } = colMeta[i];
    if (distinct) {
      // Low-cardinality: multi-select
      const selected = filter?.type === 'select' ? filter.values : [];
      const opts = distinct.map(v =>
        `<option value="${esc(v)}" ${selected.includes(v) ? 'selected' : ''}>${esc(v)}</option>`
      ).join('');
      return `<th><select multiple data-filter-col="${i}" size="1" style="width:100%;font-size:0.72rem;
        background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:1px 3px">
        <option value="">All</option>${opts}</select></th>`;
    } else {
      // High-cardinality: text input
      const val = filter?.type === 'text' ? filter.value : '';
      return `<th><input type="text" data-filter-col="${i}" value="${esc(val)}" placeholder="Filter…"
        style="width:100%;font-size:0.72rem;background:var(--surface);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:2px 4px;box-sizing:border-box"></th>`;
    }
  }).join('');

  // Build rows
  // TODO: row virtualization (e.g. windowing/IntersectionObserver) needed above ~2000 rows
  const rowsHTML = filtered.map(row =>
    `<tr class="reqs-row">${visibleCols.map(i =>
      `<td title="${esc(String(row[i] ?? ''))}">${esc(String(row[i] ?? ''))}</td>`
    ).join('')}</tr>`
  ).join('');

  const emptyMsg = filtered.length === 0
    ? `<tr><td colspan="${visibleCols.length}" style="text-align:center;padding:32px;color:var(--muted)">
        No rows match the current filters.
        <button id="reqs-clear-inline" style="background:none;border:none;color:var(--accent);cursor:pointer;
          font-size:inherit;text-decoration:underline;padding:0;margin-left:4px">Clear filters</button>
       </td></tr>`
    : rowsHTML;

  body.innerHTML = `
    <table class="reqs-table" role="grid" aria-label="Requirements">
      <thead>
        <tr role="row">${headerCells}</tr>
        <tr class="reqs-filter-row" role="row">${filterCells}</tr>
      </thead>
      <tbody>${emptyMsg}</tbody>
    </table>`;

  // Wire sort clicks
  body.querySelectorAll('thead tr:first-child th[data-col-idx]').forEach(th => {
    th.addEventListener('click', () => {
      const i = +th.dataset.colIdx;
      if (state.reqsState.sortCol === i) {
        state.reqsState.sortDir = state.reqsState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.reqsState.sortCol = i;
        state.reqsState.sortDir = 'asc';
      }
      renderReqsTable();
    });
  });

  // Wire column filter controls
  body.querySelectorAll('select[data-filter-col]').forEach(sel => {
    sel.addEventListener('change', () => {
      const i = +sel.dataset.filterCol;
      const selected = Array.from(sel.selectedOptions).map(o => o.value).filter(v => v !== '');
      if (selected.length) state.reqsState.colFilters[i] = { type: 'select', values: selected };
      else                 delete state.reqsState.colFilters[i];
      renderReqsTable();
    });
  });
  body.querySelectorAll('input[data-filter-col]').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.filterCol;
      if (inp.value) state.reqsState.colFilters[i] = { type: 'text', value: inp.value };
      else           delete state.reqsState.colFilters[i];
      renderReqsTable();
    });
  });

  // Wire inline clear button
  const inlineClear = body.querySelector('#reqs-clear-inline');
  if (inlineClear) {
    inlineClear.addEventListener('click', () => {
      state.reqsState.searchQuery = '';
      state.reqsState.sortCol     = null;
      state.reqsState.sortDir     = 'asc';
      state.reqsState.colFilters  = {};
      renderRequirements();
    });
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function renderRequirements() {
  const body    = document.getElementById('reqs-body');
  const toolbar = document.getElementById('reqs-toolbar');
  if (!body || !toolbar) return;

  if (!state.reqsData.headers.length) {
    renderReqsEmpty();
    return;
  }

  renderReqsToolbar();
  renderReqsTable();
}
