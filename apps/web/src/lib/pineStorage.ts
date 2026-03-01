export const PINE_WORKSPACE_STORAGE_KEY = 'tradingservice.pine.workspace.v1';
export const PINE_WORKSPACE_SCHEMA_VERSION = 1;
export const DEFAULT_PINE_SCRIPT_NAME = 'New Script';
export const DEFAULT_PINE_SCRIPT_REVISION = 1;
export const PINE_SCRIPT_NAME_MAX_LENGTH = 80;
export const PINE_SCRIPT_SOURCE_MAX_LENGTH = 50 * 1024;
export const DEFAULT_PINE_SCRIPT_SOURCE =
  '//@version=5\n' +
  'indicator("New Script", overlay=true)\n' +
  'plot(close, color=color.new(color.aqua, 0), title="Close")\n';

type PineWorkspacePayloadV1 = {
  version: typeof PINE_WORKSPACE_SCHEMA_VERSION;
  scripts: PineScript[];
  activeScriptId: string | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type PineScript = {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
};

export type PineWorkspaceState = {
  scripts: PineScript[];
  activeScriptId: string | null;
};

export type PineWorkspaceReadResult = {
  state: PineWorkspaceState;
  error: string | null;
};

export type PineWorkspaceWriteResult = {
  state: PineWorkspaceState;
  error: string | null;
};

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeGetItem(storage: StorageLike, key: string): { value: string | null; failed: boolean } {
  try {
    return { value: storage.getItem(key), failed: false };
  } catch {
    return { value: null, failed: true };
  }
}

function safeSetItem(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function clampTextLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

export function clampPineScriptName(name: string): string {
  const normalized = name.trim();
  if (!normalized) return '';
  return clampTextLength(normalized, PINE_SCRIPT_NAME_MAX_LENGTH).trimEnd();
}

export function isPineScriptNameOverLimit(name: string): boolean {
  return name.trim().length > PINE_SCRIPT_NAME_MAX_LENGTH;
}

export function clampPineScriptSource(source: string): string {
  return clampTextLength(source, PINE_SCRIPT_SOURCE_MAX_LENGTH);
}

export function isPineScriptSourceOverLimit(source: string): boolean {
  return source.length > PINE_SCRIPT_SOURCE_MAX_LENGTH;
}

export function getPineEditorGuardrailWarnings(name: string, source: string): string[] {
  const warnings: string[] = [];
  if (isPineScriptNameOverLimit(name)) {
    warnings.push(`이름이 ${PINE_SCRIPT_NAME_MAX_LENGTH}자를 넘어 저장 시 잘립니다.`);
  }
  if (isPineScriptSourceOverLimit(source)) {
    warnings.push(`스크립트가 50KB(${PINE_SCRIPT_SOURCE_MAX_LENGTH.toLocaleString('en-US')}자) 제한을 넘어 저장 시 잘립니다.`);
  }
  return warnings;
}

function normalizeScriptName(name: unknown, fallback: string): string {
  if (typeof name === 'string') {
    const normalized = clampPineScriptName(name);
    if (normalized.length > 0) return normalized;
  }

  const fallbackName = clampPineScriptName(fallback);
  if (fallbackName.length > 0) return fallbackName;
  return DEFAULT_PINE_SCRIPT_NAME.slice(0, PINE_SCRIPT_NAME_MAX_LENGTH);
}

function normalizeScriptSource(source: unknown): string {
  if (typeof source === 'string') return clampPineScriptSource(source);
  return clampPineScriptSource(DEFAULT_PINE_SCRIPT_SOURCE);
}

function normalizeRevision(value: unknown, fallback = DEFAULT_PINE_SCRIPT_REVISION): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= DEFAULT_PINE_SCRIPT_REVISION) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= DEFAULT_PINE_SCRIPT_REVISION) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function toStableFallbackScriptId(baseId: string, usedIds: Set<string>, fallbackIndex: number): string {
  const normalizedBase = baseId.trim() || `script-${fallbackIndex + 1}`;
  if (!usedIds.has(normalizedBase)) return normalizedBase;

  let suffix = 2;
  let candidate = `${normalizedBase}-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${normalizedBase}-${suffix}`;
  }

  return candidate;
}

