import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateMACD } from './indicatorMath.js';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toBinanceKlines(closes: number[]) {
  const startTimeMs = 1_700_000_000_000;
  const intervalMs = 60_000;

  return closes.map((close, index) => {
    const open = index > 0 ? closes[index - 1] : close;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;

    return [
      startTimeMs + index * intervalMs,
      open.toFixed(4),
      high.toFixed(4),
      low.toFixed(4),
      close.toFixed(4),
      '100',
      startTimeMs + (index + 1) * intervalMs,
      '1000',
      10,
      '50',
      '500',
      '0',
    ] as const;
  });
}

function pickMacdHistogramSeries() {
  const candidates: number[][] = [
    Array.from({ length: 80 }, (_, index) => 100 + index * 1.3),
    Array.from({ length: 80 }, (_, index) => 150 + index * 0.8 + Math.sin(index / 3) * 6),
    Array.from({ length: 80 }, (_, index) => 220 - index * 1.1 + Math.cos(index / 2.4) * 7),
  ];

  for (const closes of candidates) {
    const latest = calculateMACD(closes, 12, 26, 9).histogram.at(-1);
    if (typeof latest === 'number' && Number.isFinite(latest) && Math.abs(latest) > 0.0001) {
      return {
        closes,
        sign: latest > 0 ? 'positive' : 'negative',
      } as const;
    }
  }

  return {
    closes: candidates[0],
    sign: 'positive' as const,
  };
}

let app!: FastifyInstance;
let stateDir = '';
let stateFile = '';
let previousSkipKrxPreloadEnv: string | undefined;

async function createAppInstance() {
  vi.resetModules();
  const module = await import('./index.js');
  return module.app as FastifyInstance;
}

async function restartAppInstance() {
  await app.close();
  app = await createAppInstance();
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'tradingservice-api-state-'));
  stateFile = join(stateDir, 'runtime-state.json');
  previousSkipKrxPreloadEnv = process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD;
  process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD = '1';
  process.env.TRADINGSERVICE_STATE_FILE = stateFile;
  app = await createAppInstance();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (app) {
    await app.close();
  }
  if (previousSkipKrxPreloadEnv === undefined) {
    delete process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD;
  } else {
    process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD = previousSkipKrxPreloadEnv;
  }
  previousSkipKrxPreloadEnv = undefined;
  delete process.env.TRADINGSERVICE_STATE_FILE;
  if (stateDir) {
    await rm(stateDir, { recursive: true, force: true });
  }
});

describe('api health', () => {
  it('returns service status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      ok: boolean;
      service: string;
      krxSymbolCount: number;
    };

    expect(body.ok).toBe(true);
    expect(body.service).toBe('tradingservice-api');
    expect(typeof body.krxSymbolCount).toBe('number');
  });
});

describe('api market status', () => {
  it('returns KOSPI open in-session and closed out-of-session on weekday', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const inSession = new Date('2025-02-24T10:00:00+09:00').getTime();
    nowSpy.mockReturnValue(inSession);

    const openResponse = await app.inject({
      method: 'GET',
      url: '/api/market-status?market=KOSPI',
    });

    expect(openResponse.statusCode).toBe(200);
    expect(openResponse.json()).toEqual({
      market: 'KOSPI',
      status: 'OPEN',
      reason: 'SESSION_ACTIVE',
      checkedAt: inSession,
      timezone: 'Asia/Seoul',
      session: {
        open: '09:00',
        close: '15:30',
        text: '09:00-15:30 KST',
      },
    });

    const outOfSession = new Date('2025-02-24T08:40:00+09:00').getTime();
    nowSpy.mockReturnValue(outOfSession);

    const closedResponse = await app.inject({
      method: 'GET',
      url: '/api/market-status?market=KOSPI',
    });

    expect(closedResponse.statusCode).toBe(200);
    expect(closedResponse.json()).toEqual({
      market: 'KOSPI',
      status: 'CLOSED',
      reason: 'OUT_OF_SESSION',
      checkedAt: outOfSession,
      timezone: 'Asia/Seoul',
      session: {
        open: '09:00',
        close: '15:30',
        text: '09:00-15:30 KST',
      },
    });
  });

  it('returns KOSDAQ closed on weekend', async () => {
    const weekend = new Date('2025-02-23T11:00:00+09:00').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(weekend);

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-status?market=KOSDAQ',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      market: 'KOSDAQ',
      status: 'CLOSED',
      reason: 'WEEKEND',
      checkedAt: weekend,
      timezone: 'Asia/Seoul',
      session: {
        open: '09:00',
        close: '15:30',
        text: '09:00-15:30 KST',
      },
    });
  });

  it('returns CRYPTO open 24/7', async () => {
    const checkedAt = new Date('2025-02-23T11:00:00+09:00').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(checkedAt);

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-status?market=CRYPTO',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      market: 'CRYPTO',
      status: 'OPEN',
      reason: 'SESSION_ACTIVE',
      checkedAt,
      timezone: 'UTC',
      session: {
        open: '00:00',
        close: '23:59',
        text: '24/7',
      },
    });
  });
});

