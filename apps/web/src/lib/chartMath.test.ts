import { describe, expect, it } from 'vitest';
import { calculateEMA, calculateSMA, normalizeCompareOverlay, toTimeValuePoints } from './chartMath';

describe('chart math helpers', () => {
  it('calculates SMA values with null warmup slots', () => {
    expect(calculateSMA([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('returns all null when SMA period is invalid', () => {
    expect(calculateSMA([1, 2, 3], 0)).toEqual([null, null, null]);
  });

  it('calculates EMA values using SMA seed', () => {
    expect(calculateEMA([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('returns all null when EMA period exceeds value length', () => {
    expect(calculateEMA([1, 2], 5)).toEqual([null, null]);
  });

  it('maps indicator values to time/value points', () => {
    const candles = [
      { time: 1, close: 10 },
      { time: 2, close: 11 },
      { time: 3, close: 12 },
    ];

    expect(toTimeValuePoints(candles, [null, 10.5, 11.5])).toEqual([
      { time: 2, value: 10.5 },
      { time: 3, value: 11.5 },
    ]);
  });

  it('normalizes compare candles against base candles on overlap', () => {
    const base = [
      { time: 1, close: 100 },
      { time: 2, close: 110 },
      { time: 3, close: 120 },
    ];
    const compare = [
      { time: 1, close: 50 },
      { time: 2, close: 55 },
      { time: 3, close: 60 },
    ];

    expect(normalizeCompareOverlay(base, compare)).toEqual([
      { time: 1, value: 100 },
      { time: 2, value: 110 },
      { time: 3, value: 120 },
    ]);
  });

  it('returns empty when compare candles do not overlap base candles', () => {
    const base = [
      { time: 10, close: 100 },
      { time: 11, close: 110 },
    ];
    const compare = [
      { time: 1, close: 50 },
      { time: 2, close: 55 },
    ];

    expect(normalizeCompareOverlay(base, compare)).toEqual([]);
  });
});
