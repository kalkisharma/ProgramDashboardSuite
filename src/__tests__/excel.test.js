import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../excel.js';
import { parseScheduleSheet, parseBaselineSheet, parseInfoSheet } from '../parse.js';
import { ragConfig } from '../render/statusReport.js';
import { state, resetState } from '../state.js';
import { inferHierarchyFromWBS } from '../compute/wbs.js';
import { recalcHierarchy } from '../compute/hierarchy.js';

// Read a workbook sheet back as a 2D array of rows
const rows = (wb, sheetName) => XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });

const d = (y, m, day) => new Date(y, m - 1, day);

const minimalData = () => ({
  info: { 'Project Title': 'Test Project', 'Work Days': 'Mon,Tue,Wed,Thu,Fri' },
  tasks: [
    { id: 1, wbs: '1.0', name: 'Kickoff', poc: 'All Teams', customer: 'R. Nakamura', start: d(2025,1,6), end: d(2025,1,10), pct: 100, deps: [], milestone: true, notes: '' },
    { id: 2, wbs: '1.1', name: 'Analysis', poc: 'A. Singh', customer: 'Y. Zhang', start: d(2025,1,13), end: d(2025,2,28), pct: 50, deps: [1], milestone: false, notes: 'Some notes' },
  ],
  specs: [
    { id: 'AE-001', category: 'Aero', name: 'Max Speed', value: 200, units: 'kn', status: 'Target', group: 'Aero', notes: '', depIds: [1, 2] },
  ],
  org: [],
  weights: [],
});

describe('buildWorkbook — sheet presence', () => {
  it('produces exactly 3 sheets when org and weights are empty', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    expect(wb.SheetNames).toEqual(['Project Info', 'Schedule', 'Specifications']);
  });

  it('adds Org Chart sheet when org has data', () => {
    const pd = minimalData();
    pd.org = [{ name: 'Alice', title: 'Engineer', team: 'Systems', reportsTo: ['Bob'], email: 'alice@test.com' }];
    const wb = buildWorkbook(pd, 'lb');
    expect(wb.SheetNames).toContain('Org Chart');
  });

  it('adds Weight Budget sheet when weights has data', () => {
    const pd = minimalData();
    pd.weights = [{ subsystem: 'Wing', group: 'Structures', target: 100, estimated: 95, status: 'Estimated', notes: '' }];
    const wb = buildWorkbook(pd, 'lb');
    expect(wb.SheetNames).toContain('Weight Budget');
  });

  it('produces all 5 sheets when all data is present', () => {
    const pd = minimalData();
    pd.org = [{ name: 'Alice', title: 'Engineer', team: 'Systems', reportsTo: [], email: '' }];
    pd.weights = [{ subsystem: 'Wing', group: 'Structures', target: 100, estimated: 95, status: 'Estimated', notes: '' }];
    expect(buildWorkbook(pd, 'lb').SheetNames).toHaveLength(5);
  });
});

describe('buildWorkbook — Project Info sheet', () => {
  it('writes correct header row', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    expect(rows(wb, 'Project Info')[0]).toEqual(['Field', 'Value']);
  });

  it('writes key-value pairs from info', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const data = rows(wb, 'Project Info');
    expect(data).toContainEqual(['Project Title', 'Test Project']);
    expect(data).toContainEqual(['Work Days', 'Mon,Tue,Wed,Thu,Fri']);
  });
});

