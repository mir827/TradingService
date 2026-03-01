export const STRATEGY_TESTER_STORAGE_KEY = 'tradingservice.strategytester.v1';

export type StrategyFeeUnit = 'bps' | 'percent';
export type StrategySlippageMode = 'tick' | 'percent';
export type StrategyPositionSizeMode = 'fixed-percent' | 'fixed-qty';

export type StrategyTesterLinkedScript = {
  scriptId: string;
  scriptName: string;
  revision: number;
};

export type StrategyTesterFormState = {
  symbol: string;
  interval: string;
  limit: string;
  initialCapital: string;
  feeUnit: StrategyFeeUnit;
  feeValue: string;
  slippageMode: StrategySlippageMode;
  slippageValue: string;
  positionSizeMode: StrategyPositionSizeMode;
  fixedPercent: string;
  fixedQty: string;
  fastPeriod: string;
  slowPeriod: string;
  linkedScript: StrategyTesterLinkedScript | null;
};

export const DEFAULT_STRATEGY_TESTER_FORM: StrategyTesterFormState = {
  symbol: 'BTCUSDT',
  interval: '60',
  limit: '500',
  initialCapital: '10000',
  feeUnit: 'bps',
  feeValue: '10',
  slippageMode: 'percent',
  slippageValue: '0',
  positionSizeMode: 'fixed-percent',
  fixedPercent: '100',
  fixedQty: '1',
  fastPeriod: '12',
  slowPeriod: '26',
  linkedScript: null,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeGetItem(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(storage: StorageLike, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // no-op for private mode/quota failures
  }
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toStoredStrategyField(value: unknown, fallback: string) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length > 0) return normalized;
  }

  return fallback;
}

function normalizeLinkedScriptRevision(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return null;
}

function normalizeLinkedScript(value: unknown): StrategyTesterLinkedScript | null {
  if (!value || typeof value !== 'object') return null;

  const parsed = value as {
    scriptId?: unknown;
    scriptName?: unknown;
    revision?: unknown;
  };

  const scriptId = typeof parsed.scriptId === 'string' ? parsed.scriptId.trim() : '';
  const scriptName = typeof parsed.scriptName === 'string' ? parsed.scriptName.trim() : '';
  const revision = normalizeLinkedScriptRevision(parsed.revision);

  if (!scriptId || !scriptName || revision === null) {
    return null;
  }

  return {
    scriptId,
    scriptName,
    revision,
  };
}

export function normalizeStrategyTesterForm(value: unknown): StrategyTesterFormState {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_STRATEGY_TESTER_FORM };
  }

  const parsed = value as Partial<Record<string, unknown>>;
  const storedFeeUnit: StrategyFeeUnit = parsed.feeUnit === 'percent' ? 'percent' : 'bps';
  const storedSlippageMode: StrategySlippageMode = parsed.slippageMode === 'tick' ? 'tick' : 'percent';
  const storedPositionSizeMode: StrategyPositionSizeMode = parsed.positionSizeMode === 'fixed-qty' ? 'fixed-qty' : 'fixed-percent';
  const feeFallback = toStoredStrategyField(parsed.feeBps, DEFAULT_STRATEGY_TESTER_FORM.feeValue);

  return {
    symbol: toStoredStrategyField(parsed.symbol, DEFAULT_STRATEGY_TESTER_FORM.symbol).toUpperCase(),
    interval: toStoredStrategyField(parsed.interval, DEFAULT_STRATEGY_TESTER_FORM.interval).toUpperCase(),
    limit: toStoredStrategyField(parsed.limit, DEFAULT_STRATEGY_TESTER_FORM.limit),
    initialCapital: toStoredStrategyField(parsed.initialCapital, DEFAULT_STRATEGY_TESTER_FORM.initialCapital),
    feeUnit: storedFeeUnit,
    feeValue: toStoredStrategyField(parsed.feeValue, feeFallback),
    slippageMode: storedSlippageMode,
    slippageValue: toStoredStrategyField(parsed.slippageValue, DEFAULT_STRATEGY_TESTER_FORM.slippageValue),
    positionSizeMode: storedPositionSizeMode,
    fixedPercent: toStoredStrategyField(parsed.fixedPercent, DEFAULT_STRATEGY_TESTER_FORM.fixedPercent),
    fixedQty: toStoredStrategyField(parsed.fixedQty, DEFAULT_STRATEGY_TESTER_FORM.fixedQty),
    fastPeriod: toStoredStrategyField(parsed.fastPeriod, DEFAULT_STRATEGY_TESTER_FORM.fastPeriod),
    slowPeriod: toStoredStrategyField(parsed.slowPeriod, DEFAULT_STRATEGY_TESTER_FORM.slowPeriod),
    linkedScript: normalizeLinkedScript(parsed.linkedScript),
  };
}

export function readStrategyTesterForm(storage?: StorageLike | null): StrategyTesterFormState {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ...DEFAULT_STRATEGY_TESTER_FORM };
  }

  const raw = safeGetItem(resolvedStorage, STRATEGY_TESTER_STORAGE_KEY);
  if (typeof raw !== 'string') {
    return { ...DEFAULT_STRATEGY_TESTER_FORM };
  }

  const parsed = parseJson(raw);
  if (parsed === null) {
    return { ...DEFAULT_STRATEGY_TESTER_FORM };
  }

  return normalizeStrategyTesterForm(parsed);
}

export function writeStrategyTesterForm(form: StrategyTesterFormState, storage?: StorageLike | null): StrategyTesterFormState {
  const normalized = normalizeStrategyTesterForm(form);
  const resolvedStorage = resolveStorage(storage);

  if (resolvedStorage) {
    safeSetItem(resolvedStorage, STRATEGY_TESTER_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}
