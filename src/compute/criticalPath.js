import { daysBetween } from '../utils.js';

export function computeCriticalPath(tasks) {
  if (!tasks || tasks.length === 0) return new Set();
  const dur = {}, successors = {}, inDeg = {};
  tasks.forEach(t => {
    dur[t.id]        = t.start && t.end ? Math.max(1, daysBetween(t.start, t.end)) : 1;
    successors[t.id] = [];
    inDeg[t.id]      = 0;
  });
  tasks.forEach(t => {
    (t.deps || []).forEach(did => {
      if (successors[did] !== undefined) { successors[did].push(t.id); inDeg[t.id]++; }
    });
  });
  // Kahn's topological sort
  const tmpDeg = { ...inDeg };
  const queue  = tasks.filter(t => tmpDeg[t.id] === 0).map(t => t.id);
  const order  = [];
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    successors[id].forEach(sid => { if (--tmpDeg[sid] === 0) queue.push(sid); });
  }
  if (order.length < tasks.length) return new Set(); // cycle detected
  // Forward pass
  const es = {}, ef = {};
  tasks.forEach(t => { es[t.id] = 0; });
  order.forEach(id => {
    ef[id] = es[id] + dur[id];
    successors[id].forEach(sid => { if (ef[id] > (es[sid] || 0)) es[sid] = ef[id]; });
  });
  // Backward pass
  const maxEF = Math.max(...order.map(id => ef[id]));
  const lf = {};
  order.forEach(id => { lf[id] = maxEF; });
  [...order].reverse().forEach(id => {
    successors[id].forEach(sid => {
      const lsSid = lf[sid] - dur[sid];
      if (lsSid < lf[id]) lf[id] = lsSid;
    });
  });
  // Identify critical path: slack ≤ 0 and connected to dependency chain
  const cpSet = new Set();
  order.forEach(id => {
    const slack = (lf[id] - dur[id]) - es[id];
    if (Math.round(slack) <= 0 && (inDeg[id] > 0 || successors[id].length > 0)) cpSet.add(id);
  });
  return cpSet;
}
