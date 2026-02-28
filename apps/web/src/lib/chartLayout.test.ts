import { describe, expect, it } from 'vitest';
import {
  applyLogicalRangeSync,
  createChartRangeSyncState,
  normalizeChartLayoutMode,
  normalizeLogicalRange,
  shouldSkipSyncedRangeEvent,
} from './chartLayout';

describe('chart layout + sync helpers', () => {
  it('normalizes chart layout mode safely', () => {
    expect(normalizeChartLayoutMode('single')).toBe('single');
    expect(normalizeChartLayoutMode('split')).toBe('split');
    expect(normalizeChartLayoutMode('unknown')).toBe('single');
    expect(normalizeChartLayoutMode(undefined)).toBe('single');
  });

  it('normalizes logical ranges and orders from/to', () => {
    expect(normalizeLogicalRange({ from: 20, to: 10 })).toEqual({ from: 10, to: 20 });
    expect(normalizeLogicalRange({ from: 10, to: 20 })).toEqual({ from: 10, to: 20 });
    expect(normalizeLogicalRange({ from: Number.NaN, to: 20 })).toBeNull();
    expect(normalizeLogicalRange(null)).toBeNull();
  });

  it('applies sync only when target range differs', () => {
    const state = createChartRangeSyncState();
    let targetRange: { from: number; to: number } | null = { from: 1, to: 10 };

    const applied = applyLogicalRangeSync({
      state,
      source: 'primary',
      sourceRange: { from: 4, to: 14 },
      getTargetRange: () => targetRange,
      setTargetRange: (next) => {
        targetRange = next;
      },
    });

    expect(applied).toBe(true);
    expect(targetRange).toEqual({ from: 4, to: 14 });
    expect(state.suppressNextBySource.secondary).toEqual({ from: 4, to: 14 });

    const skippedMirrored = shouldSkipSyncedRangeEvent(state, 'secondary', { from: 4, to: 14 });
    expect(skippedMirrored).toBe(true);
    expect(state.suppressNextBySource.secondary).toBeNull();
  });

  it('ignores equivalent ranges and invalid source ranges', () => {
    const state = createChartRangeSyncState();
    const targetRange = { from: 100, to: 140 };

    expect(
      applyLogicalRangeSync({
        state,
        source: 'primary',
        sourceRange: { from: 100.004, to: 139.995 },
        getTargetRange: () => targetRange,
        setTargetRange: () => {
          throw new Error('should not set target');
        },
      }),
    ).toBe(false);

    expect(
      applyLogicalRangeSync({
        state,
        source: 'secondary',
        sourceRange: null,
        getTargetRange: () => targetRange,
        setTargetRange: () => {
          throw new Error('should not set target');
        },
      }),
    ).toBe(false);
  });

  it('does not suppress unrelated range events', () => {
    const state = createChartRangeSyncState();
    state.suppressNextBySource.secondary = { from: 10, to: 20 };

    expect(shouldSkipSyncedRangeEvent(state, 'secondary', { from: 12, to: 22 })).toBe(false);
    expect(state.suppressNextBySource.secondary).toEqual({ from: 10, to: 20 });
  });
});
