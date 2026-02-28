import { describe, expect, it } from 'vitest';
import { createUndoRedoHistory } from './history';

describe('undo/redo history utility', () => {
  it('enforces bounded depth when pushing transitions', () => {
    const history = createUndoRedoHistory<number>({ limit: 50 });

    for (let value = 1; value <= 55; value += 1) {
      history.push({ before: value - 1, after: value });
    }

    expect(history.getState()).toMatchObject({
      undoCount: 50,
      redoCount: 0,
      canUndo: true,
      canRedo: false,
    });

    const firstUndo = history.undo();
    expect(firstUndo).toEqual({ before: 54, after: 55 });

    let lastUndo = firstUndo;
    for (let index = 0; index < 49; index += 1) {
      lastUndo = history.undo();
    }

    expect(lastUndo).toEqual({ before: 5, after: 6 });
    expect(history.undo()).toBeNull();
  });

  it('invalidates redo stack after a new action is pushed', () => {
    const history = createUndoRedoHistory<string>();

    history.push({ before: 'a', after: 'b' });
    history.push({ before: 'b', after: 'c' });

    const undone = history.undo();
    expect(undone).toEqual({ before: 'b', after: 'c' });
    expect(history.getState().redoCount).toBe(1);

    history.push({ before: 'b', after: 'd' });

    expect(history.getState().redoCount).toBe(0);
    expect(history.redo()).toBeNull();
  });

  it('returns null for undo/redo on an empty stack', () => {
    const history = createUndoRedoHistory<{ value: number }>();

    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    expect(history.getState()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
      canUndo: false,
      canRedo: false,
    });
  });

  it('restores deterministic snapshots even when original references mutate', () => {
    type ChartState = {
      drawings: Array<{ id: string; price: number }>;
      indicators: { sma20: boolean };
      layout: 'single' | 'split';
    };

    const history = createUndoRedoHistory<ChartState>();
    const beforeState: ChartState = {
      drawings: [{ id: 'line-1', price: 100 }],
      indicators: { sma20: false },
      layout: 'single',
    };
    const afterState: ChartState = {
      drawings: [{ id: 'line-1', price: 125 }],
      indicators: { sma20: true },
      layout: 'split',
    };

    history.push({ before: beforeState, after: afterState });

    beforeState.drawings[0].price = 999;
    afterState.indicators.sma20 = false;

    const undoTransition = history.undo();
    expect(undoTransition?.before).toEqual({
      drawings: [{ id: 'line-1', price: 100 }],
      indicators: { sma20: false },
      layout: 'single',
    });

    if (undoTransition) {
      undoTransition.before.drawings[0].price = -1;
    }

    const redoTransition = history.redo();
    expect(redoTransition?.after).toEqual({
      drawings: [{ id: 'line-1', price: 125 }],
      indicators: { sma20: true },
      layout: 'split',
    });
  });
});
