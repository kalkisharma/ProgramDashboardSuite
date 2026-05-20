export function recalcWBS(tasks) {
  let currentPhase = 1;
  const phaseCounts = {};
  tasks.forEach(t => {
    // Phase headers: no dot, or ends with .0 (e.g. "2" or "2.0"). Sub-tasks have an inner dot (e.g. "2.3").
    const hasSubDot = t.wbs.includes('.') && !t.wbs.endsWith('.0');
    if (!hasSubDot) {
      currentPhase = parseInt(t.wbs) || currentPhase;
      t.wbs = currentPhase + '.0';
    } else {
      // Sub-task counter resets to 1 each time a new phase header is encountered above.
      if (!phaseCounts[currentPhase]) phaseCounts[currentPhase] = 0;
      phaseCounts[currentPhase]++;
      t.wbs = currentPhase + '.' + phaseCounts[currentPhase];
    }
  });
}

export function wouldCreateCycle(tasks, taskId, candidateId) {
  // Build a successor map (inverse of deps): succs[id] = list of tasks that directly depend on id.
  const succs = {};
  tasks.forEach(t => { succs[t.id] = []; });
  tasks.forEach(t => { t.deps.forEach(d => { if (succs[d]) succs[d].push(t.id); }); });
  // BFS forward from taskId through its successors. If we reach candidateId,
  // making candidateId a predecessor of taskId would close a cycle.
  const visited = new Set([taskId]);
  const q = [...(succs[taskId] || [])];
  while (q.length) {
    const id = q.shift();
    if (id === candidateId) return true;
    if (!visited.has(id)) { visited.add(id); (succs[id] || []).forEach(s => q.push(s)); }
  }
  return false;
}
