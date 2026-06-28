// N-level WBS hierarchy. After parse, `parentId` (+ array order for siblings) is the source
// of truth; WBS strings are regenerated from the tree by recalcWBS. Numbering convention:
// level-1 phases are "p.0"; a child's WBS = parent-WBS-without-trailing-".0" + "." + index
// (so phase 1.0 → task 1.1 → subtask 1.1.1).

// ── Tree helpers (operate on parentId) ───────────────────────────────────────
export function childrenOf(tasks, id) { return tasks.filter(t => t.parentId === id); }
export function isLeaf(tasks, id)     { return !tasks.some(t => t.parentId === id); }

export function descendantsOf(tasks, id) {
  const out = [];
  const stack = [...childrenOf(tasks, id)];
  while (stack.length) { const t = stack.shift(); out.push(t); childrenOf(tasks, t.id).forEach(c => stack.push(c)); }
  return out;
}

export function ancestorsOf(tasks, id) {
  const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
  const out = []; const seen = new Set();
  let cur = byId[id];
  while (cur && cur.parentId != null && byId[cur.parentId] && !seen.has(cur.parentId)) {
    seen.add(cur.parentId); cur = byId[cur.parentId]; out.push(cur);
  }
  return out;
}

// ── Parse-time: infer parentId from WBS strings (forgiving of gaps/order) ─────
// Sets t.parentId and t.level. A missing intermediate WBS falls back to the nearest
// existing ancestor prefix (so "1.1.1" with no "1.1" attaches to phase "1.0").
export function inferHierarchyFromWBS(tasks) {
  const byWbs = {}; tasks.forEach(t => { byWbs[String(t.wbs)] = t; });
  tasks.forEach(t => {
    const segs = String(t.wbs).split('.');
    const isPhase = segs.length === 1 || (segs.length === 2 && segs[1] === '0');
    if (isPhase) { t.parentId = null; return; }
    let parent = null;
    for (let n = segs.length - 1; n >= 1 && !parent; n--) {
      const cand = n === 1 ? `${segs[0]}.0` : segs.slice(0, n).join('.');
      const c = byWbs[cand];
      if (c && c !== t) parent = c;
    }
    t.parentId = parent ? parent.id : null;
  });
  // Derive level from the parent chain (robust to ordering).
  const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
  tasks.forEach(t => {
    let lvl = 1, cur = t, seen = new Set();
    while (cur.parentId != null && byId[cur.parentId] && !seen.has(cur.id)) { seen.add(cur.id); lvl++; cur = byId[cur.parentId]; }
    t.level = lvl;
  });
}

// ── Reorder a flat task list into DFS pre-order (parent immediately followed by its
// subtree), preserving current sibling order. Orphans (parentId → missing) go last. ──
export function sortTasksDFS(tasks) {
  const kids = new Map();
  tasks.forEach(t => {
    const k = t.parentId == null ? '__root__' : t.parentId;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(t);
  });
  const out = [];
  const walk = key => (kids.get(key) || []).forEach(t => { out.push(t); walk(t.id); });
  walk('__root__');
  if (out.length !== tasks.length) {
    const seen = new Set(out);
    tasks.forEach(t => { if (!seen.has(t)) out.push(t); });
  }
  return out;
}

// ── Regenerate WBS strings + level from parentId + array order. Assumes DFS order
// (a parent precedes its children), which recalcHierarchy guarantees via sortTasksDFS. ──
export function recalcWBS(tasks) {
  const count = {};      // parent key → running sibling count
  const wbsById = {};
  const levelById = {};
  tasks.forEach(t => {
    const key = t.parentId == null ? '__root__' : t.parentId;
    count[key] = (count[key] || 0) + 1;
    const idx = count[key];
    if (t.parentId == null) {
      t.wbs = idx + '.0';
      t.level = 1;
    } else {
      const pWbs = wbsById[t.parentId] || (idx + '.0');
      const prefix = pWbs.endsWith('.0') ? pWbs.slice(0, -2) : pWbs;
      t.wbs = prefix + '.' + idx;
      t.level = (levelById[t.parentId] || 1) + 1;
    }
    wbsById[t.id] = t.wbs;
    levelById[t.id] = t.level;
  });
}

// ── Dependency cycle check (flat id graph) — unchanged from v5; works across any
// tasks regardless of hierarchy level. ──
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

// ── Reparent guard: would making `newParentId` the parent of `taskId` create a cycle
// in the *hierarchy* tree (i.e. is newParentId the task itself or one of its descendants)? ──
export function wouldCreateAncestorCycle(tasks, taskId, newParentId) {
  if (newParentId == null) return false;
  if (newParentId === taskId) return true;
  return descendantsOf(tasks, taskId).some(d => d.id === newParentId);
}
