import { describe, it, expect } from 'vitest';
import {
  esc, parseDate, parseDeps, fmt, daysBetween,
  parseWorkDays, isWorkDay, addDays, snapToWorkDay,
  countWorkDays, workDaysRemaining, wdDisplay, safeUrl,
} from '../utils.js';

const WDS = [1, 2, 3, 4, 5]; // Mon–Fri
// Local-time date constructor avoids UTC-offset issues with new Date('YYYY-MM-DD')
const d = (s) => { const [y,m,day] = s.split('-').map(Number); return new Date(y, m-1, day); };

describe('esc', () => {
  it('escapes html special chars', () => {
    expect(esc('<script>"&test"</script>')).toBe('&lt;script&gt;&quot;&amp;test&quot;&lt;/script&gt;');
  });
  it('handles null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
  it('passes through plain text', () => {
    expect(esc('hello world')).toBe('hello world');
  });
});

describe('parseDate', () => {
  it('returns null for falsy input', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
  });
  it('parses a Date object and normalizes to midnight', () => {
    const input = new Date(2024, 5, 15, 12, 30); // June 15 at noon local
    const r = parseDate(input);
    expect(r).toBeInstanceOf(Date);
    expect(r.getFullYear()).toBe(2024);
    expect(r.getMonth()).toBe(5);
    expect(r.getDate()).toBe(15);
    expect(r.getHours()).toBe(0);
  });
  it('returns non-null for a date string', () => {
    expect(parseDate('2024-06-15')).toBeInstanceOf(Date);
  });
  it('normalizes a Date object to midnight', () => {
    const dt = new Date('2024-01-10T15:30:00');
    const r = parseDate(dt);
    expect(r.getHours()).toBe(0);
  });
});

describe('parseDeps', () => {
  it('returns empty for falsy', () => {
    expect(parseDeps(null)).toEqual([]);
    expect(parseDeps('')).toEqual([]);
  });
  it('parses comma-separated ints', () => {
    expect(parseDeps('1, 2, 5')).toEqual([1, 2, 5]);
  });
  it('filters non-numeric', () => {
    expect(parseDeps('1, abc, 3')).toEqual([1, 3]);
  });
});

describe('fmt', () => {
  it('formats a Date to YYYY-MM-DD', () => {
    expect(fmt(new Date('2024-03-07'))).toBe('2024-03-07');
  });
  it('returns em-dash for null', () => {
    expect(fmt(null)).toBe('—');
  });
});

describe('daysBetween', () => {
  it('returns 7 for one week', () => {
    expect(daysBetween(d('2024-01-01'), d('2024-01-08'))).toBe(7);
  });
  it('returns 0 for same day', () => {
    expect(daysBetween(d('2024-05-01'), d('2024-05-01'))).toBe(0);
  });
});

describe('parseWorkDays', () => {
  it('parses Mon-Fri', () => {
    expect(parseWorkDays('Mon,Tue,Wed,Thu,Fri')).toEqual([1, 2, 3, 4, 5]);
  });
  it('parses Mon-Thu', () => {
    expect(parseWorkDays('mon,tue,wed,thu')).toEqual([1, 2, 3, 4]);
  });
  it('handles mixed case', () => {
    expect(parseWorkDays('MON,WED,FRI')).toEqual([1, 3, 5]);
  });
  it('handles Sat and Sun', () => {
    expect(parseWorkDays('Sat,Sun')).toEqual([6, 0]);
  });
});

describe('isWorkDay', () => {
  it('Mon is a work day', () => {
    expect(isWorkDay(d('2024-06-03'), WDS)).toBe(true); // Monday
  });
  it('Sat is not a work day', () => {
    expect(isWorkDay(d('2024-06-01'), WDS)).toBe(false); // Saturday
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const r = addDays(d('2024-01-01'), 5);
    expect(r.getDate()).toBe(6);
  });
  it('subtracts negative days', () => {
    const r = addDays(d('2024-01-10'), -3);
    expect(r.getDate()).toBe(7);
  });
});

