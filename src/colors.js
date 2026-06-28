export const PHASE_COLORS = [
  '#7c3aed', // Phase 1 – purple
  '#06b6d4', // Phase 2 – cyan
  '#3b82f6', // Phase 3 – blue
  '#f59e0b', // Phase 4 – amber
  '#ec4899', // Phase 5 – pink
  '#ef4444', // Phase 6 – red
  '#84cc16', // Phase 7 – lime
  '#14b8a6', // Phase 8 – teal
  '#f97316', // Phase 9 – orange
  '#8b5cf6', // Phase 10 – violet
  '#10b981', // Phase 11 – green
  '#6366f1', // Phase 12 – indigo
];

export function phaseColor(wbs) {
  const phase = (parseInt(String(wbs).split('.')[0]) || 1) - 1;
  return PHASE_COLORS[phase % PHASE_COLORS.length];
}

export const SPEC_COLORS = {
  // Ground vehicle
  Powertrain:    { bg: 'rgba(239,68,68,.12)',   text: '#ef4444' },
  Chassis:       { bg: 'rgba(29,111,232,.12)',  text: '#60a5fa' },
  Electrical:    { bg: 'rgba(251,191,36,.12)',  text: '#fbbf24' },
  Body:          { bg: 'rgba(52,211,153,.12)',  text: '#34d399' },
  Safety:        { bg: 'rgba(248,113,113,.12)', text: '#f87171' },
  Software:      { bg: 'rgba(167,139,250,.12)', text: '#a78bfa' },
  // Tilt-wing / aerospace
  Aerodynamics:  { bg: 'rgba(6,182,212,.12)',   text: '#06b6d4' },
  Propulsion:    { bg: 'rgba(59,130,246,.12)',  text: '#3b82f6' },
  Structures:    { bg: 'rgba(245,158,11,.12)',  text: '#f59e0b' },
  Avionics:      { bg: 'rgba(132,204,22,.12)',  text: '#84cc16' },
  Systems:       { bg: 'rgba(20,184,166,.12)',  text: '#14b8a6' },
  Certification: { bg: 'rgba(239,68,68,.12)',   text: '#ef4444' },
};

export const TEAM_COLORS = {
  // Ground vehicle
  Powertrain:      '#ef4444',
  Chassis:         '#60a5fa',
  Electrical:      '#fbbf24',
  Software:        '#a78bfa',
  Safety:          '#f87171',
  Body:            '#34d399',
  Manufacturing:   '#d97706',
  // Aerospace / tilt-wing
  Systems:         '#14b8a6',
  Aerodynamics:    '#06b6d4',
  Propulsion:      '#3b82f6',
  Structures:      '#f59e0b',
  Avionics:        '#84cc16',
  'Flight Test':   '#ec4899',
  Certification:   '#ef4444',
  'All Teams':     '#58a6ff',
};

// Fallback palette for teams not in TEAM_COLORS — each new team name gets the next
// distinct color, cached so a given team keeps the same color for the whole session.
const _teamPool = [
  '#e879f9', '#22d3ee', '#fb7185', '#a3e635', '#f59e0b', '#818cf8',
  '#f472b6', '#2dd4bf', '#c084fc', '#fbbf24', '#4ade80', '#38bdf8',
  '#fca5a5', '#5eead4', '#fdba74', '#a5b4fc',
];
const _teamColorCache = {};
let _teamPoolIdx = 0;

export function clearTeamColorCache() { for (const k in _teamColorCache) delete _teamColorCache[k]; _teamPoolIdx = 0; }

export function teamColor(t) {
  if (!t) return '#58a6ff';
  if (TEAM_COLORS[t]) return TEAM_COLORS[t];
  if (!_teamColorCache[t]) { _teamColorCache[t] = _teamPool[_teamPoolIdx % _teamPool.length]; _teamPoolIdx++; }
  return _teamColorCache[t];
}
