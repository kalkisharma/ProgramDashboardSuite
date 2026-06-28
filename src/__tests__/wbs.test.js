import { describe, it, expect } from 'vitest';
import {
  recalcWBS, wouldCreateCycle, wouldCreateAncestorCycle,
  inferHierarchyFromWBS, sortTasksDFS, childrenOf, descendantsOf, ancestorsOf, isLeaf,
} from '../compute/wbs.js';

describe('recalcWBS (parentId-based, N-level)', () => {
  it('numbers phases, tasks, and subtasks from the tree', () => {
    const tasks = [
      { id: 1, parentId: null },  // phase A
      { id: 2, parentId: 1 },     // task A1
      { id: 3, parentId: 2 },     // subtask A1a
      { id: 4, parentId: 1 },     // task A2
      { id: 5, parentId: null },  // phase B
      { id: 6, parentId: 5 },     // task B1
    ];
    recalcWBS(tasks);
    expect(tasks.map(t => t.wbs)).toEqual(['1.0', '1.1', '1.1.1', '1.2', '2.0', '2.1']);
    expect(tasks.map(t => t.level)).toEqual([1, 2, 3, 2, 1, 1 + 1]);
  });

  it('renumbers after a sibling reorder (array order = sibling order)', () => {
    const tasks = [
      { id: 1, parentId: null },
      { id: 3, parentId: 1 },   // moved first
      { id: 2, parentId: 1 },
    ];
    recalcWBS(tasks);
    expect(tasks[1].wbs).toBe('1.1');
    expect(tasks[2].wbs).toBe('1.2');
  });

  it('handles empty array', () => {
    expect(() => recalcWBS([])).not.toThrow();
  });
});

describe('inferHierarchyFromWBS', () => {
  it('derives parentId + level from WBS strings', () => {
    const tasks = [
      { id: 1, wbs: '1.0' }, { id: 2, wbs: '1.1' }, { id: 3, wbs: '1.1.1' },
      { id: 4, wbs: '1.2' }, { id: 5, wbs: '2.0' }, { id: 6, wbs: '2.1' },
    ];
    inferHierarchyFromWBS(tasks);
    expect(tasks.map(t => t.parentId)).toEqual([null, 1, 2, 1, null, 5]);
    expect(tasks.map(t => t.level)).toEqual([1, 2, 3, 2, 1, 2]);
  });

  it('is forgiving of a missing intermediate (attaches to nearest existing ancestor)', () => {
    const tasks = [{ id: 1, wbs: '1.0' }, { id: 3, wbs: '1.1.1' }]; // no "1.1"
    inferHierarchyFromWBS(tasks);
    expect(tasks[1].parentId).toBe(1); // attached to the phase
  });

  it('is order-independent (maps by WBS first)', () => {
    const tasks = [{ id: 2, wbs: '1.1' }, { id: 1, wbs: '1.0' }];
    inferHierarchyFromWBS(tasks);
    expect(tasks[0].parentId).toBe(1);
    expect(tasks[1].parentId).toBe(null);
  });
});

describe('sortTasksDFS', () => {
  it('reorders a scrambled list into parent→subtree order', () => {
    const tasks = [
      { id: 5, parentId: null }, { id: 6, parentId: 5 },
      { id: 1, parentId: null }, { id: 3, parentId: 2 }, { id: 2, parentId: 1 },
    ];
    const out = sortTasksDFS(tasks).map(t => t.id);
    expect(out).toEqual([5, 6, 1, 2, 3]);
  });
});

describe('tree helpers', () => {
  const tasks = [
    { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 1 },
  ];
  it('childrenOf', () => { expect(childrenOf(tasks, 1).map(t => t.id)).toEqual([2, 4]); });
  it('descendantsOf', () => { expect(descendantsOf(tasks, 1).map(t => t.id).sort()).toEqual([2, 3, 4]); });
  it('ancestorsOf', () => { expect(ancestorsOf(tasks, 3).map(t => t.id)).toEqual([2, 1]); });
  it('isLeaf', () => { expect(isLeaf(tasks, 3)).toBe(true); expect(isLeaf(tasks, 1)).toBe(false); });
});

describe('wouldCreateAncestorCycle (reparent guard)', () => {
  const tasks = [
    { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 },
  ];
  it('blocks reparenting a task under itself', () => {
    expect(wouldCreateAncestorCycle(tasks, 1, 1)).toBe(true);
  });
  it('blocks reparenting a task under its own descendant', () => {
    expect(wouldCreateAncestorCycle(tasks, 1, 3)).toBe(true);
  });
  it('allows reparenting under an unrelated task', () => {
    const t = [{ id: 1, parentId: null }, { id: 2, parentId: null }, { id: 3, parentId: 1 }];
    expect(wouldCreateAncestorCycle(t, 3, 2)).toBe(false);
  });
  it('allows promote to top level (null parent)', () => {
    expect(wouldCreateAncestorCycle(tasks, 3, null)).toBe(false);
  });
});

describe('wouldCreateCycle (dependency graph — unchanged)', () => {
  const tasks = [{ id: 1, deps: [] }, { id: 2, deps: [1] }, { id: 3, deps: [2] }];
  it('detects a transitive cycle', () => { expect(wouldCreateCycle(tasks, 1, 3)).toBe(true); });
  it('allows a safe dependency', () => { expect(wouldCreateCycle(tasks, 3, 1)).toBe(false); });
  it('no cycle for unrelated tasks', () => {
    expect(wouldCreateCycle([{ id: 1, deps: [] }, { id: 2, deps: [] }], 1, 2)).toBe(false);
  });
});
