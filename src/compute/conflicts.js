export function computeConflicts(tasks) {
  const byId = {};
  tasks.forEach(t => { byId[t.id] = t; });
  const set = new Set();
  tasks.forEach(t => {
    if (t.milestone || !t.start) return;
    t.deps.forEach(predId => {
      const pred = byId[predId];
      if (pred && pred.end && t.start < pred.end) set.add(t.id);
    });
  });
  return set;
}
