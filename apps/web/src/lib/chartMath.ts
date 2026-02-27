export type CandleLike = {
  time: number;
  close: number;
};

export type TimeValuePoint = {
  time: number;
  value: number;
};

export type BollingerBandsValues = {
  basis: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
};

export type MacdValues = {
  macdLine: Array<number | null>;
  signalLine: Array<number | null>;
  histogram: Array<number | null>;
};

function isValidPeriod(period: number) {
  return Number.isInteger(period) && period > 0;
}

function createNullSeries(length: number) {
  return Array<number | null>(length).fill(null);
}

function hasInvalidValue(values: number[]) {
  return values.some((value) => !Number.isFinite(value));
}

export function calculateSMA(values: number[], period: number): Array<number | null> {
  const result = createNullSeries(values.length);
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
  const result = createNullSeries(values.length);
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

function calculateEMAFromNullable(values: Array<number | null>, period: number): Array<number | null> {
  const result = createNullSeries(values.length);
  if (!isValidPeriod(period)) return result;

  const indexes: number[] = [];
  const numericValues: number[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value === 'number' && Number.isFinite(value)) {
      indexes.push(index);
      numericValues.push(value);
    }
  }

  if (numericValues.length < period) return result;

  const multiplier = 2 / (period + 1);
  const seed = numericValues.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let previous = seed;

  result[indexes[period - 1]] = seed;

  for (let index = period; index < numericValues.length; index += 1) {
    const value = numericValues[index];
    previous = (value - previous) * multiplier + previous;
    result[indexes[index]] = previous;
  }

  return result;
}

export function calculateRSI(values: number[], period: number): Array<number | null> {
  const result = createNullSeries(values.length);
  if (!isValidPeriod(period) || values.length <= period || hasInvalidValue(values)) return result;

  let gainSum = 0;
  let lossSum = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    gainSum += delta > 0 ? delta : 0;
    lossSum += delta < 0 ? -delta : 0;
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;

  if (averageLoss === 0) {
    result[period] = averageGain === 0 ? 50 : 100;
  } else {
    const relativeStrength = averageGain / averageLoss;
    result[period] = 100 - 100 / (1 + relativeStrength);
  }

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;

    if (averageLoss === 0) {
      result[index] = averageGain === 0 ? 50 : 100;
      continue;
    }

    const relativeStrength = averageGain / averageLoss;
    result[index] = 100 - 100 / (1 + relativeStrength);
  }

  return result;
}

export function calculateMACD(
  values: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MacdValues {
  const macdLine = createNullSeries(values.length);
  const signalLine = createNullSeries(values.length);
  const histogram = createNullSeries(values.length);

  if (
    !isValidPeriod(fastPeriod) ||
    !isValidPeriod(slowPeriod) ||
    !isValidPeriod(signalPeriod) ||
    fastPeriod >= slowPeriod ||
    values.length < slowPeriod ||
    hasInvalidValue(values)
  ) {
    return { macdLine, signalLine, histogram };
  }

  const fast = calculateEMA(values, fastPeriod);
  const slow = calculateEMA(values, slowPeriod);

  for (let index = 0; index < values.length; index += 1) {
    const fastValue = fast[index];
    const slowValue = slow[index];

    if (typeof fastValue !== 'number' || typeof slowValue !== 'number') {
      continue;
    }

    macdLine[index] = fastValue - slowValue;
  }

  const signal = calculateEMAFromNullable(macdLine, signalPeriod);

  for (let index = 0; index < values.length; index += 1) {
    const macdValue = macdLine[index];
    const signalValue = signal[index];

    if (typeof macdValue !== 'number' || typeof signalValue !== 'number') {
      continue;
    }

    signalLine[index] = signalValue;
    histogram[index] = macdValue - signalValue;
  }

  return { macdLine, signalLine, histogram };
}

export function calculateBollingerBands(values: number[], period: number, stdDevMultiplier: number): BollingerBandsValues {
  const basis = createNullSeries(values.length);
  const upper = createNullSeries(values.length);
  const lower = createNullSeries(values.length);

  if (
    !isValidPeriod(period) ||
    !Number.isFinite(stdDevMultiplier) ||
    stdDevMultiplier <= 0 ||
    values.length < period ||
    hasInvalidValue(values)
  ) {
    return { basis, upper, lower };
  }

  let rollingSum = 0;
  let rollingSquaredSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    rollingSum += value;
    rollingSquaredSum += value * value;

    if (index >= period) {
      const trailing = values[index - period];
      rollingSum -= trailing;
      rollingSquaredSum -= trailing * trailing;
    }

    if (index < period - 1) {
      continue;
    }

    const mean = rollingSum / period;
    const variance = Math.max(rollingSquaredSum / period - mean * mean, 0);
    const standardDeviation = Math.sqrt(variance);
    const bandOffset = standardDeviation * stdDevMultiplier;

    basis[index] = mean;
    upper[index] = mean + bandOffset;
    lower[index] = mean - bandOffset;
  }

  return { basis, upper, lower };
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
