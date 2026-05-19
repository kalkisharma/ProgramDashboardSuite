export function recalcWBS(tasks) {
  let currentPhase = 1;
  const phaseCounts = {};
  tasks.forEach(t => {
    const hasSubDot = t.wbs.includes('.') && !t.wbs.endsWith('.0');
    if (!hasSubDot) {
      currentPhase = parseInt(t.wbs) || currentPhase;
      t.wbs = currentPhase + '.0';
    } else {
      if (!phaseCounts[currentPhase]) phaseCounts[currentPhase] = 0;
      phaseCounts[currentPhase]++;
      t.wbs = currentPhase + '.' + phaseCounts[currentPhase];
    }
  });
}

export function wouldCreateCycle(tasks, taskId, candidateId) {
  const succs = {};
  tasks.forEach(t => { succs[t.id] = []; });
  tasks.forEach(t => { t.deps.forEach(d => { if (succs[d]) succs[d].push(t.id); }); });
  const visited = new Set([taskId]);
  const q = [...(succs[taskId] || [])];
  while (q.length) {
    const id = q.shift();
    if (id === candidateId) return true;
    if (!visited.has(id)) { visited.add(id); (succs[id] || []).forEach(s => q.push(s)); }
  }
  return false;
}
