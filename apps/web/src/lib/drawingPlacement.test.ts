import { describe, expect, it, vi } from 'vitest';
import { resolveHorizontalLinePlacementPrice, resolvePointerPriceFromClick } from './drawingPlacement';

describe('resolvePointerPriceFromClick', () => {
  it('prefers raw localY coordinates over crosshair point coordinates', () => {
    const coordinateToPrice = vi.fn((coordinate: number) => coordinate * 10);

    const result = resolvePointerPriceFromClick({
      point: { x: 25, y: 12 },
      sourceEvent: { localY: 14 },
      chartTop: 0,
      coordinateToPrice,
    });

    expect(result).toBe(140);
    expect(coordinateToPrice).toHaveBeenCalledTimes(1);
    expect(coordinateToPrice).toHaveBeenCalledWith(14);
  });

  it('falls back to point.y when localY is missing', () => {
    const coordinateToPrice = vi.fn((coordinate: number) => coordinate + 100);

    const result = resolvePointerPriceFromClick({
      point: { x: 10, y: 8 },
      sourceEvent: {},
      coordinateToPrice,
    });

    expect(result).toBe(108);
    expect(coordinateToPrice).toHaveBeenCalledWith(8);
  });

  it('uses clientY minus chartTop when point and localY are unavailable', () => {
    const coordinateToPrice = vi.fn((coordinate: number) => coordinate);

    const result = resolvePointerPriceFromClick({
      sourceEvent: { clientY: 240 },
      chartTop: 80,
      coordinateToPrice,
    });

    expect(result).toBe(160);
    expect(coordinateToPrice).toHaveBeenCalledWith(160);
  });

  it('uses fallbackPrice when coordinate conversion fails', () => {
    const coordinateToPrice = vi.fn(() => null);

    const result = resolvePointerPriceFromClick({
      point: { x: 10, y: 5 },
      coordinateToPrice,
      fallbackPrice: 123.45,
    });

    expect(result).toBe(123.45);
    expect(coordinateToPrice).toHaveBeenCalledTimes(1);
  });

  it('returns null when no coordinate path or fallback is valid', () => {
    const result = resolvePointerPriceFromClick({
      sourceEvent: { localY: Number.NaN },
      chartTop: Number.NaN,
      coordinateToPrice: () => null,
      fallbackPrice: Number.NaN,
    });

    expect(result).toBeNull();
  });
});

describe('resolveHorizontalLinePlacementPrice', () => {
  const normalizePrice = (price: number) => Number(price.toFixed(2));

  it('keeps pointer-derived price when magnet is off', () => {
    const toMagnetPoint = vi.fn(() => ({ time: 100, price: 110 }));

    const result = resolveHorizontalLinePlacementPrice({
      rawPrice: 101.237,
      time: 100,
      magnetEnabled: false,
      normalizePrice,
      toMagnetPoint,
    });

    expect(result).toBe(101.24);
    expect(toMagnetPoint).not.toHaveBeenCalled();
  });

  it('uses snapped price when magnet is on and time is available', () => {
    const toMagnetPoint = vi.fn((time: number, price: number) => ({ time, price: price + 5 }));

    const result = resolveHorizontalLinePlacementPrice({
      rawPrice: 101.237,
      time: 100,
      magnetEnabled: true,
      normalizePrice,
      toMagnetPoint,
    });

    expect(result).toBe(106.24);
    expect(toMagnetPoint).toHaveBeenCalledWith(100, 101.24);
  });

  it('keeps pointer-derived price when time is unavailable even if magnet is on', () => {
    const toMagnetPoint = vi.fn(() => ({ time: 100, price: 120 }));

    const result = resolveHorizontalLinePlacementPrice({
      rawPrice: 99.991,
      magnetEnabled: true,
      normalizePrice,
      toMagnetPoint,
    });

    expect(result).toBe(99.99);
    expect(toMagnetPoint).not.toHaveBeenCalled();
  });

  it('falls back to pointer-derived price when snapped price is invalid', () => {
    const toMagnetPoint = vi.fn(() => ({ time: 100, price: Number.NaN }));

    const result = resolveHorizontalLinePlacementPrice({
      rawPrice: 55.551,
      time: 100,
      magnetEnabled: true,
      normalizePrice,
      toMagnetPoint,
    });

    expect(result).toBe(55.55);
  });

  it('returns null for invalid raw prices', () => {
    const result = resolveHorizontalLinePlacementPrice({
      rawPrice: Number.NaN,
      time: 100,
      magnetEnabled: true,
      normalizePrice,
      toMagnetPoint: () => ({ time: 100, price: 1 }),
    });

    expect(result).toBeNull();
  });
});
