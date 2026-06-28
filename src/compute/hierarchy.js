// Hierarchy resolution chokepoint. recalcHierarchy() is the single function called after
// parse and after every structural/date mutation: it normalizes order + WBS, resolves
// POC/Customer inheritance, and rolls parent dates/% up from children. Pure (no state
// import) — work-days are passed in.
import { sortTasksDFS, recalcWBS } from './wbs.js';
import { countWorkDays } from '../utils.js';

// Top-down: fill inherited POC/Customer from the nearest ancestor that has a value.
// Relies on DFS order (ancestors processed first, so their values are already resolved).
export function resolveInheritance(tasks) {
  const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
  const nearest = (t, field) => {
    let cur = t.parentId != null ? byId[t.parentId] : null;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); if (cur[field]) return cur[field]; cur = cur.parentId != null ? byId[cur.parentId] : null; }
    return '';
  };
  tasks.forEach(t => {
    if (t.pocInherited)      t.poc      = nearest(t, 'poc');
    if (t.customerInherited) t.customer = nearest(t, 'customer');
  });
}

// Bottom-up: a parent's start/end/pct are derived from its children (D2/item 2).
// pct is duration-weighted (work days). A parent can't be a milestone (D9).
export function rollupParents(tasks, wds) {
  const childrenMap = new Map();
  tasks.forEach(t => {
    if (t.parentId == null) return;
    if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
    childrenMap.get(t.parentId).push(t);
  });
  // DFS pre-order reversed = children before parents → correct bottom-up rollup.
  [...tasks].reverse().forEach(t => {
    const kids = childrenMap.get(t.id);
    if (!kids || !kids.length) return; // leaf — keep authored values
    const starts = kids.map(k => k.start).filter(Boolean).map(d => +d);
    const ends   = kids.map(k => k.end).filter(Boolean).map(d => +d);
    if (starts.length) t.start = new Date(Math.min(...starts));
    if (ends.length)   t.end   = new Date(Math.max(...ends));
    let wSum = 0, pSum = 0;
    kids.forEach(k => {
      const w = Math.max(1, (k.start && k.end) ? countWorkDays(k.start, k.end, wds) : 1);
      wSum += w; pSum += (k.pct || 0) * w;
    });
    t.pct = wSum ? Math.round(pSum / wSum) : 0;
    t.milestone = false; // a task with children is a container, not a point
  });
}

// The single chokepoint. Mutates `tasks` in place: reorder to DFS, regenerate WBS + level,
// resolve inheritance (top-down), roll up parents (bottom-up).
export function recalcHierarchy(tasks, wds) {
  const ordered = sortTasksDFS(tasks);
  tasks.splice(0, tasks.length, ...ordered);
  recalcWBS(tasks);
  resolveInheritance(tasks);
  rollupParents(tasks, wds);
}