describe('snapToWorkDay', () => {
  it('returns same date if already a work day', () => {
    const mon = d('2024-06-03'); // Monday
    expect(snapToWorkDay(mon, WDS, 1).getTime()).toBe(mon.getTime());
  });
  it('snaps Saturday forward to Monday', () => {
    const sat = d('2024-06-01'); // Saturday
    const result = snapToWorkDay(sat, WDS, 1);
    expect(result.getDay()).toBe(1); // Monday
  });
  it('snaps Saturday backward to Friday', () => {
    const sat = d('2024-06-01');
    const result = snapToWorkDay(sat, WDS, -1);
    expect(result.getDay()).toBe(5); // Friday
  });
});

describe('countWorkDays', () => {
  it('counts Mon-Fri as 5 work days', () => {
    expect(countWorkDays(d('2024-06-03'), d('2024-06-07'), WDS)).toBe(5);
  });
  it('returns 0 for null inputs', () => {
    expect(countWorkDays(null, d('2024-06-07'), WDS)).toBe(0);
  });
  it('includes both endpoints', () => {
    expect(countWorkDays(d('2024-06-03'), d('2024-06-03'), WDS)).toBe(1);
  });
  it('skips weekends over a 2-week span', () => {
    expect(countWorkDays(d('2024-06-03'), d('2024-06-14'), WDS)).toBe(10);
  });
});

describe('workDaysRemaining', () => {
  it('returns 0 for past end date', () => {
    const past = d('2020-01-01');
    const today = d('2024-06-10');
    expect(workDaysRemaining(past, WDS, today)).toBe(0);
  });
  it('returns correct count for future end', () => {
    const today = d('2024-06-03'); // Monday
    const end   = d('2024-06-07'); // Friday
    expect(workDaysRemaining(end, WDS, today)).toBe(5);
  });
  it('returns 0 for null endDate', () => {
    expect(workDaysRemaining(null, WDS, d('2024-06-03'))).toBe(0);
  });
});

describe('wdDisplay', () => {
  it('shows checkmark for 100% complete', () => {
    const t = { pct: 100, end: d('2024-06-07') };
    expect(wdDisplay(t, WDS, d('2024-06-03'))).toEqual({ text: '✓', cls: 'done' });
  });
  it('shows overdue for past-due unfinished task', () => {
    const t = { pct: 50, end: d('2020-01-01') };
    const result = wdDisplay(t, WDS, d('2024-06-03'));
    expect(result.cls).toBe('overdue');
  });
  it('shows remaining days for future task', () => {
    const today = d('2024-06-03');
    const end   = d('2024-06-07');
    const t = { pct: 0, end };
    const result = wdDisplay(t, WDS, today);
    expect(result.text).toBe('5 wd');
    expect(result.cls).toBe('');
  });
});

describe('esc — extended', () => {
  it('does not double-escape an already-escaped string', () => {
    expect(esc('a&b')).toBe('a&amp;b');
  });
  it('handles numbers coerced to string', () => {
    expect(esc(42)).toBe('42');
  });
  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });
});

describe('parseDeps — extended', () => {
  it('handles spaces around numbers', () => {
    expect(parseDeps(' 1 , 2 , 3 ')).toEqual([1, 2, 3]);
  });
  it('handles single value', () => {
    expect(parseDeps('5')).toEqual([5]);
  });
  it('includes negative numbers (parseDeps does not filter them)', () => {
    const result = parseDeps('-1, 2');
    expect(result).toContain(2);
  });
});

describe('addDays — extended', () => {
  it('adding 0 days returns same date', () => {
    const d1 = d('2024-06-10');
    const r = addDays(d1, 0);
    expect(r.getDate()).toBe(10);
  });
  it('crosses month boundary', () => {
    const r = addDays(d('2024-01-28'), 5);
    expect(r.getMonth()).toBe(1); // February
    expect(r.getDate()).toBe(2);
  });
});

describe('isWorkDay — extended', () => {
  it('Saturday is not a work day with Mon-Fri schedule', () => {
    const sat = d('2024-06-08'); // Saturday
    expect(isWorkDay(sat, WDS)).toBe(false);
  });
  it('Sunday is not a work day with Mon-Fri schedule', () => {
    const sun = d('2024-06-09'); // Sunday
    expect(isWorkDay(sun, WDS)).toBe(false);
  });
  it('Saturday is a work day if wds includes 6', () => {
    const sat = d('2024-06-08');
    expect(isWorkDay(sat, [1, 2, 3, 4, 5, 6])).toBe(true);
  });
  it('Monday is a work day with Mon-Thu schedule', () => {
    const mon = d('2024-06-10');
    expect(isWorkDay(mon, [1, 2, 3, 4])).toBe(true);
  });
  it('Friday is not a work day with Mon-Thu schedule', () => {
    const fri = d('2024-06-07');
    expect(isWorkDay(fri, [1, 2, 3, 4])).toBe(false);
  });
});

