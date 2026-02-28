import { describe, expect, it } from 'vitest';
import {
  LEGACY_CHART_LAYOUT_STORAGE_KEY,
  UNIFIED_LAYOUT_SCHEMA_VERSION,
  UNIFIED_LAYOUT_STORAGE_KEY,
  getDefaultUnifiedLayoutState,
  readUnifiedLayoutState,
  writeUnifiedLayoutState,
} from './layoutPersistence';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

function readUnifiedPayload(storage: MemoryStorage): unknown {
  const raw = storage.getItem(UNIFIED_LAYOUT_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as unknown) : null;
}

describe('layout persistence', () => {
  it('migrates legacy chart-layout key into the current unified schema', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_CHART_LAYOUT_STORAGE_KEY, 'split');

    const state = readUnifiedLayoutState(storage);

    expect(state).toEqual({ chartLayoutMode: 'split' });
    expect(storage.getItem(LEGACY_CHART_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(readUnifiedPayload(storage)).toEqual({
      version: UNIFIED_LAYOUT_SCHEMA_VERSION,
      chart: { layoutMode: 'split' },
    });
  });

  it('migrates unified schema v1 payloads to the current schema', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      UNIFIED_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        layoutMode: 'split',
      }),
    );

    const state = readUnifiedLayoutState(storage);

    expect(state).toEqual({ chartLayoutMode: 'split' });
    expect(readUnifiedPayload(storage)).toEqual({
      version: UNIFIED_LAYOUT_SCHEMA_VERSION,
      chart: { layoutMode: 'split' },
    });
  });

  it('falls back to defaults for invalid unified payload JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(UNIFIED_LAYOUT_STORAGE_KEY, '{not-json');

    expect(readUnifiedLayoutState(storage)).toEqual(getDefaultUnifiedLayoutState());
  });

  it('falls back to defaults for unsupported schema versions', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      UNIFIED_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 999,
        chart: { layoutMode: 'split' },
      }),
    );

    expect(readUnifiedLayoutState(storage)).toEqual(getDefaultUnifiedLayoutState());
  });

  it('writes the current schema payload and clears the legacy key', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_CHART_LAYOUT_STORAGE_KEY, 'split');

    writeUnifiedLayoutState({ chartLayoutMode: 'single' }, storage);

    expect(storage.getItem(LEGACY_CHART_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(readUnifiedPayload(storage)).toEqual({
      version: UNIFIED_LAYOUT_SCHEMA_VERSION,
      chart: { layoutMode: 'single' },
    });
  });
});
