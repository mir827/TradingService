import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDICATOR_SETTINGS,
  normalizeBollingerSettings,
  normalizeIndicatorSettings,
  normalizeMacdSettings,
  normalizeRsiSettings,
} from './indicatorSettings';

describe('indicator settings normalization', () => {
  it('returns defaults when input is missing', () => {
    expect(normalizeIndicatorSettings(undefined)).toEqual(DEFAULT_INDICATOR_SETTINGS);
  });

  it('clamps and rounds RSI period', () => {
    expect(normalizeRsiSettings({ period: 1 })).toEqual({ period: 2 });
    expect(normalizeRsiSettings({ period: 14.6 })).toEqual({ period: 15 });
    expect(normalizeRsiSettings({ period: 999 })).toEqual({ period: 200 });
  });

  it('clamps MACD params and enforces fast < slow', () => {
    expect(normalizeMacdSettings({ fast: 50, slow: 30, signal: 1 })).toEqual({
      fast: 50,
      slow: 51,
      signal: 2,
    });

    expect(normalizeMacdSettings({ fast: 500, slow: 600, signal: 999 })).toEqual({
      fast: 200,
      slow: 300,
      signal: 200,
    });
  });

  it('clamps Bollinger params and keeps std-dev at one decimal', () => {
    expect(normalizeBollingerSettings({ period: 1, stdDev: 0.123 })).toEqual({ period: 2, stdDev: 0.5 });
    expect(normalizeBollingerSettings({ period: 20.2, stdDev: 2.26 })).toEqual({ period: 20, stdDev: 2.3 });
    expect(normalizeBollingerSettings({ period: 999, stdDev: 9 })).toEqual({ period: 200, stdDev: 4 });
  });

  it('normalizes partial mixed settings input', () => {
    expect(
      normalizeIndicatorSettings({
        rsi: { period: 10 },
        macd: { fast: 25 },
        bollinger: { stdDev: 1.8 },
      }),
    ).toEqual({
      rsi: { period: 10 },
      macd: { fast: 25, slow: 26, signal: 9 },
      bollinger: { period: 20, stdDev: 1.8 },
    });
  });
});
