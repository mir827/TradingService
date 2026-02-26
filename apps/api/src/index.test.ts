import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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

afterAll(async () => {
  await clearAlertRules();
  await app.close();
});
