import Papa from 'papaparse';
import { state } from '../state.js';
import { esc } from '../utils.js';
import { safeSetItem } from '../ui/toast.js';

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

// ── Sample data ──────────────────────────────────────────────────────────────

function generateSampleReqsCSV() {
  const headers = [
    'Req ID', 'Title', 'Requirement Text',
    'Type', 'Status', 'Priority',
    'Verification Method', 'Allocated To', 'Source',
    'Rationale', 'Verification Status', 'Notes'
  ];

  const rows = [
    // Propulsion
    ['TW2-SYS-001', 'Takeoff Thrust', 'The propulsion system shall produce a minimum static thrust of 8,500 lbf at sea level ISA conditions.', 'Performance', 'Approved', 'High', 'Test', 'Propulsion', 'FAA AC 25-7D', 'Minimum thrust derived from MTOW plus 20% margin.', 'Passed', ''],
    ['TW2-SYS-002', 'Hover Endurance', 'The aircraft shall sustain hover for a minimum of 60 seconds at MTOW.', 'Performance', 'Approved', 'High', 'Test', 'Propulsion', 'Customer Spec Rev B', 'Required for urban helipad approach and departure phases.', 'Passed', ''],
    ['TW2-SYS-003', 'Battery Charge Time', 'The battery system shall reach 80% state of charge within 20 minutes using ground support equipment.', 'Performance', 'In Review', 'Medium', 'Test', 'Propulsion', 'Ops Concept Doc 3.2', 'Supports 30-minute turnaround target.', 'Not Started', 'Charger spec TBD'],
    ['TW2-SYS-004', 'Motor MTBF', 'Each propulsion motor shall have a demonstrated MTBF of no less than 5,000 flight hours.', 'Performance', 'Draft', 'High', 'Analysis', 'Propulsion', 'Safety Analysis SA-04', 'Drives single motor failure probability below 1×10⁻⁵/hour.', 'Not Started', 'Vendor data required'],
    ['TW2-SYS-005', 'Tilt Transition Time', 'The tilt-wing mechanism shall complete the VTOL-to-cruise transition in ≤ 30 seconds.', 'Performance', 'Approved', 'Medium', 'Test', 'Flight Controls', 'Customer Spec Rev B', 'Passenger comfort and airspace efficiency requirement.', 'In Progress', ''],
    // Flight Controls
    ['TW2-FC-001', 'Fly-by-Wire Redundancy', 'The flight control system shall implement triple-redundant fly-by-wire architecture with no single-point failure mode.', 'Safety', 'Approved', 'High', 'Analysis', 'Flight Controls', 'FAR Part 23 §23.1309', 'Required for catastrophic failure probability < 1×10⁻⁹/hr.', 'In Progress', ''],
    ['TW2-FC-002', 'Control Surface Authority', 'Elevons shall provide ±20° deflection range with no less than 50 lbf of sustained aerodynamic authority at Vmo.', 'Performance', 'Approved', 'High', 'Test', 'Flight Controls', 'Aerodynamics Report AER-12', 'Sized from worst-case asymmetric rotor failure scenario.', 'Not Started', ''],
    ['TW2-FC-003', 'Autopilot Modes', 'The autopilot shall provide Hover Hold, Altitude Hold, Navigation, and Approach modes.', 'Functional', 'Approved', 'Medium', 'Demonstration', 'Avionics', 'Customer Spec Rev B', 'Required for single-pilot IFR operation.', 'Not Started', ''],
    ['TW2-FC-004', 'Control Law Update Rate', 'Primary flight control laws shall execute at a minimum rate of 200 Hz.', 'Performance', 'Approved', 'High', 'Inspection', 'FC Architecture Doc', 'Required for rotor control bandwidth margin.', 'Passed', ''],
    ['TW2-FC-005', 'Failure Response Time', 'Upon detection of a flight-critical fault, the system shall engage reversionary mode within 50 ms.', 'Safety', 'In Review', 'High', 'Test', 'Flight Controls', 'Safety Analysis SA-07', 'Derived from pilot reaction time budget.', 'Not Started', 'Test procedure under review'],
    // Structures
    ['TW2-STR-001', 'Limit Load Factor', 'The primary structure shall withstand a limit load factor of +3.8g / -1.5g without permanent deformation.', 'Performance', 'Approved', 'High', 'Analysis', 'Structures', 'FAR Part 23 §23.337', 'Standard utility category load factors.', 'Passed', ''],
    ['TW2-STR-002', 'Ultimate Load Factor', 'The primary structure shall withstand 1.5× limit load (ultimate) without failure.', 'Safety', 'Approved', 'High', 'Test', 'Structures', 'FAR Part 23 §23.303', 'Required safety factor per regulation.', 'In Progress', ''],
    ['TW2-STR-003', 'Wing MTOW', 'The wing assembly shall carry the full MTOW of 6,000 lb in 1g level flight with < 0.5% elastic twist.', 'Performance', 'Approved', 'Medium', 'Analysis', 'Structures', 'Aerodynamics Report AER-12', 'Twist limit to maintain rotor shaft alignment.', 'Passed', ''],
    ['TW2-STR-004', 'Fuselage Pressurization', 'The fuselage shall maintain a cabin altitude of 8,000 ft MSL at a cruise altitude of 25,000 ft MSL.', 'Performance', 'Draft', 'Medium', 'Test', 'Structures', 'Customer Spec Rev B', 'Crew/passenger comfort and physiological requirement.', 'Not Started', 'Optional pressurization — pending config decision'],
    ['TW2-STR-005', 'Corrosion Protection', 'All primary structure shall meet or exceed ASTM B117 salt-fog corrosion resistance for 500 hours.', 'Functional', 'Approved', 'Low', 'Test', 'Structures', 'Material Spec MS-02', 'Supports operations in coastal and maritime environments.', 'Passed', ''],
    // Avionics
    ['TW2-AV-001', 'Navigation Accuracy', 'The integrated navigation system shall provide position accuracy of ≤ 3 m CEP (95%) in GPS-available environments.', 'Performance', 'Approved', 'High', 'Test', 'Avionics', 'Customer Spec Rev B', 'Required for urban air corridor precision.', 'In Progress', ''],
    ['TW2-AV-002', 'Sensor Fusion Latency', 'The sensor fusion pipeline shall maintain end-to-end latency below 10 ms from sensor input to FCC output.', 'Performance', 'Approved', 'High', 'Test', 'Avionics', 'FC Architecture Doc', 'Driven by control law stability margin analysis.', 'Not Started', ''],
    ['TW2-AV-003', 'DAA System Range', 'The detect-and-avoid system shall detect non-cooperative intruders at a minimum range of 1 NM.', 'Functional', 'In Review', 'High', 'Test', 'Avionics', 'ASTM F3442', 'Required for BVLOS operations in urban airspace.', 'Not Started', 'Sensor selection pending'],
    ['TW2-AV-004', 'Cockpit Display Update Rate', 'Primary flight displays shall refresh at a minimum of 30 Hz with ≤ 100 ms of display latency.', 'Performance', 'Approved', 'Medium', 'Inspection', 'DO-315B', 'Pilot situational awareness requirement.', 'Passed', ''],
    ['TW2-AV-005', 'SATCOM Link Margin', 'The satellite communications link shall maintain ≥ 6 dB of margin at the minimum operational elevation angle of 5°.', 'Performance', 'Draft', 'Low', 'Analysis', 'Comms Link Budget CB-01', 'Ensures reliable voice and data over oceanic routes.', 'Not Started', ''],
    // Safety
    ['TW2-SAF-001', 'Emergency Descent Rate', 'In unpowered autorotation/glide, the aircraft shall not exceed a descent rate of 2,000 fpm at MTOW.', 'Safety', 'Approved', 'High', 'Analysis', 'Safety', 'Safety Analysis SA-01', 'Limits touchdown energy to survivable levels.', 'Passed', ''],
    ['TW2-SAF-002', 'Fire Suppression', 'The battery and engine bays shall be equipped with an automatic fire suppression system activated within 500 ms of fire detection.', 'Safety', 'Approved', 'High', 'Test', 'Safety', 'FAR Part 23 §23.1195', 'Battery thermal runaway mitigation.', 'In Progress', ''],
    ['TW2-SAF-003', 'Lightning Strike', 'The aircraft shall meet DO-160G Section 22 lightning strike indirect effects requirements for all avionics.', 'Safety', 'Approved', 'High', 'Test', 'Avionics', 'DO-160G §22', 'Required for IFR certification in IMC.', 'Not Started', ''],
    ['TW2-SAF-004', 'Emergency Egress Time', 'All occupants shall be able to egress the aircraft within 90 seconds of landing in emergency configuration.', 'Safety', 'In Review', 'High', 'Demonstration', 'Safety', 'FAR Part 23 §23.807', 'Emergency egress standard.', 'Not Started', 'Door mechanism design in progress'],
    ['TW2-SAF-005', 'Bird Strike Resistance', 'The windshield and leading edges shall withstand a 4 lb bird impact at Vc without penetration.', 'Safety', 'Draft', 'Medium', 'Test', 'Structures', 'FAR Part 23 §23.775', 'Required for operations in Class B/C airspace below 10,000 ft.', 'Not Started', ''],
    // Systems Integration
    ['TW2-INT-001', 'Power Bus Architecture', 'The electrical power distribution system shall implement a dual-bus architecture with automatic bus tie and load shedding.', 'Functional', 'Approved', 'High', 'Analysis', 'Systems Integration', 'Power Arch Doc PA-03', 'Ensures no single failure removes critical bus.', 'Passed', ''],
    ['TW2-INT-002', 'Thermal Management', 'The thermal management system shall maintain all electronics within manufacturer-specified operating ranges at ISA+20°C ground conditions.', 'Performance', 'In Review', 'Medium', 'Test', 'Systems Integration', 'Thermal Analysis TA-02', 'Worst-case ground operations in desert environment.', 'Not Started', 'Cooling architecture TBD'],
    ['TW2-INT-003', 'Data Bus Bandwidth', 'The MIL-STD-1553B avionics backbone shall not exceed 50% bus utilization under peak load.', 'Performance', 'Approved', 'Low', 'Analysis', 'Avionics', 'ICD-AV-001', 'Headroom for future capability growth.', 'Passed', ''],
    ['TW2-INT-004', 'Software Configuration Control', 'All airworthiness-critical software shall be developed and controlled in accordance with DO-178C Level B or higher.', 'Functional', 'Approved', 'High', 'Inspection', 'Systems Integration', 'DO-178C', 'Required for flight-critical functions.', 'In Progress', ''],
    ['TW2-INT-005', 'System Weight Margin', 'The integrated aircraft shall maintain a minimum 5% weight margin relative to MTOW at the CDR configuration.', 'Performance', 'Approved', 'Medium', 'Analysis', 'Systems Integration', 'Weight Report WR-07', 'Preserves growth margin through detail design.', 'In Progress', ''],
  ];

  return Papa.unparse([headers, ...rows]);
}

