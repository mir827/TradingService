import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emitOpsErrorTelemetry,
  fetchOpsTelemetryFeed,
  normalizeApiOperationError,
  normalizeOpsTelemetryFeedPayload,
  readApiErrorMessage,
} from './apiOperations';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api operation helpers', () => {
  it('extracts nested api error messages', () => {
    expect(readApiErrorMessage({ error: 'simple message' })).toBe('simple message');
    expect(readApiErrorMessage({ error: { message: 'nested message' } })).toBe('nested message');
    expect(readApiErrorMessage({})).toBeNull();
  });

  it('normalizes api errors with status/code/retryability', () => {
    const normalized = normalizeApiOperationError({
      fallbackMessage: 'fallback',
      status: 503,
      payload: {
        error: {
          code: 'UPSTREAM_DOWN',
          message: 'upstream unavailable',
        },
      },
    });

    expect(normalized).toEqual({
      message: 'upstream unavailable',
      code: 'UPSTREAM_DOWN',
      status: 503,
      level: 'critical',
      retryable: true,
    });
  });

  it('falls back to error instance message for recoverable failures', () => {
    const normalized = normalizeApiOperationError({
      fallbackMessage: 'fallback',
      status: 400,
      error: new Error('bad request body'),
    });

    expect(normalized).toEqual({
      message: 'bad request body',
      code: null,
      status: 400,
      level: 'recoverable',
      retryable: false,
    });
  });

  it('emits sanitized telemetry payload and reads ops feed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            limit: 20,
            errors: [
              {
                id: 'opserr_1',
                level: 'recoverable',
                source: 'strategy',
                code: 'STRATEGY_BACKTEST_FAILED',
                message: 'failed',
                occurredAt: 1,
                recordedAt: 1,
              },
            ],
            recoveryTotal: 0,
            recoveryLimit: 20,
            recoveries: [],
          }),
          { status: 200 },
        ),
      );

    const emitted = await emitOpsErrorTelemetry('http://localhost:4100', {
      source: 'strategy',
      level: 'critical',
      code: 'strategy-backtest failed',
      message: 'strategy failed',
      context: {
        keep: 'yes',
        ignore: { nested: true },
      },
    });

    expect(emitted).toBe(true);

    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall[0]).toBe('http://localhost:4100/api/ops/errors');
    const init = firstCall[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      code: string;
      context?: Record<string, unknown>;
    };
    expect(body.code).toBe('STRATEGY_BACKTEST_FAILED');
    expect(body.context).toEqual({ keep: 'yes' });

    const feed = await fetchOpsTelemetryFeed('http://localhost:4100', { source: 'strategy' });
    expect(feed.total).toBe(1);
    expect(feed.errors[0].code).toBe('STRATEGY_BACKTEST_FAILED');
  });

  it('normalizes malformed ops feed events into safe fallback shapes', () => {
    const feed = normalizeOpsTelemetryFeedPayload(
      {
        total: 'bad',
        limit: '200',
        errors: [
          null,
          {
            id: ' ',
            level: 'boom',
            source: 'broken',
            code: ' ',
            message: '',
            context: { keep: 'ok', nested: { nope: true } },
            occurredAt: 'bad',
            recordedAt: '42',
          },
        ],
        recoveryTotal: undefined,
        recoveryLimit: '50',
        recoveries: [
          {
            id: '',
            source: 'strategy',
            action: ' ',
            status: 'broken',
            message: 123,
            errorCode: ' ',
            occurredAt: '10',
            recordedAt: 'invalid',
          },
        ],
      },
      { limit: 20, recoveryLimit: 20 },
    );

    expect(feed.total).toBe(1);
    expect(feed.limit).toBe(200);
    expect(feed.errors).toEqual([
      {
        id: 'ops_error_2',
        level: 'recoverable',
        source: 'api',
        code: 'UNKNOWN_ERROR',
        message: 'UNKNOWN_ERROR',
        context: { keep: 'ok' },
        occurredAt: 0,
        recordedAt: 42,
      },
    ]);
    expect(feed.recoveryTotal).toBe(1);
    expect(feed.recoveryLimit).toBe(50);
    expect(feed.recoveries).toEqual([
      {
        id: 'ops_recovery_1',
        source: 'strategy',
        action: 'recovery',
        status: 'attempted',
        occurredAt: 10,
        recordedAt: 10,
      },
    ]);
  });
});
