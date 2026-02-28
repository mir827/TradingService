import { describe, expect, it } from 'vitest';
import {
  calculateBollingerBands,
  computeCompareOverlay,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  normalizeCompareOverlay,
  toTimeValuePoints,
} from './chartMath';

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

  it('calculates RSI with expected warmup behavior', () => {
    expect(calculateRSI([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, null, 100, 100, 100]);
  });

  it('returns RSI midpoint for flat price movement', () => {
    expect(calculateRSI([5, 5, 5, 5], 2)).toEqual([null, null, 50, 50]);
  });

  it('returns zeroed MACD components for flat price movement', () => {
    const values = Array(40).fill(10);
    const result = calculateMACD(values, 12, 26, 9);
    expect(result.macdLine.filter((value): value is number => typeof value === 'number').every((value) => value === 0)).toBe(
      true,
    );
    expect(result.signalLine.filter((value): value is number => typeof value === 'number').every((value) => value === 0)).toBe(
      true,
    );
    expect(result.histogram.filter((value): value is number => typeof value === 'number').every((value) => value === 0)).toBe(
      true,
    );
  });

  it('calculates Bollinger Bands for flat values', () => {
    const values = Array(10).fill(7);
    const result = calculateBollingerBands(values, 5, 2);

    expect(result.basis.slice(0, 4)).toEqual([null, null, null, null]);
    expect(result.upper.slice(0, 4)).toEqual([null, null, null, null]);
    expect(result.lower.slice(0, 4)).toEqual([null, null, null, null]);
    expect(result.basis.slice(4)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(result.upper.slice(4)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(result.lower.slice(4)).toEqual([7, 7, 7, 7, 7, 7]);
  });

  it('returns null Bollinger values when std-dev multiplier is invalid', () => {
    const result = calculateBollingerBands([1, 2, 3, 4, 5], 3, 0);
    expect(result.basis).toEqual([null, null, null, null, null]);
    expect(result.upper).toEqual([null, null, null, null, null]);
    expect(result.lower).toEqual([null, null, null, null, null]);
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

  it('supports absolute compare scale mode without normalization', () => {
    const base = [
      { time: 1, close: 100 },
      { time: 2, close: 110 },
      { time: 3, close: 120 },
    ];
    const compare = [
      { time: 1, close: 50 },
      { time: 2, close: 56 },
      { time: 3, close: 63 },
    ];

    expect(computeCompareOverlay(base, compare, 'absolute')).toEqual({
      points: [
        { time: 1, value: 50 },
        { time: 2, value: 56 },
        { time: 3, value: 63 },
      ],
      anchor: null,
    });
  });

  it('uses earliest overlap candle as deterministic normalization anchor', () => {
    const base = [
      { time: 10, close: 100 },
      { time: 11, close: 120 },
      { time: 12, close: 150 },
    ];
    const compare = [
      { time: 12, close: 300 },
      { time: 10, close: 200 },
      { time: 11, close: 240 },
    ];

    expect(computeCompareOverlay(base, compare, 'normalized')).toEqual({
      points: [
        { time: 10, value: 100 },
        { time: 11, value: 120 },
        { time: 12, value: 150 },
      ],
      anchor: {
        time: 10,
        baseClose: 100,
        compareClose: 200,
        scale: 0.5,
      },
    });
  });

  it('returns empty normalized output when anchor compare close is zero', () => {
    const base = [
      { time: 1, close: 100 },
      { time: 2, close: 105 },
    ];
    const compare = [
      { time: 1, close: 0 },
      { time: 2, close: 10 },
    ];

    expect(computeCompareOverlay(base, compare, 'normalized')).toEqual({
      points: [],
      anchor: null,
    });
  });
});
