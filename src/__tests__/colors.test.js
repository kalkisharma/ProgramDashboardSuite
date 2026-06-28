import { describe, it, expect, beforeEach } from 'vitest';
import { teamColor, clearTeamColorCache, TEAM_COLORS } from '../colors.js';

describe('teamColor', () => {
  beforeEach(() => clearTeamColorCache());

  it('returns the fixed color for a known team', () => {
    expect(teamColor('Avionics')).toBe(TEAM_COLORS.Avionics);
  });

  it('returns the default for an empty/falsy team', () => {
    expect(teamColor('')).toBe('#58a6ff');
    expect(teamColor(null)).toBe('#58a6ff');
  });

  it('assigns distinct colors to distinct unknown teams', () => {
    const a = teamColor('Avionics Software');
    const b = teamColor('Hydraulics');
    const c = teamColor('Ground Ops');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('returns the same color for the same unknown team (cached)', () => {
    const first = teamColor('Recovery');
    const second = teamColor('Recovery');
    expect(second).toBe(first);
  });

  it('does not hand an unknown team the bare default color', () => {
    expect(teamColor('Brand New Team')).not.toBe('#58a6ff');
  });

  it('clearTeamColorCache resets the assignment order', () => {
    const before = teamColor('Team X');
    clearTeamColorCache();
    // first assignment after reset should reuse the first pool color
    const afterFirst = teamColor('Different Team');
    expect(afterFirst).toBe(before);
  });

  it('includes the newly added named teams', () => {
    for (const t of ['Handling Qualities', 'Loads and Criteria', 'Rotors', 'Thermal', 'Innovations', 'Airframe', 'Design']) {
      expect(TEAM_COLORS[t]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('has no duplicate colors among named teams', () => {
    const vals = Object.values(TEAM_COLORS);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('fallback colors are all distinct and never collide with a named team color', () => {
    // 16 distinct unknown teams exhaust the whole fallback pool.
    const named = new Set(Object.values(TEAM_COLORS));
    const fallback = Array.from({ length: 16 }, (_, i) => teamColor('Unknown Team ' + i));
    expect(new Set(fallback).size).toBe(16);          // all distinct
    fallback.forEach(c => expect(named.has(c)).toBe(false)); // disjoint from named
  });
});
