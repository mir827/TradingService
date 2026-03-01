export type OpsTelemetryLevel = 'recoverable' | 'critical';
export type OpsTelemetrySource = 'web' | 'api' | 'alerts' | 'strategy' | 'trading' | 'chart' | 'watchlist';
export type OpsRecoveryStatus = 'attempted' | 'succeeded' | 'failed';
export type OpsTelemetryContextValue = string | number | boolean | null;
export type OpsTelemetryContext = Record<string, OpsTelemetryContextValue>;

export type OpsErrorEvent = {
  id: string;
  level: OpsTelemetryLevel;
  source: OpsTelemetrySource;
  code: string;
  message: string;
  context?: OpsTelemetryContext;
  occurredAt: number;
  recordedAt: number;
};

export type OpsRecoveryEvent = {
  id: string;
  source: OpsTelemetrySource;
  action: string;
  status: OpsRecoveryStatus;
  message?: string;
  errorCode?: string;
  context?: OpsTelemetryContext;
  occurredAt: number;
  recordedAt: number;
};

export type OpsTelemetryFeed = {
  total: number;
  limit: number;
  errors: OpsErrorEvent[];
  recoveryTotal: number;
  recoveryLimit: number;
  recoveries: OpsRecoveryEvent[];
};

export type NormalizedApiOperationError = {
  message: string;
  code: string | null;
  status: number | null;
  level: OpsTelemetryLevel;
  retryable: boolean;
};

const OPS_TELEMETRY_LEVEL_VALUES: OpsTelemetryLevel[] = ['recoverable', 'critical'];
const OPS_TELEMETRY_SOURCE_VALUES: OpsTelemetrySource[] = ['web', 'api', 'alerts', 'strategy', 'trading', 'chart', 'watchlist'];
const OPS_RECOVERY_STATUS_VALUES: OpsRecoveryStatus[] = ['attempted', 'succeeded', 'failed'];

function asTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolvedMax = Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER;
  const boundedFallback = Math.max(min, Math.min(resolvedMax, Math.floor(fallback)));

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(resolvedMax, Math.floor(value)));
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(resolvedMax, Math.floor(parsed)));
    }
  }

  return boundedFallback;
}

export function readApiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;

  const errorValue = (payload as { error?: unknown }).error;
  const errorMessage = asTrimmedString(errorValue);
  if (errorMessage) {
    return errorMessage;
  }

  if (errorValue && typeof errorValue === 'object') {
    const nestedMessage = asTrimmedString((errorValue as { message?: unknown }).message);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return null;
}

export function readApiErrorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;

  const errorValue = (payload as { error?: unknown }).error;
  if (errorValue && typeof errorValue === 'object') {
    const nestedCode = asTrimmedString((errorValue as { code?: unknown }).code);
    if (nestedCode) {
      return nestedCode;
    }
  }

  return null;
}

export function normalizeApiOperationError(input: {
  fallbackMessage: string;
  status?: number | null;
  error?: unknown;
  payload?: unknown;
}): NormalizedApiOperationError {
  const payloadMessage = readApiErrorMessage(input.payload);
  const payloadCode = readApiErrorCode(input.payload);
  const errorMessage =
    input.error instanceof Error && asTrimmedString(input.error.message)
      ? input.error.message.trim()
      : null;

  const status = typeof input.status === 'number' && Number.isFinite(input.status) ? input.status : null;
  const message = payloadMessage ?? errorMessage ?? input.fallbackMessage;
  const code = payloadCode ?? null;
  const level: OpsTelemetryLevel = status !== null && status >= 500 ? 'critical' : 'recoverable';
  const retryable = status === null || status >= 500 || status === 429;

  return {
    message,
    code,
    status,
    level,
    retryable,
  };
}

function normalizeTelemetryCode(code: string, fallbackCode: string) {
  const trimmed = code.trim();
  const normalized = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.length >= 2 && normalized.length <= 64) {
    return normalized;
  }

  return fallbackCode;
}

