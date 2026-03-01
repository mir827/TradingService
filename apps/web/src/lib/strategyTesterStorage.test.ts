import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_TESTER_FORM,
  STRATEGY_TESTER_STORAGE_KEY,
  normalizeStrategyTesterForm,
  readStrategyTesterForm,
  writeStrategyTesterForm,
} from './strategyTesterStorage';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function writeRawPayload(storage: MemoryStorage, payload: unknown) {
  storage.setItem(STRATEGY_TESTER_STORAGE_KEY, JSON.stringify(payload));
}

describe('strategy tester storage', () => {
  it('migrates legacy payloads without linked-script fields', () => {
    const storage = new MemoryStorage();
    writeRawPayload(storage, {
      symbol: 'ethusdt',
      interval: '240',
      feeBps: 7,
      fastPeriod: '10',
      slowPeriod: '30',
    });

    const result = readStrategyTesterForm(storage);

    expect(result.symbol).toBe('ETHUSDT');
    expect(result.interval).toBe('240');
    expect(result.feeUnit).toBe('bps');
    expect(result.feeValue).toBe('7');
    expect(result.fastPeriod).toBe('10');
    expect(result.slowPeriod).toBe('30');
    expect(result.linkedScript).toBeNull();
  });

  it('loads optional linked-script fields when valid', () => {
    const storage = new MemoryStorage();
    writeRawPayload(storage, {
      ...DEFAULT_STRATEGY_TESTER_FORM,
      symbol: 'btcusdt',
      linkedScript: {
        scriptId: 'pine_abc123',
        scriptName: 'EMA Cross',
        revision: 4,
      },
    });

    const result = readStrategyTesterForm(storage);

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.linkedScript).toEqual({
      scriptId: 'pine_abc123',
      scriptName: 'EMA Cross',
      revision: 4,
    });
  });

  it('loads optional linked-script warning metadata when present', () => {
    const storage = new MemoryStorage();
    writeRawPayload(storage, {
      ...DEFAULT_STRATEGY_TESTER_FORM,
      linkedScript: {
        scriptId: 'pine_warn_1',
        scriptName: 'Warn Script',
        revision: 3,
        warningCount: 2,
      },
    });

    const result = readStrategyTesterForm(storage);

    expect(result.linkedScript).toEqual({
      scriptId: 'pine_warn_1',
      scriptName: 'Warn Script',
      revision: 3,
      warningCount: 2,
    });
  });

  it('ignores invalid linked-script values safely', () => {
    const parsed = normalizeStrategyTesterForm({
      ...DEFAULT_STRATEGY_TESTER_FORM,
      linkedScript: {
        scriptId: '  ',
        scriptName: 'Test',
        revision: 0,
      },
    });

    expect(parsed.linkedScript).toBeNull();
  });

  it('ignores invalid linked-script warning metadata safely', () => {
    const parsed = normalizeStrategyTesterForm({
      ...DEFAULT_STRATEGY_TESTER_FORM,
      linkedScript: {
        scriptId: 'pine_warn_2',
        scriptName: 'Warn 2',
        revision: 2,
        warningCount: 0,
      },
    });

    expect(parsed.linkedScript).toEqual({
      scriptId: 'pine_warn_2',
      scriptName: 'Warn 2',
      revision: 2,
    });
  });

  it('writes normalized payload including linked-script context', () => {
    const storage = new MemoryStorage();

    writeStrategyTesterForm(
      {
        ...DEFAULT_STRATEGY_TESTER_FORM,
        symbol: 'xrpusdt',
        linkedScript: {
          scriptId: 'pine_linked_1',
          scriptName: 'Linked',
          revision: 2,
        },
      },
      storage,
    );

    const written = storage.getItem(STRATEGY_TESTER_STORAGE_KEY);
    expect(written).toBeTruthy();
    expect(JSON.parse(written ?? '{}')).toMatchObject({
      symbol: 'XRPUSDT',
      linkedScript: {
        scriptId: 'pine_linked_1',
        scriptName: 'Linked',
        revision: 2,
      },
    });
  });

  it('writes linked-script warning metadata when present', () => {
    const storage = new MemoryStorage();

    writeStrategyTesterForm(
      {
        ...DEFAULT_STRATEGY_TESTER_FORM,
        linkedScript: {
          scriptId: 'pine_warn_write',
          scriptName: 'Warn Write',
          revision: 5,
          warningCount: 3,
        },
      },
      storage,
    );

    const written = storage.getItem(STRATEGY_TESTER_STORAGE_KEY);
    expect(written).toBeTruthy();
    expect(JSON.parse(written ?? '{}')).toMatchObject({
      linkedScript: {
        scriptId: 'pine_warn_write',
        scriptName: 'Warn Write',
        revision: 5,
        warningCount: 3,
      },
    });
  });

  it('keeps backward compatibility for linked-script payloads without warning metadata', () => {
    const parsed = normalizeStrategyTesterForm({
      ...DEFAULT_STRATEGY_TESTER_FORM,
      linkedScript: {
        scriptId: 'pine_legacy',
        scriptName: 'Legacy Linked',
        revision: 1,
      },
    });

    expect(parsed.linkedScript).toEqual({
      scriptId: 'pine_legacy',
      scriptName: 'Legacy Linked',
      revision: 1,
    });
  });
});
