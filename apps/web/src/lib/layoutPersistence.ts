import { normalizeChartLayoutMode, type ChartLayoutMode } from './chartLayout';

export const UNIFIED_LAYOUT_STORAGE_KEY = 'tradingservice.layout.v2';
export const LEGACY_CHART_LAYOUT_STORAGE_KEY = 'tradingservice.chartlayout.v1';
export const UNIFIED_LAYOUT_SCHEMA_VERSION = 2;

type UnifiedLayoutStorageV1 = {
  version: 1;
  layoutMode?: unknown;
  chartLayoutMode?: unknown;
};

type UnifiedLayoutStorageV2 = {
  version: typeof UNIFIED_LAYOUT_SCHEMA_VERSION;
  chart: {
    layoutMode: ChartLayoutMode;
  };
};

export type UnifiedLayoutState = {
  chartLayoutMode: ChartLayoutMode;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const DEFAULT_UNIFIED_LAYOUT_STATE: UnifiedLayoutState = {
  chartLayoutMode: 'single',
};

export function getDefaultUnifiedLayoutState(): UnifiedLayoutState {
  return { ...DEFAULT_UNIFIED_LAYOUT_STATE };
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeUnifiedLayoutState(value: { chartLayoutMode?: unknown } | null | undefined): UnifiedLayoutState {
  return {
    chartLayoutMode: normalizeChartLayoutMode(value?.chartLayoutMode),
  };
}

function toStoragePayload(state: UnifiedLayoutState): UnifiedLayoutStorageV2 {
  return {
    version: UNIFIED_LAYOUT_SCHEMA_VERSION,
    chart: {
      layoutMode: state.chartLayoutMode,
    },
  };
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
    // no-op for quota/private mode failures
  }
}

function safeRemoveItem(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // no-op for quota/private mode failures
  }
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function migrateUnifiedPayloadToCurrent(payload: unknown): UnifiedLayoutState | null {
  if (!payload || typeof payload !== 'object') return null;

  const parsed = payload as {
    version?: unknown;
    layoutMode?: unknown;
    chartLayoutMode?: unknown;
    chart?: { layoutMode?: unknown } | null;
  };

  if (parsed.version === UNIFIED_LAYOUT_SCHEMA_VERSION) {
    return normalizeUnifiedLayoutState({ chartLayoutMode: parsed.chart?.layoutMode });
  }

  if (parsed.version === 1) {
    const v1 = parsed as UnifiedLayoutStorageV1 & { chart?: { layoutMode?: unknown } | null };
    return normalizeUnifiedLayoutState({
      chartLayoutMode: v1.layoutMode ?? v1.chartLayoutMode ?? v1.chart?.layoutMode,
    });
  }

  return null;
}

function persistCurrentPayload(storage: StorageLike, state: UnifiedLayoutState) {
  safeSetItem(storage, UNIFIED_LAYOUT_STORAGE_KEY, JSON.stringify(toStoragePayload(state)));
  safeRemoveItem(storage, LEGACY_CHART_LAYOUT_STORAGE_KEY);
}

export function readUnifiedLayoutState(storage?: StorageLike | null): UnifiedLayoutState {
  const resolvedStorage = resolveStorage(storage);
  const defaults = getDefaultUnifiedLayoutState();
  if (!resolvedStorage) return defaults;

  const rawUnified = safeGetItem(resolvedStorage, UNIFIED_LAYOUT_STORAGE_KEY);
  if (typeof rawUnified === 'string') {
    const parsedUnified = parseJson(rawUnified);
    const migrated = parsedUnified ? migrateUnifiedPayloadToCurrent(parsedUnified) : null;
    if (migrated) {
      persistCurrentPayload(resolvedStorage, migrated);
      return migrated;
    }

    return defaults;
  }

  const rawLegacy = safeGetItem(resolvedStorage, LEGACY_CHART_LAYOUT_STORAGE_KEY);
  if (typeof rawLegacy !== 'string') {
    return defaults;
  }

  const migratedLegacy = normalizeUnifiedLayoutState({ chartLayoutMode: rawLegacy });
  persistCurrentPayload(resolvedStorage, migratedLegacy);
  return migratedLegacy;
}

export function writeUnifiedLayoutState(state: UnifiedLayoutState, storage?: StorageLike | null): UnifiedLayoutState {
  const normalizedState = normalizeUnifiedLayoutState(state);
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return normalizedState;

  persistCurrentPayload(resolvedStorage, normalizedState);
  return normalizedState;
}
