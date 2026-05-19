export const GANTT_COLORS = {
  // Legacy ground-vehicle categories
  Concept:       '#7c3aed',
  Engineering:   '#1d6fe8',
  Prototype:     '#0891b2',
  Validation:    '#d97706',
  Launch:        '#dc2626',
  // Expanded aerospace / tilt-wing categories
  Aerodynamics:  '#06b6d4',
  Propulsion:    '#3b82f6',
  Structures:    '#f59e0b',
  Avionics:      '#84cc16',
  Systems:       '#14b8a6',
  'Ground Test': '#f97316',
  'Flight Test': '#ec4899',
  Certification: '#ef4444',
  Production:    '#8b5cf6',
  Integration:   '#a78bfa',
  Testing:       '#fb923c',
};

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

const _colorPool = ['#10b981','#6366f1','#f43f5e','#0ea5e9','#a855f7','#22d3ee','#fbbf24','#4ade80','#fb7185','#38bdf8'];
const _colorCache = {};

export function clearColorCache() { for (const k in _colorCache) delete _colorCache[k]; }

export function ganttColor(category) {
  if (GANTT_COLORS[category]) return GANTT_COLORS[category];
  if (!_colorCache[category]) {
    _colorCache[category] = _colorPool[Object.keys(_colorCache).length % _colorPool.length];
  }
  return _colorCache[category];
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

export function teamColor(t) { return TEAM_COLORS[t] || '#58a6ff'; }