describe('api ops telemetry', () => {
  it('ingests errors and recoveries and supports filtered inspection', async () => {
    const errorResponse = await app.inject({
      method: 'POST',
      url: '/api/ops/errors',
      payload: {
        level: 'recoverable',
        source: 'web',
        code: 'TRADING_STATE_FETCH_FAILED',
        message: 'Failed to load trading state',
        context: {
          workflow: 'trading',
          status: 502,
        },
      },
    });

    expect(errorResponse.statusCode).toBe(201);
    const errorBody = errorResponse.json() as {
      event: {
        id: string;
        level: 'recoverable' | 'critical';
        source: string;
        code: string;
      };
    };
    expect(errorBody.event).toMatchObject({
      level: 'recoverable',
      source: 'web',
      code: 'TRADING_STATE_FETCH_FAILED',
    });
    expect(errorBody.event.id).toMatch(/^opserr_/);

    const recoveryResponse = await app.inject({
      method: 'POST',
      url: '/api/ops/recovery',
      payload: {
        source: 'web',
        action: 'retry_load_trading_state',
        status: 'attempted',
        context: {
          workflow: 'trading',
        },
      },
    });

    expect(recoveryResponse.statusCode).toBe(201);
    const recoveryBody = recoveryResponse.json() as {
      event: {
        id: string;
        source: string;
        action: string;
        status: string;
      };
    };
    expect(recoveryBody.event).toMatchObject({
      source: 'web',
      action: 'retry_load_trading_state',
      status: 'attempted',
    });
    expect(recoveryBody.event.id).toMatch(/^opsrec_/);

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/ops/errors?level=recoverable&source=web&limit=20&recoveryLimit=20',
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({
      total: 1,
      limit: 20,
      recoveryTotal: 1,
      recoveryLimit: 20,
      errors: [
        {
          level: 'recoverable',
          source: 'web',
          code: 'TRADING_STATE_FETCH_FAILED',
        },
      ],
      recoveries: [
        {
          source: 'web',
          action: 'retry_load_trading_state',
          status: 'attempted',
        },
      ],
    });
  });

  it('returns stable validation errors for malformed telemetry payloads', async () => {
    const invalidQuery = await app.inject({
      method: 'GET',
      url: '/api/ops/errors?level=warn',
    });

    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid query',
      },
    });

    const invalidErrorBody = await app.inject({
      method: 'POST',
      url: '/api/ops/errors',
      payload: {
        level: 'recoverable',
        source: 'web',
        code: 'not_valid',
        message: 'bad code',
      },
    });

    expect(invalidErrorBody.statusCode).toBe(400);
    expect(invalidErrorBody.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid body',
      },
    });

    const invalidRecoveryBody = await app.inject({
      method: 'POST',
      url: '/api/ops/recovery',
      payload: {
        source: 'web',
        action: 'retry_action',
        status: 'done',
      },
    });

    expect(invalidRecoveryBody.statusCode).toBe(400);
    expect(invalidRecoveryBody.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid body',
      },
    });
  });

  it('applies retention bounds and restores telemetry from runtime state', async () => {
    const oversizedErrors = Array.from({ length: 520 }, (_, index) => ({
      id: `err_${index}`,
      level: index % 2 === 0 ? 'recoverable' : 'critical',
      source: 'web',
      code: `ERR_${index}`,
      message: `error ${index}`,
      occurredAt: 1_750_000_000_000 + index,
      recordedAt: 1_750_000_000_000 + index,
    }));

    const oversizedRecoveries = Array.from({ length: 520 }, (_, index) => ({
      id: `rec_${index}`,
      source: 'web',
      action: 'retry_action',
      status: index % 3 === 0 ? 'failed' : index % 2 === 0 ? 'attempted' : 'succeeded',
      message: `recovery ${index}`,
      occurredAt: 1_750_010_000_000 + index,
      recordedAt: 1_750_010_000_000 + index,
    }));

    await writeFile(
      stateFile,
      `${JSON.stringify(
        {
          version: 4,
          opsErrors: oversizedErrors,
          opsRecoveries: oversizedRecoveries,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    await restartAppInstance();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/ops/errors?limit=200&recoveryLimit=200',
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json() as {
      total: number;
      errors: Array<{ id: string }>;
      recoveryTotal: number;
      recoveries: Array<{ id: string }>;
    };

    expect(listBody.total).toBe(500);
    expect(listBody.recoveryTotal).toBe(500);
    expect(listBody.errors[0].id).toBe('err_519');
    expect(listBody.recoveries[0].id).toBe('rec_519');

    const persistError = await app.inject({
      method: 'POST',
      url: '/api/ops/errors',
      payload: {
        level: 'critical',
        source: 'api',
        code: 'RUNTIME_STATE_LOAD_FAILED',
        message: 'State reload issue',
      },
    });

    expect(persistError.statusCode).toBe(201);

    await restartAppInstance();

    const afterRestart = await app.inject({
      method: 'GET',
      url: '/api/ops/errors?source=api&limit=20&recoveryLimit=0',
    });

    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.json()).toMatchObject({
      total: 1,
      errors: [{ code: 'RUNTIME_STATE_LOAD_FAILED' }],
    });
  });
});

describe('api watchlist persistence', () => {
  it('returns default watchlist when no state file exists', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/watchlist',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      name: string;
      items: Array<{ symbol: string }>;
    };

    expect(body.name).toBe('default');
    expect(body.items.some((item) => item.symbol === 'BTCUSDT')).toBe(true);
  });

  it('saves and loads default watchlist with normalized symbols', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/watchlist',
      payload: {
        items: [
          {
            symbol: ' btcusdt ',
            name: ' Bitcoin / USDT ',
            market: 'CRYPTO',
            exchange: ' BINANCE ',
          },
          {
            symbol: '005930.ks',
            code: ' 005930 ',
            name: ' 삼성전자 ',
            market: 'KOSPI',
            exchange: ' KRX ',
          },
        ],
      },
    });

    expect(saveResponse.statusCode).toBe(200);

    const saved = saveResponse.json() as {
      name: string;
      items: Array<{
        symbol: string;
        code?: string;
        name: string;
        market: string;
        exchange?: string;
      }>;
    };

    expect(saved.name).toBe('default');
    expect(saved.items).toEqual([
      {
        symbol: 'BTCUSDT',
        name: 'Bitcoin / USDT',
        market: 'CRYPTO',
        exchange: 'BINANCE',
      },
      {
        symbol: '005930.KS',
        code: '005930',
        name: '삼성전자',
        market: 'KOSPI',
        exchange: 'KRX',
      },
    ]);

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/watchlist?name=default',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual(saved);
  });

  it('persists watchlist across app recreation', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/watchlist',
      payload: {
        name: 'persisted-list',
        items: [
          {
            symbol: 'solusdt',
            name: ' Solana / USDT ',
            market: 'CRYPTO',
            exchange: 'BINANCE',
          },
        ],
      },
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toEqual({
      name: 'persisted-list',
      items: [
        {
          symbol: 'SOLUSDT',
          name: 'Solana / USDT',
          market: 'CRYPTO',
          exchange: 'BINANCE',
        },
      ],
    });

    await restartAppInstance();

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/watchlist?name=persisted-list',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      name: 'persisted-list',
      items: [
        {
          symbol: 'SOLUSDT',
          name: 'Solana / USDT',
          market: 'CRYPTO',
          exchange: 'BINANCE',
        },
      ],
    });
  });

  it('supports custom watchlist names', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/watchlist',
      payload: {
        name: 'my-list',
        items: [],
      },
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toEqual({
      name: 'my-list',
      items: [],
    });

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/watchlist?name=my-list',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      name: 'my-list',
      items: [],
    });
  });

  it('rejects invalid watchlist payloads', async () => {
    const invalidBody = await app.inject({
      method: 'PUT',
      url: '/api/watchlist',
      payload: {
        items: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin / USDT',
          },
        ],
      },
    });

    expect(invalidBody.statusCode).toBe(400);

    const invalidQuery = await app.inject({
      method: 'GET',
      url: '/api/watchlist?name=',
    });

    expect(invalidQuery.statusCode).toBe(400);
  });
});

describe('api paper trading workflows', () => {
  type TradingStateResponse = {
    mode: string;
    cash: number;
    summary: {
      equity: number;
      marketValue: number;
      realizedPnl: number;
      unrealizedPnl: number;
    };
    positions: Array<{
      symbol: string;
      qty: number;
      avgPrice: number;
      marketPrice: number;
      unrealizedPnl: number;
      realizedPnl: number;
    }>;
    orders: Array<{
      id: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'MARKET' | 'LIMIT' | 'STOP';
      status: string;
      qty: number;
      triggerPrice?: number;
      limitPrice?: number;
      takeProfitPrice?: number;
      stopLossPrice?: number;
      parentOrderId?: string;
      linkType?: 'BRACKET_TAKE_PROFIT' | 'BRACKET_STOP_LOSS';
      bracketChildOrderIds?: string[];
      canceledByOrderId?: string;
      fillPrice?: number;
    }>;
    fills: Array<{
      orderId: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      qty: number;
      price: number;
      realizedPnl: number;
    }>;
  };

  function mockPaperQuoteFeed(prices: number[], symbol = 'BTCUSDT') {
    let index = 0;

    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/ticker/24hr') {
        const requestedSymbol = url.searchParams.get('symbol');
        if (requestedSymbol !== symbol) {
          return jsonResponse({ error: 'unexpected symbol' }, 404);
        }

        const pickedPrice = prices[Math.min(index, prices.length - 1)];
        index += 1;
        const priceText = pickedPrice.toFixed(4);

        return jsonResponse({
          symbol,
          lastPrice: priceText,
          priceChangePercent: '0',
          highPrice: priceText,
          lowPrice: priceText,
          volume: '1000',
        });
      }

      return jsonResponse({ error: 'unexpected request' }, 404);
    });
  }

  function findOrder(state: TradingStateResponse, orderId: string) {
    return state.orders.find((order) => order.id === orderId);
  }

  it('supports buy then sell flow with persisted paper state', async () => {
    const fetchSpy = mockPaperQuoteFeed([100, 120, 120, 120]);

    const buyResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'btcusdt',
        side: 'buy',
        qty: 1,
      },
    });

    expect(buyResponse.statusCode).toBe(201);
    expect(
      (buyResponse.json() as {
        order: { symbol: string; side: string; status: string; fillPrice: number };
      }).order,
    ).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      fillPrice: 100,
    });

    const sellResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'SELL',
        qty: 1,
      },
    });

    expect(sellResponse.statusCode).toBe(201);
    expect(
      (sellResponse.json() as {
        fill: { symbol: string; side: string; price: number; realizedPnl: number };
      }).fill,
    ).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'SELL',
      price: 120,
      realizedPnl: 20,
    });

    const stateResponse = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });

    expect(stateResponse.statusCode).toBe(200);
    const state = stateResponse.json() as TradingStateResponse;
    expect(state.mode).toBe('PAPER');
    expect(state.positions).toHaveLength(0);
    expect(state.orders).toHaveLength(2);
    expect(state.fills).toHaveLength(2);
    expect(state.cash).toBeCloseTo(100_020, 8);
    expect(state.summary.realizedPnl).toBeCloseTo(20, 8);
    expect(state.summary.unrealizedPnl).toBeCloseTo(0, 8);

    await restartAppInstance();

    const afterRestart = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });

    expect(afterRestart.statusCode).toBe(200);
    const restored = afterRestart.json() as TradingStateResponse;
    expect(restored.cash).toBeCloseTo(100_020, 8);
    expect(restored.orders).toHaveLength(2);
    expect(restored.fills).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('updates average position price for consecutive buys', async () => {
    mockPaperQuoteFeed([100, 130, 130]);

    const firstBuy = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        qty: 1,
      },
    });
    expect(firstBuy.statusCode).toBe(201);

    const secondBuy = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        qty: 2,
      },
    });
    expect(secondBuy.statusCode).toBe(201);

    const stateResponse = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });

    expect(stateResponse.statusCode).toBe(200);
    const state = stateResponse.json() as TradingStateResponse;
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0]).toMatchObject({
      symbol: 'BTCUSDT',
      qty: 3,
      avgPrice: 120,
      marketPrice: 130,
      unrealizedPnl: 30,
      realizedPnl: 0,
    });
  });

  it('returns realized and unrealized pnl values in trading state', async () => {
    mockPaperQuoteFeed([100, 120, 110]);

    const buyResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        qty: 2,
      },
    });
    expect(buyResponse.statusCode).toBe(201);

    const sellResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'SELL',
        qty: 1,
      },
    });
    expect(sellResponse.statusCode).toBe(201);

    const stateResponse = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(stateResponse.statusCode).toBe(200);

    const state = stateResponse.json() as TradingStateResponse;
    expect(state.summary.realizedPnl).toBeCloseTo(20, 8);
    expect(state.summary.unrealizedPnl).toBeCloseTo(10, 8);
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0]).toMatchObject({
      symbol: 'BTCUSDT',
      qty: 1,
      avgPrice: 100,
      marketPrice: 110,
      realizedPnl: 20,
      unrealizedPnl: 10,
    });
  });

  it('keeps backward compatibility for legacy market payloads', async () => {
    mockPaperQuoteFeed([101]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        qty: 1,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(
      (response.json() as {
        order: { type: string; status: string };
      }).order,
    ).toMatchObject({
      type: 'MARKET',
      status: 'FILLED',
    });
  });

  it('validates limit/stop payloads with stable error shape', async () => {
    const missingLimitPrice = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'limit',
        qty: 1,
      },
    });

    expect(missingLimitPrice.statusCode).toBe(400);
    expect(missingLimitPrice.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid trading order payload',
      },
    });

    const missingStopTrigger = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'stop',
        qty: 1,
      },
    });

    expect(missingStopTrigger.statusCode).toBe(400);
    expect(missingStopTrigger.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid trading order payload',
      },
    });
  });

  it('transitions pending limit/stop orders to filled on quote updates', async () => {
    mockPaperQuoteFeed([100, 100, 104, 106, 89]);

    const limitOrder = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'limit',
        qty: 1,
        limitPrice: 90,
      },
    });
    expect(limitOrder.statusCode).toBe(201);
    const limitOrderId = (limitOrder.json() as { order: { id: string } }).order.id;

    const stopOrder = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'stop',
        qty: 1,
        triggerPrice: 105,
      },
    });
    expect(stopOrder.statusCode).toBe(201);
    const stopOrderId = (stopOrder.json() as { order: { id: string } }).order.id;

    const preTrigger = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(preTrigger.statusCode).toBe(200);

    const stopTrigger = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(stopTrigger.statusCode).toBe(200);

    const limitTrigger = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(limitTrigger.statusCode).toBe(200);

    const state = limitTrigger.json() as TradingStateResponse;
    expect(findOrder(state, stopOrderId)).toMatchObject({
      id: stopOrderId,
      type: 'STOP',
      status: 'FILLED',
      fillPrice: 106,
    });
    expect(findOrder(state, limitOrderId)).toMatchObject({
      id: limitOrderId,
      type: 'LIMIT',
      status: 'FILLED',
      fillPrice: 89,
    });
    expect(state.fills.filter((fill) => fill.orderId === stopOrderId)).toHaveLength(1);
    expect(state.fills.filter((fill) => fill.orderId === limitOrderId)).toHaveLength(1);
  });

  it('creates bracket child exits and preserves parent-child relationship integrity', async () => {
    mockPaperQuoteFeed([100, 100]);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'market',
        qty: 1,
        takeProfitPrice: 110,
        stopLossPrice: 95,
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const parentOrderId = (createResponse.json() as { order: { id: string } }).order.id;

    const stateResponse = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(stateResponse.statusCode).toBe(200);
    const state = stateResponse.json() as TradingStateResponse;

    const parent = findOrder(state, parentOrderId);
    expect(parent).toMatchObject({
      id: parentOrderId,
      type: 'MARKET',
      status: 'FILLED',
      takeProfitPrice: 110,
      stopLossPrice: 95,
    });

    const children = state.orders.filter((order) => order.parentOrderId === parentOrderId);
    expect(children).toHaveLength(2);
    expect(children.map((order) => order.linkType).sort()).toEqual(['BRACKET_STOP_LOSS', 'BRACKET_TAKE_PROFIT']);
    expect(children.every((order) => order.status === 'PENDING')).toBe(true);
    expect(children.every((order) => order.side === 'SELL' && order.qty === 1)).toBe(true);

    const parentChildIds = [...(parent?.bracketChildOrderIds ?? [])].sort();
    const childIds = children.map((order) => order.id).sort();
    expect(parentChildIds).toEqual(childIds);
  });

  it('maintains parent/child cancel integrity for pending and bracket children', async () => {
    mockPaperQuoteFeed([120, 100]);

    const pendingParentResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'limit',
        qty: 1,
        limitPrice: 90,
        takeProfitPrice: 110,
        stopLossPrice: 80,
      },
    });
    expect(pendingParentResponse.statusCode).toBe(201);
    const pendingParentId = (pendingParentResponse.json() as { order: { id: string } }).order.id;

    const cancelPendingParent = await app.inject({
      method: 'POST',
      url: `/api/trading/orders/${pendingParentId}/cancel`,
    });
    expect(cancelPendingParent.statusCode).toBe(200);
    expect((cancelPendingParent.json() as { order: { status: string } }).order.status).toBe('CANCELED');

    const bracketParentResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        qty: 1,
        takeProfitPrice: 110,
        stopLossPrice: 95,
      },
    });
    expect(bracketParentResponse.statusCode).toBe(201);
    const bracketParentId = (bracketParentResponse.json() as { order: { id: string } }).order.id;

    const afterCreate = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(afterCreate.statusCode).toBe(200);
    const beforeCancelState = afterCreate.json() as TradingStateResponse;
    const children = beforeCancelState.orders.filter((order) => order.parentOrderId === bracketParentId);
    expect(children).toHaveLength(2);

    const childToCancel = children[0];
    const cancelChild = await app.inject({
      method: 'POST',
      url: `/api/trading/orders/${childToCancel.id}/cancel`,
    });
    expect(cancelChild.statusCode).toBe(200);
    expect((cancelChild.json() as { order: { status: string } }).order.status).toBe('CANCELED');

    const finalStateResponse = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(finalStateResponse.statusCode).toBe(200);
    const finalState = finalStateResponse.json() as TradingStateResponse;

    const canceledChild = findOrder(finalState, childToCancel.id);
    expect(canceledChild?.status).toBe('CANCELED');

    const sibling = finalState.orders.find(
      (order) => order.parentOrderId === bracketParentId && order.id !== childToCancel.id,
    );
    expect(sibling).toBeTruthy();
    expect(sibling?.status).toBe('CANCELED');
    expect(sibling?.canceledByOrderId).toBe(childToCancel.id);
  });

  it('applies deterministic same-tick priority for simultaneously triggered pending orders', async () => {
    mockPaperQuoteFeed([120, 120, 100]);

    const firstOrderResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'limit',
        qty: 600,
        limitPrice: 100,
      },
    });
    expect(firstOrderResponse.statusCode).toBe(201);
    const firstOrderId = (firstOrderResponse.json() as { order: { id: string } }).order.id;

    await new Promise((resolve) => setTimeout(resolve, 2));

    const secondOrderResponse = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'limit',
        qty: 600,
        limitPrice: 100,
      },
    });
    expect(secondOrderResponse.statusCode).toBe(201);
    const secondOrderId = (secondOrderResponse.json() as { order: { id: string } }).order.id;

    const triggerStateResponse = await app.inject({
      method: 'GET',
      url: '/api/trading/state',
    });
    expect(triggerStateResponse.statusCode).toBe(200);
    const state = triggerStateResponse.json() as TradingStateResponse;

    expect(findOrder(state, firstOrderId)).toMatchObject({
      id: firstOrderId,
      status: 'FILLED',
      fillPrice: 100,
    });
    expect(findOrder(state, secondOrderId)).toMatchObject({
      id: secondOrderId,
      status: 'REJECTED',
    });
  });

  it('rejects invalid order payloads with stable error shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      payload: {
        symbol: 'BTCUSDT',
        side: 'BUY',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid trading order payload',
      },
    });
  });
});

describe('api strategy backtest', () => {
  it('rejects invalid backtest payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/strategy/backtest',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        limit: 200,
        params: {
          initialCapital: 10_000,
          feeBps: 10,
          positionSizeMode: 'fixed-percent',
          fixedPercent: 50,
        },
        strategy: {
          type: 'maCrossover',
          fastPeriod: 30,
          slowPeriod: 20,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'Invalid body',
    });
  });

  it('returns deterministic MA crossover backtest results', async () => {
    const closes = [100, 100, 100, 110, 120, 115, 90, 95, 105, 110];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      const symbol = url.searchParams.get('symbol');

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/klines' && symbol === 'BTCUSDT') {
        return jsonResponse(toBinanceKlines(closes));
      }

      return jsonResponse({ error: 'unexpected request' }, 404);
    });

    const payload = {
      symbol: 'BTCUSDT',
      interval: '60',
      limit: 50,
      params: {
        initialCapital: 10_000,
        feeBps: 10,
        positionSizeMode: 'fixed-percent' as const,
        fixedPercent: 50,
      },
      strategy: {
        type: 'maCrossover' as const,
        fastPeriod: 2,
        slowPeriod: 3,
      },
    };

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/strategy/backtest',
      payload,
    });

    expect(firstResponse.statusCode).toBe(200);

    const firstBody = firstResponse.json() as {
      symbol: string;
      interval: string;
      summary: {
        netPnl: number;
        returnPct: number;
        maxDrawdownPct: number;
        winRate: number;
        tradeCount: number;
      };
      equityCurve: Array<{ time: number; value: number }>;
      drawdownCurve: Array<{ time: number; value: number }>;
      trades: Array<{
        entryTime: number;
        exitTime: number;
        side: string;
        qty: number;
        entryPrice: number;
        exitPrice: number;
        pnl: number;
      }>;
    };

    expect(firstBody.symbol).toBe('BTCUSDT');
    expect(firstBody.interval).toBe('60');
    expect(firstBody.summary.tradeCount).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(firstBody.summary.netPnl)).toBe(true);
    expect(Number.isFinite(firstBody.summary.returnPct)).toBe(true);
    expect(Number.isFinite(firstBody.summary.maxDrawdownPct)).toBe(true);
    expect(Number.isFinite(firstBody.summary.winRate)).toBe(true);
    expect(firstBody.equityCurve).toHaveLength(closes.length);
    expect(firstBody.drawdownCurve).toHaveLength(closes.length);

    if (firstBody.trades.length > 0) {
      expect(firstBody.trades[0]).toMatchObject({
        side: 'LONG',
      });
      expect(firstBody.trades[0].exitTime).toBeGreaterThanOrEqual(firstBody.trades[0].entryTime);
    }

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/strategy/backtest',
      payload,
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json()).toEqual(firstBody);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('api alerts rules', () => {
  it('supports create/list/delete flow', async () => {
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=btcusdt',
    });

    expect(listBefore.statusCode).toBe(200);
    expect((listBefore.json() as { rules: unknown[] }).rules).toHaveLength(0);

    const create = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'btcusdt',
        metric: 'price',
        operator: '>=',
        threshold: 100000,
        cooldownSec: 120,
      },
    });

    expect(create.statusCode).toBe(201);

    const created = create.json() as {
      rule: {
        id: string;
        symbol: string;
        metric: string;
        operator: string;
        threshold: number;
        cooldownSec: number;
        lastTriggeredAt: number | null;
        state: 'active' | 'triggered' | 'cooldown' | 'error';
        stateUpdatedAt: number;
        lastStateTransition: {
          from: 'active' | 'triggered' | 'cooldown' | 'error' | null;
          to: 'active' | 'triggered' | 'cooldown' | 'error';
          reason: string;
        };
      };
    };

    expect(created.rule.symbol).toBe('BTCUSDT');
    expect(created.rule.metric).toBe('price');
    expect(created.rule.operator).toBe('>=');
    expect(created.rule.threshold).toBe(100000);
    expect(created.rule.cooldownSec).toBe(120);
    expect(created.rule.lastTriggeredAt).toBeNull();
    expect(created.rule.state).toBe('active');
    expect(typeof created.rule.stateUpdatedAt).toBe('number');
    expect(created.rule.lastStateTransition).toMatchObject({
      from: null,
      to: 'active',
      reason: 'ruleCreated',
    });

    const listAfter = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });

    expect(listAfter.statusCode).toBe(200);
    const listed = listAfter.json() as { rules: Array<{ id: string }> };
    expect(listed.rules).toHaveLength(1);
    expect(listed.rules[0].id).toBe(created.rule.id);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/alerts/rules/${created.rule.id}`,
    });

    expect(remove.statusCode).toBe(200);
    expect((remove.json() as { ok: boolean }).ok).toBe(true);

    const listAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });

    expect(listAfterDelete.statusCode).toBe(200);
    expect((listAfterDelete.json() as { rules: unknown[] }).rules).toHaveLength(0);
  });

  it('evaluates alerts and applies cooldown suppression', async () => {
    const createPriceRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 50000,
        cooldownSec: 600,
      },
    });
    const createChangeRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'changePercent',
        operator: '<=',
        threshold: -2,
        cooldownSec: 0,
      },
    });

    expect(createPriceRule.statusCode).toBe(201);
    expect(createChangeRule.statusCode).toBe(201);

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 51000,
          changePercent: -3.4,
        },
      },
    });

    expect(firstCheck.statusCode).toBe(200);

    const firstBody = firstCheck.json() as {
      checkedRuleCount: number;
      triggeredCount: number;
      suppressedByCooldown: number;
      triggered: Array<{ metric: string }>;
    };

    expect(firstBody.checkedRuleCount).toBe(2);
    expect(firstBody.triggeredCount).toBe(2);
    expect(firstBody.suppressedByCooldown).toBe(0);
    expect(firstBody.triggered.map((entry) => entry.metric).sort()).toEqual(['changePercent', 'price']);

    const secondCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 52000,
          changePercent: -3.8,
        },
      },
    });

    expect(secondCheck.statusCode).toBe(200);

    const secondBody = secondCheck.json() as {
      checkedRuleCount: number;
      triggeredCount: number;
      suppressedByCooldown: number;
      triggered: Array<{ metric: string }>;
    };

    expect(secondBody.checkedRuleCount).toBe(2);
    expect(secondBody.triggeredCount).toBe(1);
    expect(secondBody.suppressedByCooldown).toBe(1);
    expect(secondBody.triggered).toHaveLength(1);
    expect(secondBody.triggered[0].metric).toBe('changePercent');
  });

  it('tracks lifecycle transitions across trigger, cooldown, and active recovery', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_750_060_000_000);

    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        cooldownSec: 120,
      },
    });

    expect(createRule.statusCode).toBe(201);

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 110,
          changePercent: 0.2,
        },
      },
    });

    expect(firstCheck.statusCode).toBe(200);
    const firstBody = firstCheck.json() as {
      evaluatedAt: number;
      triggeredCount: number;
      suppressedByCooldown: number;
      suppressed: Array<{ state: 'cooldown' }>;
      triggered: Array<{
        state?: 'active' | 'triggered' | 'cooldown' | 'error';
        transition?: { from: string | null; to: string; reason: string };
      }>;
    };
    expect(firstBody.triggeredCount).toBe(1);
    expect(firstBody.suppressedByCooldown).toBe(0);
    expect(firstBody.suppressed).toHaveLength(0);
    expect(firstBody.triggered[0]).toMatchObject({
      state: 'triggered',
      transition: {
        from: 'active',
        to: 'triggered',
        reason: 'conditionMet',
      },
    });

    const firstList = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });
    expect(firstList.statusCode).toBe(200);
    expect(firstList.json()).toMatchObject({
      rules: [
        {
          state: 'triggered',
          lastTrigger: {
            triggeredAt: firstBody.evaluatedAt,
            currentValue: 110,
            source: 'manual',
            sourceSymbol: 'BTCUSDT',
          },
          lastStateTransition: {
            from: 'active',
            to: 'triggered',
            reason: 'conditionMet',
          },
        },
      ],
    });

    nowSpy.mockReturnValue(1_750_060_030_000);
    const secondCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 112,
          changePercent: 0.3,
        },
      },
    });

    expect(secondCheck.statusCode).toBe(200);
    const secondBody = secondCheck.json() as {
      triggeredCount: number;
      suppressedByCooldown: number;
      suppressed: Array<{ state: 'cooldown'; transition?: { reason: string } }>;
    };
    expect(secondBody.triggeredCount).toBe(0);
    expect(secondBody.suppressedByCooldown).toBe(1);
    expect(secondBody.suppressed).toHaveLength(1);
    expect(secondBody.suppressed[0]).toMatchObject({
      state: 'cooldown',
      transition: {
        reason: 'cooldownSuppressed',
      },
    });

    const secondList = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });
    expect(secondList.statusCode).toBe(200);
    expect(secondList.json()).toMatchObject({
      rules: [
        {
          state: 'cooldown',
          lastStateTransition: {
            to: 'cooldown',
            reason: 'cooldownSuppressed',
          },
        },
      ],
    });

    nowSpy.mockReturnValue(1_750_060_045_000);
    const recoveryCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 95,
          changePercent: -0.1,
        },
      },
    });

    expect(recoveryCheck.statusCode).toBe(200);
    expect(recoveryCheck.json()).toMatchObject({
      triggeredCount: 0,
      suppressedByCooldown: 0,
    });

    const recoveredList = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });
    expect(recoveredList.statusCode).toBe(200);
    expect(recoveredList.json()).toMatchObject({
      rules: [
        {
          state: 'active',
          lastStateTransition: {
            from: 'cooldown',
            to: 'active',
            reason: 'conditionNotMet',
          },
        },
      ],
    });

    const lifecycleHistory = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=BTCUSDT&type=triggered&state=triggered&limit=10',
    });
    expect(lifecycleHistory.statusCode).toBe(200);
    expect(lifecycleHistory.json()).toMatchObject({
      total: 1,
      events: [
        {
          eventType: 'triggered',
          state: 'triggered',
          transition: {
            to: 'triggered',
            reason: 'conditionMet',
          },
        },
      ],
    });
  });

  it('moves rules to error on evaluation failure and recovers on next successful check', async () => {
    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 150,
        cooldownSec: 60,
      },
    });

    expect(createRule.statusCode).toBe(201);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/ticker/24hr') {
        return jsonResponse({ error: 'temporary failure' }, 503);
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });

    const failedCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
      },
    });

    expect(failedCheck.statusCode).toBe(502);
    expect(failedCheck.json()).toMatchObject({
      error: 'Failed to evaluate alert rules due to quote fetch failure',
    });

    const erroredRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });
    expect(erroredRules.statusCode).toBe(200);
    expect(erroredRules.json()).toMatchObject({
      rules: [
        {
          state: 'error',
          lastStateTransition: {
            to: 'error',
            reason: 'evaluationError',
          },
          lastError: {
            message: 'Failed to evaluate alert rules due to quote fetch failure',
            source: 'manual',
            sourceSymbol: 'BTCUSDT',
          },
        },
      ],
    });

    const defaultHistory = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=BTCUSDT&limit=10',
    });
    expect(defaultHistory.statusCode).toBe(200);
    expect(defaultHistory.json()).toMatchObject({
      total: 0,
      events: [],
    });

    const errorHistory = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=BTCUSDT&type=error&state=error&limit=10',
    });
    expect(errorHistory.statusCode).toBe(200);
    expect(errorHistory.json()).toMatchObject({
      total: 1,
      events: [
        {
          eventType: 'error',
          state: 'error',
          errorMessage: 'Failed to evaluate alert rules due to quote fetch failure',
          source: 'manual',
          sourceSymbol: 'BTCUSDT',
        },
      ],
    });

    const recoveredCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 120,
          changePercent: 0.5,
        },
      },
    });

    expect(recoveredCheck.statusCode).toBe(200);

    const recoveredRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });
    expect(recoveredRules.statusCode).toBe(200);
    expect(recoveredRules.json()).toMatchObject({
      rules: [
        {
          state: 'active',
          lastStateTransition: {
            from: 'error',
            to: 'active',
            reason: 'conditionNotMet',
          },
        },
      ],
    });
    expect((recoveredRules.json() as { rules: Array<{ lastError?: unknown }> }).rules[0].lastError).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('persists alert cooldown and lastTriggeredAt across app recreation', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_750_000_000_000);

    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        cooldownSec: 120,
      },
    });

    expect(createRule.statusCode).toBe(201);

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 200,
          changePercent: 0.2,
        },
      },
    });

    expect(firstCheck.statusCode).toBe(200);
    const firstBody = firstCheck.json() as {
      evaluatedAt: number;
      triggeredCount: number;
      suppressedByCooldown: number;
    };
    expect(firstBody.triggeredCount).toBe(1);
    expect(firstBody.suppressedByCooldown).toBe(0);

    await restartAppInstance();

    nowSpy.mockReturnValue(1_750_000_030_000);

    const secondCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 200,
          changePercent: 0.2,
        },
      },
    });

    expect(secondCheck.statusCode).toBe(200);
    const secondBody = secondCheck.json() as {
      triggeredCount: number;
      suppressedByCooldown: number;
    };
    expect(secondBody.triggeredCount).toBe(0);
    expect(secondBody.suppressedByCooldown).toBe(1);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });

    expect(listResponse.statusCode).toBe(200);
    const listedRule = (listResponse.json() as { rules: Array<{ lastTriggeredAt: number | null }> }).rules[0];
    expect(listedRule.lastTriggeredAt).toBe(firstBody.evaluatedAt);
  });
});