describe('buildWorkbook — Schedule sheet', () => {
  it('writes correct header row', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    expect(rows(wb, 'Schedule')[0]).toEqual([
      'Task ID','WBS','Task Name','POC','Customer','Start Date','End Date',
      '% Complete','Dependencies','Milestone','Notes',
    ]);
  });

  it('writes task fields correctly', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const data = rows(wb, 'Schedule');
    const task1 = data[1];
    expect(task1[0]).toBe(1);              // Task ID
    expect(task1[2]).toBe('Kickoff');       // Task Name
    expect(task1[3]).toBe('All Teams');     // POC
    expect(task1[4]).toBe('R. Nakamura');   // Customer
    expect(task1[7]).toBe(100);             // % Complete
    expect(task1[9]).toBe('Y');             // Milestone
  });

  it('formats dates as YYYY-MM-DD strings', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const data = rows(wb, 'Schedule');
    expect(data[1][5]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Start Date
    expect(data[1][6]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // End Date
  });

  it('writes empty string for null dates', () => {
    const pd = minimalData();
    pd.tasks = [{ id: 3, wbs: '1.2', name: 'No Dates', poc: '', customer: '', start: null, end: null, pct: 0, deps: [], milestone: false, notes: '' }];
    const wb = buildWorkbook(pd, 'lb');
    const row = rows(wb, 'Schedule')[1];
    expect(row[5]).toBe('');
    expect(row[6]).toBe('');
  });

  it('writes milestone: false as "N"', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    expect(rows(wb, 'Schedule')[2][9]).toBe('N');
  });

  it('filters out dangling dependency IDs not present in tasks', () => {
    const pd = minimalData();
    pd.tasks[1].deps = [1, 99]; // 99 does not exist
    const wb = buildWorkbook(pd, 'lb');
    expect(rows(wb, 'Schedule')[2][8]).toBe('1'); // only valid dep
  });
});

describe('buildWorkbook — Specifications sheet', () => {
  it('writes correct header row', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    expect(rows(wb, 'Specifications')[0]).toEqual([
      'Spec ID','Category','Specification Name','Value','Units',
      'Status','Responsible Group','Notes','Dependent Task IDs',
    ]);
  });

  it('writes spec fields correctly', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const row = rows(wb, 'Specifications')[1];
    expect(row[0]).toBe('AE-001');
    expect(row[3]).toBe(200);       // value
    expect(row[4]).toBe('kn');      // units
  });

  it('filters dangling depIds not present in tasks', () => {
    const pd = minimalData();
    pd.specs[0].depIds = [1, 999]; // 999 does not exist
    const wb = buildWorkbook(pd, 'lb');
    expect(rows(wb, 'Specifications')[1][8]).toBe('1');
  });
});

describe('buildWorkbook — Org Chart sheet', () => {
  it('writes correct header row', () => {
    const pd = minimalData();
    pd.org = [{ name: 'Alice', title: 'Engineer', team: 'Systems', reportsTo: ['Bob', 'Carol'], email: 'a@test.com' }];
    const wb = buildWorkbook(pd, 'lb');
    expect(rows(wb, 'Org Chart')[0]).toEqual(['Name','Title','Team','Reports To','Email']);
  });

  it('joins reportsTo array with ", "', () => {
    const pd = minimalData();
    pd.org = [{ name: 'Alice', title: 'Engineer', team: 'Systems', reportsTo: ['Bob', 'Carol'], email: 'a@test.com' }];
    const wb = buildWorkbook(pd, 'lb');
    expect(rows(wb, 'Org Chart')[1][3]).toBe('Bob, Carol');
  });

  it('writes empty string for root node with no managers', () => {
    const pd = minimalData();
    pd.org = [{ name: 'Boss', title: 'Director', team: 'All', reportsTo: [], email: 'b@test.com' }];
    const wb = buildWorkbook(pd, 'lb');
    expect(rows(wb, 'Org Chart')[1][3]).toBe('');
  });
});

describe('buildWorkbook — Weight Budget sheet', () => {
  it('uses provided weightUnit in column headers', () => {
    const pd = minimalData();
    pd.weights = [{ subsystem: 'Wing', group: 'Structures', target: 100, estimated: 95, status: 'Estimated', notes: '' }];
    const wb = buildWorkbook(pd, 'kg');
    const header = rows(wb, 'Weight Budget')[0];
    expect(header[2]).toBe('Target Weight (kg)');
    expect(header[3]).toBe('Estimated Weight (kg)');
  });

  it('defaults to "lb" when weightUnit is not provided', () => {
    const pd = minimalData();
    pd.weights = [{ subsystem: 'Wing', group: 'Structures', target: 100, estimated: 95, status: 'Estimated', notes: '' }];
    const wb = buildWorkbook(pd, undefined);
    const header = rows(wb, 'Weight Budget')[0];
    expect(header[2]).toBe('Target Weight (lb)');
  });

  it('writes weight row values correctly', () => {
    const pd = minimalData();
    pd.weights = [{ subsystem: 'Wing', group: 'Structures', target: 100, estimated: 95, contingency: 8, status: 'Estimated', notes: 'ok' }];
    const wb = buildWorkbook(pd, 'lb');
    const row = rows(wb, 'Weight Budget')[1];
    expect(row[0]).toBe('Wing');
    expect(row[2]).toBe(100);
    expect(row[3]).toBe(95);
    expect(row[4]).toBe(8);          // Contingency (%)
    expect(row[5]).toBe('Estimated'); // Status
  });
});

