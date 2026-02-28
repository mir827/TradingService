import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toRequestUrl(input: string | URL | Request) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function run() {
  const previousSkipKrxPreload = process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD;
  const previousStateFile = process.env.TRADINGSERVICE_STATE_FILE;
  const originalFetch = globalThis.fetch;

  const stateDir = await mkdtemp(join(tmpdir(), 'tradingservice-kr-smoke-'));
  const stateFile = join(stateDir, 'runtime-state.json');

  let app: FastifyInstance | null = null;

  try {
    process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD = '1';
    process.env.TRADINGSERVICE_STATE_FILE = stateFile;

    globalThis.fetch = (async (input) => {
      const url = new URL(toRequestUrl(input));

      if (url.hostname === 'query1.finance.yahoo.com' && url.pathname === '/v8/finance/chart/005930.KS') {
        return jsonResponse({
          chart: {
            result: [
              {
                meta: {
                  regularMarketPrice: 71500,
                  previousClose: 70000,
                  regularMarketDayHigh: 71800,
                  regularMarketDayLow: 69800,
                  regularMarketVolume: 1234567,
                },
              },
            ],
          },
        });
      }

      return jsonResponse({ error: 'unexpected request', url: url.toString() }, 404);
    }) as typeof fetch;

    const module = await import('../src/index.js');
    app = module.app as FastifyInstance;

    const quoteResponse = await app.inject({
      method: 'GET',
      url: '/api/quote?symbol=005930.KS',
    });
    assert.equal(quoteResponse.statusCode, 200, 'quote route should succeed');
    const quoteBody = quoteResponse.json() as {
      symbol?: string;
      nxt?: {
        supported?: boolean;
        available?: boolean;
        status?: string;
        reason?: string;
      };
    };
    assert.equal(quoteBody.symbol, '005930.KS');
    assert.equal(quoteBody.nxt?.supported, true);
    assert.equal(quoteBody.nxt?.available, false);
    assert.equal(quoteBody.nxt?.status, 'unavailable');
    assert.equal(quoteBody.nxt?.reason, 'NXT_FEED_NOT_CONFIGURED');

    const marketStatusResponse = await app.inject({
      method: 'GET',
      url: '/api/market-status?market=KOSPI',
    });
    assert.equal(marketStatusResponse.statusCode, 200, 'market-status route should succeed');
    const marketStatusBody = marketStatusResponse.json() as {
      market?: string;
      venues?: {
        krx?: { venue?: string; phase?: string };
        nxt?: { venue?: string; phase?: string; unavailableReason?: string };
      };
    };
    assert.equal(marketStatusBody.market, 'KOSPI');
    assert.equal(marketStatusBody.venues?.krx?.venue, 'KRX');
    assert.ok(
      marketStatusBody.venues?.krx?.phase === 'OPEN' ||
        marketStatusBody.venues?.krx?.phase === 'PRE_MARKET' ||
        marketStatusBody.venues?.krx?.phase === 'POST_MARKET' ||
        marketStatusBody.venues?.krx?.phase === 'CLOSED',
      'KRX phase should be one of supported values',
    );
    assert.equal(marketStatusBody.venues?.nxt?.venue, 'NXT');
    assert.equal(marketStatusBody.venues?.nxt?.phase, 'UNAVAILABLE');
    assert.equal(marketStatusBody.venues?.nxt?.unavailableReason, 'NXT_STATUS_NOT_INTEGRATED');

    const watchlistSaveResponse = await app.inject({
      method: 'PUT',
      url: '/api/watchlist',
      payload: {
        name: 'kr-smoke',
        items: [
          {
            symbol: '005930.KS',
            code: '005930',
            name: '삼성전자',
            market: 'KOSPI',
            exchange: 'KRX',
            venue: 'NXT',
          },
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin / USDT',
            market: 'CRYPTO',
            exchange: 'BINANCE',
            venue: 'KRX',
          },
        ],
      },
    });
    assert.equal(watchlistSaveResponse.statusCode, 200, 'watchlist save should succeed');

    const watchlistLoadResponse = await app.inject({
      method: 'GET',
      url: '/api/watchlist?name=kr-smoke',
    });
    assert.equal(watchlistLoadResponse.statusCode, 200, 'watchlist load should succeed');
    const watchlistBody = watchlistLoadResponse.json() as {
      items?: Array<{ symbol?: string; venue?: string }>;
    };
    assert.ok(
      watchlistBody.items?.some((item) => item.symbol === '005930.KS' && item.venue === 'NXT'),
      'KR watchlist venue metadata should persist',
    );
    assert.ok(
      watchlistBody.items?.some((item) => item.symbol === 'BTCUSDT' && item.venue === undefined),
      'Non-KR watchlist item should ignore venue metadata',
    );

    const createRuleResponse = await app.inject({
      method: 'POST',
      url: '/api/alerts/rules',
      payload: {
        symbol: '005930.KS',
        venue: 'NXT',
        metric: 'price',
        operator: '>=',
        threshold: 70000,
        cooldownSec: 0,
      },
    });
    assert.equal(createRuleResponse.statusCode, 201, 'alerts/rules create should succeed');

    const listRulesResponse = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules?symbol=005930.KS&venue=NXT',
    });
    assert.equal(listRulesResponse.statusCode, 200, 'alerts/rules list should succeed');
    const listRulesBody = listRulesResponse.json() as {
      rules?: Array<{ symbol?: string; venue?: string }>;
    };
    assert.equal(listRulesBody.rules?.length, 1);
    assert.equal(listRulesBody.rules?.[0]?.symbol, '005930.KS');
    assert.equal(listRulesBody.rules?.[0]?.venue, 'NXT');

    const checkAlertsResponse = await app.inject({
      method: 'POST',
      url: '/api/alerts/check',
      payload: {
        symbol: '005930.KS',
        venue: 'NXT',
        values: {
          symbol: '005930.KS',
          lastPrice: 71000,
          changePercent: 1.3,
        },
      },
    });
    assert.equal(checkAlertsResponse.statusCode, 200, 'alerts/check should succeed');
    const checkAlertsBody = checkAlertsResponse.json() as {
      checkedRuleCount?: number;
      triggeredCount?: number;
      triggered?: Array<{ symbol?: string; venue?: string }>;
    };
    assert.equal(checkAlertsBody.checkedRuleCount, 1);
    assert.equal(checkAlertsBody.triggeredCount, 1);
    assert.equal(checkAlertsBody.triggered?.[0]?.symbol, '005930.KS');
    assert.equal(checkAlertsBody.triggered?.[0]?.venue, 'NXT');

    console.log('KR regression smoke passed: quote, market-status, watchlist, alerts/rules, alerts/check');
  } finally {
    if (app) {
      await app.close();
    }

    if (previousSkipKrxPreload === undefined) {
      delete process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD;
    } else {
      process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD = previousSkipKrxPreload;
    }

    if (previousStateFile === undefined) {
      delete process.env.TRADINGSERVICE_STATE_FILE;
    } else {
      process.env.TRADINGSERVICE_STATE_FILE = previousStateFile;
    }

    globalThis.fetch = originalFetch;
    await rm(stateDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('KR regression smoke failed');
  console.error(error);
  process.exitCode = 1;
});
