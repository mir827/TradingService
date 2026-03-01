import { describe, expect, it } from 'vitest';
import { snapToNearestCandleAnchor } from './drawingMagnet';

describe('snapToNearestCandleAnchor', () => {
  const candles = [
    { time: 100, open: 10, high: 13, low: 9, close: 12 },
    { time: 110, open: 14, high: 16, low: 13, close: 15 },
    { time: 120, open: 20, high: 22, low: 18, close: 19 },
  ];

  it('returns null for invalid inputs', () => {
    expect(snapToNearestCandleAnchor({ time: Number.NaN, price: 10 }, candles)).toBeNull();
    expect(snapToNearestCandleAnchor({ time: 110, price: Number.NaN }, candles)).toBeNull();
    expect(snapToNearestCandleAnchor({ time: 110, price: 10 }, [])).toBeNull();
  });

  it('snaps to nearest candle time and nearest OHLC anchor price', () => {
    const snapped = snapToNearestCandleAnchor({ time: 112.4, price: 15.4 }, candles);

    expect(snapped).toEqual({ time: 110, price: 15 });
  });

  it('uses the earlier candle when time distance is tied', () => {
    const snapped = snapToNearestCandleAnchor({ time: 105, price: 14.9 }, candles);

    expect(snapped).toEqual({ time: 100, price: 13 });
  });

  it('uses deterministic price-key order for tied OHLC distances', () => {
    const snapped = snapToNearestCandleAnchor(
      { time: 110, price: 15 },
      [{ time: 110, open: 14, high: 16, low: 16, close: 18 }],
    );

    expect(snapped).toEqual({ time: 110, price: 14 });
  });

  it('ignores candles with invalid OHLC anchors', () => {
    const snapped = snapToNearestCandleAnchor(
      { time: 101, price: 13.2 },
      [
        { time: 100, open: Number.NaN, high: Number.NaN, low: Number.NaN, close: Number.NaN },
        { time: 102, open: 13, high: 14, low: 12, close: 13.5 },
      ],
    );

    expect(snapped).toEqual({ time: 102, price: 13 });
  });
});