function sanitizeOpsTelemetryContext(context?: unknown) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return undefined;

  const sanitizedEntries: Array<[string, OpsTelemetryContextValue]> = [];
  for (const [rawKey, rawValue] of Object.entries(context)) {
    const key = rawKey.trim();
    if (!key || key.length > 64) {
      continue;
    }

    if (typeof rawValue === 'string') {
      sanitizedEntries.push([key, rawValue.slice(0, 400)]);
      continue;
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      sanitizedEntries.push([key, rawValue]);
      continue;
    }

    if (typeof rawValue === 'boolean') {
      sanitizedEntries.push([key, rawValue]);
      continue;
    }

    if (rawValue === null) {
      sanitizedEntries.push([key, null]);
    }

    if (sanitizedEntries.length >= 20) {
      break;
    }
  }

  if (!sanitizedEntries.length) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries);
}

function normalizeOpsErrorEvent(value: unknown, index: number): OpsErrorEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as {
    id?: unknown;
    level?: unknown;
    source?: unknown;
    code?: unknown;
    message?: unknown;
    context?: unknown;
    occurredAt?: unknown;
    recordedAt?: unknown;
  };

  const code = normalizeTelemetryCode(asTrimmedString(payload.code), 'UNKNOWN_ERROR');
  const message = asTrimmedString(payload.message) || code;
  const occurredAt = normalizeBoundedInteger(payload.occurredAt, 0, 0, Number.MAX_SAFE_INTEGER);
  const recordedAt = normalizeBoundedInteger(payload.recordedAt, occurredAt, 0, Number.MAX_SAFE_INTEGER);
  const id = asTrimmedString(payload.id) || `ops_error_${index + 1}`;
  const source = OPS_TELEMETRY_SOURCE_VALUES.includes(payload.source as OpsTelemetrySource)
    ? (payload.source as OpsTelemetrySource)
    : 'api';
  const level = OPS_TELEMETRY_LEVEL_VALUES.includes(payload.level as OpsTelemetryLevel)
    ? (payload.level as OpsTelemetryLevel)
    : 'recoverable';
  const context = sanitizeOpsTelemetryContext(payload.context);

  return {
    id,
    level,
    source,
    code,
    message,
    ...(context ? { context } : {}),
    occurredAt,
    recordedAt,
  };
}

function normalizeOpsRecoveryEvent(value: unknown, index: number): OpsRecoveryEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as {
    id?: unknown;
    source?: unknown;
    action?: unknown;
    status?: unknown;
    message?: unknown;
    errorCode?: unknown;
    context?: unknown;
    occurredAt?: unknown;
    recordedAt?: unknown;
  };

  const occurredAt = normalizeBoundedInteger(payload.occurredAt, 0, 0, Number.MAX_SAFE_INTEGER);
  const recordedAt = normalizeBoundedInteger(payload.recordedAt, occurredAt, 0, Number.MAX_SAFE_INTEGER);
  const id = asTrimmedString(payload.id) || `ops_recovery_${index + 1}`;
  const source = OPS_TELEMETRY_SOURCE_VALUES.includes(payload.source as OpsTelemetrySource)
    ? (payload.source as OpsTelemetrySource)
    : 'api';
  const action = asTrimmedString(payload.action).slice(0, 80) || 'recovery';
  const status = OPS_RECOVERY_STATUS_VALUES.includes(payload.status as OpsRecoveryStatus)
    ? (payload.status as OpsRecoveryStatus)
    : 'attempted';
  const message = asTrimmedString(payload.message).slice(0, 400) || undefined;
  const errorCode = asTrimmedString(payload.errorCode)
    ? normalizeTelemetryCode(asTrimmedString(payload.errorCode), 'RECOVERY_ERROR')
    : undefined;
  const context = sanitizeOpsTelemetryContext(payload.context);

  return {
    id,
    source,
    action,
    status,
    ...(message ? { message } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(context ? { context } : {}),
    occurredAt,
    recordedAt,
  };
}

