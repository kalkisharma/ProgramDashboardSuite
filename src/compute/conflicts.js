export function computeConflicts(tasks) {
  const byId = {};
  tasks.forEach(t => { byId[t.id] = t; });
  // Parents have derived (rolled-up) dates, so a "starts before predecessor ends" check on
  // them is meaningless — flag conflicts at the leaf level only. (Flat data: no parents.)
  const parentIds = new Set(tasks.map(t => t.parentId).filter(p => p != null));
  const set = new Set();
  tasks.forEach(t => {
    if (t.milestone || !t.start || parentIds.has(t.id)) return;
    t.deps.forEach(predId => {
      const pred = byId[predId];
      if (pred && pred.end && t.start < pred.end) set.add(t.id);
    });
  });
  return set;
}
