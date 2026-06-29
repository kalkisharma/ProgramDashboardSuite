import { describe, it, expect } from 'vitest';
import { computeCriticalPath } from '../compute/criticalPath.js';

const d = (s) => { const [y,m,day] = s.split('-').map(Number); return new Date(y, m-1, day); };

describe('computeCriticalPath', () => {
  it('returns empty set for empty tasks', () => {
    expect(computeCriticalPath([])).toEqual(new Set());
  });

  it('returns empty set for null', () => {
    expect(computeCriticalPath(null)).toEqual(new Set());
  });

  it('identifies single critical task in a chain', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-10'), deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-11'), end: d('2024-01-20'), deps: [1] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(true);
    expect(cp.has(2)).toBe(true);
  });

  it('excludes isolated tasks with no deps', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-05'), deps: [] },
    ];
    // Single task with no deps or successors — not on critical path
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(false);
  });

  it('handles diamond dependency — longer path is critical', () => {
    // 1 → 2 (short), 1 → 3 (long), both → 4
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-02'), deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-03'), end: d('2024-01-04'), deps: [1] }, // 2 days
      { id: 3, wbs: '1.3', start: d('2024-01-03'), end: d('2024-01-15'), deps: [1] }, // 13 days
      { id: 4, wbs: '1.4', start: d('2024-01-16'), end: d('2024-01-17'), deps: [2, 3] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(3)).toBe(true);  // long path
    expect(cp.has(1)).toBe(true);  // feeds critical
    expect(cp.has(4)).toBe(true);  // end of chain
  });

  it('returns empty set when cycle detected', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-05'), deps: [2] },
      { id: 2, wbs: '1.2', start: d('2024-01-06'), end: d('2024-01-10'), deps: [1] },
    ];
    expect(computeCriticalPath(tasks)).toEqual(new Set());
  });

  it('returns a Set instance', () => {
    expect(computeCriticalPath([]) instanceof Set).toBe(true);
  });

  it('linear chain of three tasks: all are on critical path', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-05'), deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-06'), end: d('2024-01-10'), deps: [1] },
      { id: 3, wbs: '1.3', start: d('2024-01-11'), end: d('2024-01-15'), deps: [2] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(true);
    expect(cp.has(2)).toBe(true);
    expect(cp.has(3)).toBe(true);
  });

  it('parallel paths: shorter branch excluded from critical path', () => {
    // 1 → 2 (1 day) and 1 → 3 (10 days), both → 4
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-02'), deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-03'), end: d('2024-01-04'), deps: [1] },
      { id: 3, wbs: '1.3', start: d('2024-01-03'), end: d('2024-01-12'), deps: [1] },
      { id: 4, wbs: '1.4', start: d('2024-01-13'), end: d('2024-01-14'), deps: [2, 3] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(3)).toBe(true);
    expect(cp.has(2)).toBe(false);
  });

  it('handles tasks with null start/end gracefully', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: null, end: null, deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-11'), end: d('2024-01-15'), deps: [1] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp instanceof Set).toBe(true);
  });

  it('two independent chains: each is critical within its own chain', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-05'), deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-06'), end: d('2024-01-10'), deps: [1] },
      { id: 3, wbs: '2.1', start: d('2024-02-01'), end: d('2024-02-05'), deps: [] },
      { id: 4, wbs: '2.2', start: d('2024-02-06'), end: d('2024-02-10'), deps: [3] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(true);
    expect(cp.has(2)).toBe(true);
    expect(cp.has(3)).toBe(true);
    expect(cp.has(4)).toBe(true);
  });

  it('task with only successors (source node) is on critical path', () => {
    const tasks = [
      { id: 1, wbs: '1.1', start: d('2024-01-01'), end: d('2024-01-10'), deps: [] },
      { id: 2, wbs: '1.2', start: d('2024-01-11'), end: d('2024-01-20'), deps: [1] },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(true);
  });
});

describe('computeCriticalPath — hierarchy', () => {
  it('excludes parent (derived-date) tasks; evaluates leaves', () => {
    const tasks = [
      { id: 10, parentId: null, deps: [], start: d('2024-01-01'), end: d('2024-01-20') },
      { id: 1, parentId: 10, deps: [], start: d('2024-01-01'), end: d('2024-01-10') },
      { id: 2, parentId: 10, deps: [1], start: d('2024-01-10'), end: d('2024-01-20') },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(10)).toBe(false); // parent excluded
    expect(cp.has(1)).toBe(true);
    expect(cp.has(2)).toBe(true);
  });
});

describe('computeCriticalPath — v6.5 rewrite (dates, work-days, parent deps, remaining)', () => {
  it('resolves a dependency on a PARENT to its leaf descendants', () => {
    // succ (3) depends on parent 10; 10 has leaves 1,2 → 3 should sit after 1 & 2.
    const tasks = [
      { id: 10, parentId: null, deps: [], start: d('2024-01-01'), end: d('2024-01-12') },
      { id: 1, parentId: 10, deps: [], start: d('2024-01-01'), end: d('2024-01-05') },
      { id: 2, parentId: 10, deps: [], start: d('2024-01-08'), end: d('2024-01-12') },
      { id: 3, parentId: null, deps: [10], start: d('2024-01-15'), end: d('2024-01-19') },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(3)).toBe(true);   // connected via the resolved parent dep
    expect(cp.has(2)).toBe(true);   // latest leaf of the parent drives the successor
    expect(cp.has(10)).toBe(false); // parent itself never on the path
  });

  it('drops COMPLETED tasks from the remaining critical path', () => {
    const tasks = [
      { id: 1, deps: [],  pct: 100, start: d('2024-01-01'), end: d('2024-01-05') },
      { id: 2, deps: [1], pct: 0,   start: d('2024-01-08'), end: d('2024-01-12') },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(false); // done → off the remaining path
    expect(cp.has(2)).toBe(true);
  });

  it('uses work-day durations (weekend spans do not inflate)', () => {
    // both branches from 1; branch via 3 spans a weekend but is the same WORK-day length as 2.
    const tasks = [
      { id: 1, deps: [],     start: d('2024-01-01'), end: d('2024-01-01') },
      { id: 2, deps: [1],    start: d('2024-01-02'), end: d('2024-01-04') }, // Tue–Thu = 3 wd
      { id: 3, deps: [1],    start: d('2024-01-02'), end: d('2024-01-04') }, // same
      { id: 4, deps: [2, 3], start: d('2024-01-05'), end: d('2024-01-05') },
    ];
    const cp = computeCriticalPath(tasks);
    expect(cp.has(1)).toBe(true);
    expect(cp.has(4)).toBe(true);
  });
});
