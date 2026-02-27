import { describe, expect, it } from 'vitest';
import {
  normalizeDrawingItems,
  normalizeDrawingLines,
  toLegacyDrawingLines,
} from './drawings.js';

describe('drawing normalization helpers', () => {
  it('normalizes ids and trims note text for mixed drawing inputs', () => {
    const drawings = normalizeDrawingItems([
      { id: '  fixed-h  ', type: 'horizontal', price: 100.25 },
      {
        type: 'trendline',
        startTime: 1000,
        startPrice: 10,
        endTime: 1100,
        endPrice: 12.5,
      },
      {
        type: 'rectangle',
        startTime: 1200,
        startPrice: 9.5,
        endTime: 1300,
        endPrice: 11,
      },
      {
        id: '  note-fixed ',
        type: 'note',
        time: 1400,
        price: 10.7,
        text: '  breakout zone  ',
      },
    ]);

    expect(drawings[0]).toEqual({ id: 'fixed-h', type: 'horizontal', price: 100.25 });
    expect(drawings[1]).toEqual({
      id: expect.stringMatching(/^trend_/),
      type: 'trendline',
      startTime: 1000,
      startPrice: 10,
      endTime: 1100,
      endPrice: 12.5,
    });
    expect(drawings[2]).toEqual({
      id: expect.stringMatching(/^rect_/),
      type: 'rectangle',
      startTime: 1200,
      startPrice: 9.5,
      endTime: 1300,
      endPrice: 11,
    });
    expect(drawings[3]).toEqual({
      id: 'note-fixed',
      type: 'note',
      time: 1400,
      price: 10.7,
      text: 'breakout zone',
    });
  });

  it('keeps legacy lines compatibility from normalized drawings', () => {
    const normalizedFromLines = normalizeDrawingLines([{ price: 123 }, { id: 'fixed', price: 456 }]);
    const legacyLines = toLegacyDrawingLines([
      ...normalizedFromLines,
      { id: 'v-1', type: 'vertical', time: 111 },
      { id: 'n-1', type: 'note', time: 222, price: 9.9, text: 'memo' },
    ]);

    expect(legacyLines).toHaveLength(2);
    expect(legacyLines[0]).toEqual({ id: expect.stringMatching(/^line_/), price: 123 });
    expect(legacyLines[1]).toEqual({ id: 'fixed', price: 456 });
  });
});
