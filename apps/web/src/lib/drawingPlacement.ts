export type PlacementPoint = {
  x: number;
  y: number;
};

export type PlacementSourceEvent = {
  localY?: number;
  clientY?: number;
};

type ResolvePointerPriceFromClickInput = {
  point?: PlacementPoint | null;
  sourceEvent?: PlacementSourceEvent | null;
  chartTop?: number | null;
  fallbackPrice?: number | null;
  coordinateToPrice: (coordinate: number) => number | null;
};

type ResolveHorizontalLinePlacementPriceInput = {
  rawPrice: number | null;
  time?: number;
  magnetEnabled: boolean;
  normalizePrice: (price: number) => number;
  toMagnetPoint?: (time: number, price: number) => { time: number; price: number } | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pushCoordinateCandidate(target: number[], value: unknown) {
  if (!isFiniteNumber(value)) return;
  if (target.includes(value)) return;
  target.push(value);
}

export function resolvePointerPriceFromClick(input: ResolvePointerPriceFromClickInput): number | null {
  const yCandidates: number[] = [];

  pushCoordinateCandidate(yCandidates, input.sourceEvent?.localY);
  pushCoordinateCandidate(yCandidates, input.point?.y);
  if (isFiniteNumber(input.sourceEvent?.clientY) && isFiniteNumber(input.chartTop)) {
    pushCoordinateCandidate(yCandidates, input.sourceEvent.clientY - input.chartTop);
  }

  for (const candidateY of yCandidates) {
    let rawPrice: unknown;
    try {
      rawPrice = input.coordinateToPrice(candidateY);
    } catch {
      continue;
    }

    if (isFiniteNumber(rawPrice)) {
      return rawPrice;
    }
  }

  return isFiniteNumber(input.fallbackPrice) ? input.fallbackPrice : null;
}

export function resolveHorizontalLinePlacementPrice(input: ResolveHorizontalLinePlacementPriceInput): number | null {
  if (!isFiniteNumber(input.rawPrice)) return null;

  const normalizedRawPrice = input.normalizePrice(input.rawPrice);
  if (!isFiniteNumber(normalizedRawPrice)) return null;

  if (!input.magnetEnabled || !isFiniteNumber(input.time) || !input.toMagnetPoint) {
    return normalizedRawPrice;
  }

  const snapped = input.toMagnetPoint(input.time, normalizedRawPrice);
  if (!snapped || !isFiniteNumber(snapped.price)) {
    return normalizedRawPrice;
  }

  const normalizedSnappedPrice = input.normalizePrice(snapped.price);
  return isFiniteNumber(normalizedSnappedPrice) ? normalizedSnappedPrice : normalizedRawPrice;
}
