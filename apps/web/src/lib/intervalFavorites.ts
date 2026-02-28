export const INTERVAL_FAVORITES_STORAGE_KEY = 'tradingservice.intervalfavorites.v1';
export const INTERVAL_FAVORITES_SCHEMA_VERSION = 1;
export const DEFAULT_INTERVAL_FAVORITES = ['1', '5', '15', '60'] as const;

type IntervalFavoritesPayloadV1 = {
  version: typeof INTERVAL_FAVORITES_SCHEMA_VERSION;
  favorites: string[];
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

function normalizeAllowedIntervals(intervals: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  intervals.forEach((interval) => {
    if (typeof interval !== 'string') return;
    const normalized = interval.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  });

  return ordered;
}

function normalizeFromCandidateList(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const favorites: string[] = [];

  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const normalized = entry.trim();
    if (!normalized || !allowed.has(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    favorites.push(normalized);
  });

  return favorites;
}

function normalizeFallbackFavorites(available: string[]): string[] {
  if (!available.length) return [];
  const allowed = new Set(available);
  const normalizedDefaults = normalizeFromCandidateList(DEFAULT_INTERVAL_FAVORITES, allowed);
  if (normalizedDefaults.length) return normalizedDefaults;
  return [available[0]];
}

export function normalizeIntervalFavorites(value: unknown, availableIntervals: readonly string[]): string[] {
  const available = normalizeAllowedIntervals(availableIntervals);
  if (!available.length) return [];

  const allowed = new Set(available);
  if (Array.isArray(value)) {
    const normalized = normalizeFromCandidateList(value, allowed);
    if (normalized.length) {
      return available.filter((interval) => normalized.includes(interval));
    }

    if (value.length === 0) {
      return [];
    }
  }

  if (value && typeof value === 'object') {
    const parsed = value as { favorites?: unknown; intervals?: unknown };
    const normalized = normalizeFromCandidateList(parsed.favorites ?? parsed.intervals, allowed);
    if (normalized.length) {
      return available.filter((interval) => normalized.includes(interval));
    }
  }

  return normalizeFallbackFavorites(available);
}

function toPayload(favorites: string[]): IntervalFavoritesPayloadV1 {
  return {
    version: INTERVAL_FAVORITES_SCHEMA_VERSION,
    favorites,
  };
}

function migratePayload(payload: unknown, availableIntervals: readonly string[]): string[] | null {
  if (Array.isArray(payload)) {
    return normalizeIntervalFavorites(payload, availableIntervals);
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as {
    version?: unknown;
    favorites?: unknown;
    intervals?: unknown;
  };

  if (parsed.version === INTERVAL_FAVORITES_SCHEMA_VERSION) {
    return normalizeIntervalFavorites(parsed.favorites, availableIntervals);
  }

  if (parsed.version === undefined || parsed.version === null) {
    return normalizeIntervalFavorites(parsed.favorites ?? parsed.intervals, availableIntervals);
  }

  return null;
}

export function readIntervalFavorites(availableIntervals: readonly string[], storage?: StorageLike | null): string[] {
  const defaults = normalizeIntervalFavorites(undefined, availableIntervals);
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return defaults;

  const raw = safeGetItem(resolvedStorage, INTERVAL_FAVORITES_STORAGE_KEY);
  if (typeof raw !== 'string') {
    safeSetItem(resolvedStorage, INTERVAL_FAVORITES_STORAGE_KEY, JSON.stringify(toPayload(defaults)));
    return defaults;
  }

  const parsed = parseJson(raw);
  const migrated = parsed ? migratePayload(parsed, availableIntervals) : null;
  if (!migrated) {
    safeSetItem(resolvedStorage, INTERVAL_FAVORITES_STORAGE_KEY, JSON.stringify(toPayload(defaults)));
    return defaults;
  }

  safeSetItem(resolvedStorage, INTERVAL_FAVORITES_STORAGE_KEY, JSON.stringify(toPayload(migrated)));
  return migrated;
}

export function writeIntervalFavorites(
  favorites: unknown,
  availableIntervals: readonly string[],
  storage?: StorageLike | null,
): string[] {
  const normalized = normalizeIntervalFavorites(favorites, availableIntervals);
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return normalized;

  safeSetItem(resolvedStorage, INTERVAL_FAVORITES_STORAGE_KEY, JSON.stringify(toPayload(normalized)));
  return normalized;
}
