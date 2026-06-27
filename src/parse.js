import * as XLSX from 'xlsx';
import { parseDate, parseDeps, parseWorkDays } from './utils.js';

export function parseInfoSheet(ws) {
  if (!ws) return {};
  const info = {};
  XLSX.utils.sheet_to_json(ws, { header: 1 })
    .forEach(r => { if (r[0] && r[1] != null) info[String(r[0]).trim()] = r[1]; });
  return info;
}

export function parseScheduleSheet(ws) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const h = rows[0] || [];
  return rows.slice(1).filter(r => r[h.indexOf('Task ID')] != null).map(r => {
    const g = k => r[h.indexOf(k)];
    return {
      id:        +g('Task ID'),
      wbs:       String(g('WBS') || ''),
      name:      String(g('Task Name') || ''),
      poc:       String(g('POC') || ''),
      customer:  String(g('Customer') || ''),
      start:     parseDate(g('Start Date')),
      end:       parseDate(g('End Date')),
      pct:       +g('% Complete') || 0,
      deps:      parseDeps(g('Dependencies')),
      milestone: String(g('Milestone') || '').toUpperCase() === 'Y',
      notes:     String(g('Notes') || ''),
    };
  });
}

export function parseSpecsSheet(ws) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const h = rows[0] || [];
  return rows.slice(1).filter(r => r[h.indexOf('Spec ID')] != null).map(r => {
    const g = k => r[h.indexOf(k)];
    return {
      id:       String(g('Spec ID') || ''),
      category: String(g('Category') || ''),
      name:     String(g('Specification Name') || ''),
      value:    g('Value') != null ? g('Value') : '',
      units:    String(g('Units') || '—'),
      status:   String(g('Status') || 'TBD'),
      group:    String(g('Responsible Group') || ''),
      notes:    String(g('Notes') || ''),
      depIds:   parseDeps(g('Dependent Task IDs')),
    };
  });
}

export function parseOrgSheet(ws) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const h = rows[0] || [];
  return rows.slice(1).filter(r => r[h.indexOf('Name')] != null).map(r => {
    const g = k => r[h.indexOf(k)];
    return {
      name:      String(g('Name') || ''),
      title:     String(g('Title') || ''),
      team:      String(g('Team') || ''),
      reportsTo: String(g('Reports To') || '').split(',').map(s => s.trim()).filter(Boolean),
      email:     String(g('Email') || ''),
    };
  });
}

export function parseWeightSheet(ws) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const h = rows[0] || [];
  const tgtCol = h.find(c => c === 'Target Weight (lb)') || h.find(c => String(c).startsWith('Target Weight')) || 'Target Weight (lb)';
  const estCol = h.find(c => c === 'Estimated Weight (lb)') || h.find(c => String(c).startsWith('Estimated Weight')) || 'Estimated Weight (lb)';
  return rows.slice(1).filter(r => r[h.indexOf('Subsystem')] != null).map(r => {
    const g = k => r[h.indexOf(k)];
    return {
      subsystem: String(g('Subsystem') || ''),
      group:     String(g('Group') || ''),
      target:    Number(g(tgtCol)) || 0,
      estimated: Number(g(estCol)) || 0,
      status:    String(g('Status') || 'TBD'),
      notes:     String(g('Notes') || ''),
    };
  });
}

export function extractWorkDays(info) {
  const wd = info['Work Days'];
  if (!wd) return null;
  const parsed = parseWorkDays(String(wd));
  return parsed.length ? parsed : null;
}