function normalizeScripts(value: unknown, now: number): PineScript[] {
  if (!Array.isArray(value)) return [];

  const scripts: PineScript[] = [];
  const usedIds = new Set<string>();

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;

    const parsed = entry as {
      id?: unknown;
      name?: unknown;
      source?: unknown;
      content?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
      revision?: unknown;
    };

    const rawId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    const id = toStableFallbackScriptId(rawId, usedIds, index);
    usedIds.add(id);

    const fallbackName = `Script ${scripts.length + 1}`;
    const name = normalizeScriptName(parsed.name, fallbackName);
    const source = normalizeScriptSource(parsed.source ?? parsed.content);
    const createdAt = normalizeTimestamp(parsed.createdAt, now);
    const updatedAt = Math.max(createdAt, normalizeTimestamp(parsed.updatedAt, createdAt));
    const revision = normalizeRevision(parsed.revision);

    scripts.push({
      id,
      name,
      source,
      createdAt,
      updatedAt,
      revision,
    });
  });

  return scripts;
}

function normalizeActiveScriptId(activeScriptId: unknown, scripts: PineScript[]): string | null {
  if (typeof activeScriptId === 'string') {
    const normalized = activeScriptId.trim();
    if (normalized.length > 0 && scripts.some((script) => script.id === normalized)) {
      return normalized;
    }
  }

  return scripts.length > 0 ? scripts[0].id : null;
}

function toPayload(state: PineWorkspaceState): PineWorkspacePayloadV1 {
  return {
    version: PINE_WORKSPACE_SCHEMA_VERSION,
    scripts: state.scripts.map((script) => ({ ...script })),
    activeScriptId: state.activeScriptId,
  };
}

function resolveRetainedActiveScriptId(
  scripts: PineScript[],
  previousActiveScriptId: string | null,
  preferredActiveScriptId: string | null = null,
): string | null {
  return normalizeActiveScriptId(preferredActiveScriptId ?? previousActiveScriptId, scripts);
}

function createUniquePineScriptId(now: number, scripts: readonly PineScript[]): string {
  const usedIds = new Set(scripts.map((script) => script.id));
  let nextId = createPineScriptId(now);
  while (usedIds.has(nextId)) {
    nextId = createPineScriptId(now);
  }
  return nextId;
}

