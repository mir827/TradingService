import { describe, expect, it } from 'vitest';
import { findProjectedDrawingHit } from './drawingSelection';

describe('drawing selection guards', () => {
  it('keeps selection working when a selected shape projection fails', () => {
    const hit = findProjectedDrawingHit({
      x: 101,
      y: 102,
      selectedDrawingId: 'selected-trendline',
      trendlines: [
        {
          id: 'selected-trendline',
          visible: true,
          startTime: 1,
          startPrice: 1,
          endTime: 2,
          endPrice: 2,
        },
      ],
      rays: [],
      rectangles: [
        {
          id: 'rect-safe',
          visible: true,
          startTime: 3,
          startPrice: 3,
          endTime: 4,
          endPrice: 4,
        },
      ],
      notes: [],
      hitTolerancePx: 8,
      noteHitRadiusPx: 14,
      coordinateAbsLimit: 2_000,
      project: (time) => {
        if (time === 1) throw new Error('projection failed');
        if (time === 2) return { x: 120, y: 120 };
        if (time === 3) return { x: 90, y: 90 };
        if (time === 4) return { x: 110, y: 110 };
        return null;
      },
    });

    expect(hit?.id).toBe('rect-safe');
    expect(hit?.kind).toBe('rectangle');
  });

  it('skips invalid projected values without throwing', () => {
    const guardMessages: string[] = [];
    const hit = findProjectedDrawingHit({
      x: 40,
      y: 60,
      selectedDrawingId: null,
      trendlines: [
        {
          id: 'trend-invalid',
          visible: true,
          startTime: 1,
          startPrice: 1,
          endTime: 2,
          endPrice: 2,
        },
      ],
      rays: [
        {
          id: 'ray-invalid',
          visible: true,
          startTime: 3,
          startPrice: 3,
          endTime: 4,
          endPrice: 4,
        },
      ],
      rectangles: [
        {
          id: 'rect-invalid',
          visible: true,
          startTime: 5,
          startPrice: 5,
          endTime: 6,
          endPrice: 6,
        },
      ],
      notes: [
        {
          id: 'note-invalid',
          visible: true,
          time: 7,
          price: 7,
        },
      ],
      hitTolerancePx: 8,
      noteHitRadiusPx: 14,
      coordinateAbsLimit: 2_000,
      project: (time) => {
        if (time === 1) return { x: Number.NaN, y: 20 };
        if (time === 2) return { x: 40, y: Number.POSITIVE_INFINITY };
        if (time === 3) return { x: Number.NEGATIVE_INFINITY, y: 20 };
        if (time === 4) return { x: 20, y: 20 };
        if (time === 5) return null;
        if (time === 6) return { x: 300, y: 300 };
        if (time === 7) throw new Error('note projection failed');
        return null;
      },
      onGuardMessage: (message) => {
        guardMessages.push(message);
      },
    });

    expect(hit).toBeNull();
    expect(guardMessages.length).toBeGreaterThan(0);
  });

  it('prefers selected shape when distance ties', () => {
    const hit = findProjectedDrawingHit({
      x: 50,
      y: 50,
      selectedDrawingId: 'trend-b',
      trendlines: [
        {
          id: 'trend-a',
          visible: true,
          startTime: 1,
          startPrice: 1,
          endTime: 2,
          endPrice: 2,
        },
        {
          id: 'trend-b',
          visible: true,
          startTime: 3,
          startPrice: 3,
          endTime: 4,
          endPrice: 4,
        },
      ],
      rays: [],
      rectangles: [],
      notes: [],
      hitTolerancePx: 15,
      noteHitRadiusPx: 14,
      coordinateAbsLimit: 2_000,
      project: (time) => {
        if (time === 1) return { x: 10, y: 40 };
        if (time === 2) return { x: 90, y: 40 };
        if (time === 3) return { x: 10, y: 60 };
        if (time === 4) return { x: 90, y: 60 };
        return null;
      },
    });

    expect(hit?.id).toBe('trend-b');
    expect(hit?.kind).toBe('trendline');
  });
});
