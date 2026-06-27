export const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
export function getToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) { const d = new Date(v); d.setHours(0,0,0,0); return d; }
  const d = new Date(v);
  if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
  return null;
}

export function parseDeps(v) {
  if (!v) return [];
  return String(v).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}

export function fmt(d) { return d ? d.toISOString().slice(0,10) : '—'; }

// Sanitize a Reference-Files URL/Path for use as a link href. Allows http(s)/file/mailto
// schemes, Windows drive paths (C:\…), UNC paths (\\server\share), and relative paths;
// blocks dangerous schemes (javascript:, data:, vbscript:, …). Returns null if unusable.
export function safeUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (/^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s)) return s; // Windows drive / UNC path
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);            // has a URL scheme?
  if (m && !['http', 'https', 'file', 'mailto'].includes(m[1].toLowerCase())) return null;
  return s;
}

export function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

export function parseWorkDays(str) {
  const map = { mon:1, tue:2, wed:3, thu:4, fri:5, sat:6, sun:0 };
  return String(str).toLowerCase().split(',')
    .map(s => map[s.trim().slice(0,3)]).filter(n => n !== undefined);
}

export function isWorkDay(date, wds) { return wds.includes(date.getDay()); }

export function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }

export function snapToWorkDay(date, wds, dir) {
  const d = new Date(date); d.setHours(0,0,0,0);
  if (isWorkDay(d, wds)) return d;
  if (dir === undefined || dir === 0) {
    const fwd = snapToWorkDay(date, wds, 1);
    const bwd = snapToWorkDay(date, wds, -1);
    return Math.abs(daysBetween(date, fwd)) <= Math.abs(daysBetween(date, bwd)) ? fwd : bwd;
  }
  let i = 0;
  while (!isWorkDay(d, wds) && i < 14) { d.setDate(d.getDate() + (dir >= 0 ? 1 : -1)); i++; }
  return d;
}

export function countWorkDays(start, end, wds) {
  if (!start || !end) return 0;
  let count = 0;
  const d = new Date(start); d.setHours(0,0,0,0);
  const e = new Date(end);   e.setHours(0,0,0,0);
  while (d <= e) { if (isWorkDay(d, wds)) count++; d.setDate(d.getDate() + 1); }
  return count;
}

export function workDaysRemaining(endDate, wds, today) {
  if (!endDate) return 0;
  const e = new Date(endDate); e.setHours(0,0,0,0);
  if (e < today) return 0;
  return countWorkDays(today, e, wds);
}

export function wdDisplay(t, wds, today) {
  if (t.pct === 100) return { text: '✓', cls: 'done' };
  const rem = workDaysRemaining(t.end, wds, today);
  if (rem <= 0 && t.end && t.end < today) return { text: '0 wd', cls: 'overdue' };
  return { text: rem + ' wd', cls: '' };
}