describe('buildWorkbook — Schedule sheet extended', () => {
  it('writes milestone: true as "Y"', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const scheduleRows = rows(wb, 'Schedule');
    const kickoffRow = scheduleRows.find(r => r[0] === 1);
    expect(kickoffRow[9]).toBe('Y');
  });

  it('writes milestone: false as "N"', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const scheduleRows = rows(wb, 'Schedule');
    const analysisRow = scheduleRows.find(r => r[0] === 2);
    expect(analysisRow[9]).toBe('N');
  });

  it('writes task rows in id order', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const scheduleRows = rows(wb, 'Schedule');
    const dataRows = scheduleRows.slice(1);
    expect(dataRows[0][0]).toBe(1);
    expect(dataRows[1][0]).toBe(2);
  });

  it('task with zero deps writes empty deps string', () => {
    const pd = minimalData();
    pd.tasks[0].deps = [];
    const wb = buildWorkbook(pd, 'lb');
    const scheduleRows = rows(wb, 'Schedule');
    const row = scheduleRows.find(r => r[0] === 1);
    expect(row[8]).toBe('');
  });
});

describe('buildWorkbook — Specifications sheet extended', () => {
  it('writes spec value as number when numeric', () => {
    const wb = buildWorkbook(minimalData(), 'lb');
    const specRows = rows(wb, 'Specifications');
    const specRow = specRows.find(r => r[0] === 'AE-001');
    expect(typeof specRow[3]).toBe('number');
    expect(specRow[3]).toBe(200);
  });

  it('multiple specs written in order', () => {
    const pd = minimalData();
    pd.specs.push({ id: 'PE-001', category: 'Perf', name: 'Climb', value: 1000, units: 'ft/min', status: 'TBD', group: 'P', notes: '', depIds: [] });
    const wb = buildWorkbook(pd, 'lb');
    const specRows = rows(wb, 'Specifications').slice(1);
    expect(specRows[0][0]).toBe('AE-001');
    expect(specRows[1][0]).toBe('PE-001');
  });
});

describe('buildWorkbook — Org Chart sheet extended', () => {
  it('single reports-to written without trailing comma', () => {
    const pd = minimalData();
    pd.org = [{ name: 'Alice', title: 'Lead', team: 'Systems', reportsTo: ['Bob'], email: '' }];
    const wb = buildWorkbook(pd, 'lb');
    const orgRows = rows(wb, 'Org Chart');
    expect(orgRows[1][3]).toBe('Bob');
  });
});

describe('buildWorkbook — Reference Files sheet', () => {
  it('omits the sheet when there are no reference files', () => {
    expect(buildWorkbook(minimalData(), 'lb').SheetNames).not.toContain('Reference Files');
  });

  it('writes header and rows when reference files are present', () => {
    const pd = minimalData();
    pd.referenceFiles = [
      { fileName: 'Spec PDF', url: 'https://x.com/a.pdf', generatedDate: '2025-05-09', generatedBy: 'L. Chen', notes: 'Aero' },
    ];
    const wb = buildWorkbook(pd, 'lb');
    expect(wb.SheetNames).toContain('Reference Files');
    const data = rows(wb, 'Reference Files');
    expect(data[0]).toEqual(['File Name','URL/Path','Generated Date','Generated By','Notes']);
    expect(data[1]).toEqual(['Spec PDF', 'https://x.com/a.pdf', '2025-05-09', 'L. Chen', 'Aero']);
  });
});

