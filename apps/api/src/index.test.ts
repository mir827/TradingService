import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let app!: FastifyInstance;
let stateDir = '';
let stateFile = '';

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
  process.env.TRADINGSERVICE_STATE_FILE = stateFile;
  app = await createAppInstance();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (app) {
    await app.close();
  }
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
      };
    };

    expect(created.rule.symbol).toBe('BTCUSDT');
    expect(created.rule.metric).toBe('price');
    expect(created.rule.operator).toBe('>=');
    expect(created.rule.threshold).toBe(100000);
    expect(created.rule.cooldownSec).toBe(120);
    expect(created.rule.lastTriggeredAt).toBeNull();

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
      events: Array<{ ruleId: string; triggeredAt: number }>;
    };
    expect(firstBody.events).toHaveLength(1);

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
      events: Array<{ ruleId: string; triggeredAt: number }>;
    };
    expect(secondBody.events).toHaveLength(0);

    const listedRules = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=SOLUSDT',
    });

    expect(listedRules.statusCode).toBe(200);
    const rule = (listedRules.json() as { rules: Array<{ lastTriggeredAt: number | null }> }).rules[0];
    expect(rule.lastTriggeredAt).toBe(firstBody.checkedAt);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('api alerts history', () => {
  it('appends manual/watchlist triggered events and supports symbol filtering', async () => {
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

    const filteredResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=btcusdt&limit=10',
    });

    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json()).toMatchObject({
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

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('applies default/max limit and clears history', async () => {
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

    for (let i = 0; i < 55; i += 1) {
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
    expect(defaultBody.total).toBe(55);
    expect(defaultBody.events).toHaveLength(50);
    expect(defaultBody.events[0].currentValue).toBe(154);
    expect(defaultBody.events[49].currentValue).toBe(105);

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
    expect(maxBody.total).toBe(55);
    expect(maxBody.events).toHaveLength(55);
    expect(maxBody.events[0].currentValue).toBe(154);
    expect(maxBody.events[54].currentValue).toBe(100);

    const filteredResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/history?symbol=BTCUSDT&limit=3',
    });

    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json()).toMatchObject({
      symbol: 'BTCUSDT',
      limit: 3,
      total: 55,
      events: [{ currentValue: 154 }, { currentValue: 153 }, { currentValue: 152 }],
    });

    const clearResponse = await app.inject({
      method: 'DELETE',
      url: '/api/alerts/history',
    });

    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toEqual({ ok: true, cleared: 55 });

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
      drawings: Array<{ id: string; type: 'horizontal' | 'vertical'; price?: number; time?: number }>;
    };

    expect(saved.symbol).toBe('BTCUSDT');
    expect(saved.interval).toBe('1D');
    expect(saved.lines).toHaveLength(2);
    expect(saved.lines[0]).toEqual({ id: 'line-fixed', price: 100000.5 });
    expect(saved.lines[1].id).toMatch(/^line_/);
    expect(saved.lines[1].price).toBe(99500.25);
    expect(saved.drawings).toEqual([
      { id: 'line-fixed', type: 'horizontal', price: 100000.5 },
      { id: saved.lines[1].id, type: 'horizontal', price: 99500.25 },
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

  it('saves and loads mixed horizontal/vertical drawings', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/drawings',
      payload: {
        symbol: 'ETHUSDT',
        interval: '60',
        drawings: [
          { id: 'h-fixed', type: 'horizontal', price: 3210.5 },
          { id: 'v-fixed', type: 'vertical', time: 1735689600 },
          { type: 'vertical', time: 1735693200 },
        ],
      },
    });

    expect(saveResponse.statusCode).toBe(200);

    const saved = saveResponse.json() as {
      symbol: string;
      interval: string;
      lines: Array<{ id: string; price: number }>;
      drawings: Array<{ id: string; type: 'horizontal' | 'vertical'; price?: number; time?: number }>;
    };

    expect(saved.symbol).toBe('ETHUSDT');
    expect(saved.interval).toBe('60');
    expect(saved.drawings).toHaveLength(3);
    expect(saved.drawings[0]).toEqual({ id: 'h-fixed', type: 'horizontal', price: 3210.5 });
    expect(saved.drawings[1]).toEqual({ id: 'v-fixed', type: 'vertical', time: 1735689600 });
    expect(saved.drawings[2]).toEqual({
      id: expect.stringMatching(/^vline_/),
      type: 'vertical',
      time: 1735693200,
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
        ],
      },
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toEqual({
      symbol: 'ETHUSDT',
      interval: '240',
      drawings: [
        { id: 'persist-h', type: 'horizontal', price: 2500 },
        { id: 'persist-v', type: 'vertical', time: 1735700000 },
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
        { id: 'persist-h', type: 'horizontal', price: 2500 },
        { id: 'persist-v', type: 'vertical', time: 1735700000 },
      ],
      lines: [{ id: 'persist-h', price: 2500 }],
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
  });
});
