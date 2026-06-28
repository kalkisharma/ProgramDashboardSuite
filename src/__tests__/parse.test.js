import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseInfoSheet, parseScheduleSheet, parseSpecsSheet,
  parseOrgSheet, parseWeightSheet, parseReferenceSheet, extractWorkDays,
} from '../parse.js';

// Build a SheetJS worksheet from a 2D array of rows
const sheet = (rows) => XLSX.utils.aoa_to_sheet(rows);

describe('parseInfoSheet', () => {
  it('returns empty object for missing sheet', () => {
    expect(parseInfoSheet(null)).toEqual({});
  });

  it('parses key/value pairs', () => {
    const ws = sheet([
      ['Field', 'Value'],
      ['Project Title', 'Test Program'],
      ['Work Days', 'Mon,Tue,Wed,Thu,Fri'],
    ]);
    const info = parseInfoSheet(ws);
    expect(info['Project Title']).toBe('Test Program');
    expect(info['Work Days']).toBe('Mon,Tue,Wed,Thu,Fri');
  });

  it('trims whitespace from keys', () => {
    const ws = sheet([['  Project Title  ', 'Padded']]);
    expect(parseInfoSheet(ws)['Project Title']).toBe('Padded');
  });
});

describe('parseScheduleSheet', () => {
  it('returns empty array for missing sheet', () => {
    expect(parseScheduleSheet(null)).toEqual([]);
  });

  it('parses a task row', () => {
    const ws = sheet([
      ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'],
      [1, '1.1', 'Design', 'A. Singh', 'R. Nakamura', new Date(2024,0,1), new Date(2024,1,1), 50, '', '', 'Some notes'],
    ]);
    const tasks = parseScheduleSheet(ws);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(1);
    expect(tasks[0].name).toBe('Design');
    expect(tasks[0].poc).toBe('A. Singh');
    expect(tasks[0].customer).toBe('R. Nakamura');
    expect(tasks[0].pct).toBe(50);
    expect(tasks[0].milestone).toBe(false);
    expect(tasks[0].deps).toEqual([]);
  });

  it('parses milestone flag', () => {
    const ws = sheet([
      ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'],
      [2, '1.2', 'CDR', '', '', new Date(2024,2,1), new Date(2024,2,1), 0, '', 'Y', ''],
    ]);
    expect(parseScheduleSheet(ws)[0].milestone).toBe(true);
  });

  it('parses dependency list', () => {
    const ws = sheet([
      ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'],
      [3, '1.3', 'Test', '', '', null, null, 0, '1, 2', '', ''],
    ]);
    expect(parseScheduleSheet(ws)[0].deps).toEqual([1, 2]);
  });

  it('skips rows without a Task ID', () => {
    const ws = sheet([
      ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'],
      [null, '1.1', 'No ID row', '', '', null, null, 0, '', '', ''],
    ]);
    expect(parseScheduleSheet(ws)).toHaveLength(0);
  });

  it('produces null start/end for missing date values', () => {
    const ws = sheet([
      ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'],
      [4, '1.4', 'No Dates', '', '', null, null, 0, '', '', ''],
    ]);
    const task = parseScheduleSheet(ws)[0];
    expect(task.start).toBeNull();
    expect(task.end).toBeNull();
  });
});

describe('parseSpecsSheet', () => {
  it('returns empty array for missing sheet', () => {
    expect(parseSpecsSheet(null)).toEqual([]);
  });

  it('parses a spec row', () => {
    const ws = sheet([
      ['Spec ID','Category','Specification Name','Value','Units','Status','Responsible Group','Notes','Dependent Task IDs'],
      ['AE-001','Aerodynamics','Max Speed',250,'km/h','Active','Aero','','1,2'],
    ]);
    const specs = parseSpecsSheet(ws);
    expect(specs[0].id).toBe('AE-001');
    expect(specs[0].value).toBe(250);
    expect(specs[0].depIds).toEqual([1, 2]);
  });
});