describe('api alerts indicator-aware rules', () => {
  it('creates indicator-aware rules and supports scoped rule filtering', async () => {
    const createLegacyRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
      },
    });

    const createRsiRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        indicatorConditions: [
          {
            type: 'rsiThreshold',
            operator: '<=',
            threshold: 30,
          },
        ],
      },
    });

    const createMacdCrossRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'ETHUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        indicatorConditions: [
          {
            type: 'macdCrossSignal',
            signal: 'bullish',
          },
        ],
      },
    });

    expect(createLegacyRule.statusCode).toBe(201);
    expect(createRsiRule.statusCode).toBe(201);
    expect(createMacdCrossRule.statusCode).toBe(201);

    const filteredRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbols=BTCUSDT,ETHUSDT&indicatorAwareOnly=true',
    });

    expect(filteredRules.statusCode).toBe(200);
    const body = filteredRules.json() as {
      rules: Array<{
        symbol: string;
        indicatorConditions?: Array<{ type: string; period?: number }>;
      }>;
    };

    expect(body.rules).toHaveLength(2);
    expect(body.rules.every((rule) => (rule.indicatorConditions?.length ?? 0) > 0)).toBe(true);

    const rsiRule = body.rules.find((rule) => rule.symbol === 'BTCUSDT');
    expect(rsiRule?.indicatorConditions?.[0]).toMatchObject({
      type: 'rsiThreshold',
      period: 14,
    });
  });

  it('persists indicator-aware rule fields across app recreation', async () => {
    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'ETHUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 2000,
        indicatorConditions: [
          {
            type: 'bollingerBandPosition',
            position: 'aboveUpper',
          },
        ],
      },
    });
    expect(createRule.statusCode).toBe(201);

    await restartAppInstance();

    const listedRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=ETHUSDT',
    });

    expect(listedRules.statusCode).toBe(200);
    expect((listedRules.json() as { rules: Array<{ indicatorConditions?: Array<{ type: string }> }> }).rules).toMatchObject([
      {
        indicatorConditions: [{ type: 'bollingerBandPosition' }],
      },
    ]);
  });

  it('evaluates RSI indicator rules and keeps cooldown semantics unchanged', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_750_020_000_000);

    const descendingCloses = Array.from({ length: 40 }, (_, index) => 200 - index);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/klines' && url.searchParams.get('symbol') === 'BTCUSDT') {
        return jsonResponse(toBinanceKlines(descendingCloses));
      }

      return jsonResponse({ error: 'unexpected request' }, 404);
    });

    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        cooldownSec: 120,
        indicatorConditions: [
          {
            type: 'rsiThreshold',
            operator: '<=',
            threshold: 30,
          },
        ],
      },
    });

    expect(createRule.statusCode).toBe(201);

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 150,
          changePercent: -1,
        },
        indicatorAwareOnly: true,
      },
    });

    expect(firstCheck.statusCode).toBe(200);
    const firstBody = firstCheck.json() as {
      triggeredCount: number;
      suppressedByCooldown: number;
      triggered: Array<{ indicatorConditions?: Array<{ type: string }> }>;
    };

    expect(firstBody.triggeredCount).toBe(1);
    expect(firstBody.suppressedByCooldown).toBe(0);
    expect(firstBody.triggered[0].indicatorConditions?.[0]?.type).toBe('rsiThreshold');

    nowSpy.mockReturnValue(1_750_020_030_000);
    const secondCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbols: ['BTCUSDT'],
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 150,
          changePercent: -1,
        },
        indicatorAwareOnly: true,
      },
    });

    expect(secondCheck.statusCode).toBe(200);
    const secondBody = secondCheck.json() as {
      checkedRuleCount: number;
      triggeredCount: number;
      suppressedByCooldown: number;
    };

    expect(secondBody.checkedRuleCount).toBe(1);
    expect(secondBody.triggeredCount).toBe(0);
    expect(secondBody.suppressedByCooldown).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('evaluates MACD/Bollinger conditions and supports scoped check filters', async () => {
    const macdSeries = pickMacdHistogramSeries();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      const symbol = url.searchParams.get('symbol');

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/ticker/24hr' && symbol === 'ETHUSDT') {
        return jsonResponse({
          lastPrice: '210',
          priceChangePercent: '1.2',
          highPrice: '220',
          lowPrice: '180',
          volume: '500',
        });
      }

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/ticker/24hr' && symbol === 'BTCUSDT') {
        return jsonResponse({
          lastPrice: '150',
          priceChangePercent: '0.8',
          highPrice: '155',
          lowPrice: '140',
          volume: '600',
        });
      }

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/klines' && symbol === 'ETHUSDT') {
        return jsonResponse(toBinanceKlines(macdSeries.closes));
      }

      return jsonResponse({ error: 'unexpected request' }, 404);
    });

    const createBtcLegacy = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
      },
    });

    const createMacdRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'ETHUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        indicatorConditions: [
          {
            type: 'macdHistogramSign',
            sign: macdSeries.sign,
          },
        ],
      },
    });

    const createBollingerRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'ETHUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        indicatorConditions: [
          {
            type: 'bollingerBandPosition',
            position: 'belowLower',
          },
        ],
      },
    });

    expect(createBtcLegacy.statusCode).toBe(201);
    expect(createMacdRule.statusCode).toBe(201);
    expect(createBollingerRule.statusCode).toBe(201);

    const watchlistCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {
        symbols: ['BTCUSDT', 'ETHUSDT'],
        indicatorAwareOnly: true,
      },
    });

    expect(watchlistCheck.statusCode).toBe(200);
    const watchlistBody = watchlistCheck.json() as {
      checkedSymbols: string[];
      events: Array<{ symbol: string; indicatorConditions?: Array<{ type: string }> }>;
    };

    expect(watchlistBody.checkedSymbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(watchlistBody.events).toHaveLength(1);
    expect(watchlistBody.events[0].symbol).toBe('ETHUSDT');
    expect(watchlistBody.events[0].indicatorConditions?.[0]).toMatchObject({
      type: 'macdHistogramSign',
    });

    const historyFiltered = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbols=ETHUSDT&indicatorAwareOnly=true&limit=10',
    });

    expect(historyFiltered.statusCode).toBe(200);
    expect(historyFiltered.json()).toMatchObject({
      symbol: null,
      limit: 10,
      total: 1,
      events: [{ symbol: 'ETHUSDT' }],
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('applies requested source scope for watchlist checks', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      const symbol = url.searchParams.get('symbol');

      if (url.hostname === 'api.binance.com' && url.pathname === '/api/v3/ticker/24hr' && symbol === 'BTCUSDT') {
        return jsonResponse({
          lastPrice: '120',
          priceChangePercent: '0.2',
          highPrice: '130',
          lowPrice: '115',
          volume: '100',
        });
      }

      return jsonResponse({ error: 'unexpected request' }, 404);
    });

    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
      },
    });
    expect(createRule.statusCode).toBe(201);

    const check = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {
        symbols: ['BTCUSDT'],
        source: 'manual',
      },
    });

    expect(check.statusCode).toBe(200);
    expect((check.json() as { events: unknown[] }).events).toHaveLength(1);

    const manualHistory = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?source=manual&limit=10',
    });
    expect(manualHistory.statusCode).toBe(200);
    expect((manualHistory.json() as { total: number }).total).toBe(1);

    const watchlistHistory = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?source=watchlist&limit=10',
    });
    expect(watchlistHistory.statusCode).toBe(200);
    expect((watchlistHistory.json() as { total: number }).total).toBe(0);
  });
});