export function createPineScriptId(now = Date.now()): string {
  return `pine_${Math.max(0, Math.floor(now)).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toClampedUniqueName(baseName: string, suffix: string): string {
  const maxBaseLength = Math.max(1, PINE_SCRIPT_NAME_MAX_LENGTH - suffix.length);
  const clampedBase = clampTextLength(baseName, maxBaseLength).trimEnd();
  const normalizedBase = clampedBase.length > 0 ? clampedBase : DEFAULT_PINE_SCRIPT_NAME.slice(0, maxBaseLength);
  return `${normalizedBase}${suffix}`;
}

export function createUniquePineScriptName(desiredName: string, scripts: readonly PineScript[]): string {
  const baseName = normalizeScriptName(desiredName, DEFAULT_PINE_SCRIPT_NAME);
  const normalizedNameSet = new Set(scripts.map((script) => script.name.toLowerCase()));

  if (!normalizedNameSet.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  let candidate = toClampedUniqueName(baseName, ` (${suffix})`);
  while (normalizedNameSet.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = toClampedUniqueName(baseName, ` (${suffix})`);
  }

  return candidate;
}

export function getDefaultPineWorkspaceState(): PineWorkspaceState {
  return {
    scripts: [],
    activeScriptId: null,
  };
}

export function normalizePineWorkspace(value: unknown, now = Date.now()): PineWorkspaceState {
  if (Array.isArray(value)) {
    const scripts = normalizeScripts(value, now);
    return {
      scripts,
      activeScriptId: normalizeActiveScriptId(null, scripts),
    };
  }

  if (!value || typeof value !== 'object') {
    return getDefaultPineWorkspaceState();
  }

  const parsed = value as {
    version?: unknown;
    scripts?: unknown;
    activeScriptId?: unknown;
  };

  if (parsed.version !== undefined && parsed.version !== null && parsed.version !== PINE_WORKSPACE_SCHEMA_VERSION) {
    return getDefaultPineWorkspaceState();
  }

  const scripts = normalizeScripts(parsed.scripts, now);
  return {
    scripts,
    activeScriptId: normalizeActiveScriptId(parsed.activeScriptId, scripts),
  };
}

export function setActivePineScript(workspace: PineWorkspaceState, scriptId: string | null): PineWorkspaceState {
  const normalizedWorkspace = normalizePineWorkspace(workspace);

  if (scriptId === null) {
    return {
      scripts: normalizedWorkspace.scripts,
      activeScriptId: null,
    };
  }

  const normalizedId = scriptId.trim();
  if (!normalizedId || !normalizedWorkspace.scripts.some((script) => script.id === normalizedId)) {
    return normalizedWorkspace;
  }

  return {
    scripts: normalizedWorkspace.scripts,
    activeScriptId: normalizedId,
  };
}

export function upsertPineScript(workspace: PineWorkspaceState, script: PineScript, now = Date.now()): PineWorkspaceState {
  const normalizedWorkspace = normalizePineWorkspace(workspace, now);
  const normalizedId = typeof script.id === 'string' && script.id.trim().length > 0 ? script.id.trim() : createPineScriptId(now);
  const existing = normalizedWorkspace.scripts.find((item) => item.id === normalizedId);
  const createdAt = normalizeTimestamp(script.createdAt, existing?.createdAt ?? now);
  const updatedAt = Math.max(createdAt, normalizeTimestamp(script.updatedAt, now));
  const revision = existing ? existing.revision + 1 : DEFAULT_PINE_SCRIPT_REVISION;
  const nextScript: PineScript = {
    id: normalizedId,
    name: normalizeScriptName(script.name, existing?.name ?? DEFAULT_PINE_SCRIPT_NAME),
    source: normalizeScriptSource(script.source),
    createdAt,
    updatedAt,
    revision,
  };

  const remaining = normalizedWorkspace.scripts.filter((item) => item.id !== normalizedId);
  return normalizePineWorkspace(
    {
      version: PINE_WORKSPACE_SCHEMA_VERSION,
      scripts: [nextScript, ...remaining],
      activeScriptId: normalizedId,
    },
    now,
  );
}

type RenamePineScriptOptions = {
  now?: number;
  sourceOverride?: string;
};

export function renamePineScript(
  workspace: PineWorkspaceState,
  scriptId: string,
  desiredName: string,
  options: RenamePineScriptOptions = {},
): PineWorkspaceState {
  const now = options.now ?? Date.now();
  const normalizedWorkspace = normalizePineWorkspace(workspace, now);
  const normalizedId = scriptId.trim();
  if (!normalizedId) return normalizedWorkspace;

  const targetScript = normalizedWorkspace.scripts.find((script) => script.id === normalizedId);
  if (!targetScript) return normalizedWorkspace;

  const nameReservedByOthers = normalizedWorkspace.scripts.filter((script) => script.id !== normalizedId);
  const nextName = createUniquePineScriptName(desiredName, nameReservedByOthers);
  const nextSource =
    options.sourceOverride === undefined ? targetScript.source : normalizeScriptSource(options.sourceOverride);
  const sourceChanged = nextSource !== targetScript.source;
  const nameChanged = nextName !== targetScript.name;

  if (!sourceChanged && !nameChanged) {
    return normalizedWorkspace;
  }

  const updatedAt = Math.max(targetScript.createdAt, now);
  const revision = sourceChanged ? targetScript.revision + 1 : targetScript.revision;
  const scripts = normalizedWorkspace.scripts.map((script) =>
    script.id === normalizedId
      ? {
          ...script,
          name: nextName,
          source: nextSource,
          updatedAt,
          revision,
        }
      : script,
  );
  const activeScriptId = resolveRetainedActiveScriptId(scripts, normalizedWorkspace.activeScriptId);

  return normalizePineWorkspace(
    {
      version: PINE_WORKSPACE_SCHEMA_VERSION,
      scripts,
      activeScriptId,
    },
    now,
  );
}

type DuplicatePineScriptOptions = {
  now?: number;
  nameBase?: string;
  sourceOverride?: string;
};

export function duplicatePineScript(
  workspace: PineWorkspaceState,
  scriptId: string,
  options: DuplicatePineScriptOptions = {},
): PineWorkspaceState {
  const now = options.now ?? Date.now();
  const normalizedWorkspace = normalizePineWorkspace(workspace, now);
  const normalizedId = scriptId.trim();
  if (!normalizedId) return normalizedWorkspace;

  const sourceScript = normalizedWorkspace.scripts.find((script) => script.id === normalizedId);
  if (!sourceScript) return normalizedWorkspace;
  const sourceIndex = normalizedWorkspace.scripts.findIndex((script) => script.id === normalizedId);
  if (sourceIndex < 0) return normalizedWorkspace;

  const duplicateId = createUniquePineScriptId(now, normalizedWorkspace.scripts);
  const duplicateNameBase = `${normalizeScriptName(options.nameBase, sourceScript.name)} Copy`;
  const duplicateScript: PineScript = {
    id: duplicateId,
    name: createUniquePineScriptName(duplicateNameBase, normalizedWorkspace.scripts),
    source: options.sourceOverride === undefined ? sourceScript.source : normalizeScriptSource(options.sourceOverride),
    createdAt: now,
    updatedAt: now,
    revision: DEFAULT_PINE_SCRIPT_REVISION,
  };
  const scripts = [
    ...normalizedWorkspace.scripts.slice(0, sourceIndex),
    duplicateScript,
    ...normalizedWorkspace.scripts.slice(sourceIndex),
  ];
  const activeScriptId = resolveRetainedActiveScriptId(scripts, normalizedWorkspace.activeScriptId, duplicateScript.id);

  return normalizePineWorkspace(
    {
      version: PINE_WORKSPACE_SCHEMA_VERSION,
      scripts,
      activeScriptId,
    },
    now,
  );
}

export function deletePineScript(workspace: PineWorkspaceState, scriptId: string, now = Date.now()): PineWorkspaceState {
  const normalizedWorkspace = normalizePineWorkspace(workspace, now);
  const normalizedId = scriptId.trim();
  if (!normalizedId) return normalizedWorkspace;
  const removedIndex = normalizedWorkspace.scripts.findIndex((script) => script.id === normalizedId);
  if (removedIndex < 0) return normalizedWorkspace;

  const scripts = normalizedWorkspace.scripts.filter((script) => script.id !== normalizedId);
  const preferredActiveScriptId =
    normalizedWorkspace.activeScriptId === normalizedId
      ? scripts[Math.min(removedIndex, Math.max(0, scripts.length - 1))]?.id ?? null
      : normalizedWorkspace.activeScriptId;
  const activeScriptId = resolveRetainedActiveScriptId(
    scripts,
    normalizedWorkspace.activeScriptId,
    preferredActiveScriptId,
  );

  return normalizePineWorkspace(
    {
      version: PINE_WORKSPACE_SCHEMA_VERSION,
      scripts,
      activeScriptId,
    },
    now,
  );
}

export function filterPineScriptsByName(scripts: readonly PineScript[], query: string): PineScript[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...scripts];
  }

  return scripts.filter((script) => script.name.toLowerCase().includes(normalizedQuery));
}

export function readPineWorkspace(storage?: StorageLike | null): PineWorkspaceReadResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return {
      state: getDefaultPineWorkspaceState(),
      error: null,
    };
  }

  const rawResult = safeGetItem(resolvedStorage, PINE_WORKSPACE_STORAGE_KEY);
  if (rawResult.failed) {
    return {
      state: getDefaultPineWorkspaceState(),
      error: 'Pine 저장소 읽기에 실패해 기본 상태로 복구했습니다.',
    };
  }

  if (typeof rawResult.value !== 'string') {
    return {
      state: getDefaultPineWorkspaceState(),
      error: null,
    };
  }

  const parsed = parseJson(rawResult.value);
  if (!parsed) {
    return {
      state: getDefaultPineWorkspaceState(),
      error: '저장된 Pine 데이터가 손상되어 기본 상태로 복구했습니다.',
    };
  }

  const normalized = normalizePineWorkspace(parsed);
  const persisted = safeSetItem(resolvedStorage, PINE_WORKSPACE_STORAGE_KEY, JSON.stringify(toPayload(normalized)));
  return {
    state: normalized,
    error: persisted ? null : 'Pine 저장소 갱신에 실패했습니다. 이번 세션에서만 유지됩니다.',
  };
}

export function writePineWorkspace(state: PineWorkspaceState, storage?: StorageLike | null): PineWorkspaceWriteResult {
  const normalized = normalizePineWorkspace(state);
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return {
      state: normalized,
      error: null,
    };
  }

  const persisted = safeSetItem(resolvedStorage, PINE_WORKSPACE_STORAGE_KEY, JSON.stringify(toPayload(normalized)));
  return {
    state: normalized,
    error: persisted ? null : 'Pine 저장소 저장에 실패했습니다. 이번 세션에서만 유지됩니다.',
  };
}
