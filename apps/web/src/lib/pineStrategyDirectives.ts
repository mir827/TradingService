export type PineStrategyTesterDirectiveParams = {
  fastPeriod?: number;
  slowPeriod?: number;
  initialCapital?: number;
  feeBps?: number;
};

const STRATEGY_FAST_MIN = 2;
const STRATEGY_FAST_MAX = 300;
const STRATEGY_SLOW_MIN = 3;
const STRATEGY_SLOW_MAX = 600;
const STRATEGY_CAPITAL_MIN = 1;
const STRATEGY_CAPITAL_MAX = 1_000_000_000_000_000;
const STRATEGY_FEE_BPS_MIN = 0;
const STRATEGY_FEE_BPS_MAX = 2000;

const DIRECTIVE_PATTERN = /^\s*\/\/\s*@(?<key>ts_fast|ts_slow|ts_capital|ts_fee_bps)\s*=\s*(?<value>[-+]?\d+(?:\.\d+)?)\s*$/;

function parseFiniteNumber(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoundedInteger(value: number, min: number, max: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function parseBoundedNumber(value: number, min: number, max: number): number | null {
  if (value < min || value > max) return null;
  return value;
}

export function parsePineStrategyTesterDirectives(source: string): PineStrategyTesterDirectiveParams {
  if (typeof source !== 'string' || source.length === 0) {
    return {};
  }

  const parsed: PineStrategyTesterDirectiveParams = {};
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(DIRECTIVE_PATTERN);
    if (!match || !match.groups) continue;

    const value = parseFiniteNumber(match.groups.value);
    if (value === null) continue;

    if (match.groups.key === 'ts_fast') {
      const normalized = parseBoundedInteger(value, STRATEGY_FAST_MIN, STRATEGY_FAST_MAX);
      if (normalized !== null) {
        parsed.fastPeriod = normalized;
      }
      continue;
    }

    if (match.groups.key === 'ts_slow') {
      const normalized = parseBoundedInteger(value, STRATEGY_SLOW_MIN, STRATEGY_SLOW_MAX);
      if (normalized !== null) {
        parsed.slowPeriod = normalized;
      }
      continue;
    }

    if (match.groups.key === 'ts_capital') {
      const normalized = parseBoundedNumber(value, STRATEGY_CAPITAL_MIN, STRATEGY_CAPITAL_MAX);
      if (normalized !== null) {
        parsed.initialCapital = normalized;
      }
      continue;
    }

    const normalized = parseBoundedNumber(value, STRATEGY_FEE_BPS_MIN, STRATEGY_FEE_BPS_MAX);
    if (normalized !== null) {
      parsed.feeBps = normalized;
    }
  }

  if (
    typeof parsed.fastPeriod === 'number' &&
    typeof parsed.slowPeriod === 'number' &&
    parsed.fastPeriod >= parsed.slowPeriod
  ) {
    delete parsed.fastPeriod;
    delete parsed.slowPeriod;
  }

  return parsed;
}
