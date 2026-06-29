import { countWorkDays } from '../utils.js';

// Critical path over LEAF tasks. Improvements over the old topological-only version:
//  - durations are in WORK-DAYS (not calendar days), matching the rest of the app
//  - early-start is ANCHORED to each task's actual scheduled start (in work-day offsets
//    from the earliest start), so float reflects real calendar position, not just topology
//  - dependencies that point at a PARENT/summary task resolve to all its leaf descendants
//    ("after Phase 2" = after every leaf of Phase 2)
//  - each dependency-connected COMPONENT is evaluated against its own end date, so two
//    independent chains are each critical within themselves
//  - COMPLETED tasks (100%) contribute 0 duration and are excluded → a *remaining* path
// `wds` is the work-day array (defaults to Mon–Fri so callers/tests can omit it).
export function computeCriticalPath(tasks, wds = [1, 2, 3, 4, 5]) {
  if (!tasks || tasks.length === 0) return new Set();
  const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
  const parentIds = new Set(tasks.map(t => t.parentId).filter(p => p != null));
  const isParent = id => parentIds.has(id);
  const nodes = tasks.filter(t => !isParent(t.id)); // leaves only (parents hold rolled-up dates)
  if (!nodes.length) return new Set();

  // Resolve a dependency id → leaf node ids (expand a parent dep to its leaf descendants).
  const childrenOf = id => tasks.filter(t => t.parentId === id);
  const leavesOf = id => {
    const out = [], stack = [...childrenOf(id)];
    while (stack.length) { const c = stack.pop(); if (isParent(c.id)) stack.push(...childrenOf(c.id)); else out.push(c.id); }
    return out;
  };
  const resolveDep = did => !(did in byId) ? [] : (isParent(did) ? leavesOf(did) : [did]);

  // Work-day offset of each task's actual start from the earliest start in the schedule.
  const starts = nodes.map(t => t.start).filter(Boolean);
  const epoch = starts.length ? new Date(Math.min(...starts)) : null;
  const startOff = {}, dur = {};
  nodes.forEach(t => {
    startOff[t.id] = (epoch && t.start) ? Math.max(0, countWorkDays(epoch, t.start, wds) - 1) : 0;
    const done = (t.pct || 0) >= 100;
    dur[t.id] = done ? 0 : (t.start && t.end ? Math.max(1, countWorkDays(t.start, t.end, wds)) : 1);
  });

  // Directed edges (pred → succ) + undirected components (union-find).
  const succ = {}, inDeg = {}, uf = {};
  nodes.forEach(t => { succ[t.id] = []; inDeg[t.id] = 0; uf[t.id] = t.id; });
  const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  nodes.forEach(t => (t.deps || []).forEach(did => resolveDep(did).forEach(pid => {
    if (succ[pid] !== undefined && pid !== t.id) { succ[pid].push(t.id); inDeg[t.id]++; uf[find(pid)] = find(t.id); }
  })));

  // Topological order (Kahn). A cycle anywhere → no meaningful CP.
  const tmp = { ...inDeg };
  const queue = nodes.filter(t => tmp[t.id] === 0).map(t => t.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    succ[id].forEach(s => { if (--tmp[s] === 0) queue.push(s); });
  }
  if (order.length < nodes.length) return new Set();

  // Forward pass — ES anchored to actual start, raised by predecessors.
  const es = {}, ef = {};
  order.forEach(id => { es[id] = startOff[id]; });
  order.forEach(id => {
    ef[id] = es[id] + dur[id];
    succ[id].forEach(s => { if (ef[id] > es[s]) es[s] = ef[id]; });
  });

  // Backward pass — each component bounded by its own latest finish.
  const compMax = {};
  order.forEach(id => { const r = find(id); compMax[r] = Math.max(compMax[r] ?? -Infinity, ef[id]); });
  const lf = {};
  order.forEach(id => { lf[id] = compMax[find(id)]; });
  [...order].reverse().forEach(id => {
    succ[id].forEach(s => { const ls = lf[s] - dur[s]; if (ls < lf[id]) lf[id] = ls; });
  });

  // Critical = zero slack, connected to the dependency network, and not already complete.
  const cp = new Set();
  order.forEach(id => {
    if ((byId[id].pct || 0) >= 100) return;
    const slack = (lf[id] - dur[id]) - es[id];
    if (Math.round(slack) <= 0 && (inDeg[id] > 0 || succ[id].length > 0)) cp.add(id);
  });
  return cp;
}
