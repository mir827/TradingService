import { describe, expect, it } from 'vitest';
import { buildDrawingOverlayGeometry } from './drawingOverlay';

describe('drawing overlay geometry safety', () => {
  it('clamps trendline/ray/rectangle geometry after out-of-range drag coordinates', () => {
    const geometry = buildDrawingOverlayGeometry({
      width: 900,
      height: 500,
      trendlines: [
        {
          id: 'trend-1',
          visible: true,
          startTime: 1,
          startPrice: 1,
          endTime: 2,
          endPrice: 2,
        },
      ],
      rays: [
        {
          id: 'ray-1',
          visible: true,
          startTime: 3,
          startPrice: 3,
          endTime: 4,
          endPrice: 4,
        },
      ],
      rectangles: [
        {
          id: 'rect-1',
          visible: true,
          startTime: 5,
          startPrice: 5,
          endTime: 6,
          endPrice: 6,
        },
      ],
      notes: [
        {
          id: 'note-1',
          visible: true,
          time: 7,
          price: 7,
          text: 'memo',
        },
      ],
      toCoordinate: (time) => {
        if (time === 1) return { x: -500_000, y: -320_000 };
        if (time === 2) return { x: 420_000, y: 300_000 };
        if (time === 3) return { x: -240_000, y: 50 };
        if (time === 4) return { x: 220_000, y: 2_400 };
        if (time === 5) return { x: 170_000, y: 210_000 };
        if (time === 6) return { x: 260_000, y: 280_000 };
        if (time === 7) return { x: 125_000, y: 95_000 };
        return null;
      },
    });

    expect(geometry.trendlines).toHaveLength(1);
    expect(geometry.rays).toHaveLength(1);
    expect(geometry.rectangles).toHaveLength(1);
    expect(geometry.notes).toHaveLength(1);

    const maxAbs = Math.max(geometry.width, geometry.height) * 4;
    const coordinates = [
      geometry.trendlines[0].x1,
      geometry.trendlines[0].y1,
      geometry.trendlines[0].x2,
      geometry.trendlines[0].y2,
      geometry.rays[0].x1,
      geometry.rays[0].y1,
      geometry.rays[0].x2,
      geometry.rays[0].y2,
      geometry.rectangles[0].x,
      geometry.rectangles[0].y,
      geometry.rectangles[0].width,
      geometry.rectangles[0].height,
      geometry.notes[0].x,
      geometry.notes[0].y,
    ];

    for (const value of coordinates) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(maxAbs);
    }
  });

  it('drops invalid and degenerate projected shapes', () => {
    const geometry = buildDrawingOverlayGeometry({
      width: 640,
      height: 360,
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
          id: 'ray-flat',
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
          id: 'note-valid',
          visible: true,
          time: 7,
          price: 7,
          text: 'ok',
        },
      ],
      toCoordinate: (time) => {
        if (time === 1) return { x: Number.NaN, y: 10 };
        if (time === 2) return { x: 20, y: Number.POSITIVE_INFINITY };
        if (time === 3) return { x: 40, y: 40 };
        if (time === 4) return { x: 40, y: 40 };
        if (time === 5) return null;
        if (time === 6) return { x: 120, y: 120 };
        if (time === 7) return { x: 200, y: 160 };
        return null;
      },
    });

    expect(geometry.trendlines).toHaveLength(0);
    expect(geometry.rays).toHaveLength(0);
    expect(geometry.rectangles).toHaveLength(0);
    expect(geometry.notes).toEqual([{ id: 'note-valid', x: 200, y: 160, text: 'ok' }]);
  });

  it('skips malformed one-off projections without dropping valid shapes', () => {
    const geometry = buildDrawingOverlayGeometry({
      width: 720,
      height: 420,
      trendlines: [
        {
          id: 'selected-trendline',
          visible: true,
          startTime: 1,
          startPrice: 1,
          endTime: 2,
          endPrice: 2,
        },
        {
          id: 'trend-ok',
          visible: true,
          startTime: 3,
          startPrice: 3,
          endTime: 4,
          endPrice: 4,
        },
      ],
      rays: [
        {
          id: 'ray-bad',
          visible: true,
          startTime: 5,
          startPrice: 5,
          endTime: 6,
          endPrice: 6,
        },
        {
          id: 'ray-ok',
          visible: true,
          startTime: 7,
          startPrice: 7,
          endTime: 8,
          endPrice: 8,
        },
      ],
      rectangles: [
        {
          id: 'rect-bad',
          visible: true,
          startTime: 9,
          startPrice: 9,
          endTime: 10,
          endPrice: 10,
        },
        {
          id: 'rect-ok',
          visible: true,
          startTime: 11,
          startPrice: 11,
          endTime: 12,
          endPrice: 12,
        },
      ],
      notes: [
        {
          id: 'note-bad',
          visible: true,
          time: 13,
          price: 13,
          text: 'bad note',
        },
        {
          id: 'note-ok',
          visible: true,
          time: 14,
          price: 14,
          text: 'good note',
        },
      ],
      toCoordinate: (time) => {
        if (time === 1) throw new Error('projection failed');
        if (time === 2) return { x: 50, y: 20 };
        if (time === 3) return { x: 120, y: 40 };
        if (time === 4) return { x: 200, y: 140 };
        if (time === 5) return { x: 240, y: 160 };
        if (time === 6) return { x: 240, y: 160 };
        if (time === 7) return { x: 260, y: 170 };
        if (time === 8) return { x: 340, y: 210 };
        if (time === 9) return { x: Number.POSITIVE_INFINITY, y: 30 };
        if (time === 10) return { x: 160, y: 120 };
        if (time === 11) return { x: 180, y: 80 };
        if (time === 12) return { x: 300, y: 190 };
        if (time === 13) return { x: Number.NaN, y: 20 };
        if (time === 14) return { x: 360, y: 220 };
        return null;
      },
    });

    expect(geometry.trendlines.map((shape) => shape.id)).toEqual(['trend-ok']);
    expect(geometry.rays.map((shape) => shape.id)).toEqual(['ray-ok']);
    expect(geometry.rectangles.map((shape) => shape.id)).toEqual(['rect-ok']);
    expect(geometry.notes.map((shape) => shape.id)).toEqual(['note-ok']);
  });

  it('keeps rectangle dimensions finite and non-negative under extreme projected values', () => {
    const geometry = buildDrawingOverlayGeometry({
      width: 840,
      height: 460,
      trendlines: [],
      rays: [],
      rectangles: [
        {
          id: 'rect-extreme',
          visible: true,
          startTime: 1,
          startPrice: 1,
          endTime: 2,
          endPrice: 2,
        },
      ],
      notes: [],
      toCoordinate: (time) => {
        if (time === 1) return { x: -10_000_000, y: 8_000_000 };
        if (time === 2) return { x: 12_000_000, y: -9_000_000 };
        return null;
      },
    });

    expect(geometry.rectangles).toHaveLength(1);
    const [rect] = geometry.rectangles;
    const maxAbs = Math.max(geometry.width, geometry.height) * 4;

    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.y)).toBe(true);
    expect(Number.isFinite(rect.width)).toBe(true);
    expect(Number.isFinite(rect.height)).toBe(true);
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
    expect(rect.width).toBeLessThanOrEqual(maxAbs * 2);
    expect(rect.height).toBeLessThanOrEqual(maxAbs * 2);
  });
});
