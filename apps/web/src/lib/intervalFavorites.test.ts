import { describe, expect, it } from 'vitest';
import {
  INTERVAL_FAVORITES_SCHEMA_VERSION,
  INTERVAL_FAVORITES_STORAGE_KEY,
  normalizeIntervalFavorites,
  readIntervalFavorites,
  writeIntervalFavorites,
} from './intervalFavorites';

const AVAILABLE_INTERVALS = ['1', '5', '15', '60', '240', '1D', '1W'];

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function readPayload(storage: MemoryStorage): unknown {
  const raw = storage.getItem(INTERVAL_FAVORITES_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as unknown) : null;
}

describe('interval favorites persistence', () => {
  it('returns defaults and writes current schema when storage is empty', () => {
    const storage = new MemoryStorage();

    const favorites = readIntervalFavorites(AVAILABLE_INTERVALS, storage);

    expect(favorites).toEqual(['1', '5', '15', '60']);
    expect(readPayload(storage)).toEqual({
      version: INTERVAL_FAVORITES_SCHEMA_VERSION,
      favorites: ['1', '5', '15', '60'],
    });
  });

  it('migrates legacy raw-array payloads and preserves stable available-order sorting', () => {
    const storage = new MemoryStorage();
    storage.setItem(INTERVAL_FAVORITES_STORAGE_KEY, JSON.stringify(['1W', '5', '1W', '1']));

    const favorites = readIntervalFavorites(AVAILABLE_INTERVALS, storage);

    expect(favorites).toEqual(['1', '5', '1W']);
    expect(readPayload(storage)).toEqual({
      version: INTERVAL_FAVORITES_SCHEMA_VERSION,
      favorites: ['1', '5', '1W'],
    });
  });

  it('falls back to defaults for unsupported schema versions', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      INTERVAL_FAVORITES_STORAGE_KEY,
      JSON.stringify({
        version: 999,
        favorites: ['1W'],
      }),
    );

    const favorites = readIntervalFavorites(AVAILABLE_INTERVALS, storage);

    expect(favorites).toEqual(['1', '5', '15', '60']);
  });

  it('writes normalized favorites and keeps explicit empty favorites arrays', () => {
    const storage = new MemoryStorage();

    expect(writeIntervalFavorites(['1D', 'invalid', '5', '5'], AVAILABLE_INTERVALS, storage)).toEqual(['5', '1D']);
    expect(writeIntervalFavorites([], AVAILABLE_INTERVALS, storage)).toEqual([]);
    expect(readPayload(storage)).toEqual({
      version: INTERVAL_FAVORITES_SCHEMA_VERSION,
      favorites: [],
    });
  });

  it('normalizes object payloads and falls back when no valid intervals remain', () => {
    expect(normalizeIntervalFavorites({ favorites: ['60', '15'] }, AVAILABLE_INTERVALS)).toEqual(['15', '60']);
    expect(normalizeIntervalFavorites({ favorites: ['invalid'] }, AVAILABLE_INTERVALS)).toEqual(['1', '5', '15', '60']);
  });
});