export function normalizeOpsTelemetryFeedPayload(
  payload: unknown,
  options?: {
    limit?: number;
    recoveryLimit?: number;
  },
): OpsTelemetryFeed {
  const parsed =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as {
          total?: unknown;
          limit?: unknown;
          errors?: unknown;
          recoveryTotal?: unknown;
          recoveryLimit?: unknown;
          recoveries?: unknown;
        })
      : {};

  const fallbackLimit = normalizeBoundedInteger(options?.limit, 20, 1, 200);
  const fallbackRecoveryLimit = normalizeBoundedInteger(options?.recoveryLimit, 20, 0, 200);
  const normalizedErrors = Array.isArray(parsed.errors)
    ? parsed.errors
        .map((eventItem, index) => normalizeOpsErrorEvent(eventItem, index))
        .filter((eventItem): eventItem is OpsErrorEvent => eventItem !== null)
    : [];
  const normalizedRecoveries = Array.isArray(parsed.recoveries)
    ? parsed.recoveries
        .map((eventItem, index) => normalizeOpsRecoveryEvent(eventItem, index))
        .filter((eventItem): eventItem is OpsRecoveryEvent => eventItem !== null)
    : [];

  return {
    total: normalizeBoundedInteger(parsed.total, normalizedErrors.length, 0, Number.MAX_SAFE_INTEGER),
    limit: normalizeBoundedInteger(parsed.limit, fallbackLimit, 1, 200),
    errors: normalizedErrors,
    recoveryTotal: normalizeBoundedInteger(parsed.recoveryTotal, normalizedRecoveries.length, 0, Number.MAX_SAFE_INTEGER),
    recoveryLimit: normalizeBoundedInteger(parsed.recoveryLimit, fallbackRecoveryLimit, 0, 200),
    recoveries: normalizedRecoveries,
  };
}

async function postOpsEvent(apiBase: string, path: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function emitOpsErrorTelemetry(
  apiBase: string,
  input: {
    source: OpsTelemetrySource;
    code: string;
    message: string;
    level: OpsTelemetryLevel;
    context?: Record<string, unknown>;
    occurredAt?: number;
  },
) {
  return postOpsEvent(apiBase, '/api/ops/errors', {
    level: input.level,
    source: input.source,
    code: normalizeTelemetryCode(input.code, 'CLIENT_ERROR'),
    message: input.message.slice(0, 400),
    ...(input.context ? { context: sanitizeOpsTelemetryContext(input.context) } : {}),
    ...(typeof input.occurredAt === 'number' ? { occurredAt: Math.floor(input.occurredAt) } : {}),
  });
}

export async function emitOpsRecoveryTelemetry(
  apiBase: string,
  input: {
    source: OpsTelemetrySource;
    action: string;
    status: OpsRecoveryStatus;
    message?: string;
    errorCode?: string;
    context?: Record<string, unknown>;
    occurredAt?: number;
  },
) {
  return postOpsEvent(apiBase, '/api/ops/recovery', {
    source: input.source,
    action: input.action.slice(0, 80),
    status: input.status,
    ...(input.message ? { message: input.message.slice(0, 400) } : {}),
    ...(input.errorCode ? { errorCode: normalizeTelemetryCode(input.errorCode, 'RECOVERY_ERROR') } : {}),
    ...(input.context ? { context: sanitizeOpsTelemetryContext(input.context) } : {}),
    ...(typeof input.occurredAt === 'number' ? { occurredAt: Math.floor(input.occurredAt) } : {}),
  });
}

export async function fetchOpsTelemetryFeed(
  apiBase: string,
  options?: {
    level?: OpsTelemetryLevel;
    source?: OpsTelemetrySource;
    limit?: number;
    recoveryLimit?: number;
  },
): Promise<OpsTelemetryFeed> {
  const params = new URLSearchParams();

  if (options?.level) {
    params.set('level', options.level);
  }

  if (options?.source) {
    params.set('source', options.source);
  }

  if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
    params.set('limit', `${Math.max(1, Math.min(200, Math.floor(options.limit)))}`);
  }

  if (typeof options?.recoveryLimit === 'number' && Number.isFinite(options.recoveryLimit)) {
    params.set('recoveryLimit', `${Math.max(0, Math.min(200, Math.floor(options.recoveryLimit)))}`);
  }

  const query = params.toString();
  const response = await fetch(`${apiBase}/api/ops/errors${query ? `?${query}` : ''}`);

  if (!response.ok) {
    let message = '운영 텔레메트리를 불러오지 못했습니다.';

    try {
      const payload = (await response.json()) as unknown;
      const parsed = readApiErrorMessage(payload);
      if (parsed) {
        message = parsed;
      }
    } catch {
      // no-op: fallback message already set
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as unknown;
  return normalizeOpsTelemetryFeedPayload(payload, options);
}
