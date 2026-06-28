import { describe, it, expect } from 'vitest';
import { computeConflicts } from '../compute/conflicts.js';

const d = (s) => { const [y,m,day] = s.split('-').map(Number); return new Date(y, m-1, day); };

describe('computeConflicts', () => {
  it('returns empty set when no tasks', () => {
    expect(computeConflicts([])).toEqual(new Set());
  });

  it('detects conflict when task starts before predecessor ends', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-20'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-10'), end: d('2024-01-25'), deps: [1], milestone: false },
    ];
    const conflicts = computeConflicts(tasks);
    expect(conflicts.has(2)).toBe(true);
    expect(conflicts.has(1)).toBe(false);
  });

  it('no conflict when task starts after predecessor ends', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-10'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-11'), end: d('2024-01-20'), deps: [1], milestone: false },
    ];
    expect(computeConflicts(tasks)).toEqual(new Set());
  });

  it('ignores milestones', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-20'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-10'), end: d('2024-01-10'), deps: [1], milestone: true },
    ];
    // Task 2 is a milestone — should not be flagged as conflicted
    expect(computeConflicts(tasks).has(2)).toBe(false);
  });

  it('ignores tasks with no start date', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-20'), deps: [], milestone: false },
      { id: 2, start: null, end: null, deps: [1], milestone: false },
    ];
    expect(computeConflicts(tasks).has(2)).toBe(false);
  });

  it('no conflict when task starts on same day predecessor ends', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-10'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-10'), end: d('2024-01-20'), deps: [1], milestone: false },
    ];
    expect(computeConflicts(tasks)).toEqual(new Set());
  });

  it('detects multiple conflicts independently', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-20'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-01'), end: d('2024-01-30'), deps: [], milestone: false },
      { id: 3, start: d('2024-01-10'), end: d('2024-01-25'), deps: [1], milestone: false },
      { id: 4, start: d('2024-01-10'), end: d('2024-01-28'), deps: [2], milestone: false },
    ];
    const conflicts = computeConflicts(tasks);
    expect(conflicts.has(3)).toBe(true);
    expect(conflicts.has(4)).toBe(true);
    expect(conflicts.has(1)).toBe(false);
    expect(conflicts.has(2)).toBe(false);
  });

  it('task with missing predecessor is not flagged', () => {
    const tasks = [
      { id: 2, start: d('2024-01-10'), end: d('2024-01-20'), deps: [99], milestone: false },
    ];
    expect(computeConflicts(tasks)).toEqual(new Set());
  });

  it('handles empty deps array on all tasks', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-10'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-05'), end: d('2024-01-15'), deps: [], milestone: false },
    ];
    expect(computeConflicts(tasks)).toEqual(new Set());
  });

  it('conflict in a three-task chain only flags the violating task', () => {
    const tasks = [
      { id: 1, start: d('2024-01-01'), end: d('2024-01-10'), deps: [], milestone: false },
      { id: 2, start: d('2024-01-11'), end: d('2024-01-20'), deps: [1], milestone: false },
      { id: 3, start: d('2024-01-15'), end: d('2024-01-25'), deps: [2], milestone: false },
    ];
    const conflicts = computeConflicts(tasks);
    expect(conflicts.has(3)).toBe(true);
    expect(conflicts.has(2)).toBe(false);
    expect(conflicts.has(1)).toBe(false);
  });

  it('returns a Set instance', () => {
    expect(computeConflicts([]) instanceof Set).toBe(true);
  });
});

describe('computeConflicts — hierarchy', () => {
  it('does not flag parent tasks (derived dates); flags leaf conflicts', () => {
    const tasks = [
      { id: 10, parentId: null, milestone: false, deps: [], start: d('2024-01-05'), end: d('2024-01-20') },
      { id: 1, parentId: 10, milestone: false, deps: [], start: d('2024-01-10'), end: d('2024-01-15') },
      { id: 2, parentId: 10, milestone: false, deps: [1], start: d('2024-01-12'), end: d('2024-01-20') },
    ];
    const c = computeConflicts(tasks);
    expect(c.has(10)).toBe(false);
    expect(c.has(2)).toBe(true); // starts 01-12 before pred 1 ends 01-15
  });
});
