import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

type MarketType = 'CRYPTO' | 'KOSPI' | 'KOSDAQ';

type SymbolItem = {
  symbol: string;
  code?: string;
  name: string;
  market: MarketType;
  exchange?: string;
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Quote = {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
};

type AlertMetric = 'price' | 'changePercent';
type AlertOperator = '>=' | '<=' | '>' | '<';

type AlertRule = {
  id: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  cooldownSec: number;
  createdAt: number;
  lastTriggeredAt: number | null;
};

type MarketStatusState = 'OPEN' | 'CLOSED';
type MarketStatusReason = 'WEEKEND' | 'OUT_OF_SESSION' | 'SESSION_ACTIVE';

type MarketStatusPayload = {
  market: MarketType;
  status: MarketStatusState;
  reason: MarketStatusReason;
  checkedAt: number;
  timezone: string;
  session: {
    open: string;
    close: string;
    text: string;
  };
};

export const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

const KRX_LIST_URL = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13';
const KRX_REFRESH_MS = 1000 * 60 * 60 * 12;

const cryptoSymbols: SymbolItem[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin / USDT', market: 'CRYPTO', exchange: 'BINANCE' },
  { symbol: 'ETHUSDT', name: 'Ethereum / USDT', market: 'CRYPTO', exchange: 'BINANCE' },
  { symbol: 'SOLUSDT', name: 'Solana / USDT', market: 'CRYPTO', exchange: 'BINANCE' },
  { symbol: 'BNBUSDT', name: 'BNB / USDT', market: 'CRYPTO', exchange: 'BINANCE' },
  { symbol: 'XRPUSDT', name: 'XRP / USDT', market: 'CRYPTO', exchange: 'BINANCE' },
];

const krxFallbackSymbols: SymbolItem[] = [
  { symbol: '005930.KS', code: '005930', name: '삼성전자', market: 'KOSPI', exchange: 'KRX' },
  { symbol: '000660.KS', code: '000660', name: 'SK하이닉스', market: 'KOSPI', exchange: 'KRX' },
  { symbol: '035420.KS', code: '035420', name: 'NAVER', market: 'KOSPI', exchange: 'KRX' },
  { symbol: '035720.KS', code: '035720', name: '카카오', market: 'KOSPI', exchange: 'KRX' },
  { symbol: '068270.KS', code: '068270', name: '셀트리온', market: 'KOSPI', exchange: 'KRX' },
  { symbol: '247540.KQ', code: '247540', name: '에코프로비엠', market: 'KOSDAQ', exchange: 'KRX' },
  { symbol: '086520.KQ', code: '086520', name: '에코프로', market: 'KOSDAQ', exchange: 'KRX' },
  { symbol: '293490.KQ', code: '293490', name: '카카오게임즈', market: 'KOSDAQ', exchange: 'KRX' },
];

let krxSymbols: SymbolItem[] = [];
let krxLoadedAtMs = 0;

const quoteCache = new Map<string, { expiresAt: number; value: Quote }>();
const candleCache = new Map<string, { expiresAt: number; value: Candle[] }>();
const alertRuleStore = new Map<string, AlertRule>();

const cryptoIntervalMap: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '45': '45m',
  '60': '1h',
  '120': '2h',
  '240': '4h',
  '1D': '1d',
  '1W': '1w',
};

const krxIntervalMap: Record<string, string> = {
  '1': '1m',
  '3': '5m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '45': '60m',
  '60': '60m',
  '120': '60m',
  '240': '1d',
  '1D': '1d',
  '1W': '1wk',
};

const krxRangeMap: Record<string, string> = {
  '1': '5d',
  '3': '1mo',
  '5': '1mo',
  '15': '1mo',
  '30': '1mo',
  '45': '1mo',
  '60': '3mo',
  '120': '6mo',
  '240': '1y',
  '1D': '2y',
  '1W': '5y',
};

const KRX_TIMEZONE = 'Asia/Seoul';
const KRX_SESSION_OPEN = '09:00';
const KRX_SESSION_CLOSE = '15:30';
const KRX_SESSION_TEXT = `${KRX_SESSION_OPEN}-${KRX_SESSION_CLOSE} KST`;
const KRX_SESSION_OPEN_MINUTE = 9 * 60;
const KRX_SESSION_CLOSE_MINUTE = 15 * 60 + 30;

const krxTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KRX_TIMEZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const candleQuerySchema = z.object({
  symbol: z.string().default('BTCUSDT'),
  interval: z.string().default('60'),
  limit: z.coerce.number().int().min(50).max(1000).default(400),
});

