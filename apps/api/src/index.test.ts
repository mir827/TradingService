import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './index.js';

type AlertRule = {
  id: string;
};

async function clearAlertRules() {
  const response = await app.inject({
    method: 'GET',
    url: '/api/alerts/rules',
  });

  const body = response.json() as { rules?: AlertRule[] };
  const rules = body.rules ?? [];

  await Promise.all(
    rules.map((rule) =>
      app.inject({
        method: 'DELETE',
        url: `/api/alerts/rules/${rule.id}`,
      }),
    ),
  );
}

beforeEach(async () => {
  await clearAlertRules();
});

afterEach(() => {
  vi.restoreAllMocks();
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
});

describe('api drawings persistence', () => {
  it('saves and loads drawings with symbol/interval normalization', async () => {
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
    };

    expect(saved.symbol).toBe('BTCUSDT');
    expect(saved.interval).toBe('1D');
    expect(saved.lines).toHaveLength(2);
    expect(saved.lines[0]).toEqual({ id: 'line-fixed', price: 100000.5 });
    expect(saved.lines[1].id).toMatch(/^line_/);
    expect(saved.lines[1].price).toBe(99500.25);

    const loadResponse = await app.inject({
      method: 'GET',
      url: '/api/drawings?symbol=btcusdt&interval=1d',
    });

    expect(loadResponse.statusCode).toBe(200);
    expect(loadResponse.json()).toEqual({
      symbol: 'BTCUSDT',
      interval: '1D',
      lines: saved.lines,
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
  });
});

afterAll(async () => {
  await clearAlertRules();
  await app.close();
});