describe('parseOrgSheet', () => {
  it('returns empty array for missing sheet', () => {
    expect(parseOrgSheet(null)).toEqual([]);
  });

  it('parses a person row with matrix reporting', () => {
    const ws = sheet([
      ['Name','Title','Team','Reports To','Email'],
      ['Alice','Engineer','Systems','Bob, Carol','alice@example.com'],
    ]);
    const org = parseOrgSheet(ws);
    expect(org[0].name).toBe('Alice');
    expect(org[0].reportsTo).toEqual(['Bob', 'Carol']);
  });
});

describe('parseWeightSheet', () => {
  it('returns empty array for missing sheet', () => {
    expect(parseWeightSheet(null)).toEqual([]);
  });

  it('parses a weight row with exact column names', () => {
    const ws = sheet([
      ['Subsystem','Group','Target Weight (lb)','Estimated Weight (lb)','Status','Notes'],
      ['Wing','Structure',120,115,'On Track',''],
    ]);
    const weights = parseWeightSheet(ws);
    expect(weights[0].subsystem).toBe('Wing');
    expect(weights[0].target).toBe(120);
    expect(weights[0].estimated).toBe(115);
  });

  it('falls back to startsWith match for alternate column names', () => {
    const ws = sheet([
      ['Subsystem','Group','Target Weight (kg)','Estimated Weight (kg)','Status','Notes'],
      ['Fuselage','Frame',200,195,'TBD',''],
    ]);
    const weights = parseWeightSheet(ws);
    expect(weights[0].target).toBe(200);
    expect(weights[0].estimated).toBe(195);
  });
});

describe('extractWorkDays', () => {
  it('returns null when Work Days key absent', () => {
    expect(extractWorkDays({})).toBeNull();
  });

  it('returns parsed array for valid Work Days string', () => {
    expect(extractWorkDays({ 'Work Days': 'Mon,Tue,Wed,Thu,Fri' })).toEqual([1,2,3,4,5]);
  });

  it('returns null for unrecognized string', () => {
    expect(extractWorkDays({ 'Work Days': 'invalid' })).toBeNull();
  });
});

describe('parseInfoSheet — extended', () => {
  it('parses phase name keys', () => {
    const ws = sheet([
      ['Field', 'Value'],
      ['Phase 1 Name', 'Concept'],
      ['Phase 2 Name', 'PDR'],
    ]);
    const info = parseInfoSheet(ws);
    expect(info['Phase 1 Name']).toBe('Concept');
    expect(info['Phase 2 Name']).toBe('PDR');
  });

  it('skips rows with null key but includes rows with valid keys', () => {
    const ws = sheet([
      [null, 'no key'],
      ['Valid Key', 'yes'],
    ]);
    const info = parseInfoSheet(ws);
    expect(info['Valid Key']).toBe('yes');
    expect(info).not.toHaveProperty('null');
  });

  it('handles numeric values', () => {
    const ws = sheet([['Field', 'Value'], ['Budget', 1000000]]);
    expect(parseInfoSheet(ws)['Budget']).toBe(1000000);
  });
});

describe('parseScheduleSheet — extended', () => {
  const HDR = ['Task ID','WBS','Task Name','POC','Customer','Start Date','End Date','% Complete','Dependencies','Milestone','Notes'];

  it('parses percent complete as a number', () => {
    const ws = sheet([HDR, [5, '1.5', 'Task', '', '', new Date(2024,0,1), new Date(2024,0,10), 75, '', '', '']]);
    expect(parseScheduleSheet(ws)[0].pct).toBe(75);
  });

  it('treats "y" (lowercase) as milestone', () => {
    const ws = sheet([HDR, [6, '1.6', 'Rev', '', '', new Date(2024,0,1), new Date(2024,0,1), 0, '', 'y', '']]);
    expect(parseScheduleSheet(ws)[0].milestone).toBe(true);
  });

  it('parses notes string', () => {
    const ws = sheet([HDR, [7, '1.7', 'Task', '', '', null, null, 0, '', '', 'Important note']]);
    expect(parseScheduleSheet(ws)[0].notes).toBe('Important note');
  });

  it('parses comma-separated POC and Customer', () => {
    const ws = sheet([HDR, [8, '1.8', 'Task', 'A. Singh, B. Osei', 'FAA ODA', null, null, 0, '', '', '']]);
    const task = parseScheduleSheet(ws)[0];
    expect(task.poc).toBe('A. Singh, B. Osei');
    expect(task.customer).toBe('FAA ODA');
  });

  it('multiple tasks parsed in order', () => {
    const ws = sheet([
      HDR,
      [1, '1.1', 'Alpha', '', '', new Date(2024,0,1), new Date(2024,0,5), 0, '', '', ''],
      [2, '1.2', 'Beta',  '', '', new Date(2024,0,6), new Date(2024,0,10), 50, '1', '', ''],
    ]);
    const tasks = parseScheduleSheet(ws);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].name).toBe('Alpha');
    expect(tasks[1].name).toBe('Beta');
    expect(tasks[1].deps).toEqual([1]);
  });
});