const quoteQuerySchema = z.object({
  symbol: z.string().default('BTCUSDT'),
});

const marketStatusQuerySchema = z.object({
  market: z.enum(['CRYPTO', 'KOSPI', 'KOSDAQ']),
});

const searchQuerySchema = z.object({
  query: z.string().min(1),
  market: z.enum(['ALL', 'CRYPTO', 'KOSPI', 'KOSDAQ']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const alertRuleQuerySchema = z.object({
  symbol: z.string().optional(),
});

const alertRuleCreateSchema = z.object({
  symbol: z.string().min(1),
  metric: z.enum(['price', 'changePercent']),
  operator: z.enum(['>=', '<=', '>', '<']),
  threshold: z.number().finite(),
  cooldownSec: z.coerce.number().int().min(0).max(86400).default(0),
});

const alertRuleDeleteParamSchema = z.object({
  id: z.string().min(1),
});

const alertCheckBodySchema = z.object({
  symbol: z.string().optional(),
  values: z
    .object({
      symbol: z.string().optional(),
      lastPrice: z.number().finite(),
      changePercent: z.number().finite(),
    })
    .optional(),
});

function stripTags(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortTicker(symbol: string) {
  return symbol.replace(/\.K[QS]$/i, '');
}

function isKrxSymbol(symbol: string) {
  return /\.K[QS]$/i.test(symbol);
}

function getCachedQuote(symbol: string) {
  const cache = quoteCache.get(symbol);
  if (!cache) return null;
  if (cache.expiresAt < Date.now()) {
    quoteCache.delete(symbol);
    return null;
  }
  return cache.value;
}

function setCachedQuote(symbol: string, value: Quote, ttlMs = 8000) {
  quoteCache.set(symbol, { expiresAt: Date.now() + ttlMs, value });
}

function getCachedCandles(key: string) {
  const cache = candleCache.get(key);
  if (!cache) return null;
  if (cache.expiresAt < Date.now()) {
    candleCache.delete(key);
    return null;
  }
  return cache.value;
}

function setCachedCandles(key: string, value: Candle[], ttlMs = 15000) {
  candleCache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function createAlertRuleId() {
  return `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function getKrxStatus(checkedAt: number): Omit<MarketStatusPayload, 'market' | 'checkedAt'> {
  const parts = krxTimeFormatter.formatToParts(new Date(checkedAt));
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const currentMinute = hour * 60 + minute;
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const inSession = currentMinute >= KRX_SESSION_OPEN_MINUTE && currentMinute <= KRX_SESSION_CLOSE_MINUTE;

  return {
    status: !weekend && inSession ? 'OPEN' : 'CLOSED',
    reason: weekend ? 'WEEKEND' : inSession ? 'SESSION_ACTIVE' : 'OUT_OF_SESSION',
    timezone: KRX_TIMEZONE,
    session: {
      open: KRX_SESSION_OPEN,
      close: KRX_SESSION_CLOSE,
      text: KRX_SESSION_TEXT,
    },
  };
}

function getMarketStatus(market: MarketType, checkedAt = Date.now()): MarketStatusPayload {
  if (market === 'CRYPTO') {
    return {
      market,
      status: 'OPEN',
      reason: 'SESSION_ACTIVE',
      checkedAt,
      timezone: 'UTC',
      session: {
        open: '00:00',
        close: '23:59',
        text: '24/7',
      },
    };
  }

  return {
    market,
    checkedAt,
    ...getKrxStatus(checkedAt),
  };
}

function serializeAlertRule(rule: AlertRule) {
  return {
    ...rule,
  };
}

function compareWithOperator(value: number, operator: AlertOperator, threshold: number) {
  if (operator === '>=') return value >= threshold;
  if (operator === '<=') return value <= threshold;
  if (operator === '>') return value > threshold;
  return value < threshold;
}

function selectMetricValue(metric: AlertMetric, values: { lastPrice: number; changePercent: number }) {
  return metric === 'price' ? values.lastPrice : values.changePercent;
}

async function refreshKrxSymbols(force = false) {
  if (!force && krxSymbols.length > 0 && Date.now() - krxLoadedAtMs < KRX_REFRESH_MS) {
    return;
  }

  const response = await fetch(KRX_LIST_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage',
    },
  });

  if (!response.ok) {
    throw new Error(`KRX symbol source returned ${response.status}`);
  }

  const html = new TextDecoder('euc-kr').decode(await response.arrayBuffer());
  const rows = html.split(/<tr>/gi).slice(1);
  const parsed: SymbolItem[] = [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      stripTags(match[1]),
    );

    if (cells.length < 3) continue;

    const name = cells[0];
    const marketRaw = cells[1];
    const code = cells[2].replace(/\s+/g, '');

    if (!/^\d{6}$/.test(code)) continue;

    let market: MarketType | null = null;

    if (marketRaw.includes('유가')) {
      market = 'KOSPI';
    } else if (marketRaw.includes('코스닥')) {
      market = 'KOSDAQ';
    } else {
      continue;
    }

    parsed.push({
      symbol: `${code}${market === 'KOSPI' ? '.KS' : '.KQ'}`,
      code,
      name,
      market,
      exchange: 'KRX',
    });
  }

  const dedup = new Map<string, SymbolItem>();
  for (const item of parsed) {
    if (!dedup.has(item.symbol)) {
      dedup.set(item.symbol, item);
    }
  }

  krxSymbols = [...dedup.values()];
  krxLoadedAtMs = Date.now();
}

function getDefaultSymbols() {
  const symbolMap = new Map(krxSymbols.map((item) => [item.symbol, item]));
  const priority = [
    '005930.KS',
    '000660.KS',
    '035420.KS',
    '035720.KS',
    '068270.KS',
    '247540.KQ',
    '086520.KQ',
    '293490.KQ',
  ];

  const selectedKrx = priority
    .map((symbol) => symbolMap.get(symbol) ?? krxFallbackSymbols.find((item) => item.symbol === symbol))
    .filter((item): item is SymbolItem => Boolean(item));

  return [...cryptoSymbols, ...selectedKrx];
}

function scoreByQuery(item: SymbolItem, queryLower: string, queryDigits: string) {
  const short = shortTicker(item.symbol).toLowerCase();
  const full = item.symbol.toLowerCase();
  const name = item.name.toLowerCase();
  const code = item.code ?? '';
  const paddedDigits =
    queryDigits.length > 0 && queryDigits.length < 6 ? queryDigits.padStart(6, '0') : queryDigits;

  let score = 0;

  if (queryLower === short || queryLower === full || (paddedDigits && code === paddedDigits)) score += 250;
  if (paddedDigits && code.startsWith(paddedDigits)) score += 160;
  if (name.startsWith(queryLower)) score += 140;
  if (short.startsWith(queryLower)) score += 120;
  if (name.includes(queryLower)) score += 60;
  if (full.includes(queryLower)) score += 45;

  return score;
}

async function fetchCryptoCandles(symbol: string, interval: string, limit: number) {
  const normalizedInterval = cryptoIntervalMap[interval] ?? '1h';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${normalizedInterval}&limit=${limit}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`crypto candles upstream error (${response.status})`);
  }

  const raw = (await response.json()) as Array<
    [
      number,
      string,
      string,
      string,
      string,
      string,
      number,
      string,
      number,
      string,
      string,
      string,
    ]
  >;

  return raw.map((c) => ({
    time: Math.floor(c[0] / 1000),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
  }));
}

async function fetchKrxCandles(symbol: string, interval: string, limit: number) {
  const normalizedInterval = krxIntervalMap[interval] ?? '60m';
  const range = krxRangeMap[interval] ?? '3mo';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${normalizedInterval}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) {
    throw new Error(`krx candles upstream error (${response.status})`);
  }

  const json = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];

  if (!timestamps.length || !quote) {
    return [];
  }

  const open = quote.open ?? [];
  const high = quote.high ?? [];
  const low = quote.low ?? [];
  const close = quote.close ?? [];
  const volume = quote.volume ?? [];

  const candles: Candle[] = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const o = open[i];
    const h = high[i];
    const l = low[i];
    const c = close[i];

    if ([o, h, l, c].some((v) => v === null || v === undefined)) continue;

    candles.push({
      time: timestamps[i],
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: Number(volume[i] ?? 0),
    });
  }

  return candles.slice(-limit);
}

async function fetchCryptoQuote(symbol: string): Promise<Quote> {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`crypto quote upstream error (${response.status})`);
  }

  const quote = (await response.json()) as {
    lastPrice: string;
    priceChangePercent: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
  };

  return {
    symbol,
    lastPrice: Number(quote.lastPrice),
    changePercent: Number(quote.priceChangePercent),
    highPrice: Number(quote.highPrice),
    lowPrice: Number(quote.lowPrice),
    volume: Number(quote.volume),
  };
}

async function fetchKrxQuote(symbol: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!response.ok) {
    throw new Error(`krx quote upstream error (${response.status})`);
  }

  const json = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          previousClose?: number;
          regularMarketDayHigh?: number;
          regularMarketDayLow?: number;
          regularMarketVolume?: number;
        };
      }>;
    };
  };

  const meta = json.chart?.result?.[0]?.meta;

  if (!meta) {
    throw new Error('krx quote payload missing meta');
  }

  const lastPrice = Number(meta.regularMarketPrice ?? meta.previousClose ?? 0);
  const previousClose = Number(meta.previousClose ?? 0);

  return {
    symbol,
    lastPrice,
    changePercent: previousClose ? ((lastPrice - previousClose) / previousClose) * 100 : 0,
    highPrice: Number(meta.regularMarketDayHigh ?? lastPrice),
    lowPrice: Number(meta.regularMarketDayLow ?? lastPrice),
    volume: Number(meta.regularMarketVolume ?? 0),
  };
}

async function fetchLiveQuote(symbol: string) {
  const cached = getCachedQuote(symbol);
  if (cached) return cached;

  const quote = isKrxSymbol(symbol)
    ? await fetchKrxQuote(symbol)
    : await fetchCryptoQuote(symbol);

  setCachedQuote(symbol, quote);
  return quote;
}

try {
  await refreshKrxSymbols();
  app.log.info(`Loaded ${krxSymbols.length} KRX symbols`);
} catch (error) {
  app.log.warn({ error }, 'Unable to preload KRX symbols. Fallback list will be used.');
}

app.get('/health', async () => ({
  ok: true,
  service: 'tradingservice-api',
  krxSymbolCount: krxSymbols.length,
}));

app.get('/api/symbols', async () => {
  try {
    await refreshKrxSymbols();
  } catch (error) {
    app.log.warn({ error }, 'Failed refreshing KRX symbols for /api/symbols');
  }

  return { symbols: getDefaultSymbols() };
});

app.get('/api/search', async (request, reply) => {
  const parsed = searchQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const { query, market, limit } = parsed.data;
  const queryLower = query.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, '');

  try {
    await refreshKrxSymbols();
  } catch (error) {
    app.log.warn({ error }, 'Failed refreshing KRX symbols for /api/search');
  }

  const candidatePool: SymbolItem[] = [];

  if (market === 'ALL' || market === 'CRYPTO') {
    candidatePool.push(...cryptoSymbols);
  }

  if (market === 'ALL' || market === 'KOSPI' || market === 'KOSDAQ') {
    const universe = krxSymbols.length ? krxSymbols : krxFallbackSymbols;
    candidatePool.push(
      ...universe.filter((item) =>
        market === 'ALL' ? true : item.market === market,
      ),
    );
  }

  const scored = candidatePool
    .map((item) => ({
      item,
      score: scoreByQuery(item, queryLower, queryDigits),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol))
    .slice(0, limit)
    .map((entry) => entry.item);

  return {
    query,
    market,
    items: scored,
  };
});

app.get('/api/candles', async (request, reply) => {
  const parsed = candleQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const { symbol, interval, limit } = parsed.data;
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `${normalizedSymbol}:${interval}:${limit}`;
  const cached = getCachedCandles(cacheKey);

  if (cached) {
    return { symbol: normalizedSymbol, interval, candles: cached };
  }

  try {
    const candles = isKrxSymbol(normalizedSymbol)
      ? await fetchKrxCandles(normalizedSymbol, interval, limit)
      : await fetchCryptoCandles(normalizedSymbol, interval, limit);

    setCachedCandles(cacheKey, candles);

    return { symbol: normalizedSymbol, interval, candles };
  } catch (error) {
    app.log.error({ error, symbol: normalizedSymbol, interval }, 'Failed to fetch candles');
    return reply.code(502).send({ error: 'Failed to fetch candle data from upstream exchange' });
  }
});

app.get('/api/quote', async (request, reply) => {
  const parsed = quoteQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const symbol = parsed.data.symbol.toUpperCase();
  try {
    return await fetchLiveQuote(symbol);
  } catch (error) {
    app.log.error({ error, symbol }, 'Failed to fetch quote');
    return reply.code(502).send({ error: 'Failed to fetch quote data from upstream exchange' });
  }
});

app.get('/api/market-status', async (request, reply) => {
  const parsed = marketStatusQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  return getMarketStatus(parsed.data.market, Date.now());
});

app.get('/api/alerts/rules', async (request, reply) => {
  const parsed = alertRuleQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const symbol = parsed.data.symbol ? normalizeSymbol(parsed.data.symbol) : null;
  const rules = [...alertRuleStore.values()]
    .filter((rule) => (symbol ? rule.symbol === symbol : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(serializeAlertRule);

  return { rules };
});

app.post('/api/alerts/rules', async (request, reply) => {
  const parsed = alertRuleCreateSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const now = Date.now();
  const rule: AlertRule = {
    id: createAlertRuleId(),
    symbol: normalizeSymbol(parsed.data.symbol),
    metric: parsed.data.metric,
    operator: parsed.data.operator,
    threshold: parsed.data.threshold,
    cooldownSec: parsed.data.cooldownSec,
    createdAt: now,
    lastTriggeredAt: null,
  };

  alertRuleStore.set(rule.id, rule);

  return reply.code(201).send({ rule: serializeAlertRule(rule) });
});

app.delete('/api/alerts/rules/:id', async (request, reply) => {
  const parsed = alertRuleDeleteParamSchema.safeParse(request.params);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid params', detail: parsed.error.format() });
  }

  const found = alertRuleStore.get(parsed.data.id);
  if (!found) {
    return reply.code(404).send({ error: 'Alert rule not found' });
  }

  alertRuleStore.delete(parsed.data.id);
  return { ok: true };
});

app.post('/api/alerts/check', async (request, reply) => {
  const parsed = alertCheckBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const requestedSymbol = parsed.data.symbol ? normalizeSymbol(parsed.data.symbol) : null;
  const rules = [...alertRuleStore.values()].filter((rule) =>
    requestedSymbol ? rule.symbol === requestedSymbol : true,
  );

  if (!rules.length) {
    return {
      evaluatedAt: Date.now(),
      checkedRuleCount: 0,
      triggeredCount: 0,
      suppressedByCooldown: 0,
      triggered: [],
    };
  }

  const quoteBySymbol = new Map<string, { lastPrice: number; changePercent: number }>();
  const fallbackProvidedSymbol =
    requestedSymbol ??
    (rules.every((rule) => rule.symbol === rules[0].symbol) ? rules[0].symbol : null);
  const providedSymbolRaw = parsed.data.values?.symbol ?? fallbackProvidedSymbol;
  const providedSymbol = providedSymbolRaw ? normalizeSymbol(providedSymbolRaw) : null;

  if (parsed.data.values && providedSymbol) {
    quoteBySymbol.set(providedSymbol, {
      lastPrice: parsed.data.values.lastPrice,
      changePercent: parsed.data.values.changePercent,
    });
  }

  const symbolsToFetch = [...new Set(rules.map((rule) => rule.symbol))].filter(
    (symbol) => !quoteBySymbol.has(symbol),
  );

  try {
    await Promise.all(
      symbolsToFetch.map(async (symbol) => {
        const quote = await fetchLiveQuote(symbol);
        quoteBySymbol.set(symbol, {
          lastPrice: quote.lastPrice,
          changePercent: quote.changePercent,
        });
      }),
    );
  } catch (error) {
    app.log.error({ error, symbolsToFetch }, 'Failed to fetch quotes for alert checks');
    return reply.code(502).send({ error: 'Failed to evaluate alert rules due to quote fetch failure' });
  }

  const now = Date.now();
  const triggered: Array<{
    ruleId: string;
    symbol: string;
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number;
    currentValue: number;
    triggeredAt: number;
    cooldownSec: number;
  }> = [];
  let suppressedByCooldown = 0;

  for (const rule of rules) {
    const values = quoteBySymbol.get(rule.symbol);
    if (!values) continue;

    const currentValue = selectMetricValue(rule.metric, values);
    const met = compareWithOperator(currentValue, rule.operator, rule.threshold);

    if (!met) continue;

    const cooldownMs = rule.cooldownSec * 1000;
    const inCooldown =
      cooldownMs > 0 &&
      typeof rule.lastTriggeredAt === 'number' &&
      now - rule.lastTriggeredAt < cooldownMs;

    if (inCooldown) {
      suppressedByCooldown += 1;
      continue;
    }

    rule.lastTriggeredAt = now;
    triggered.push({
      ruleId: rule.id,
      symbol: rule.symbol,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      currentValue,
      triggeredAt: now,
      cooldownSec: rule.cooldownSec,
    });
  }

  return {
    evaluatedAt: now,
    checkedRuleCount: rules.length,
    triggeredCount: triggered.length,
    suppressedByCooldown,
    triggered,
  };
});

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? 4100);

  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
