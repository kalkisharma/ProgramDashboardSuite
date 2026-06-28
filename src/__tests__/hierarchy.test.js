import { describe, it, expect } from 'vitest';
import { recalcHierarchy, resolveInheritance, rollupParents } from '../compute/hierarchy.js';

const WDS = [1, 2, 3, 4, 5]; // Mon–Fri
const d = (s) => { const [y, m, day] = s.split('-').map(Number); return new Date(y, m - 1, day); };

describe('resolveInheritance', () => {
  it('inherits POC/Customer from the nearest ancestor when flagged', () => {
    const tasks = [
      { id: 1, parentId: null, poc: 'Alice', customer: 'Acme', pocInherited: false, customerInherited: false },
      { id: 2, parentId: 1, poc: '', customer: 'Bob', pocInherited: true, customerInherited: false },
      { id: 3, parentId: 2, poc: '', customer: '', pocInherited: true, customerInherited: true },
    ];
    resolveInheritance(tasks);
    expect(tasks[1].poc).toBe('Alice');       // inherited from phase
    expect(tasks[1].customer).toBe('Bob');    // explicit, untouched
    expect(tasks[2].poc).toBe('Alice');       // inherited through chain
    expect(tasks[2].customer).toBe('Bob');    // nearest ancestor with a customer
  });
});

describe('rollupParents', () => {
  it('rolls parent start/end/pct from children and clears milestone', () => {
    const tasks = [
      { id: 1, parentId: null, start: d('2024-06-01'), end: d('2024-06-02'), pct: 0, milestone: true },
      { id: 2, parentId: 1, start: d('2024-01-01'), end: d('2024-01-05'), pct: 0, milestone: false },   // 5 wd
      { id: 3, parentId: 1, start: d('2024-01-08'), end: d('2024-01-12'), pct: 100, milestone: false }, // 5 wd
    ];
    rollupParents(tasks, WDS);
    expect(tasks[0].start).toEqual(d('2024-01-01'));
    expect(tasks[0].end).toEqual(d('2024-01-12'));
    expect(tasks[0].pct).toBe(50);          // equal-duration weighted avg of 0 and 100
    expect(tasks[0].milestone).toBe(false); // a parent can't be a milestone
  });

  it('leaves leaf tasks untouched', () => {
    const tasks = [{ id: 1, parentId: null, start: d('2024-01-01'), end: d('2024-01-05'), pct: 42, milestone: true }];
    rollupParents(tasks, WDS);
    expect(tasks[0].pct).toBe(42);
    expect(tasks[0].milestone).toBe(true);
  });
});

describe('recalcHierarchy (chokepoint)', () => {
  it('orders DFS, regenerates WBS, resolves inheritance, rolls up parents', () => {
    const tasks = [
      { id: 2, parentId: 1, poc: '', customer: 'Bob', pocInherited: true, customerInherited: false,
        start: d('2024-01-01'), end: d('2024-01-05'), pct: 0, milestone: false },
      { id: 1, parentId: null, poc: 'Alice', customer: 'Acme', pocInherited: false, customerInherited: false,
        start: d('2024-06-01'), end: d('2024-06-02'), pct: 0, milestone: true },
      { id: 3, parentId: 1, poc: '', customer: '', pocInherited: true, customerInherited: true,
        start: d('2024-01-08'), end: d('2024-01-12'), pct: 100, milestone: false },
    ];
    recalcHierarchy(tasks, WDS);
    // DFS order: phase first
    expect(tasks.map(t => t.id)).toEqual([1, 2, 3]);
    expect(tasks.map(t => t.wbs)).toEqual(['1.0', '1.1', '1.2']);
    // inheritance
    expect(tasks[1].poc).toBe('Alice');
    expect(tasks[1].customer).toBe('Bob');
    expect(tasks[2].poc).toBe('Alice');
    expect(tasks[2].customer).toBe('Acme');
    // parent rollup + milestone cleared
    expect(tasks[0].start).toEqual(d('2024-01-01'));
    expect(tasks[0].end).toEqual(d('2024-01-12'));
    expect(tasks[0].pct).toBe(50);
    expect(tasks[0].milestone).toBe(false);
  });
});
