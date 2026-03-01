import { describe, expect, it } from 'vitest';
import {
  PINE_SCRIPT_NAME_MAX_LENGTH,
  PINE_SCRIPT_SOURCE_MAX_LENGTH,
  PINE_WORKSPACE_SCHEMA_VERSION,
  PINE_WORKSPACE_STORAGE_KEY,
  clampPineScriptName,
  clampPineScriptSource,
  createUniquePineScriptName,
  duplicatePineScript,
  deletePineScript,
  filterPineScriptsByName,
  getDefaultPineWorkspaceState,
  normalizePineWorkspace,
  readPineWorkspace,
  renamePineScript,
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

  it('migrates legacy script entries that do not include revision metadata', () => {
    const now = 1_700_000_000_000;
    const storage = new MemoryStorage();
    storage.setItem(
      PINE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: PINE_WORKSPACE_SCHEMA_VERSION,
        scripts: [{ id: 'legacy', name: 'Legacy', content: 'plot(close)', createdAt: now, updatedAt: now + 1_000 }],
        activeScriptId: 'legacy',
      }),
    );

    const result = readPineWorkspace(storage);
    expect(result.error).toBeNull();
    expect(result.state).toEqual({
      scripts: [
        {
          id: 'legacy',
          name: 'Legacy',
          source: 'plot(close)',
          createdAt: now,
          updatedAt: now + 1_000,
          revision: 1,
        },
      ],
      activeScriptId: 'legacy',
    });
    expect(readPayload(storage)).toEqual({
      version: PINE_WORKSPACE_SCHEMA_VERSION,
      scripts: [
        {
          id: 'legacy',
          name: 'Legacy',
          source: 'plot(close)',
          createdAt: now,
          updatedAt: now + 1_000,
          revision: 1,
        },
      ],
      activeScriptId: 'legacy',
    });
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
        revision: 1,
      },
      baseNow,
    );

    expect(workspace.activeScriptId).toBe('script-a');
    expect(workspace.scripts).toHaveLength(1);
    expect(workspace.scripts[0].revision).toBe(1);

    workspace = upsertPineScript(
      workspace,
      {
        id: 'script-a',
        name: 'Alpha',
        source: 'plot(open)',
        createdAt: baseNow,
        updatedAt: baseNow + 1000,
        revision: 1,
      },
      baseNow + 1000,
    );

    expect(workspace.scripts[0].source).toBe('plot(open)');
    expect(workspace.scripts[0].updatedAt).toBe(baseNow + 1000);
    expect(workspace.scripts[0].createdAt).toBe(baseNow);
    expect(workspace.scripts[0].revision).toBe(2);

    workspace = upsertPineScript(
      workspace,
      {
        id: 'script-b',
        name: 'Beta',
        source: 'plot(volume)',
        createdAt: baseNow + 2000,
        updatedAt: baseNow + 2000,
        revision: 99,
      },
      baseNow + 2000,
    );

    expect(workspace.activeScriptId).toBe('script-b');
    expect(workspace.scripts.map((script) => script.id)).toEqual(['script-b', 'script-a']);
    expect(workspace.scripts[0].revision).toBe(1);

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
          revision: 2,
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
        { id: 'first', name: 'First', source: 'a', createdAt: now, updatedAt: now, revision: 1 },
        { id: 'second', name: 'Second', source: 'b', createdAt: now + 1, updatedAt: now + 1, revision: 1 },
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
        { id: 'one', name: 'Alpha', source: 'plot(close)', createdAt: 1, updatedAt: 1, revision: 1 },
        { id: 'two', name: 'Alpha (2)', source: 'plot(open)', createdAt: 2, updatedAt: 2, revision: 1 },
      ],
      activeScriptId: 'one',
    });

    expect(createUniquePineScriptName('Alpha', workspace.scripts)).toBe('Alpha (3)');
    expect(setActivePineScript(workspace, 'two').activeScriptId).toBe('two');
    expect(setActivePineScript(workspace, 'missing').activeScriptId).toBe('one');
  });

  it('keeps active selection deterministic across rename/duplicate/delete helpers', () => {
    const now = 1_700_000_500_000;
    let workspace = normalizePineWorkspace(
      {
        version: 1,
        scripts: [
          { id: 'one', name: 'One', source: 'plot(close)', createdAt: now, updatedAt: now, revision: 1 },
          { id: 'two', name: 'Two', source: 'plot(open)', createdAt: now + 1, updatedAt: now + 1, revision: 1 },
          { id: 'three', name: 'Three', source: 'plot(high)', createdAt: now + 2, updatedAt: now + 2, revision: 1 },
        ],
        activeScriptId: 'two',
      },
      now,
    );

    workspace = renamePineScript(workspace, 'one', 'One Renamed', { now: now + 10 });
    expect(workspace.activeScriptId).toBe('two');
    expect(workspace.scripts.find((script) => script.id === 'one')?.name).toBe('One Renamed');

    workspace = duplicatePineScript(workspace, 'two', { now: now + 20 });
    expect(workspace.activeScriptId).toBeTruthy();
    const duplicateScriptId = workspace.activeScriptId ?? '';
    const duplicate = workspace.scripts.find((script) => script.id === duplicateScriptId);
    expect(duplicate?.name).toBe('Two Copy');
    expect(duplicate?.revision).toBe(1);

    workspace = deletePineScript(workspace, duplicateScriptId, now + 30);
    expect(workspace.activeScriptId).toBe('two');

    workspace = deletePineScript(workspace, 'two', now + 40);
    expect(workspace.activeScriptId).toBe('three');
  });

  it('applies name/source guardrails consistently across save/rename/duplicate flows', () => {
    const now = 1_700_000_700_000;
    const overLongName = `Guardrail-${'n'.repeat(PINE_SCRIPT_NAME_MAX_LENGTH + 20)}`;
    const overLongSource = `plot(close)\n${'a'.repeat(PINE_SCRIPT_SOURCE_MAX_LENGTH + 100)}`;

    let workspace = upsertPineScript(
      getDefaultPineWorkspaceState(),
      {
        id: 'guarded',
        name: overLongName,
        source: overLongSource,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
      now,
    );

    const saved = workspace.scripts.find((script) => script.id === 'guarded');
    expect(saved).toBeTruthy();
    expect(saved?.name).toBe(clampPineScriptName(overLongName));
    expect(saved?.name.length).toBeLessThanOrEqual(PINE_SCRIPT_NAME_MAX_LENGTH);
    expect(saved?.source).toBe(clampPineScriptSource(overLongSource));
    expect(saved?.source.length).toBe(PINE_SCRIPT_SOURCE_MAX_LENGTH);

    workspace = renamePineScript(workspace, 'guarded', overLongName, {
      now: now + 10,
      sourceOverride: overLongSource,
    });
    const renamed = workspace.scripts.find((script) => script.id === 'guarded');
    expect(renamed?.name.length).toBeLessThanOrEqual(PINE_SCRIPT_NAME_MAX_LENGTH);
    expect(renamed?.source.length).toBeLessThanOrEqual(PINE_SCRIPT_SOURCE_MAX_LENGTH);

    workspace = duplicatePineScript(workspace, 'guarded', {
      now: now + 20,
      nameBase: overLongName,
      sourceOverride: overLongSource,
    });
    const duplicated = workspace.activeScriptId ? workspace.scripts.find((script) => script.id === workspace.activeScriptId) : null;
    expect(duplicated).toBeTruthy();
    expect(duplicated?.name.length).toBeLessThanOrEqual(PINE_SCRIPT_NAME_MAX_LENGTH);
    expect(duplicated?.source.length).toBeLessThanOrEqual(PINE_SCRIPT_SOURCE_MAX_LENGTH);
  });

  it('keeps generated unique names within max length', () => {
    const baseName = 'A'.repeat(PINE_SCRIPT_NAME_MAX_LENGTH);
    const first = normalizePineWorkspace({
      version: 1,
      scripts: [{ id: 'one', name: baseName, source: 'a', createdAt: 1, updatedAt: 1, revision: 1 }],
      activeScriptId: 'one',
    });

    const generated = createUniquePineScriptName(baseName, first.scripts);
    expect(generated.length).toBeLessThanOrEqual(PINE_SCRIPT_NAME_MAX_LENGTH);
    expect(generated).not.toBe(baseName);
  });

  it('filters scripts by name case-insensitively', () => {
    const workspace = normalizePineWorkspace({
      version: 1,
      scripts: [
        { id: 'one', name: 'Alpha Trend', source: 'a', createdAt: 1, updatedAt: 1, revision: 1 },
        { id: 'two', name: 'Beta Mean Reversion', source: 'b', createdAt: 2, updatedAt: 2, revision: 1 },
        { id: 'three', name: 'Alpha Breakout', source: 'c', createdAt: 3, updatedAt: 3, revision: 1 },
      ],
      activeScriptId: 'one',
    });

    expect(filterPineScriptsByName(workspace.scripts, 'alpha').map((script) => script.id)).toEqual(['one', 'three']);
    expect(filterPineScriptsByName(workspace.scripts, '  ')).toHaveLength(3);
  });
});
