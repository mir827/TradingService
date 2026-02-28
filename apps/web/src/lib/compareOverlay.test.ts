import { describe, expect, it } from 'vitest';
import {
  FETCH_COMPARE_ERROR,
  SAME_SYMBOL_COMPARE_ERROR,
  createInitialCompareOverlaySlots,
  finalizeCompareSlotFetch,
  normalizeCompareScaleMode,
  startCompareSlotFetch,
} from './compareOverlay';

type MockCandle = { time: number; close: number };

describe('compare overlay helpers', () => {
  it('creates three empty compare slots by default', () => {
    expect(createInitialCompareOverlaySlots<MockCandle>()).toEqual([
      { symbol: '', visible: true, candles: [], loading: false, error: null },
      { symbol: '', visible: true, candles: [], loading: false, error: null },
      { symbol: '', visible: true, candles: [], loading: false, error: null },
    ]);
  });

  it('marks loading slots and handles selected-symbol guard before fetch', () => {
    const slots = [
      { symbol: 'ETHUSDT', visible: true, candles: [], loading: false, error: null },
      { symbol: 'BTCUSDT', visible: true, candles: [{ time: 1, close: 10 }], loading: false, error: null },
      { symbol: '', visible: true, candles: [{ time: 2, close: 11 }], loading: false, error: null },
    ];

    expect(startCompareSlotFetch(slots, 'BTCUSDT')).toEqual([
      { symbol: 'ETHUSDT', visible: true, candles: [], loading: true, error: null },
      { symbol: 'BTCUSDT', visible: true, candles: [], loading: false, error: SAME_SYMBOL_COMPARE_ERROR },
      { symbol: '', visible: true, candles: [], loading: false, error: null },
    ]);
  });

  it('keeps successful symbols when one compare fetch fails', () => {
    const slots = [
      { symbol: 'ETHUSDT', visible: true, candles: [], loading: true, error: null },
      { symbol: 'SOLUSDT', visible: true, candles: [], loading: true, error: null },
      { symbol: '', visible: true, candles: [], loading: false, error: null },
    ];

    const resolved = finalizeCompareSlotFetch({
      slots,
      selectedSymbol: 'BTCUSDT',
      results: [
        {
          slotIndex: 0,
          symbol: 'ETHUSDT',
          candles: [
            { time: 1, close: 20 },
            { time: 2, close: 22 },
          ],
        },
        {
          slotIndex: 1,
          symbol: 'SOLUSDT',
          error: FETCH_COMPARE_ERROR,
        },
      ],
    });

    expect(resolved).toEqual([
      {
        symbol: 'ETHUSDT',
        visible: true,
        candles: [
          { time: 1, close: 20 },
          { time: 2, close: 22 },
        ],
        loading: false,
        error: null,
      },
      {
        symbol: 'SOLUSDT',
        visible: true,
        candles: [],
        loading: false,
        error: FETCH_COMPARE_ERROR,
      },
      { symbol: '', visible: true, candles: [], loading: false, error: null },
    ]);
  });

  it('normalizes compare scale mode safely', () => {
    expect(normalizeCompareScaleMode('normalized')).toBe('normalized');
    expect(normalizeCompareScaleMode('absolute')).toBe('absolute');
    expect(normalizeCompareScaleMode('unknown')).toBe('normalized');
    expect(normalizeCompareScaleMode(undefined)).toBe('normalized');
  });
});