describe('snapToWorkDay — extended', () => {
  it('snaps Saturday forward to Monday (next week)', () => {
    const sat = d('2024-06-08'); // Saturday
    const result = snapToWorkDay(sat, WDS, 1);
    expect(result.getDate()).toBe(10); // Monday June 10
  });
  it('snaps Sunday backward to Friday', () => {
    const sun = d('2024-06-09');
    const result = snapToWorkDay(sun, WDS, -1);
    expect(result.getDay()).toBe(5); // Friday
  });
  it('already a Monday: no change (forward)', () => {
    const mon = d('2024-06-10');
    const result = snapToWorkDay(mon, WDS, 1);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(10);
  });
});

describe('countWorkDays — extended', () => {
  it('Mon-Thu schedule: 5 days of Mon-Fri = 4 work days', () => {
    const wdsMT = [1, 2, 3, 4]; // Mon-Thu only
    expect(countWorkDays(d('2024-06-03'), d('2024-06-07'), wdsMT)).toBe(4);
  });
  it('returns 0 when end before start', () => {
    expect(countWorkDays(d('2024-06-07'), d('2024-06-03'), WDS)).toBe(0);
  });
  it('returns 0 for null end', () => {
    expect(countWorkDays(d('2024-06-03'), null, WDS)).toBe(0);
  });
});

describe('daysBetween — extended', () => {
  it('returns negative when end is before start', () => {
    expect(daysBetween(d('2024-06-10'), d('2024-06-01'))).toBeLessThan(0);
  });
  it('counts across month boundary', () => {
    expect(daysBetween(d('2024-01-28'), d('2024-02-04'))).toBe(7);
  });
});

describe('fmt — extended', () => {
  it('formats date correctly at year boundary', () => {
    expect(fmt(d('2024-12-31'))).toBe('2024-12-31');
  });
  it('pads month and day with leading zero', () => {
    expect(fmt(d('2024-01-05'))).toBe('2024-01-05');
  });
});

describe('parseWorkDays — extended', () => {
  it('returns empty array for empty string', () => {
    expect(parseWorkDays('')).toEqual([]);
  });
  it('parses Sat and Sun as 6 and 0', () => {
    const wds = parseWorkDays('Sat,Sun');
    expect(wds).toContain(6);
    expect(wds).toContain(0);
  });
  it('repeated days produce repeated values (no dedup)', () => {
    const wds = parseWorkDays('Mon,Mon,Tue');
    expect(wds).toContain(1);
    expect(wds).toContain(2);
  });
});

describe('safeUrl', () => {
  it('allows http and https', () => {
    expect(safeUrl('http://example.com/x')).toBe('http://example.com/x');
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('allows file and mailto schemes', () => {
    expect(safeUrl('file:///C:/docs/a.pdf')).toBe('file:///C:/docs/a.pdf');
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });
  it('allows Windows drive paths and UNC paths', () => {
    expect(safeUrl('C:\\docs\\spec.pdf')).toBe('C:\\docs\\spec.pdf');
    expect(safeUrl('C:/docs/spec.pdf')).toBe('C:/docs/spec.pdf');
    expect(safeUrl('\\\\server\\share\\f.txt')).toBe('\\\\server\\share\\f.txt');
  });
  it('allows relative paths', () => {
    expect(safeUrl('docs/spec.pdf')).toBe('docs/spec.pdf');
    expect(safeUrl('./a/b.txt')).toBe('./a/b.txt');
  });
  it('blocks dangerous schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>x</script>')).toBeNull();
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull();
  });
  it('trims and rejects empty/null', () => {
    expect(safeUrl('  https://x.com  ')).toBe('https://x.com');
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl('   ')).toBeNull();
  });
});