describe('parseSpecsSheet — extended', () => {
  const HDR = ['Spec ID','Category','Specification Name','Value','Units','Status','Responsible Group','Notes','Dependent Task IDs'];

  it('handles empty notes', () => {
    const ws = sheet([HDR, ['PE-001','Perf','Climb Rate',1000,'ft/min','Target','Perf','','']]);
    expect(parseSpecsSheet(ws)[0].notes).toBe('');
  });

  it('handles missing dep IDs', () => {
    const ws = sheet([HDR, ['PE-002','Perf','Speed',250,'kt','TBD','Perf','','']]);
    expect(parseSpecsSheet(ws)[0].depIds).toEqual([]);
  });
});

describe('parseOrgSheet — extended', () => {
  it('handles single reports-to (not a comma list)', () => {
    const ws = sheet([
      ['Name','Title','Team','Reports To','Email'],
      ['Bob','Manager','Systems','Carol','bob@example.com'],
    ]);
    const org = parseOrgSheet(ws);
    expect(org[0].reportsTo).toEqual(['Carol']);
  });

  it('handles empty reports-to (root node)', () => {
    const ws = sheet([
      ['Name','Title','Team','Reports To','Email'],
      ['Carol','CEO','Exec','','carol@example.com'],
    ]);
    const org = parseOrgSheet(ws);
    expect(org[0].reportsTo).toEqual([]);
  });
});

describe('extractWorkDays — extended', () => {
  it('returns Mon-Thu for "Mon,Tue,Wed,Thu"', () => {
    expect(extractWorkDays({ 'Work Days': 'Mon,Tue,Wed,Thu' })).toEqual([1,2,3,4]);
  });

  it('handles uppercase day names', () => {
    const result = extractWorkDays({ 'Work Days': 'MON,TUE,WED,THU,FRI' });
    expect(result).toEqual([1,2,3,4,5]);
  });
});

describe('parseReferenceSheet', () => {
  const HDR = ['File Name','URL/Path','Generated Date','Generated By','Notes'];

  it('returns empty array for missing sheet', () => {
    expect(parseReferenceSheet(null)).toEqual([]);
  });

  it('parses a reference row', () => {
    const ws = sheet([HDR, ['Spec PDF', 'https://x.com/a.pdf', '2025-05-09', 'L. Chen', 'Aero report']]);
    const f = parseReferenceSheet(ws)[0];
    expect(f.fileName).toBe('Spec PDF');
    expect(f.url).toBe('https://x.com/a.pdf');
    expect(f.generatedDate).toBe('2025-05-09');
    expect(f.generatedBy).toBe('L. Chen');
    expect(f.notes).toBe('Aero report');
  });

  it('keeps a string date as-is', () => {
    const ws = sheet([HDR, ['Doc', 'docs/a.pdf', 'Q1 2026', 'K. Johansson', '']]);
    expect(parseReferenceSheet(ws)[0].generatedDate).toBe('Q1 2026');
  });

  it('skips rows without a File Name', () => {
    const ws = sheet([HDR, [null, 'docs/x.pdf', '', '', '']]);
    expect(parseReferenceSheet(ws)).toHaveLength(0);
  });
});
