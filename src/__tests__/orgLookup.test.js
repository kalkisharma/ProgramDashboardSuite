import { describe, it, expect } from 'vitest';
import { buildOrgIndex, resolveNames } from '../compute/orgLookup.js';

const ORG = [
  { name: 'Alice Smith', team: 'Avionics' },
  { name: 'Bob Jones',   team: 'Structures' },
  { name: 'Carol Lee',   team: 'Avionics' },
  { name: 'Dave Null',   team: '' },          // person exists but has no team
];

describe('buildOrgIndex', () => {
  it('maps normalized names to teams', () => {
    const idx = buildOrgIndex(ORG);
    expect(idx.get('alice smith')).toBe('Avionics');
    expect(idx.get('bob jones')).toBe('Structures');
  });
  it('handles null/empty org', () => {
    expect(buildOrgIndex(null).size).toBe(0);
    expect(buildOrgIndex([]).size).toBe(0);
  });
  it('first wins on duplicate names', () => {
    const idx = buildOrgIndex([{ name: 'X', team: 'A' }, { name: 'x', team: 'B' }]);
    expect(idx.get('x')).toBe('A');
  });
});

describe('resolveNames', () => {
  const idx = buildOrgIndex(ORG);

  it('resolves a single known name to its team', () => {
    const r = resolveNames('Alice Smith', idx);
    expect(r.names).toEqual(['Alice Smith']);
    expect(r.teams).toEqual(['Avionics']);
    expect(r.unknown).toEqual([]);
    expect(r.hasUnknown).toBe(false);
  });

  it('is trim + case-insensitive', () => {
    const r = resolveNames('  alice smith ', idx);
    expect(r.teams).toEqual(['Avionics']);
    expect(r.hasUnknown).toBe(false);
  });

  it('aggregates unique teams in input order for multiple names', () => {
    const r = resolveNames('Bob Jones, Alice Smith', idx);
    expect(r.teams).toEqual(['Structures', 'Avionics']);
  });

  it('collapses duplicate teams', () => {
    const r = resolveNames('Alice Smith, Carol Lee', idx);
    expect(r.teams).toEqual(['Avionics']);
  });

  it('flags unknown names', () => {
    const r = resolveNames('Alice Smith, Eve Unknown', idx);
    expect(r.teams).toEqual(['Avionics']);
    expect(r.unknown).toEqual(['Eve Unknown']);
    expect(r.hasUnknown).toBe(true);
  });

  it('known person with empty team contributes no team and is not unknown', () => {
    const r = resolveNames('Dave Null', idx);
    expect(r.teams).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.hasUnknown).toBe(false);
  });

  it('skips validation entirely when org is empty', () => {
    const r = resolveNames('Alice Smith, Eve Unknown', buildOrgIndex([]));
    expect(r.names).toEqual(['Alice Smith', 'Eve Unknown']);
    expect(r.teams).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.hasUnknown).toBe(false);
  });

  it('handles empty / null input', () => {
    expect(resolveNames('', idx)).toEqual({ names: [], teams: [], unknown: [], hasUnknown: false });
    expect(resolveNames(null, idx)).toEqual({ names: [], teams: [], unknown: [], hasUnknown: false });
  });

  it('drops blank entries between commas', () => {
    const r = resolveNames('Alice Smith, , ,Bob Jones', idx);
    expect(r.names).toEqual(['Alice Smith', 'Bob Jones']);
    expect(r.teams).toEqual(['Avionics', 'Structures']);
  });
});
