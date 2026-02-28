import { describe, expect, it } from 'vitest';
import { calculateBollingerBands, calculateMACD, calculateRSI } from './indicatorMath.js';

describe('api indicator math', () => {
  it('computes RSI values with warmup nulls', () => {
    expect(calculateRSI([10, 11, 12, 13, 14, 15], 3)).toEqual([null, null, null, 100, 100, 100]);
  });

  it('returns RSI midpoint for flat movement', () => {
    expect(calculateRSI([5, 5, 5, 5], 2)).toEqual([null, null, 50, 50]);
  });

  it('returns null RSI series when period is invalid', () => {
    expect(calculateRSI([1, 2, 3], 0)).toEqual([null, null, null]);
  });

  it('computes MACD and histogram for simple trend data', () => {
    const values = Array.from({ length: 50 }, (_, index) => index + 1);
    const result = calculateMACD(values, 12, 26, 9);
    const lastHistogram = result.histogram.at(-1);
    expect(typeof lastHistogram).toBe('number');
    expect(Number.isFinite(lastHistogram)).toBe(true);
  });

  it('returns null MACD values when fast period is not less than slow period', () => {
    const result = calculateMACD([1, 2, 3, 4, 5], 5, 5, 3);
    expect(result.macdLine).toEqual([null, null, null, null, null]);
    expect(result.signalLine).toEqual([null, null, null, null, null]);
    expect(result.histogram).toEqual([null, null, null, null, null]);
  });

  it('computes Bollinger bands for flat values', () => {
    const result = calculateBollingerBands(Array(8).fill(10), 4, 2);
    expect(result.basis.slice(0, 3)).toEqual([null, null, null]);
    expect(result.upper.slice(3)).toEqual([10, 10, 10, 10, 10]);
    expect(result.lower.slice(3)).toEqual([10, 10, 10, 10, 10]);
  });

  it('returns null Bollinger series when std-dev multiplier is invalid', () => {
    const result = calculateBollingerBands([1, 2, 3, 4], 2, 0);
    expect(result.basis).toEqual([null, null, null, null]);
    expect(result.upper).toEqual([null, null, null, null]);
    expect(result.lower).toEqual([null, null, null, null]);
  });
});
