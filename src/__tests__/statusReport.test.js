import { describe, it, expect, beforeEach } from 'vitest';
import { ragStatus, expectedPct, ragConfig } from '../render/statusReport.js';
import { state, resetState } from '../state.js';

const d = (s) => { const [y, m, day] = s.split('-').map(Number); return new Date(y, m - 1, day); };
const NOCONF = new Set();

beforeEach(() => {
  resetState();
  state.ganttWorkDays = [1, 2, 3, 4, 5]; // Mon–Fri
  state.ProjectData.info = {};
});

describe('ragConfig', () => {
  it('defaults to 10 / 50 / 15', () => {
    expect(ragConfig()).toEqual({ atRiskDays: 10, atRiskPct: 50, slipTol: 15 });
  });
  it('reads Project Info overrides', () => {
    state.ProjectData.info = { 'RAG At-Risk Days': '5', 'RAG At-Risk %': '40', 'RAG Slip Tolerance %': '20' };
    expect(ragConfig()).toEqual({ atRiskDays: 5, atRiskPct: 40, slipTol: 20 });
  });
});

describe('expectedPct', () => {
  it('is 0 before the task starts', () => {
    expect(expectedPct({ start: d('2025-02-03'), end: d('2025-02-28') }, d('2025-01-01'))).toBe(0);
  });
  it('is null without dates', () => {
    expect(expectedPct({ start: null, end: null }, d('2025-01-01'))).toBeNull();
  });
  it('is 100 at/after end', () => {
    expect(expectedPct({ start: d('2025-01-06'), end: d('2025-01-10') }, d('2025-01-20'))).toBe(100);
  });
  it('is ~55% halfway through a 20-work-day span', () => {
    // 2025-01-06..01-31 = 20 work-days; today 01-20 = 11 elapsed → 55%
    expect(expectedPct({ start: d('2025-01-06'), end: d('2025-01-31') }, d('2025-01-20'))).toBe(55);
  });
});

describe('ragStatus', () => {
  it('done at 100%', () => {
    expect(ragStatus({ pct: 100, start: d('2025-01-06'), end: d('2025-01-10') }, NOCONF, d('2025-01-20'))).toBe('done');
  });
  it('red when past end and incomplete', () => {
    expect(ragStatus({ pct: 50, start: d('2025-01-06'), end: d('2025-01-10') }, NOCONF, d('2025-01-20'))).toBe('red');
  });
  it('amber when behind expected progress (0% halfway through)', () => {
    expect(ragStatus({ pct: 0, start: d('2025-01-06'), end: d('2025-01-31') }, NOCONF, d('2025-01-20'))).toBe('amber');
  });
  it('green when on/ahead of expected progress', () => {
    expect(ragStatus({ pct: 90, start: d('2025-01-06'), end: d('2025-01-31') }, NOCONF, d('2025-01-20'))).toBe('green');
  });
  it('amber on a scheduling conflict even when progress looks fine', () => {
    expect(ragStatus({ id: 5, pct: 90, start: d('2025-01-06'), end: d('2025-01-31') }, new Set([5]), d('2025-01-20'))).toBe('amber');
  });
  it('honors a relaxed slip tolerance override (stays green)', () => {
    state.ProjectData.info = { 'RAG Slip Tolerance %': '100' };
    expect(ragStatus({ pct: 0, start: d('2025-01-06'), end: d('2025-06-30') }, NOCONF, d('2025-02-03'))).toBe('green');
  });
});
