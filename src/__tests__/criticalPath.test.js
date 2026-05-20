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
