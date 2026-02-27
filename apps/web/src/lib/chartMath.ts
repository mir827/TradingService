export type CandleLike = {
  time: number;
  close: number;
};

export type TimeValuePoint = {
  time: number;
  value: number;
};

function isValidPeriod(period: number) {
  return Number.isInteger(period) && period > 0;
}

export function calculateSMA(values: number[], period: number): Array<number | null> {
  const result = Array<number | null>(values.length).fill(null);
  if (!isValidPeriod(period) || values.length < period) return result;

  let rollingSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;

    rollingSum += value;

    if (index >= period) {
      rollingSum -= values[index - period];
    }

    if (index >= period - 1) {
      result[index] = rollingSum / period;
    }
  }

  return result;
}

export function calculateEMA(values: number[], period: number): Array<number | null> {
  const result = Array<number | null>(values.length).fill(null);
  if (!isValidPeriod(period) || values.length < period) return result;

  const multiplier = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let previous = seed;

  result[period - 1] = seed;

  for (let index = period; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;

    previous = (value - previous) * multiplier + previous;
    result[index] = previous;
  }

  return result;
}

export function toTimeValuePoints(candles: CandleLike[], values: Array<number | null>): TimeValuePoint[] {
  if (!candles.length || !values.length) return [];

  const length = Math.min(candles.length, values.length);
  const points: TimeValuePoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const candle = candles[index];
    const value = values[index];

    if (!Number.isFinite(candle.time) || typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }

    points.push({
      time: candle.time,
      value,
    });
  }

  return points;
}

export function normalizeCompareOverlay(baseCandles: CandleLike[], compareCandles: CandleLike[]): TimeValuePoint[] {
  if (!baseCandles.length || !compareCandles.length) return [];

  const baseByTime = new Map<number, number>();
  for (const candle of baseCandles) {
    if (Number.isFinite(candle.time) && Number.isFinite(candle.close)) {
      baseByTime.set(candle.time, candle.close);
    }
  }

  const overlap = compareCandles
    .filter((candle) => baseByTime.has(candle.time) && Number.isFinite(candle.close))
    .sort((left, right) => left.time - right.time);

  if (!overlap.length) return [];

  const anchor = overlap[0];
  const anchorBaseClose = baseByTime.get(anchor.time);

  if (typeof anchorBaseClose !== 'number' || !Number.isFinite(anchorBaseClose) || anchor.close === 0) {
    return [];
  }

  const scale = anchorBaseClose / anchor.close;

  return overlap.map((candle) => ({
    time: candle.time,
    value: candle.close * scale,
  }));
}
