import { describe, it, expect } from 'vitest';
import { recalcWBS, wouldCreateCycle } from '../compute/wbs.js';

describe('recalcWBS', () => {
  it('numbers sub-tasks sequentially within a phase', () => {
    const tasks = [
      { id: 1, wbs: '1.0' },
      { id: 2, wbs: '1.1' },
      { id: 3, wbs: '1.2' },
    ];
    recalcWBS(tasks);
    expect(tasks[0].wbs).toBe('1.0');
    expect(tasks[1].wbs).toBe('1.1');
    expect(tasks[2].wbs).toBe('1.2');
  });

  it('resets sub-task counter across phases', () => {
    const tasks = [
      { id: 1, wbs: '1.0' },
      { id: 2, wbs: '1.1' },
      { id: 3, wbs: '2.0' },
      { id: 4, wbs: '2.1' },
    ];
    recalcWBS(tasks);
    expect(tasks[0].wbs).toBe('1.0');
    expect(tasks[1].wbs).toBe('1.1');
    expect(tasks[2].wbs).toBe('2.0');
    expect(tasks[3].wbs).toBe('2.1');
  });

  it('renumbers after a reorder', () => {
    const tasks = [
      { id: 1, wbs: '1.0' },
      { id: 3, wbs: '1.3' }, // was third, now second
      { id: 2, wbs: '1.2' },
    ];
    recalcWBS(tasks);
    expect(tasks[1].wbs).toBe('1.1');
    expect(tasks[2].wbs).toBe('1.2');
  });
});

describe('wouldCreateCycle', () => {
  const tasks = [
    { id: 1, deps: [] },
    { id: 2, deps: [1] },
    { id: 3, deps: [2] },
  ];

  it('detects direct cycle', () => {
    expect(wouldCreateCycle(tasks, 3, 1)).toBe(false); // adding 3→1 dep (1 is pred, not successor)
    // wouldCreateCycle(tasks, taskId, candidateId) = would adding candidateId as dep of taskId create cycle
    // candidateId is the proposed predecessor; cycle = if taskId is reachable from candidateId
    // Actually re-reading the logic: it checks if candidateId can be reached FROM taskId via successors
    // If so, adding candidateId as a dep of taskId would create a cycle
    // tasks: 1→2→3 (1 is pred of 2 is pred of 3)
    // wouldCreateCycle(tasks, 1, 3) = would adding 3 as pred of 1 create cycle?
    //   succs: 1→[2], 2→[3], 3→[]
    //   From taskId=1, successors include 2, then 3. candidateId=3 → found → true
    expect(wouldCreateCycle(tasks, 1, 3)).toBe(true);
  });

  it('allows safe dependency', () => {
    // Adding 1 as pred of 3 — 3 has no successors, so no path from 3 back to 1
    expect(wouldCreateCycle(tasks, 3, 1)).toBe(false);
  });

  it('no cycle for unrelated tasks', () => {
    const t = [
      { id: 1, deps: [] },
      { id: 2, deps: [] },
    ];
    expect(wouldCreateCycle(t, 1, 2)).toBe(false);
  });
});