describe('api alerts watchlist checks', () => {
  it('checks watchlist symbols and returns triggered events', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      const symbol = url.searchParams.get('symbol');

      if (url.hostname !== 'api.binance.com' || url.pathname !== '/api/v3/ticker/24hr' || !symbol) {
        return jsonResponse({ error: 'unexpected request' }, 404);
      }

      if (symbol === 'BTCUSDT') {
        return jsonResponse({
          lastPrice: '51000',
          priceChangePercent: '1.2',
          highPrice: '52000',
          lowPrice: '50000',
          volume: '100',
        });
      }

      if (symbol === 'ETHUSDT') {
        return jsonResponse({
          lastPrice: '2900',
          priceChangePercent: '-2.4',
          highPrice: '3000',
          lowPrice: '2800',
          volume: '200',
        });
      }

      return jsonResponse({ error: 'unexpected symbol' }, 404);
    });

    const createBtcRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 50000,
        cooldownSec: 60,
      },
    });
    const createEthRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'ETHUSDT',
        metric: 'changePercent',
        operator: '<=',
        threshold: -2,
        cooldownSec: 0,
      },
    });

    expect(createBtcRule.statusCode).toBe(201);
    expect(createEthRule.statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {
        symbols: [' btcusdt ', 'ETHUSDT'],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      checkedAt: number;
      checkedSymbols: string[];
      events: Array<{ symbol: string; metric: string; ruleId: string; triggeredAt: number }>;
    };

    expect(typeof body.checkedAt).toBe('number');
    expect(body.checkedSymbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(body.events).toHaveLength(2);
    expect(body.events.map((event) => event.symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(body.events.map((event) => event.metric).sort()).toEqual(['changePercent', 'price']);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('rejects invalid check-watchlist payloads', async () => {
    const missingSymbols = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {},
    });
    const emptyArray = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: { symbols: [] },
    });
    const blankSymbol = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: { symbols: ['BTCUSDT', '  '] },
    });
    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: { symbols: Array.from({ length: 41 }, () => 'BTCUSDT') },
    });

    expect(missingSymbols.statusCode).toBe(400);
    expect(emptyArray.statusCode).toBe(400);
    expect(blankSymbol.statusCode).toBe(400);
    expect(tooMany.statusCode).toBe(400);
  });

  it('applies cooldown across repeated watchlist checks', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_750_000_000_000);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      const symbol = url.searchParams.get('symbol');

      if (url.hostname !== 'api.binance.com' || url.pathname !== '/api/v3/ticker/24hr' || symbol !== 'SOLUSDT') {
        return jsonResponse({ error: 'unexpected request' }, 404);
      }

      return jsonResponse({
        lastPrice: '250',
        priceChangePercent: '0.1',
        highPrice: '255',
        lowPrice: '240',
        volume: '1000',
      });
    });

    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'SOLUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 200,
        cooldownSec: 120,
      },
    });

    expect(createRule.statusCode).toBe(201);
    const createdRuleId = (createRule.json() as { rule: { id: string } }).rule.id;

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {
        symbols: ['SOLUSDT'],
      },
    });

    expect(firstCheck.statusCode).toBe(200);
    const firstBody = firstCheck.json() as {
      checkedAt: number;
      suppressedByCooldown: number;
      events: Array<{ ruleId: string; triggeredAt: number }>;
    };
    expect(firstBody.events).toHaveLength(1);
    expect(firstBody.suppressedByCooldown).toBe(0);

    nowSpy.mockReturnValue(1_750_000_030_000);

    const secondCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {
        symbols: ['SOLUSDT'],
      },
    });

    expect(secondCheck.statusCode).toBe(200);
    const secondBody = secondCheck.json() as {
      checkedAt: number;
      suppressedByCooldown: number;
      events: Array<{ ruleId: string; triggeredAt: number }>;
    };
    expect(secondBody.events).toHaveLength(0);
    expect(secondBody.suppressedByCooldown).toBe(1);

    const listedRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=SOLUSDT',
    });

    expect(listedRules.statusCode).toBe(200);
    const rule = (listedRules.json() as { rules: Array<{ lastTriggeredAt: number | null }> }).rules[0];
    expect(rule.lastTriggeredAt).toBe(firstBody.checkedAt);

    const history = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=SOLUSDT&limit=10',
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      total: 1,
      events: [{ ruleId: createdRuleId }],
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('api alerts history', () => {
  it('appends manual/watchlist triggered events and supports symbol/source/time filters', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const manualTriggeredAt = 1_750_010_000_000;
    const watchlistTriggeredAt = 1_750_010_015_000;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl);
      const symbol = url.searchParams.get('symbol');

      if (url.hostname !== 'api.binance.com' || url.pathname !== '/api/v3/ticker/24hr' || symbol !== 'ETHUSDT') {
        return jsonResponse({ error: 'unexpected request' }, 404);
      }

      return jsonResponse({
        lastPrice: '2900',
        priceChangePercent: '-2.4',
        highPrice: '3000',
        lowPrice: '2800',
        volume: '200',
      });
    });

    const createBtcRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 50000,
      },
    });
    const createEthRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'ETHUSDT',
        metric: 'changePercent',
        operator: '<=',
        threshold: -2,
      },
    });

    expect(createBtcRule.statusCode).toBe(201);
    expect(createEthRule.statusCode).toBe(201);

    nowSpy.mockReturnValue(manualTriggeredAt);

    const manualCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 51000,
          changePercent: 0.5,
        },
      },
    });

    expect(manualCheck.statusCode).toBe(200);
    expect((manualCheck.json() as { triggeredCount: number }).triggeredCount).toBe(1);

    nowSpy.mockReturnValue(watchlistTriggeredAt);

    const watchlistCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check-watchlist',
      payload: {
        symbols: ['ETHUSDT'],
      },
    });

    expect(watchlistCheck.statusCode).toBe(200);
    expect((watchlistCheck.json() as { events: unknown[] }).events).toHaveLength(1);

    const historyResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history',
    });

    expect(historyResponse.statusCode).toBe(200);
    const historyBody = historyResponse.json() as {
      symbol: string | null;
      limit: number;
      total: number;
      events: Array<{
        symbol: string;
        metric: string;
        threshold: number;
        currentValue: number;
        triggeredAt: number;
        source: 'manual' | 'watchlist';
        sourceSymbol?: string;
      }>;
    };

    expect(historyBody.symbol).toBeNull();
    expect(historyBody.limit).toBe(50);
    expect(historyBody.total).toBe(2);
    expect(historyBody.events).toHaveLength(2);
    expect(historyBody.events[0]).toMatchObject({
      symbol: 'ETHUSDT',
      metric: 'changePercent',
      threshold: -2,
      currentValue: -2.4,
      source: 'watchlist',
    });
    expect(historyBody.events[1]).toMatchObject({
      symbol: 'BTCUSDT',
      metric: 'price',
      threshold: 50000,
      currentValue: 51000,
      source: 'manual',
      sourceSymbol: 'BTCUSDT',
    });
    expect(historyBody.events[0].triggeredAt).toBe(watchlistTriggeredAt);
    expect(historyBody.events[1].triggeredAt).toBe(manualTriggeredAt);

    const symbolFilteredResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=btcusdt&limit=10',
    });

    expect(symbolFilteredResponse.statusCode).toBe(200);
    expect(symbolFilteredResponse.json()).toMatchObject({
      symbol: 'BTCUSDT',
      limit: 10,
      total: 1,
      events: [
        {
          symbol: 'BTCUSDT',
          metric: 'price',
          source: 'manual',
        },
      ],
    });

    const manualSourceResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?source=manual&limit=10',
    });

    expect(manualSourceResponse.statusCode).toBe(200);
    expect(manualSourceResponse.json()).toMatchObject({
      symbol: null,
      limit: 10,
      total: 1,
      events: [{ symbol: 'BTCUSDT', source: 'manual', triggeredAt: manualTriggeredAt }],
    });

    const watchlistSourceResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?source=watchlist&limit=10',
    });

    expect(watchlistSourceResponse.statusCode).toBe(200);
    expect(watchlistSourceResponse.json()).toMatchObject({
      symbol: null,
      limit: 10,
      total: 1,
      events: [{ symbol: 'ETHUSDT', source: 'watchlist', triggeredAt: watchlistTriggeredAt }],
    });

    const fromTsFilteredResponse = await app.inject({
      method: 'GET',
      url: `/api/alerts/history?fromTs=${watchlistTriggeredAt}`,
    });

    expect(fromTsFilteredResponse.statusCode).toBe(200);
    expect(fromTsFilteredResponse.json()).toMatchObject({
      symbol: null,
      limit: 50,
      total: 1,
      events: [{ symbol: 'ETHUSDT', triggeredAt: watchlistTriggeredAt }],
    });

    const toTsFilteredResponse = await app.inject({
      method: 'GET',
      url: `/api/alerts/history?toTs=${manualTriggeredAt}`,
    });

    expect(toTsFilteredResponse.statusCode).toBe(200);
    expect(toTsFilteredResponse.json()).toMatchObject({
      symbol: null,
      limit: 50,
      total: 1,
      events: [{ symbol: 'BTCUSDT', triggeredAt: manualTriggeredAt }],
    });

    const rangeFilteredResponse = await app.inject({
      method: 'GET',
      url: `/api/alerts/history?fromTs=${manualTriggeredAt}&toTs=${watchlistTriggeredAt}&limit=10`,
    });

    expect(rangeFilteredResponse.statusCode).toBe(200);
    expect(rangeFilteredResponse.json()).toMatchObject({
      symbol: null,
      limit: 10,
      total: 2,
      events: [{ triggeredAt: watchlistTriggeredAt }, { triggeredAt: manualTriggeredAt }],
    });

    const invalidRangeResponse = await app.inject({
      method: 'GET',
      url: `/api/alerts/history?fromTs=${watchlistTriggeredAt}&toTs=${manualTriggeredAt}`,
    });

    expect(invalidRangeResponse.statusCode).toBe(400);

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('keeps latest 500 events, applies default/max limit, and clears history', async () => {
    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
      },
    });

    expect(createRule.statusCode).toBe(201);

    for (let i = 0; i < 520; i += 1) {
      const check = await app.inject({
        method: 'POST',
        url: '/api/alerts/check',
        payload: {
          symbol: 'BTCUSDT',
          values: {
            symbol: 'BTCUSDT',
            lastPrice: 100 + i,
            changePercent: i / 10,
          },
        },
      });

      expect(check.statusCode).toBe(200);
    }

    const defaultLimitResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history',
    });

    expect(defaultLimitResponse.statusCode).toBe(200);
    const defaultBody = defaultLimitResponse.json() as {
      limit: number;
      total: number;
      events: Array<{ currentValue: number }>;
    };
    expect(defaultBody.limit).toBe(50);
    expect(defaultBody.total).toBe(500);
    expect(defaultBody.events).toHaveLength(50);
    expect(defaultBody.events[0].currentValue).toBe(619);
    expect(defaultBody.events[49].currentValue).toBe(570);

    const maxLimitResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?limit=999',
    });

    expect(maxLimitResponse.statusCode).toBe(200);
    const maxBody = maxLimitResponse.json() as {
      limit: number;
      total: number;
      events: Array<{ currentValue: number }>;
    };
    expect(maxBody.limit).toBe(200);
    expect(maxBody.total).toBe(500);
    expect(maxBody.events).toHaveLength(200);
    expect(maxBody.events[0].currentValue).toBe(619);
    expect(maxBody.events[199].currentValue).toBe(420);

    const filteredResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=BTCUSDT&limit=3',
    });

    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json()).toMatchObject({
      symbol: 'BTCUSDT',
      limit: 3,
      total: 500,
      events: [{ currentValue: 619 }, { currentValue: 618 }, { currentValue: 617 }],
    });

    const clearResponse = await app.inject({
      method: 'DELETE',
      url: '/api/alerts/history',
    });

    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toEqual({ ok: true, cleared: 500 });

    const afterClearResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?limit=200',
    });

    expect(afterClearResponse.statusCode).toBe(200);
    expect(afterClearResponse.json()).toEqual({
      symbol: null,
      limit: 200,
      total: 0,
      events: [],
    });
  });

  it('persists alert history across app recreation and clear', async () => {
    const createRule = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
      },
    });

    expect(createRule.statusCode).toBe(201);

    const firstCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 111,
          changePercent: 0.1,
        },
      },
    });

    const secondCheck = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 222,
          changePercent: 0.2,
        },
      },
    });

    expect(firstCheck.statusCode).toBe(200);
    expect(secondCheck.statusCode).toBe(200);

    await restartAppInstance();

    const afterRestartResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?limit=10',
    });

    expect(afterRestartResponse.statusCode).toBe(200);
    expect(afterRestartResponse.json()).toMatchObject({
      symbol: null,
      limit: 10,
      total: 2,
      events: [
        { symbol: 'BTCUSDT', currentValue: 222, source: 'manual' },
        { symbol: 'BTCUSDT', currentValue: 111, source: 'manual' },
      ],
    });

    const clearResponse = await app.inject({
      method: 'DELETE',
      url: '/api/alerts/history',
    });

    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toEqual({ ok: true, cleared: 2 });

    await restartAppInstance();

    const afterClearAndRestartResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?limit=10',
    });

    expect(afterClearAndRestartResponse.statusCode).toBe(200);
    expect(afterClearAndRestartResponse.json()).toEqual({
      symbol: null,
      limit: 10,
      total: 0,
      events: [],
    });
  });
});

