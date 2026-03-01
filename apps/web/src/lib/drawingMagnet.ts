export type MagnetAnchorCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MagnetPoint = {
  time: number;
  price: number;
};

const PRICE_KEYS = ['open', 'high', 'low', 'close'] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveNearestPriceAnchor(price: number, candle: MagnetAnchorCandle) {
  let bestPrice: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const key of PRICE_KEYS) {
    const candidate = candle[key];
    if (!isFiniteNumber(candidate)) continue;

    const distance = Math.abs(candidate - price);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPrice = candidate;
    }
  }

  return bestPrice;
}

export function snapToNearestCandleAnchor(point: MagnetPoint, candles: MagnetAnchorCandle[]): MagnetPoint | null {
  if (!isFiniteNumber(point.time) || !isFiniteNumber(point.price)) return null;
  if (candles.length === 0) return null;

  let bestCandle: MagnetAnchorCandle | null = null;
  let bestTimeDistance = Number.POSITIVE_INFINITY;
  let bestCandleTime = Number.POSITIVE_INFINITY;

  for (const candle of candles) {
    const candleTime = Math.floor(candle.time);
    if (!isFiniteNumber(candleTime)) continue;

    const nearestPrice = resolveNearestPriceAnchor(point.price, candle);
    if (!isFiniteNumber(nearestPrice)) continue;

    const timeDistance = Math.abs(candleTime - point.time);

    if (timeDistance < bestTimeDistance) {
      bestCandle = candle;
      bestTimeDistance = timeDistance;
      bestCandleTime = candleTime;
      continue;
    }

    if (timeDistance === bestTimeDistance && candleTime < bestCandleTime) {
      bestCandle = candle;
      bestCandleTime = candleTime;
    }
  }

  if (!bestCandle) return null;

  const snappedPrice = resolveNearestPriceAnchor(point.price, bestCandle);
  if (!isFiniteNumber(snappedPrice)) return null;

  return {
    time: Math.floor(bestCandle.time),
    price: snappedPrice,
  };
}
