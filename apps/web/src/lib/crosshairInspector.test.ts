import { describe, expect, it } from 'vitest';
import {
  normalizeCrosshairInspectorSnapshot,
  toInspectorTimeValueMap,
} from './crosshairInspector';

describe('crosshair inspector helpers', () => {
  const candles = [
    { time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 1000 },
    { time: 101, open: 10.5, high: 12, low: 10, close: 11, volume: 1500 },
  ];
  const candlesByTime = new Map(candles.map((candle) => [candle.time, candle]));

  it('uses crosshair candle data when time is available', () => {
    const snapshot = normalizeCrosshairInspectorSnapshot({
      crosshairTime: 100,
      latestCandle: candles[1],
      candlesByTime,
      indicatorInputs: [
        {
          key: 'sma20',
          label: 'SMA 20',
          valuesByTime: new Map([[100, 10.25]]),
        },
      ],
      compareInputs: [
        {
          slotIndex: 0,
          symbol: 'ETHUSDT',
          visible: true,
          valuesByTime: new Map([[100, 2010]]),
        },
      ],
    });

    expect(snapshot.mode).toBe('crosshair');
    expect(snapshot.time).toBe(100);
    expect(snapshot.candle).toEqual(candles[0]);
    expect(snapshot.indicators).toEqual([{ key: 'sma20', label: 'SMA 20', value: 10.25 }]);
    expect(snapshot.compares).toEqual([{ slotIndex: 0, symbol: 'ETHUSDT', visible: true, value: 2010 }]);
    expect(snapshot.helperText).toBe('커서 위치 데이터');
  });

  it('falls back to latest candle when crosshair candle is unavailable', () => {
    const snapshot = normalizeCrosshairInspectorSnapshot({
      crosshairTime: 999,
      latestCandle: candles[1],
      candlesByTime,
      indicatorInputs: [
        {
          key: 'ema20',
          label: 'EMA 20',
          valuesByTime: new Map([[101, 10.75]]),
        },
      ],
      compareInputs: [
        {
          slotIndex: 1,
          symbol: 'SOLUSDT',
          visible: true,
          valuesByTime: new Map(),
        },
      ],
    });

    expect(snapshot.mode).toBe('latest');
    expect(snapshot.time).toBe(101);
    expect(snapshot.candle).toEqual(candles[1]);
    expect(snapshot.indicators[0]?.value).toBe(10.75);
    expect(snapshot.compares[0]?.value).toBeNull();
    expect(snapshot.helperText).toBe('커서 데이터 없음 · 최신 캔들 표시');
  });

  it('returns empty mode when no candle data exists', () => {
    const snapshot = normalizeCrosshairInspectorSnapshot({
      crosshairTime: null,
      latestCandle: null,
      candlesByTime: new Map(),
      indicatorInputs: [{ key: 'rsi', label: 'RSI 14', valuesByTime: new Map([[100, 50]]) }],
      compareInputs: [{ slotIndex: 0, symbol: 'ETHUSDT', visible: true, valuesByTime: new Map([[100, 2000]]) }],
    });

    expect(snapshot.mode).toBe('empty');
    expect(snapshot.time).toBeNull();
    expect(snapshot.candle).toBeNull();
    expect(snapshot.indicators[0]?.value).toBeNull();
    expect(snapshot.compares[0]?.value).toBeNull();
    expect(snapshot.helperText).toBe('표시할 캔들 데이터가 없습니다.');
  });

  it('filters invalid numeric values from time/value lookup creation', () => {
    const lookup = toInspectorTimeValueMap(
      [
        { time: 100 },
        { time: 101 },
        { time: 102 },
      ],
      [1, Number.NaN, Number.POSITIVE_INFINITY],
    );

    expect([...lookup.entries()]).toEqual([[100, 1]]);
  });
});
