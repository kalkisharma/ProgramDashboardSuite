import { describe, it, expect, beforeEach } from 'vitest';
import { state, resetState } from '../state.js';
import { ZOOM_STEPS } from '../constants.js';

describe('resetState', () => {
  beforeEach(() => {
    // Dirty the state before each test
    state.ProjectData.tasks.push({ id: 99 });
    state.undoStack.push({ label: 'test', snapshot: {} });
    state.isDirty = true;
    state.ganttWorkDays = [1, 2, 3];
    state.zoomIdx = 7;
    state.collapsedPhases.add(2);
    state.conflictSet.add(99);
    state.ganttPhaseFilter = '3';
    state.ganttTeamFilter = 'Engineering';
    state.spCurrentType = 'task';
    state.spCurrentId = 5;
  });

  it('resets ProjectData to empty collections', () => {
    resetState();
    expect(state.ProjectData.tasks).toEqual([]);
    expect(state.ProjectData.specs).toEqual([]);
    expect(state.ProjectData.org).toEqual([]);
    expect(state.ProjectData.weights).toEqual([]);
    expect(state.ProjectData.info).toEqual({});
  });

  it('resets undoStack and redoStack', () => {
    resetState();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
  });

  it('resets isDirty to false', () => {
    resetState();
    expect(state.isDirty).toBe(false);
  });

  it('resets ganttWorkDays to Mon-Fri', () => {
    resetState();
    expect(state.ganttWorkDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('resets zoomIdx to 3', () => {
    resetState();
    expect(state.zoomIdx).toBe(3);
    expect(state.ganttZoom).toBe(ZOOM_STEPS[3]);
  });

  it('resets collapsedPhases to empty Set', () => {
    resetState();
    expect(state.collapsedPhases instanceof Set).toBe(true);
    expect(state.collapsedPhases.size).toBe(0);
  });

  it('resets conflictSet to empty Set', () => {
    resetState();
    expect(state.conflictSet instanceof Set).toBe(true);
    expect(state.conflictSet.size).toBe(0);
  });

  it('resets ganttPhaseFilter and ganttTeamFilter to "all"', () => {
    resetState();
    expect(state.ganttPhaseFilter).toBe('all');
    expect(state.ganttTeamFilter).toBe('all');
  });

  it('resets spCurrentType and spCurrentId to null', () => {
    resetState();
    expect(state.spCurrentType).toBeNull();
    expect(state.spCurrentId).toBeNull();
  });

  it('resets all handlers to null', () => {
    state.handlers.openTaskPanel = () => {};
    resetState();
    expect(state.handlers.openTaskPanel).toBeNull();
    expect(state.handlers.openSpecPanel).toBeNull();
    expect(state.handlers.openOrgPanel).toBeNull();
    expect(state.handlers.openWeightPanel).toBeNull();
    expect(state.handlers.toggleHelp).toBeNull();
    expect(state.handlers.applyUndo).toBeNull();
  });

  it('resets depArrowEls to empty array', () => {
    state.depArrowEls.push({ el: {}, predId: 1, succId: 2 });
    resetState();
    expect(state.depArrowEls).toEqual([]);
  });

  it('resets ganttMinDateRef and ganttTodayX to null', () => {
    state.ganttMinDateRef = new Date();
    state.ganttTodayX = 300;
    resetState();
    expect(state.ganttMinDateRef).toBeNull();
    expect(state.ganttTodayX).toBeNull();
  });
});

describe('state singleton', () => {
  it('is the same object on repeated imports', async () => {
    const { state: state2 } = await import('../state.js');
    expect(state2).toBe(state);
  });

  it('mutations on state are visible across imports', async () => {
    resetState();
    state.isDirty = true;
    const { state: state2 } = await import('../state.js');
    expect(state2.isDirty).toBe(true);
    resetState();
  });
});