describe('api alerts backward compatibility', () => {
  it('loads and evaluates legacy persisted rules without indicator fields', async () => {
    const legacyState = {
      version: 1,
      alertRules: [
        {
          id: 'legacy-rule-1',
          symbol: 'btcusdt',
          metric: 'price',
          operator: '>=',
          threshold: 100,
          cooldownSec: 0,
          createdAt: 1_750_030_000_000,
          lastTriggeredAt: null,
        },
      ],
      alertHistory: [],
      watchlists: [],
      drawings: [],
    };

    await writeFile(stateFile, `${JSON.stringify(legacyState, null, 2)}\n`, 'utf8');
    await restartAppInstance();

    const listedRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=BTCUSDT',
    });

    expect(listedRules.statusCode).toBe(200);
    expect((listedRules.json() as { rules: Array<{ id: string; indicatorConditions?: unknown[] }> }).rules).toMatchObject([
      {
        id: 'legacy-rule-1',
        symbol: 'BTCUSDT',
        metric: 'price',
        operator: '>=',
        threshold: 100,
        cooldownSec: 0,
        createdAt: 1_750_030_000_000,
        lastTriggeredAt: null,
        state: 'active',
        lastStateTransition: {
          to: 'active',
          reason: 'ruleCreated',
        },
      },
    ]);

    const check = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: 'BTCUSDT',
        values: {
          symbol: 'BTCUSDT',
          lastPrice: 120,
          changePercent: 0.3,
        },
      },
    });

    expect(check.statusCode).toBe(200);
    expect((check.json() as { checkedRuleCount: number; triggeredCount: number }).checkedRuleCount).toBe(1);
    expect((check.json() as { checkedRuleCount: number; triggeredCount: number }).triggeredCount).toBe(1);
  });
});

