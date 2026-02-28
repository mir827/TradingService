import { describe, expect, it } from 'vitest';
import {
  PINE_WORKSPACE_SCHEMA_VERSION,
  PINE_WORKSPACE_STORAGE_KEY,
  createUniquePineScriptName,
  deletePineScript,
  getDefaultPineWorkspaceState,
  normalizePineWorkspace,
  readPineWorkspace,
  setActivePineScript,
  upsertPineScript,
  writePineWorkspace,
  type PineWorkspaceState,
} from './pineStorage';

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
  const raw = storage.getItem(PINE_WORKSPACE_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as unknown) : null;
}

describe('pine workspace persistence', () => {
  it('falls back safely for empty and corrupt payloads', () => {
    const emptyStorage = new MemoryStorage();
    expect(readPineWorkspace(emptyStorage)).toEqual({
      state: getDefaultPineWorkspaceState(),
      error: null,
    });

    const corruptStorage = new MemoryStorage();
    corruptStorage.setItem(PINE_WORKSPACE_STORAGE_KEY, '{not-json');
    const corruptResult = readPineWorkspace(corruptStorage);
    expect(corruptResult.state).toEqual(getDefaultPineWorkspaceState());
    expect(corruptResult.error).toBeTruthy();
  });

  it('supports save/update/delete behavior with deterministic active-script updates', () => {
    const baseNow = 1_700_000_000_000;
    let workspace: PineWorkspaceState = getDefaultPineWorkspaceState();

    workspace = upsertPineScript(
      workspace,
      {
        id: 'script-a',
        name: 'Alpha',
        source: 'plot(close)',
        createdAt: baseNow,
        updatedAt: baseNow,
      },
      baseNow,
    );

    expect(workspace.activeScriptId).toBe('script-a');
    expect(workspace.scripts).toHaveLength(1);

    workspace = upsertPineScript(
      workspace,
      {
        id: 'script-a',
        name: 'Alpha',
        source: 'plot(open)',
        createdAt: baseNow,
        updatedAt: baseNow + 1000,
      },
      baseNow + 1000,
    );

    expect(workspace.scripts[0].source).toBe('plot(open)');
    expect(workspace.scripts[0].updatedAt).toBe(baseNow + 1000);
    expect(workspace.scripts[0].createdAt).toBe(baseNow);

    workspace = upsertPineScript(
      workspace,
      {
        id: 'script-b',
        name: 'Beta',
        source: 'plot(volume)',
        createdAt: baseNow + 2000,
        updatedAt: baseNow + 2000,
      },
      baseNow + 2000,
    );

    expect(workspace.activeScriptId).toBe('script-b');
    expect(workspace.scripts.map((script) => script.id)).toEqual(['script-b', 'script-a']);

    workspace = deletePineScript(workspace, 'script-b', baseNow + 3000);
    expect(workspace.scripts.map((script) => script.id)).toEqual(['script-a']);
    expect(workspace.activeScriptId).toBe('script-a');

    const storage = new MemoryStorage();
    const writeResult = writePineWorkspace(workspace, storage);
    expect(writeResult.error).toBeNull();
    expect(readPayload(storage)).toEqual({
      version: PINE_WORKSPACE_SCHEMA_VERSION,
      scripts: [
        {
          id: 'script-a',
          name: 'Alpha',
          source: 'plot(open)',
          createdAt: baseNow,
          updatedAt: baseNow + 1000,
        },
      ],
      activeScriptId: 'script-a',
    });
  });

  it('restores active script using explicit id, then falls back to first script when invalid', () => {
    const now = 1_700_000_100_000;
    const payload = {
      version: 1,
      scripts: [
        { id: 'first', name: 'First', source: 'a', createdAt: now, updatedAt: now },
        { id: 'second', name: 'Second', source: 'b', createdAt: now + 1, updatedAt: now + 1 },
      ],
      activeScriptId: 'second',
    };

    const explicit = normalizePineWorkspace(payload, now);
    expect(explicit.activeScriptId).toBe('second');

    const invalid = normalizePineWorkspace({ ...payload, activeScriptId: 'missing' }, now);
    expect(invalid.activeScriptId).toBe('first');

    const missing = normalizePineWorkspace({ ...payload, activeScriptId: null }, now);
    expect(missing.activeScriptId).toBe('first');
  });

  it('normalizes active selection helper and unique naming helper', () => {
    const workspace = normalizePineWorkspace({
      version: 1,
      scripts: [
        { id: 'one', name: 'Alpha', source: 'plot(close)', createdAt: 1, updatedAt: 1 },
        { id: 'two', name: 'Alpha (2)', source: 'plot(open)', createdAt: 2, updatedAt: 2 },
      ],
      activeScriptId: 'one',
    });

    expect(createUniquePineScriptName('Alpha', workspace.scripts)).toBe('Alpha (3)');
    expect(setActivePineScript(workspace, 'two').activeScriptId).toBe('two');
    expect(setActivePineScript(workspace, 'missing').activeScriptId).toBe('one');
  });
});