export function downloadSampleReqsCSV() {
  const csv  = generateSampleReqsCSV();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'TW-2 Sample Requirements.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function loadSampleReqs() {
  const csv = generateSampleReqsCSV();
  const { headers, rows, error } = parseReqsCSV(csv);
  if (error || !headers.length) return;
  state.reqsData  = { headers, rows };
  state.reqsState = { sortCol: null, sortDir: 'asc', searchQuery: '', hiddenCols: [], colFilters: {} };
  saveReqsToStorage();
  renderRequirements();
}

// ── localStorage persistence ─────────────────────────────────────────────────

function saveReqsToStorage() {
  safeSetItem('vh-reqs-data', JSON.stringify({ data: state.reqsData, reqsState: state.reqsState }));
}

function clearReqsStorage() {
  try { localStorage.removeItem('vh-reqs-data'); } catch (_) {}
}

function restoreReqsFromStorage() {
  try {
    const raw = localStorage.getItem('vh-reqs-data');
    if (!raw) return false;
    const { data, reqsState } = JSON.parse(raw);
    if (!data?.headers?.length) return false;
    state.reqsData  = data;
    state.reqsState = reqsState || { sortCol: null, sortDir: 'asc', searchQuery: '', hiddenCols: [], colFilters: {} };
    return true;
  } catch (_) { return false; }
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
    saveReqsToStorage();
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
      <div class="drop-title">Drop a requirements CSV — or try with sample data</div>
      <div class="drop-sub">Independent of your project Excel — drop any CSV where the first row is column headers</div>
      <div id="reqs-load-error" class="reqs-load-error" style="display:none"></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center">
        <label for="reqs-file-input" class="btn-primary">Browse for CSV</label>
        <button class="btn-secondary" id="reqs-sample-btn">Try with sample data</button>
        <button class="btn-secondary" id="reqs-download-btn">Download sample CSV</button>
      </div>
      <input type="file" id="reqs-file-input" accept=".csv" style="display:none">
    </div>`;
  wireDropZone();
  document.getElementById('reqs-sample-btn').addEventListener('click', loadSampleReqs);
  document.getElementById('reqs-download-btn').addEventListener('click', downloadSampleReqsCSV);
}

function renderReqsError(msg) {
  const err = document.getElementById('reqs-load-error');
  if (err) { err.textContent = msg; err.style.display = 'block'; }
}

function wireDropZone() {
  const zone  = document.getElementById('reqs-drop-zone');
  const input = document.getElementById('reqs-file-input');
  if (!zone || !input) return;

  zone.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag-over'); });
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

// ── Filter popover (shared singleton, appended to body) ──────────────────────

let _filterPopover         = null;
let _filterPopoverCol      = null;
let _filterPopoverOnOutside = null;

function _getFilterPopover() {
  if (!_filterPopover) {
    _filterPopover = document.createElement('div');
    _filterPopover.setAttribute('role', 'dialog');
    _filterPopover.setAttribute('aria-label', 'Column filter');
    _filterPopover.style.cssText =
      'display:none;position:fixed;z-index:500;background:var(--surface);' +
      'border:1px solid var(--border);border-radius:8px;padding:6px 0;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3);min-width:160px;max-height:260px;overflow-y:auto';
    document.body.appendChild(_filterPopover);
  }
  return _filterPopover;
}

function _syncOutsideClick() {
  if (_filterPopoverOnOutside) {
    document.removeEventListener('click', _filterPopoverOnOutside);
    _filterPopoverOnOutside = null;
  }
  if (_filterPopoverCol === null) return;
  const col = _filterPopoverCol;
  _filterPopoverOnOutside = e => {
    if (!_filterPopover.contains(e.target) && !e.target.closest(`button[data-filter-col="${col}"]`)) {
      closeFilterPopover();
    }
  };
  document.addEventListener('click', _filterPopoverOnOutside);
}

function closeFilterPopover() {
  if (_filterPopover) _filterPopover.style.display = 'none';
  _filterPopoverCol = null;
  _syncOutsideClick();
}

function openFilterPopover(colIdx, anchorBtn) {
  const popover  = _getFilterPopover();
  const { rows } = state.reqsData;
  const distinct = getDistinctValues(colValues(rows, colIdx));
  if (!distinct) return;

  const active = state.reqsState.colFilters[colIdx]?.values ?? [];
  const items  = distinct.map(v => `
    <label style="display:flex;align-items:center;gap:7px;padding:4px 12px;cursor:pointer;
      font-size:0.8rem;color:var(--text);white-space:nowrap">
      <input type="checkbox" value="${esc(v)}" ${active.includes(v) ? 'checked' : ''}
        style="cursor:pointer"> ${esc(v || '(empty)')}
    </label>`).join('');

  popover.innerHTML = `
    <div style="padding:4px 12px 6px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <button id="reqs-fp-clear" style="background:none;border:none;color:var(--accent);
        cursor:pointer;font-size:0.78rem;padding:0;line-height:1.5">Clear filter</button>
    </div>
    ${items}`;

  popover.style.display = 'block';
  const rect = anchorBtn.getBoundingClientRect();
  const pw   = popover.offsetWidth;
  const ph   = popover.offsetHeight;
  let left   = rect.left;
  let top    = rect.bottom + 4;
  if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
  if (top  + ph > window.innerHeight - 8) top  = rect.top - ph - 4;
  popover.style.left = Math.max(8, left) + 'px';
  popover.style.top  = Math.max(8, top)  + 'px';

  _filterPopoverCol = colIdx;
  _syncOutsideClick();

  popover.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = Array.from(popover.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value);
      if (checked.length) state.reqsState.colFilters[colIdx] = { type: 'select', values: checked };
      else                delete state.reqsState.colFilters[colIdx];
      renderReqsTable();
    });
  });

  popover.querySelector('#reqs-fp-clear').addEventListener('click', () => {
    delete state.reqsState.colFilters[colIdx];
    closeFilterPopover();
    renderReqsTable();
  });
}

function _updateFilterBtn(btn, colIdx) {
  const f = state.reqsState.colFilters[colIdx];
  btn.textContent = f?.values?.length ? `${f.values.length} ✓` : 'All';
  btn.style.color = f?.values?.length ? 'var(--accent)' : '';
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

  // Columns toggle panel — fixed outside-click pattern (no stacking listeners)
  const colsBtn   = toolbar.querySelector('#reqs-cols-btn');
  const colsPanel = toolbar.querySelector('#reqs-cols-panel');

  function onColsOutside(e) {
    if (!colsBtn.contains(e.target) && !colsPanel.contains(e.target)) {
      colsPanel.style.display = 'none';
      colsBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onColsOutside);
    }
  }

  colsBtn.addEventListener('click', () => {
    const open = colsPanel.style.display !== 'none';
    colsPanel.style.display = open ? 'none' : 'block';
    colsBtn.setAttribute('aria-expanded', String(!open));
    if (!open) document.addEventListener('click', onColsOutside);
    else        document.removeEventListener('click', onColsOutside);
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

  // Clear filters — resets sort, search, column filters, and column visibility
  toolbar.querySelector('#reqs-clear-btn').addEventListener('click', () => {
    state.reqsState.searchQuery = '';
    state.reqsState.sortCol     = null;
    state.reqsState.sortDir     = 'asc';
    state.reqsState.colFilters  = {};
    state.reqsState.hiddenCols  = [];
    closeFilterPopover();
    renderRequirements();
  });

  // Load different CSV
  toolbar.querySelector('#reqs-reload-btn').addEventListener('click', () => {
    state.reqsData  = { headers: [], rows: [] };
    state.reqsState = { sortCol: null, sortDir: 'asc', searchQuery: '', hiddenCols: [], colFilters: {} };
    clearReqsStorage();
    closeFilterPopover();
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
    const vals     = colValues(rows, i);
    const type     = inferColType(vals);
    const distinct = getDistinctValues(vals);
    return { type, distinct };
  });

  // Filter rows
  const q = searchQuery.trim().toLowerCase();
  let filtered = rows.filter(row => {
    if (q && !visibleCols.some(i => String(row[i] ?? '').toLowerCase().includes(q))) return false;
    for (const [idxStr, filter] of Object.entries(colFilters)) {
      const i    = +idxStr;
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
    const { distinct } = colMeta[i];
    if (distinct) {
      // Low-cardinality: button opens checkbox popover
      return `<th><button class="reqs-filter-btn" data-filter-col="${i}"
        aria-label="Filter ${esc(headers[i] || '(empty)')}"
        aria-expanded="false" aria-haspopup="true">All</button></th>`;
    } else {
      // High-cardinality: text input
      const filter = colFilters[i];
      const val = filter?.type === 'text' ? filter.value : '';
      return `<th><input type="text" data-filter-col="${i}" value="${esc(val)}" placeholder="Filter…"
        aria-label="Filter ${esc(headers[i] || '(empty)')}"
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
    <table class="reqs-table" role="table" aria-label="Requirements">
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

  // Wire low-cardinality filter buttons
  body.querySelectorAll('button[data-filter-col]').forEach(btn => {
    const i = +btn.dataset.filterCol;
    _updateFilterBtn(btn, i);
    btn.addEventListener('click', () => {
      if (_filterPopoverCol === i) {
        closeFilterPopover();
      } else {
        if (_filterPopoverCol !== null) closeFilterPopover();
        openFilterPopover(i, btn);
      }
    });
  });

  // Wire high-cardinality text inputs
  body.querySelectorAll('input[data-filter-col]').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.filterCol;
      if (inp.value) state.reqsState.colFilters[i] = { type: 'text', value: inp.value };
      else           delete state.reqsState.colFilters[i];
      renderReqsTable();
      // Restore focus after DOM rebuild — input element is replaced on every render
      const refocused = body.querySelector(`input[data-filter-col="${i}"]`);
      if (refocused) { refocused.focus(); const len = refocused.value.length; refocused.setSelectionRange(len, len); }
    });
  });

  // Sync open popover with rebuilt DOM after table re-render
  if (_filterPopoverCol !== null) {
    const activeBtn = body.querySelector(`button[data-filter-col="${_filterPopoverCol}"]`);
    if (activeBtn) {
      activeBtn.setAttribute('aria-expanded', 'true');
      _syncOutsideClick();
    } else {
      closeFilterPopover();
    }
  }

  // Wire inline clear button
  const inlineClear = body.querySelector('#reqs-clear-inline');
  if (inlineClear) {
    inlineClear.addEventListener('click', () => {
      state.reqsState.searchQuery = '';
      state.reqsState.sortCol     = null;
      state.reqsState.sortDir     = 'asc';
      state.reqsState.colFilters  = {};
      closeFilterPopover();
      renderRequirements();
    });
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function renderRequirements() {
  closeFilterPopover();
  const body    = document.getElementById('reqs-body');
  const toolbar = document.getElementById('reqs-toolbar');
  if (!body || !toolbar) return;

  if (!state.reqsData.headers.length) {
    if (restoreReqsFromStorage()) {
      renderReqsToolbar();
      renderReqsTable();
      return;
    }
    renderReqsEmpty();
    return;
  }

  renderReqsToolbar();
  renderReqsTable();
}