describe('api drawings persistence', () => {
  it('saves and loads drawings with symbol/interval normalization from legacy lines payload', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: ' btcusdt ',
        interval: ' 1d ',
        lines: [{ id: 'line-fixed', price: 100000.5 }, { price: 99500.25 }],
      },
    });

    expect(saveResponse.statusCode).toBe(200);

    const saved = saveResponse.json() as {
      symbol: string;
      interval: string;
      lines: Array<{ id: string; price: number }>;
      drawings: Array<Record<string, unknown>>;
    };

    expect(saved.symbol).toBe('BTCUSDT');
    expect(saved.interval).toBe('1D');
    expect(saved.lines).toHaveLength(2);
    expect(saved.lines[0]).toEqual({ id: 'line-fixed', price: 100000.5 });
    expect(saved.lines[1].id).toMatch(/^line_/);
    expect(saved.lines[1].price).toBe(99500.25);
    expect(saved.drawings).toEqual([
      { id: 'line-fixed', type: 'horizontal', price: 100000.5, visible: true, locked: false },
      { id: saved.lines[1].id, type: 'horizontal', price: 99500.25, visible: true, locked: false },
    ]);

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/drawings?symbol=btcusdt&interval=1d',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      symbol: 'BTCUSDT',
      interval: '1D',
      drawings: saved.drawings,
      lines: saved.lines,
    });
  });

  it('saves and loads mixed drawing primitives', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'ETHUSDT',
        interval: '60',
        drawings: [
          { id: 'h-fixed', type: 'horizontal', price: 3210.5 },
          { id: 'v-fixed', type: 'vertical', time: 1735689600 },
          { id: 'trend-fixed', type: 'trendline', startTime: 1735693200, startPrice: 3201.2, endTime: 1735696800, endPrice: 3300.4 },
          { id: 'ray-fixed', type: 'ray', startTime: 1735695000, startPrice: 3220.4, endTime: 1735698600, endPrice: 3340.2 },
          { type: 'rectangle', startTime: 1735695000, startPrice: 3188.7, endTime: 1735700400, endPrice: 3345.1 },
          { id: 'note-fixed', type: 'note', time: 1735700400, price: 3299.1, text: '  breakout  ' },
        ],
      },
    });

    expect(saveResponse.statusCode).toBe(200);

    const saved = saveResponse.json() as {
      symbol: string;
      interval: string;
      lines: Array<{ id: string; price: number }>;
      drawings: Array<Record<string, unknown>>;
    };

    expect(saved.symbol).toBe('ETHUSDT');
    expect(saved.interval).toBe('60');
    expect(saved.drawings).toHaveLength(6);
    expect(saved.drawings[0]).toEqual({ id: 'h-fixed', type: 'horizontal', price: 3210.5, visible: true, locked: false });
    expect(saved.drawings[1]).toEqual({ id: 'v-fixed', type: 'vertical', time: 1735689600, visible: true, locked: false });
    expect(saved.drawings[2]).toEqual({
      id: 'trend-fixed',
      type: 'trendline',
      startTime: 1735693200,
      startPrice: 3201.2,
      endTime: 1735696800,
      endPrice: 3300.4,
      visible: true,
      locked: false,
    });
    expect(saved.drawings[3]).toEqual({
      id: 'ray-fixed',
      type: 'ray',
      startTime: 1735695000,
      startPrice: 3220.4,
      endTime: 1735698600,
      endPrice: 3340.2,
      visible: true,
      locked: false,
    });
    expect(saved.drawings[4]).toEqual({
      id: expect.stringMatching(/^rect_/),
      type: 'rectangle',
      startTime: 1735695000,
      startPrice: 3188.7,
      endTime: 1735700400,
      endPrice: 3345.1,
      visible: true,
      locked: false,
    });
    expect(saved.drawings[5]).toEqual({
      id: 'note-fixed',
      type: 'note',
      time: 1735700400,
      price: 3299.1,
      text: 'breakout',
      visible: true,
      locked: false,
    });
    expect(saved.lines).toEqual([{ id: 'h-fixed', price: 3210.5 }]);

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/drawings?symbol=ethusdt&interval=60',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      symbol: 'ETHUSDT',
      interval: '60',
      drawings: saved.drawings,
      lines: saved.lines,
    });
  });

  it('persists drawings across app recreation', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'ethusdt',
        interval: '240',
        drawings: [
          { id: 'persist-h', type: 'horizontal', price: 2500 },
          { id: 'persist-v', type: 'vertical', time: 1735700000 },
          { id: 'persist-trend', type: 'trendline', startTime: 1735700000, startPrice: 2488.4, endTime: 1735703600, endPrice: 2522.7 },
          { id: 'persist-ray', type: 'ray', startTime: 1735700900, startPrice: 2494.4, endTime: 1735705400, endPrice: 2548.3 },
          { id: 'persist-rect', type: 'rectangle', startTime: 1735701800, startPrice: 2475.2, endTime: 1735707200, endPrice: 2550.5 },
          { id: 'persist-note', type: 'note', time: 1735707200, price: 2512.3, text: 'hold' },
        ],
      },
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toEqual({
      symbol: 'ETHUSDT',
      interval: '240',
      drawings: [
        { id: 'persist-h', type: 'horizontal', price: 2500, visible: true, locked: false },
        { id: 'persist-v', type: 'vertical', time: 1735700000, visible: true, locked: false },
        {
          id: 'persist-trend',
          type: 'trendline',
          startTime: 1735700000,
          startPrice: 2488.4,
          endTime: 1735703600,
          endPrice: 2522.7,
          visible: true,
          locked: false,
        },
        {
          id: 'persist-ray',
          type: 'ray',
          startTime: 1735700900,
          startPrice: 2494.4,
          endTime: 1735705400,
          endPrice: 2548.3,
          visible: true,
          locked: false,
        },
        {
          id: 'persist-rect',
          type: 'rectangle',
          startTime: 1735701800,
          startPrice: 2475.2,
          endTime: 1735707200,
          endPrice: 2550.5,
          visible: true,
          locked: false,
        },
        { id: 'persist-note', type: 'note', time: 1735707200, price: 2512.3, text: 'hold', visible: true, locked: false },
      ],
      lines: [{ id: 'persist-h', price: 2500 }],
    });

    await restartAppInstance();

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/drawings?symbol=ETHUSDT&interval=240',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      symbol: 'ETHUSDT',
      interval: '240',
      drawings: [
        { id: 'persist-h', type: 'horizontal', price: 2500, visible: true, locked: false },
        { id: 'persist-v', type: 'vertical', time: 1735700000, visible: true, locked: false },
        {
          id: 'persist-trend',
          type: 'trendline',
          startTime: 1735700000,
          startPrice: 2488.4,
          endTime: 1735703600,
          endPrice: 2522.7,
          visible: true,
          locked: false,
        },
        {
          id: 'persist-ray',
          type: 'ray',
          startTime: 1735700900,
          startPrice: 2494.4,
          endTime: 1735705400,
          endPrice: 2548.3,
          visible: true,
          locked: false,
        },
        {
          id: 'persist-rect',
          type: 'rectangle',
          startTime: 1735701800,
          startPrice: 2475.2,
          endTime: 1735707200,
          endPrice: 2550.5,
          visible: true,
          locked: false,
        },
        { id: 'persist-note', type: 'note', time: 1735707200, price: 2512.3, text: 'hold', visible: true, locked: false },
      ],
      lines: [{ id: 'persist-h', price: 2500 }],
    });
  });

  it('loads legacy persisted drawings without flags using visible/locked defaults', async () => {
    await writeFile(
      stateFile,
      `${JSON.stringify(
        {
          version: 4,
          drawings: [
            {
              symbol: 'BTCUSDT',
              interval: '60',
              drawings: [
                { id: 'legacy-h', type: 'horizontal', price: 101.5 },
                { id: 'legacy-v', type: 'vertical', time: 1735701000 },
                {
                  id: 'legacy-trend',
                  type: 'trendline',
                  startTime: 1735701000,
                  startPrice: 100,
                  endTime: 1735704600,
                  endPrice: 120,
                },
                {
                  id: 'legacy-ray',
                  type: 'ray',
                  startTime: 1735701000,
                  startPrice: 100,
                  endTime: 1735704600,
                  endPrice: 130,
                },
                {
                  id: 'legacy-rect',
                  type: 'rectangle',
                  startTime: 1735701000,
                  startPrice: 90,
                  endTime: 1735704600,
                  endPrice: 110,
                },
                { id: 'legacy-note', type: 'note', time: 1735704600, price: 108, text: 'memo' },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    await restartAppInstance();

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/drawings?symbol=BTCUSDT&interval=60',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      symbol: 'BTCUSDT',
      interval: '60',
      drawings: [
        { id: 'legacy-h', type: 'horizontal', price: 101.5, visible: true, locked: false },
        { id: 'legacy-v', type: 'vertical', time: 1735701000, visible: true, locked: false },
        {
          id: 'legacy-trend',
          type: 'trendline',
          startTime: 1735701000,
          startPrice: 100,
          endTime: 1735704600,
          endPrice: 120,
          visible: true,
          locked: false,
        },
        {
          id: 'legacy-ray',
          type: 'ray',
          startTime: 1735701000,
          startPrice: 100,
          endTime: 1735704600,
          endPrice: 130,
          visible: true,
          locked: false,
        },
        {
          id: 'legacy-rect',
          type: 'rectangle',
          startTime: 1735701000,
          startPrice: 90,
          endTime: 1735704600,
          endPrice: 110,
          visible: true,
          locked: false,
        },
        { id: 'legacy-note', type: 'note', time: 1735704600, price: 108, text: 'memo', visible: true, locked: false },
      ],
      lines: [{ id: 'legacy-h', price: 101.5 }],
    });
  });

  it('rejects invalid drawings query/body payloads', async () => {
    const invalidQuery = await app.inject({
      method: 'GET',
      url: '/api/drawings?symbol=BTCUSDT',
    });

    expect(invalidQuery.statusCode).toBe(400);

    const invalidBody = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        lines: [{ price: 'bad-price' }],
      },
    });

    expect(invalidBody.statusCode).toBe(400);

    const invalidVerticalDrawing = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        drawings: [{ type: 'vertical', price: 10000 }],
      },
    });

    expect(invalidVerticalDrawing.statusCode).toBe(400);

    const invalidRectangleDrawing = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        drawings: [{ type: 'rectangle', startTime: 1735689600, startPrice: 100, endPrice: 120 }],
      },
    });

    expect(invalidRectangleDrawing.statusCode).toBe(400);

    const invalidRayDrawing = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        drawings: [{ type: 'ray', startTime: 1735689600, startPrice: 100, endTime: 1735693200 }],
      },
    });

    expect(invalidRayDrawing.statusCode).toBe(400);

    const invalidNoteDrawing = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        drawings: [{ type: 'note', time: 1735689600, price: 100, text: '   ' }],
      },
    });

    expect(invalidNoteDrawing.statusCode).toBe(400);

    const invalidVisibleFlag = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        drawings: [{ type: 'horizontal', price: 100, visible: 'yes' }],
      },
    });

    expect(invalidVisibleFlag.statusCode).toBe(400);

    const invalidLockedFlag = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'BTCUSDT',
        interval: '60',
        drawings: [{ type: 'vertical', time: 1735689600, locked: 1 }],
      },
    });

    expect(invalidLockedFlag.statusCode).toBe(400);
  });
});
