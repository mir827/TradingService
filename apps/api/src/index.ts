import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

const symbols = [
  { symbol: 'BTCUSDT', name: 'Bitcoin / USDT', market: 'CRYPTO' },
  { symbol: 'ETHUSDT', name: 'Ethereum / USDT', market: 'CRYPTO' },
  { symbol: 'SOLUSDT', name: 'Solana / USDT', market: 'CRYPTO' },
  { symbol: 'BNBUSDT', name: 'BNB / USDT', market: 'CRYPTO' },
  { symbol: 'XRPUSDT', name: 'XRP / USDT', market: 'CRYPTO' },
];

const intervalMap: Record<string, string> = {
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

const candleQuerySchema = z.object({
  symbol: z.string().default('BTCUSDT'),
  interval: z.string().default('60'),
  limit: z.coerce.number().int().min(50).max(1000).default(400),
});

app.get('/health', async () => ({ ok: true, service: 'tradingservice-api' }));

app.get('/api/symbols', async () => ({ symbols }));

app.get('/api/candles', async (request, reply) => {
  const parsed = candleQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const { symbol, interval, limit } = parsed.data;
  const normalizedInterval = intervalMap[interval] ?? '1h';

  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${normalizedInterval}&limit=${limit}`;
  const response = await fetch(url);

  if (!response.ok) {
    return reply
      .code(502)
      .send({ error: 'Failed to fetch candle data from upstream exchange' });
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

  const candles = raw.map((c) => ({
    time: Math.floor(c[0] / 1000),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
  }));

  return { symbol, interval, candles };
});

app.get('/api/quote', async (request, reply) => {
  const querySchema = z.object({ symbol: z.string().default('BTCUSDT') });
  const parsed = querySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const symbol = parsed.data.symbol.toUpperCase();
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  const response = await fetch(url);

  if (!response.ok) {
    return reply
      .code(502)
      .send({ error: 'Failed to fetch quote data from upstream exchange' });
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
});

const port = Number(process.env.PORT ?? 4100);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
