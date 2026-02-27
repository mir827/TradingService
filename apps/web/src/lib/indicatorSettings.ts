export type RsiSettings = {
  period: number;
};

export type MacdSettings = {
  fast: number;
  slow: number;
  signal: number;
};

export type BollingerSettings = {
  period: number;
  stdDev: number;
};

export type IndicatorSettings = {
  rsi: RsiSettings;
  macd: MacdSettings;
  bollinger: BollingerSettings;
};

export type PartialIndicatorSettings = {
  rsi?: Partial<RsiSettings>;
  macd?: Partial<MacdSettings>;
  bollinger?: Partial<BollingerSettings>;
};

export const RSI_PERIOD_RANGE = { min: 2, max: 200 } as const;
export const MACD_FAST_RANGE = { min: 2, max: 200 } as const;
export const MACD_SLOW_RANGE = { min: 3, max: 300 } as const;
export const MACD_SIGNAL_RANGE = { min: 2, max: 200 } as const;
export const BOLLINGER_PERIOD_RANGE = { min: 2, max: 200 } as const;
export const BOLLINGER_STD_DEV_RANGE = { min: 0.5, max: 4 } as const;

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettings = {
  rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  bollinger: { period: 20, stdDev: 2 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(Math.round(numeric), min, max);
}

function normalizeDecimal(value: unknown, fallback: number, min: number, max: number, fractionDigits: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const clamped = clamp(numeric, min, max);
  return Number(clamped.toFixed(fractionDigits));
}

export function normalizeRsiSettings(value: Partial<RsiSettings> | undefined): RsiSettings {
  return {
    period: normalizeInteger(
      value?.period,
      DEFAULT_INDICATOR_SETTINGS.rsi.period,
      RSI_PERIOD_RANGE.min,
      RSI_PERIOD_RANGE.max,
    ),
  };
}

export function normalizeMacdSettings(value: Partial<MacdSettings> | undefined): MacdSettings {
  let fast = normalizeInteger(
    value?.fast,
    DEFAULT_INDICATOR_SETTINGS.macd.fast,
    MACD_FAST_RANGE.min,
    MACD_FAST_RANGE.max,
  );
  let slow = normalizeInteger(
    value?.slow,
    DEFAULT_INDICATOR_SETTINGS.macd.slow,
    MACD_SLOW_RANGE.min,
    MACD_SLOW_RANGE.max,
  );
  const signal = normalizeInteger(
    value?.signal,
    DEFAULT_INDICATOR_SETTINGS.macd.signal,
    MACD_SIGNAL_RANGE.min,
    MACD_SIGNAL_RANGE.max,
  );

  if (slow <= fast) {
    slow = Math.min(MACD_SLOW_RANGE.max, fast + 1);
  }

  if (fast >= slow) {
    fast = Math.max(MACD_FAST_RANGE.min, slow - 1);
  }

  return { fast, slow, signal };
}

export function normalizeBollingerSettings(value: Partial<BollingerSettings> | undefined): BollingerSettings {
  return {
    period: normalizeInteger(
      value?.period,
      DEFAULT_INDICATOR_SETTINGS.bollinger.period,
      BOLLINGER_PERIOD_RANGE.min,
      BOLLINGER_PERIOD_RANGE.max,
    ),
    stdDev: normalizeDecimal(
      value?.stdDev,
      DEFAULT_INDICATOR_SETTINGS.bollinger.stdDev,
      BOLLINGER_STD_DEV_RANGE.min,
      BOLLINGER_STD_DEV_RANGE.max,
      1,
    ),
  };
}

export function normalizeIndicatorSettings(value: PartialIndicatorSettings | undefined): IndicatorSettings {
  return {
    rsi: normalizeRsiSettings(value?.rsi),
    macd: normalizeMacdSettings(value?.macd),
    bollinger: normalizeBollingerSettings(value?.bollinger),
  };
}