describe('buildWorkbook — hierarchy round-trip', () => {
  const pd = () => ({
    info: {}, specs: [], org: [], weights: [], referenceFiles: [],
    tasks: [
      { id: 1, wbs: '1.0', name: 'Phase', poc: 'Alice', customer: 'Acme', pocInherited: false, customerInherited: false, parentId: null, level: 1, start: d(2025,1,6), end: d(2025,1,17), pct: 50, deps: [], milestone: false, notes: '' },
      { id: 2, wbs: '1.1', name: 'Sub', poc: 'Alice', customer: 'Acme', pocInherited: true, customerInherited: true, parentId: 1, level: 2, start: d(2025,1,6), end: d(2025,1,10), pct: 100, deps: [], milestone: false, notes: '' },
    ],
  });

  it('writes blank for inherited POC/Customer', () => {
    const sub = rows(buildWorkbook(pd(), 'lb'), 'Schedule').find(r => r[1] === '1.1');
    expect(sub[3]).toBe(''); // POC blank (inherited)
    expect(sub[4]).toBe(''); // Customer blank (inherited)
  });

  it('re-imports the same tree + inherited flags', () => {
    const wb = buildWorkbook(pd(), 'lb');
    const tasks = parseScheduleSheet(wb.Sheets['Schedule']);
    inferHierarchyFromWBS(tasks);
    recalcHierarchy(tasks, [1, 2, 3, 4, 5]);
    const phase = tasks.find(t => t.wbs === '1.0');
    const sub = tasks.find(t => t.wbs === '1.1');
    expect(sub.parentId).toBe(phase.id);
    expect(sub.pocInherited).toBe(true);
    expect(sub.poc).toBe('Alice');     // re-inherited from the phase
    expect(sub.customer).toBe('Acme');
  });
});

describe('buildWorkbook — Baseline sheet round-trip', () => {
  it('writes a Baseline sheet only when set, and re-imports it by Task ID', () => {
    const base = () => ({
      info: {}, specs: [], org: [], weights: [], referenceFiles: [],
      tasks: [{ id: 1, wbs: '1.1', name: 'T', poc: '', customer: '', pocInherited: false, customerInherited: false,
        parentId: null, level: 1, start: d(2025,1,6), end: d(2025,1,17),
        baselineStart: null, baselineEnd: null, pct: 0, deps: [], milestone: false, notes: '' }],
    });
    // No baseline → no sheet
    expect(buildWorkbook(base(), 'lb').SheetNames).not.toContain('Baseline');
    // With baseline → sheet present + round-trips
    const pd = base();
    pd.tasks[0].baselineStart = d(2025,1,6);
    pd.tasks[0].baselineEnd   = d(2025,1,20);
    const wb = buildWorkbook(pd, 'lb');
    expect(wb.SheetNames).toContain('Baseline');
    const map = parseBaselineSheet(wb.Sheets['Baseline']);
    expect(map[1].end.getFullYear()).toBe(2025);
    expect(map[1].end.getMonth()).toBe(0);
    expect(map[1].end.getDate()).toBe(20);
  });
});

describe('RAG thresholds — Excel round-trip', () => {
  const buildAndReadInfo = (vals) => {
    const pd = minimalData();
    Object.assign(pd.info, vals);
    const wb = buildWorkbook(pd, 'lb');
    return parseInfoSheet(wb.Sheets['Project Info']);
  };

  it('round-trips RAG keys saved as strings (panel) → ragConfig', () => {
    const info = buildAndReadInfo({ 'RAG At-Risk Days': '7', 'RAG At-Risk %': '40', 'RAG Slip Tolerance %': '20' });
    resetState(); state.ProjectData.info = info;
    expect(ragConfig()).toEqual({ atRiskDays: 7, atRiskPct: 40, slipTol: 20 });
  });

  it('round-trips RAG keys stored as numbers (sample) → ragConfig', () => {
    const info = buildAndReadInfo({ 'RAG At-Risk Days': 10, 'RAG At-Risk %': 50, 'RAG Slip Tolerance %': 15 });
    resetState(); state.ProjectData.info = info;
    expect(ragConfig()).toEqual({ atRiskDays: 10, atRiskPct: 50, slipTol: 15 });
  });

  it('falls back to defaults when the keys are absent', () => {
    const info = buildAndReadInfo({});
    resetState(); state.ProjectData.info = info;
    expect(ragConfig()).toEqual({ atRiskDays: 10, atRiskPct: 50, slipTol: 15 });
  });
});
