import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  normalizeDrawingItems,
  normalizeDrawingLines,
  toLegacyDrawingLines,
  type DrawingInputItem,
  type DrawingItem,
} from './drawings.js';
import {
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  type BollingerBandsValues,
  type MacdValues,
} from './indicatorMath.js';
import { runMaCrossoverBacktest } from './strategyBacktest.js';

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
type AlertIndicatorComparator = '>=' | '<=';
type AlertHistoryEventSource = 'manual' | 'watchlist';
type AlertLifecycleState = 'active' | 'triggered' | 'cooldown' | 'error';
type AlertHistoryEventType = 'triggered' | 'error';
type AlertStateTransitionReason =
  | 'ruleCreated'
  | 'conditionMet'
  | 'conditionNotMet'
  | 'cooldownSuppressed'
  | 'evaluationError';

type AlertStateTransition = {
  from: AlertLifecycleState | null;
  to: AlertLifecycleState;
  transitionedAt: number;
  reason: AlertStateTransitionReason;
  message?: string;
};

type AlertLastTriggerMetadata = {
  triggeredAt: number;
  currentValue: number;
  source: AlertHistoryEventSource;
  sourceSymbol?: string;
};

type AlertLastErrorMetadata = {
  failedAt: number;
  message: string;
  source: AlertHistoryEventSource;
  sourceSymbol?: string;
};

type AlertIndicatorCondition =
  | {
      type: 'rsiThreshold';
      operator: AlertIndicatorComparator;
      threshold: number;
      period: number;
    }
  | {
      type: 'macdCrossSignal';
      signal: 'bullish' | 'bearish';
      fastPeriod: number;
      slowPeriod: number;
      signalPeriod: number;
    }
  | {
      type: 'macdHistogramSign';
      sign: 'positive' | 'negative';
      fastPeriod: number;
      slowPeriod: number;
      signalPeriod: number;
    }
  | {
      type: 'bollingerBandPosition';
      position: 'aboveUpper' | 'belowLower';
      period: number;
      stdDev: number;
    };

type AlertRule = {
  id: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  cooldownSec: number;
  indicatorConditions?: AlertIndicatorCondition[];
  createdAt: number;
  lastTriggeredAt: number | null;
  state: AlertLifecycleState;
  stateUpdatedAt: number;
  lastStateTransition: AlertStateTransition;
  lastTrigger?: AlertLastTriggerMetadata;
  lastError?: AlertLastErrorMetadata;
};

type AlertCheckEvent = {
  ruleId: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  currentValue?: number;
  triggeredAt: number;
  cooldownSec: number;
  indicatorConditions?: AlertIndicatorCondition[];
  eventType?: AlertHistoryEventType;
  state?: AlertLifecycleState;
  transition?: AlertStateTransition;
  errorMessage?: string;
};

type AlertHistoryEvent = AlertCheckEvent & {
  source?: AlertHistoryEventSource;
  sourceSymbol?: string;
};

type AlertCooldownSuppression = {
  ruleId: string;
  symbol: string;
  metric: AlertMetric;
  suppressedAt: number;
  cooldownSec: number;
  remainingMs: number;
  state: 'cooldown';
  transition?: AlertStateTransition;
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

type TradingMode = 'PAPER';
type TradingOrderSide = 'BUY' | 'SELL';
type TradingOrderType = 'MARKET' | 'LIMIT' | 'STOP';
type TradingOrderLinkType = 'BRACKET_TAKE_PROFIT' | 'BRACKET_STOP_LOSS';
type TradingOrderStatus = 'PENDING' | 'FILLED' | 'CANCELED' | 'REJECTED';

type TradingPosition = {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  updatedAt: number;
};

type TradingOrder = {
  id: string;
  symbol: string;
  side: TradingOrderSide;
  type: TradingOrderType;
  status: TradingOrderStatus;
  qty: number;
  notional: number;
  triggerPrice?: number;
  limitPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  parentOrderId?: string;
  linkType?: TradingOrderLinkType;
  bracketChildOrderIds?: string[];
  canceledByOrderId?: string;
  fillPrice?: number;
  filledAt?: number;
  canceledAt?: number;
  rejectReason?: string;
  createdAt: number;
  updatedAt: number;
};

type TradingFill = {
  id: string;
  orderId: string;
  symbol: string;
  side: TradingOrderSide;
  qty: number;
  price: number;
  notional: number;
  realizedPnl: number;
  filledAt: number;
};

type TradingState = {
  mode: TradingMode;
  startingCash: number;
  cash: number;
  positions: Map<string, TradingPosition>;
  orders: TradingOrder[];
  fills: TradingFill[];
  updatedAt: number;
};

type TradingErrorCode =
  | 'VALIDATION_ERROR'
  | 'QUOTE_UNAVAILABLE'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_POSITION'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_CANCELABLE';

type OpsTelemetryLevel = 'recoverable' | 'critical';
type OpsTelemetrySource = 'web' | 'api' | 'alerts' | 'strategy' | 'trading' | 'chart' | 'watchlist';
type OpsRecoveryStatus = 'attempted' | 'succeeded' | 'failed';
type OpsTelemetryContextValue = string | number | boolean | null;
type OpsTelemetryContext = Record<string, OpsTelemetryContextValue>;

type OpsErrorEvent = {
  id: string;
  level: OpsTelemetryLevel;
  source: OpsTelemetrySource;
  code: string;
  message: string;
  context?: OpsTelemetryContext;
  occurredAt: number;
  recordedAt: number;
};

type OpsRecoveryEvent = {
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

export const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

const KRX_LIST_URL = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13';
const KRX_REFRESH_MS = 1000 * 60 * 60 * 12;
const KRX_STARTUP_PRELOAD_TIMEOUT_MS = 2000;

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
const alertHistoryStore: AlertHistoryEvent[] = [];
const opsErrorStore: OpsErrorEvent[] = [];
const opsRecoveryStore: OpsRecoveryEvent[] = [];
const drawingStore = new Map<string, DrawingItem[]>();
const watchlistStore = new Map<string, SymbolItem[]>();
const DEFAULT_RUNTIME_STATE_FILE = './outputs/runtime-state.json';
const RUNTIME_STATE_VERSION = 4;
const PAPER_TRADING_MODE: TradingMode = 'PAPER';
const PAPER_TRADING_DEFAULT_STARTING_CASH = 100_000;
const PAPER_TRADING_VALUE_PRECISION = 8;
const PAPER_TRADING_EPSILON = 1e-8;
const PAPER_TRADING_MAX_ORDERS = 1000;
const PAPER_TRADING_MAX_FILLS = 2000;
const PAPER_TRADING_MAX_BRACKET_CHILDREN = 2;
const ALERT_HISTORY_MAX_EVENTS = 500;
const ALERT_INDICATOR_INTERVAL = '60';
const ALERT_INDICATOR_CANDLE_LIMIT = 200;
const ALERT_RSI_DEFAULT_PERIOD = 14;
const ALERT_MACD_FAST_DEFAULT_PERIOD = 12;
const ALERT_MACD_SLOW_DEFAULT_PERIOD = 26;
const ALERT_MACD_SIGNAL_DEFAULT_PERIOD = 9;
const ALERT_BOLLINGER_DEFAULT_PERIOD = 20;
const ALERT_BOLLINGER_DEFAULT_STD_DEV = 2;
const ALERT_ERROR_EVENT_DEDUP_WINDOW_MS = 30_000;
const OPS_ERROR_MAX_EVENTS = 500;
const OPS_RECOVERY_MAX_EVENTS = 500;
const TRADING_TRIGGER_PRIORITY_BY_LINK_TYPE: Record<TradingOrderLinkType, number> = {
  BRACKET_STOP_LOSS: 0,
  BRACKET_TAKE_PROFIT: 1,
};
const paperTradingState = createInitialPaperTradingState();

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

const symbolItemSchema = z.object({
  symbol: z.string().trim().min(1),
  code: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  market: z.enum(['CRYPTO', 'KOSPI', 'KOSDAQ']),
  exchange: z.string().trim().min(1).optional(),
});

const watchlistQuerySchema = z.object({
  name: z.string().trim().min(1).default('default'),
});

const watchlistPutBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  items: z.array(symbolItemSchema),
});

const opsTelemetryLevelSchema = z.enum(['recoverable', 'critical']);
const opsTelemetrySourceSchema = z.enum(['web', 'api', 'alerts', 'strategy', 'trading', 'chart', 'watchlist']);
const opsRecoveryStatusSchema = z.enum(['attempted', 'succeeded', 'failed']);
const opsTelemetryCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9_]+$/);
const opsTelemetryContextValueSchema = z.union([z.string().max(400), z.number().finite(), z.boolean(), z.null()]);
const opsTelemetryContextSchema = z
  .record(z.string().trim().min(1).max(64), opsTelemetryContextValueSchema)
  .refine((context) => Object.keys(context).length <= 20, {
    message: 'context must have 20 keys or fewer',
  });

const opsErrorsQuerySchema = z.object({
  level: opsTelemetryLevelSchema.optional(),
  source: opsTelemetrySourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  recoveryLimit: z.coerce.number().int().min(0).max(200).default(20),
});

const opsErrorCreateBodySchema = z
  .object({
    level: opsTelemetryLevelSchema,
    source: opsTelemetrySourceSchema,
    code: opsTelemetryCodeSchema,
    message: z.string().trim().min(1).max(400),
    context: opsTelemetryContextSchema.optional(),
    occurredAt: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

const opsRecoveryCreateBodySchema = z
  .object({
    source: opsTelemetrySourceSchema,
    action: z.string().trim().min(1).max(80),
    status: opsRecoveryStatusSchema,
    message: z.string().trim().min(1).max(400).optional(),
    errorCode: opsTelemetryCodeSchema.optional(),
    context: opsTelemetryContextSchema.optional(),
    occurredAt: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

const alertQuerySymbolsSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  }

  return value;
}, z.array(z.string().trim().min(1)).min(1).max(40).optional());

const alertQueryIndicatorAwareOnlySchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return value;
}, z.boolean().optional());

const alertQueryStateSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }

  return value;
}, z.enum(['active', 'triggered', 'cooldown', 'error']).optional());

const alertQueryTypeSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }

  return value;
}, z.enum(['triggered', 'error', 'all']).optional());

const alertRuleQuerySchema = z.object({
  symbol: z.string().optional(),
  symbols: alertQuerySymbolsSchema,
  indicatorAwareOnly: alertQueryIndicatorAwareOnlySchema,
});

const drawingsQuerySchema = z.object({
  symbol: z.string().min(1),
  interval: z.string().min(1),
});

const drawingLineSchema = z.object({
  id: z.string().min(1).optional(),
  price: z.number().finite(),
});

const drawingItemSchema: z.ZodType<DrawingInputItem> = z.discriminatedUnion('type', [
  z.object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('horizontal'),
    price: z.number().finite(),
  }),
  z.object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('vertical'),
    time: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('trendline'),
    startTime: z.number().int().nonnegative(),
    startPrice: z.number().finite(),
    endTime: z.number().int().nonnegative(),
    endPrice: z.number().finite(),
  }),
  z.object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('ray'),
    startTime: z.number().int().nonnegative(),
    startPrice: z.number().finite(),
    endTime: z.number().int().nonnegative(),
    endPrice: z.number().finite(),
  }),
  z.object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('rectangle'),
    startTime: z.number().int().nonnegative(),
    startPrice: z.number().finite(),
    endTime: z.number().int().nonnegative(),
    endPrice: z.number().finite(),
  }),
  z.object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('note'),
    time: z.number().int().nonnegative(),
    price: z.number().finite(),
    text: z.string().trim().min(1).max(240),
  }),
]);

const drawingsPutBodySchema = z
  .object({
    symbol: z.string().min(1),
    interval: z.string().min(1),
    lines: z.array(drawingLineSchema).optional(),
    drawings: z.array(drawingItemSchema).optional(),
  })
  .refine((data) => data.drawings !== undefined || data.lines !== undefined, {
    message: 'Either drawings or lines is required',
    path: ['drawings'],
  });

const alertIndicatorConditionSchema: z.ZodType<AlertIndicatorCondition> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rsiThreshold'),
    operator: z.enum(['>=', '<=']),
    threshold: z.number().finite().min(0).max(100),
    period: z.coerce.number().int().min(2).max(100).default(ALERT_RSI_DEFAULT_PERIOD),
  }),
  z
    .object({
      type: z.literal('macdCrossSignal'),
      signal: z.enum(['bullish', 'bearish']),
      fastPeriod: z.coerce.number().int().min(2).max(100).default(ALERT_MACD_FAST_DEFAULT_PERIOD),
      slowPeriod: z.coerce.number().int().min(3).max(200).default(ALERT_MACD_SLOW_DEFAULT_PERIOD),
      signalPeriod: z.coerce.number().int().min(2).max(100).default(ALERT_MACD_SIGNAL_DEFAULT_PERIOD),
    })
    .refine((data) => data.fastPeriod < data.slowPeriod, {
      message: 'fastPeriod must be less than slowPeriod',
      path: ['fastPeriod'],
    }),
  z
    .object({
      type: z.literal('macdHistogramSign'),
      sign: z.enum(['positive', 'negative']),
      fastPeriod: z.coerce.number().int().min(2).max(100).default(ALERT_MACD_FAST_DEFAULT_PERIOD),
      slowPeriod: z.coerce.number().int().min(3).max(200).default(ALERT_MACD_SLOW_DEFAULT_PERIOD),
      signalPeriod: z.coerce.number().int().min(2).max(100).default(ALERT_MACD_SIGNAL_DEFAULT_PERIOD),
    })
    .refine((data) => data.fastPeriod < data.slowPeriod, {
      message: 'fastPeriod must be less than slowPeriod',
      path: ['fastPeriod'],
    }),
  z.object({
    type: z.literal('bollingerBandPosition'),
    position: z.enum(['aboveUpper', 'belowLower']),
    period: z.coerce.number().int().min(2).max(200).default(ALERT_BOLLINGER_DEFAULT_PERIOD),
    stdDev: z.coerce.number().finite().min(0.1).max(6).default(ALERT_BOLLINGER_DEFAULT_STD_DEV),
  }),
]);

const alertRuleCreateSchema = z.object({
  symbol: z.string().min(1),
  metric: z.enum(['price', 'changePercent']),
  operator: z.enum(['>=', '<=', '>', '<']),
  threshold: z.number().finite(),
  cooldownSec: z.coerce.number().int().min(0).max(86400).default(0),
  indicatorConditions: z.array(alertIndicatorConditionSchema).max(4).optional(),
});

const alertRuleDeleteParamSchema = z.object({
  id: z.string().min(1),
});

const alertCheckBodySchema = z.object({
  symbol: z.string().optional(),
  symbols: z.array(z.string().trim().min(1)).min(1).max(40).optional(),
  source: z.enum(['manual', 'watchlist']).optional(),
  indicatorAwareOnly: z.boolean().optional(),
  values: z
    .object({
      symbol: z.string().optional(),
      lastPrice: z.number().finite(),
      changePercent: z.number().finite(),
    })
    .optional(),
});

const alertCheckWatchlistBodySchema = z.object({
  symbols: z.array(z.string().trim().min(1)).min(1).max(40),
  source: z.enum(['manual', 'watchlist']).optional(),
  indicatorAwareOnly: z.boolean().optional(),
});

const alertHistoryQuerySchema = z.object({
  symbol: z.string().optional(),
  symbols: alertQuerySymbolsSchema,
  fromTs: z.coerce.number().int().nonnegative().optional(),
  toTs: z.coerce.number().int().nonnegative().optional(),
  source: z.enum(['manual', 'watchlist']).optional(),
  state: alertQueryStateSchema,
  type: alertQueryTypeSchema,
  indicatorAwareOnly: alertQueryIndicatorAwareOnlySchema,
  limit: z.coerce.number().int().min(1).default(50).transform((value) => Math.min(value, 200)),
})
  .refine(
    (data) => !(typeof data.fromTs === 'number' && typeof data.toTs === 'number') || data.fromTs <= data.toTs,
    {
      message: 'fromTs must be less than or equal to toTs',
      path: ['fromTs'],
    },
  );

const strategyBacktestBodySchema = z.object({
  symbol: z.string().trim().min(1),
  interval: z.string().trim().min(1),
  limit: z.coerce.number().int().min(50).max(1000).default(500),
  params: z.object({
    initialCapital: z.coerce.number().finite().positive().max(1_000_000_000_000),
    feeBps: z.coerce.number().finite().min(0).max(2000).default(10),
    positionSizeMode: z.literal('fixed-percent'),
    fixedPercent: z.coerce.number().finite().gt(0).max(100),
  }),
  strategy: z
    .object({
      type: z.literal('maCrossover'),
      fastPeriod: z.coerce.number().int().min(2).max(300),
      slowPeriod: z.coerce.number().int().min(3).max(600),
    })
    .refine((data) => data.fastPeriod < data.slowPeriod, {
      message: 'fastPeriod must be less than slowPeriod',
      path: ['fastPeriod'],
    }),
});

const tradingOrderSideSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.trim().toUpperCase();
  }
  return value;
}, z.enum(['BUY', 'SELL']));

const tradingOrderTypeSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.trim().toUpperCase();
  }
  return value;
}, z.enum(['MARKET', 'LIMIT', 'STOP']));

const tradingOrderCreateBodySchema = z
  .object({
    symbol: z.string().trim().min(1),
    side: tradingOrderSideSchema,
    orderType: tradingOrderTypeSchema.optional(),
    qty: z.coerce.number().finite().positive().optional(),
    notional: z.coerce.number().finite().positive().optional(),
    triggerPrice: z.coerce.number().finite().positive().optional(),
    limitPrice: z.coerce.number().finite().positive().optional(),
    takeProfitPrice: z.coerce.number().finite().positive().optional(),
    stopLossPrice: z.coerce.number().finite().positive().optional(),
  })
  .superRefine((data, context) => {
    const orderType = data.orderType ?? 'MARKET';

    if (orderType === 'MARKET') {
      if (typeof data.qty !== 'number' && typeof data.notional !== 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Either qty or notional is required',
          path: ['qty'],
        });
      }

      if (typeof data.limitPrice === 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'limitPrice is only supported for limit orders',
          path: ['limitPrice'],
        });
      }

      if (typeof data.triggerPrice === 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'triggerPrice is only supported for stop orders',
          path: ['triggerPrice'],
        });
      }
    }

    if (orderType !== 'MARKET') {
      if (typeof data.qty !== 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'qty is required for non-market orders',
          path: ['qty'],
        });
      }

      if (typeof data.notional === 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'notional is only supported for market orders',
          path: ['notional'],
        });
      }
    }

    if (orderType === 'LIMIT') {
      if (typeof data.limitPrice !== 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'limitPrice is required for limit orders',
          path: ['limitPrice'],
        });
      }

      if (typeof data.triggerPrice === 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'triggerPrice is not valid for limit orders',
          path: ['triggerPrice'],
        });
      }
    }

    if (orderType === 'STOP') {
      if (typeof data.triggerPrice !== 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'triggerPrice is required for stop orders',
          path: ['triggerPrice'],
        });
      }

      if (typeof data.limitPrice === 'number') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'limitPrice is not valid for stop orders',
          path: ['limitPrice'],
        });
      }
    }

    if ((typeof data.takeProfitPrice === 'number' || typeof data.stopLossPrice === 'number') && data.side !== 'BUY') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bracket TP/SL is currently supported only for BUY orders',
        path: ['side'],
      });
    }
  });

const tradingOrderCancelParamSchema = z.object({
  id: z.string().trim().min(1),
});

const persistedTradingPositionSchema = z.object({
  symbol: z.string().trim().min(1),
  qty: z.coerce.number().finite().min(0),
  avgPrice: z.coerce.number().finite().min(0),
  marketPrice: z.coerce.number().finite().min(0),
  unrealizedPnl: z.coerce.number().finite(),
  realizedPnl: z.coerce.number().finite(),
  updatedAt: z.coerce.number().int().nonnegative(),
});

const persistedTradingOrderSchema = z.object({
  id: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['MARKET', 'LIMIT', 'STOP']),
  status: z.enum(['PENDING', 'FILLED', 'CANCELED', 'REJECTED']),
  qty: z.coerce.number().finite().positive(),
  notional: z.coerce.number().finite().nonnegative(),
  triggerPrice: z.coerce.number().finite().positive().optional(),
  limitPrice: z.coerce.number().finite().positive().optional(),
  takeProfitPrice: z.coerce.number().finite().positive().optional(),
  stopLossPrice: z.coerce.number().finite().positive().optional(),
  parentOrderId: z.string().trim().min(1).optional(),
  linkType: z.enum(['BRACKET_TAKE_PROFIT', 'BRACKET_STOP_LOSS']).optional(),
  bracketChildOrderIds: z.array(z.string().trim().min(1)).max(2).optional(),
  canceledByOrderId: z.string().trim().min(1).optional(),
  fillPrice: z.coerce.number().finite().positive().optional(),
  filledAt: z.coerce.number().int().nonnegative().optional(),
  canceledAt: z.coerce.number().int().nonnegative().optional(),
  rejectReason: z.string().trim().min(1).optional(),
  createdAt: z.coerce.number().int().nonnegative(),
  updatedAt: z.coerce.number().int().nonnegative(),
});

const persistedTradingFillSchema = z.object({
  id: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  side: z.enum(['BUY', 'SELL']),
  qty: z.coerce.number().finite().positive(),
  price: z.coerce.number().finite().positive(),
  notional: z.coerce.number().finite().nonnegative(),
  realizedPnl: z.coerce.number().finite(),
  filledAt: z.coerce.number().int().nonnegative(),
});

const persistedTradingStateSchema = z.object({
  mode: z.literal('PAPER').optional(),
  startingCash: z.coerce.number().finite().nonnegative().optional(),
  cash: z.coerce.number().finite().optional(),
  positions: z.array(z.unknown()).optional(),
  orders: z.array(z.unknown()).optional(),
  fills: z.array(z.unknown()).optional(),
  updatedAt: z.coerce.number().int().nonnegative().optional(),
});

const alertLifecycleStateSchema = z.enum(['active', 'triggered', 'cooldown', 'error']);
const alertStateTransitionReasonSchema = z.enum([
  'ruleCreated',
  'conditionMet',
  'conditionNotMet',
  'cooldownSuppressed',
  'evaluationError',
]);

const persistedAlertStateTransitionSchema = z.object({
  from: z.union([z.null(), alertLifecycleStateSchema]),
  to: alertLifecycleStateSchema,
  transitionedAt: z.coerce.number().int().nonnegative(),
  reason: alertStateTransitionReasonSchema,
  message: z.string().trim().min(1).max(300).optional(),
});

const persistedAlertLastTriggerSchema = z.object({
  triggeredAt: z.coerce.number().int().nonnegative(),
  currentValue: z.coerce.number().finite(),
  source: z.enum(['manual', 'watchlist']),
  sourceSymbol: z.string().trim().min(1).optional(),
});

const persistedAlertLastErrorSchema = z.object({
  failedAt: z.coerce.number().int().nonnegative(),
  message: z.string().trim().min(1).max(300),
  source: z.enum(['manual', 'watchlist']),
  sourceSymbol: z.string().trim().min(1).optional(),
});

const persistedAlertRuleSchema = z.object({
  id: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  metric: z.enum(['price', 'changePercent']),
  operator: z.enum(['>=', '<=', '>', '<']),
  threshold: z.coerce.number().finite(),
  cooldownSec: z.coerce.number().int().min(0).max(86400),
  indicatorConditions: z.array(alertIndicatorConditionSchema).max(4).optional(),
  createdAt: z.coerce.number().int().nonnegative(),
  lastTriggeredAt: z.union([z.null(), z.coerce.number().int().nonnegative()]),
  state: alertLifecycleStateSchema.optional(),
  stateUpdatedAt: z.coerce.number().int().nonnegative().optional(),
  lastStateTransition: persistedAlertStateTransitionSchema.optional(),
  lastTrigger: persistedAlertLastTriggerSchema.optional(),
  lastError: persistedAlertLastErrorSchema.optional(),
});

const persistedAlertHistoryEventSchema = z.object({
  ruleId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  metric: z.enum(['price', 'changePercent']),
  operator: z.enum(['>=', '<=', '>', '<']),
  threshold: z.coerce.number().finite(),
  currentValue: z.coerce.number().finite().optional(),
  triggeredAt: z.coerce.number().int().nonnegative(),
  cooldownSec: z.coerce.number().int().min(0).max(86400),
  indicatorConditions: z.array(alertIndicatorConditionSchema).max(4).optional(),
  eventType: z.enum(['triggered', 'error']).optional(),
  state: alertLifecycleStateSchema.optional(),
  transition: persistedAlertStateTransitionSchema.optional(),
  errorMessage: z.string().trim().min(1).max(300).optional(),
  source: z.enum(['manual', 'watchlist']).optional(),
  sourceSymbol: z.string().trim().min(1).optional(),
});

const persistedOpsErrorEventSchema = z.object({
  id: z.string().trim().min(1),
  level: opsTelemetryLevelSchema,
  source: opsTelemetrySourceSchema,
  code: opsTelemetryCodeSchema,
  message: z.string().trim().min(1).max(400),
  context: opsTelemetryContextSchema.optional(),
  occurredAt: z.coerce.number().int().nonnegative(),
  recordedAt: z.coerce.number().int().nonnegative(),
});

const persistedOpsRecoveryEventSchema = z.object({
  id: z.string().trim().min(1),
  source: opsTelemetrySourceSchema,
  action: z.string().trim().min(1).max(80),
  status: opsRecoveryStatusSchema,
  message: z.string().trim().min(1).max(400).optional(),
  errorCode: opsTelemetryCodeSchema.optional(),
  context: opsTelemetryContextSchema.optional(),
  occurredAt: z.coerce.number().int().nonnegative(),
  recordedAt: z.coerce.number().int().nonnegative(),
});

const persistedWatchlistEntrySchema = z.object({
  name: z.string().trim().min(1),
  items: z.array(z.unknown()),
});

const persistedDrawingEntrySchema = z.object({
  symbol: z.string().trim().min(1),
  interval: z.string().trim().min(1),
  drawings: z.array(z.unknown()),
});

const persistedRuntimeStateSchema = z
  .object({
    version: z.coerce.number().int().min(1).optional(),
    alertRules: z.array(z.unknown()).optional(),
    alertHistory: z.array(z.unknown()).optional(),
    opsErrors: z.array(z.unknown()).optional(),
    opsRecoveries: z.array(z.unknown()).optional(),
    watchlists: z.array(z.unknown()).optional(),
    drawings: z.array(z.unknown()).optional(),
    trading: z.unknown().optional(),
  })
  .passthrough();

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

function cloneSymbolItem(item: SymbolItem): SymbolItem {
  return { ...item };
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function normalizeInterval(interval: string) {
  return interval.trim().toUpperCase();
}

function resolveRuntimeStateFilePath() {
  const overridePath = process.env.TRADINGSERVICE_STATE_FILE?.trim();
  return resolve(process.cwd(), overridePath || DEFAULT_RUNTIME_STATE_FILE);
}

function normalizeSymbolItem(item: SymbolItem): SymbolItem {
  const code = item.code?.trim();
  const exchange = item.exchange?.trim();

  return {
    symbol: normalizeSymbol(item.symbol),
    ...(code ? { code } : {}),
    name: item.name.trim(),
    market: item.market,
    ...(exchange ? { exchange } : {}),
  };
}

function normalizeWatchlistName(name?: string) {
  return name?.trim() || 'default';
}

function getOrCreateWatchlist(name: string) {
  if (!watchlistStore.has(name)) {
    const initial = name === 'default' ? getDefaultSymbols().map(cloneSymbolItem) : [];
    watchlistStore.set(name, initial);
  }

  return watchlistStore.get(name) ?? [];
}

function getWatchlistItems(name: string) {
  return getOrCreateWatchlist(name).map(cloneSymbolItem);
}

function setWatchlistItems(name: string, items: SymbolItem[]) {
  const normalized = items.map((item) => normalizeSymbolItem(item));
  watchlistStore.set(name, normalized.map(cloneSymbolItem));
  return normalized;
}

function createDrawingStoreKey(symbol: string, interval: string) {
  return `${symbol}:${interval}`;
}

function parseDrawingStoreKey(key: string) {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  return {
    symbol: key.slice(0, separatorIndex),
    interval: key.slice(separatorIndex + 1),
  };
}

function trimAlertHistoryOverflow() {
  const overflow = alertHistoryStore.length - ALERT_HISTORY_MAX_EVENTS;
  if (overflow > 0) {
    alertHistoryStore.splice(0, overflow);
  }
}

function createOpsErrorEventId() {
  return `opserr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createOpsRecoveryEventId() {
  return `opsrec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimOpsErrorOverflow() {
  const overflow = opsErrorStore.length - OPS_ERROR_MAX_EVENTS;
  if (overflow > 0) {
    opsErrorStore.splice(0, overflow);
  }
}

function trimOpsRecoveryOverflow() {
  const overflow = opsRecoveryStore.length - OPS_RECOVERY_MAX_EVENTS;
  if (overflow > 0) {
    opsRecoveryStore.splice(0, overflow);
  }
}

function cloneOpsContext(context?: OpsTelemetryContext) {
  return context ? { ...context } : undefined;
}

function recordOpsErrorEvent(input: {
  level: OpsTelemetryLevel;
  source: OpsTelemetrySource;
  code: string;
  message: string;
  context?: OpsTelemetryContext;
  occurredAt?: number;
}) {
  const now = Date.now();
  const event: OpsErrorEvent = {
    id: createOpsErrorEventId(),
    level: input.level,
    source: input.source,
    code: input.code,
    message: input.message,
    ...(input.context ? { context: cloneOpsContext(input.context) } : {}),
    occurredAt: input.occurredAt ?? now,
    recordedAt: now,
  };

  opsErrorStore.push(event);
  trimOpsErrorOverflow();
  return event;
}

function recordOpsRecoveryEvent(input: {
  source: OpsTelemetrySource;
  action: string;
  status: OpsRecoveryStatus;
  message?: string;
  errorCode?: string;
  context?: OpsTelemetryContext;
  occurredAt?: number;
}) {
  const now = Date.now();
  const event: OpsRecoveryEvent = {
    id: createOpsRecoveryEventId(),
    source: input.source,
    action: input.action,
    status: input.status,
    ...(input.message ? { message: input.message } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.context ? { context: cloneOpsContext(input.context) } : {}),
    occurredAt: input.occurredAt ?? now,
    recordedAt: now,
  };

  opsRecoveryStore.push(event);
  trimOpsRecoveryOverflow();
  return event;
}

function getOpsErrorEvents(level: OpsTelemetryLevel | null, source: OpsTelemetrySource | null, limit: number) {
  const filtered = opsErrorStore.filter((eventItem) => {
    if (level && eventItem.level !== level) {
      return false;
    }

    if (source && eventItem.source !== source) {
      return false;
    }

    return true;
  });

  const total = filtered.length;
  const start = Math.max(total - limit, 0);

  return {
    total,
    events: filtered.slice(start).reverse().map((eventItem) => ({
      ...eventItem,
      ...(eventItem.context ? { context: cloneOpsContext(eventItem.context) } : {}),
    })),
  };
}

function getOpsRecoveryEvents(source: OpsTelemetrySource | null, limit: number) {
  const filtered = source ? opsRecoveryStore.filter((eventItem) => eventItem.source === source) : opsRecoveryStore;
  const total = filtered.length;
  const start = Math.max(total - limit, 0);

  return {
    total,
    events: filtered.slice(start).reverse().map((eventItem) => ({
      ...eventItem,
      ...(eventItem.context ? { context: cloneOpsContext(eventItem.context) } : {}),
    })),
  };
}

function roundTradingValue(value: number, precision = PAPER_TRADING_VALUE_PRECISION) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(precision));
}

function createInitialPaperTradingState(startingCash = PAPER_TRADING_DEFAULT_STARTING_CASH): TradingState {
  const normalizedStartingCash = roundTradingValue(Math.max(startingCash, 0));
  const now = Date.now();

  return {
    mode: PAPER_TRADING_MODE,
    startingCash: normalizedStartingCash,
    cash: normalizedStartingCash,
    positions: new Map(),
    orders: [],
    fills: [],
    updatedAt: now,
  };
}

function resetPaperTradingState(startingCash = PAPER_TRADING_DEFAULT_STARTING_CASH) {
  const next = createInitialPaperTradingState(startingCash);
  paperTradingState.mode = next.mode;
  paperTradingState.startingCash = next.startingCash;
  paperTradingState.cash = next.cash;
  paperTradingState.positions = next.positions;
  paperTradingState.orders = next.orders;
  paperTradingState.fills = next.fills;
  paperTradingState.updatedAt = next.updatedAt;
}

function createTradingOrderId() {
  return `porder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTradingFillId() {
  return `pfill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneTradingPosition(position: TradingPosition): TradingPosition {
  return { ...position };
}

function cloneTradingOrder(order: TradingOrder): TradingOrder {
  return {
    ...order,
    ...(order.bracketChildOrderIds ? { bracketChildOrderIds: [...order.bracketChildOrderIds] } : {}),
  };
}

function cloneTradingFill(fill: TradingFill): TradingFill {
  return { ...fill };
}

function trimPaperTradingHistory() {
  const orderOverflow = paperTradingState.orders.length - PAPER_TRADING_MAX_ORDERS;
  if (orderOverflow > 0) {
    paperTradingState.orders.splice(0, orderOverflow);
  }

  const fillOverflow = paperTradingState.fills.length - PAPER_TRADING_MAX_FILLS;
  if (fillOverflow > 0) {
    paperTradingState.fills.splice(0, fillOverflow);
  }
}

function normalizeTradingQty(rawQty: number) {
  const normalized = roundTradingValue(rawQty);
  if (!Number.isFinite(normalized) || normalized <= PAPER_TRADING_EPSILON) {
    return null;
  }
  return normalized;
}

function sendTradingError(
  reply: FastifyReply,
  statusCode: number,
  code: TradingErrorCode,
  message: string,
  detail?: unknown,
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      ...(detail !== undefined ? { detail } : {}),
    },
  });
}

function sendOpsTelemetryError(
  reply: FastifyReply,
  statusCode: number,
  code: 'VALIDATION_ERROR',
  message: string,
  detail?: unknown,
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      ...(detail !== undefined ? { detail } : {}),
    },
  });
}

function normalizeTradingPrice(rawPrice: number) {
  const normalized = roundTradingValue(rawPrice);
  if (!Number.isFinite(normalized) || normalized <= PAPER_TRADING_EPSILON) {
    return null;
  }
  return normalized;
}

function validateBracketPriceInput(
  side: TradingOrderSide,
  referencePrice: number,
  takeProfitPrice?: number,
  stopLossPrice?: number,
) {
  if (typeof takeProfitPrice !== 'number' && typeof stopLossPrice !== 'number') {
    return { ok: true as const };
  }

  if (side !== 'BUY') {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'Bracket TP/SL is currently supported only for BUY orders',
    };
  }

  if (!Number.isFinite(referencePrice) || referencePrice <= PAPER_TRADING_EPSILON) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'Invalid bracket reference price',
    };
  }

  if (typeof takeProfitPrice === 'number' && takeProfitPrice <= referencePrice + PAPER_TRADING_EPSILON) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'takeProfitPrice must be greater than entry price for BUY orders',
    };
  }

  if (typeof stopLossPrice === 'number' && stopLossPrice >= referencePrice - PAPER_TRADING_EPSILON) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'stopLossPrice must be less than entry price for BUY orders',
    };
  }

  if (
    typeof takeProfitPrice === 'number' &&
    typeof stopLossPrice === 'number' &&
    stopLossPrice + PAPER_TRADING_EPSILON >= takeProfitPrice
  ) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'stopLossPrice must be less than takeProfitPrice',
    };
  }

  return { ok: true as const };
}

function markTradingOrderCanceled(order: TradingOrder, canceledAt: number, canceledByOrderId?: string) {
  order.status = 'CANCELED';
  order.canceledAt = canceledAt;
  order.updatedAt = canceledAt;
  delete order.rejectReason;

  if (canceledByOrderId) {
    order.canceledByOrderId = canceledByOrderId;
  } else {
    delete order.canceledByOrderId;
  }
}

function cancelPendingBracketChildren(parentOrderId: string, canceledAt: number, canceledByOrderId: string) {
  let canceled = 0;

  for (const order of paperTradingState.orders) {
    if (order.status !== 'PENDING') continue;
    if (order.parentOrderId !== parentOrderId) continue;
    markTradingOrderCanceled(order, canceledAt, canceledByOrderId);
    canceled += 1;
  }

  return canceled;
}

function cancelSiblingBracketOrders(order: TradingOrder, canceledAt: number) {
  if (!order.parentOrderId) return 0;

  let canceled = 0;
  for (const sibling of paperTradingState.orders) {
    if (sibling.id === order.id) continue;
    if (sibling.status !== 'PENDING') continue;
    if (sibling.parentOrderId !== order.parentOrderId) continue;
    markTradingOrderCanceled(sibling, canceledAt, order.id);
    canceled += 1;
  }

  return canceled;
}

function cancelPendingBracketOrdersForSymbol(symbol: string, canceledAt: number, canceledByOrderId: string) {
  let canceled = 0;
  for (const order of paperTradingState.orders) {
    if (order.status !== 'PENDING') continue;
    if (order.symbol !== symbol) continue;
    if (!order.parentOrderId) continue;
    markTradingOrderCanceled(order, canceledAt, canceledByOrderId);
    canceled += 1;
  }
  return canceled;
}

function shouldTriggerPendingOrder(order: TradingOrder, marketPrice: number) {
  if (order.status !== 'PENDING') return false;

  if (order.type === 'LIMIT') {
    if (typeof order.limitPrice !== 'number') return false;
    return order.side === 'BUY'
      ? marketPrice <= order.limitPrice + PAPER_TRADING_EPSILON
      : marketPrice + PAPER_TRADING_EPSILON >= order.limitPrice;
  }

  if (order.type === 'STOP') {
    if (typeof order.triggerPrice !== 'number') return false;
    return order.side === 'BUY'
      ? marketPrice + PAPER_TRADING_EPSILON >= order.triggerPrice
      : marketPrice <= order.triggerPrice + PAPER_TRADING_EPSILON;
  }

  return true;
}

function getPendingOrderTriggerPriority(order: TradingOrder) {
  if (order.parentOrderId && order.linkType) {
    return TRADING_TRIGGER_PRIORITY_BY_LINK_TYPE[order.linkType] ?? 2;
  }
  return 2;
}

function applyPaperExecutionToPortfolio(symbol: string, side: TradingOrderSide, qty: number, fillPrice: number, now: number) {
  const normalizedQty = normalizeTradingQty(qty);
  if (!normalizedQty) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'Order quantity must be greater than zero',
    };
  }

  const normalizedPrice = normalizeTradingPrice(fillPrice);
  if (!normalizedPrice) {
    return {
      ok: false as const,
      statusCode: 502,
      code: 'QUOTE_UNAVAILABLE' as TradingErrorCode,
      message: 'Unable to determine market fill price',
    };
  }

  const notional = roundTradingValue(normalizedQty * normalizedPrice);
  const existing = paperTradingState.positions.get(symbol);
  let realizedPnlDelta = 0;

  if (side === 'BUY') {
    if (paperTradingState.cash + PAPER_TRADING_EPSILON < notional) {
      return {
        ok: false as const,
        statusCode: 422,
        code: 'INSUFFICIENT_CASH' as TradingErrorCode,
        message: 'Insufficient paper cash balance for this order',
      };
    }

    const previousQty = existing?.qty ?? 0;
    const previousCost = previousQty * (existing?.avgPrice ?? 0);
    const nextQty = roundTradingValue(previousQty + normalizedQty);
    const nextAvgPrice = nextQty <= PAPER_TRADING_EPSILON ? 0 : roundTradingValue((previousCost + notional) / nextQty);
    const nextRealizedPnl = existing?.realizedPnl ?? 0;

    paperTradingState.positions.set(symbol, {
      symbol,
      qty: nextQty,
      avgPrice: nextAvgPrice,
      marketPrice: normalizedPrice,
      unrealizedPnl: roundTradingValue((normalizedPrice - nextAvgPrice) * nextQty),
      realizedPnl: roundTradingValue(nextRealizedPnl),
      updatedAt: now,
    });

    paperTradingState.cash = roundTradingValue(paperTradingState.cash - notional);
  } else {
    if (!existing || existing.qty <= PAPER_TRADING_EPSILON) {
      return {
        ok: false as const,
        statusCode: 422,
        code: 'INSUFFICIENT_POSITION' as TradingErrorCode,
        message: 'No position is available to sell',
      };
    }

    if (existing.qty + PAPER_TRADING_EPSILON < normalizedQty) {
      return {
        ok: false as const,
        statusCode: 422,
        code: 'INSUFFICIENT_POSITION' as TradingErrorCode,
        message: 'Sell quantity exceeds current paper position size',
      };
    }

    realizedPnlDelta = roundTradingValue((normalizedPrice - existing.avgPrice) * normalizedQty);
    const nextQty = roundTradingValue(existing.qty - normalizedQty);
    const nextRealizedPnl = roundTradingValue(existing.realizedPnl + realizedPnlDelta);

    if (nextQty <= PAPER_TRADING_EPSILON) {
      paperTradingState.positions.delete(symbol);
      cancelPendingBracketOrdersForSymbol(symbol, now, `auto_flatten_${symbol}`);
    } else {
      paperTradingState.positions.set(symbol, {
        symbol,
        qty: nextQty,
        avgPrice: existing.avgPrice,
        marketPrice: normalizedPrice,
        unrealizedPnl: roundTradingValue((normalizedPrice - existing.avgPrice) * nextQty),
        realizedPnl: nextRealizedPnl,
        updatedAt: now,
      });
    }

    paperTradingState.cash = roundTradingValue(paperTradingState.cash + notional);
  }

  return {
    ok: true as const,
    qty: normalizedQty,
    fillPrice: normalizedPrice,
    notional,
    realizedPnlDelta,
  };
}

function createBracketChildOrdersForFilledParent(parentOrder: TradingOrder, createdAt: number) {
  if (parentOrder.status !== 'FILLED') return 0;
  if (parentOrder.parentOrderId) return 0;
  if (parentOrder.side !== 'BUY') return 0;

  const linkedChildIds: string[] = [];
  const existingChildren = paperTradingState.orders.filter((order) => order.parentOrderId === parentOrder.id);
  let createdCount = 0;

  const ensureChild = (linkType: TradingOrderLinkType, type: TradingOrderType, rawPrice: number | undefined) => {
    if (typeof rawPrice !== 'number') return;

    const normalizedPrice = normalizeTradingPrice(rawPrice);
    if (!normalizedPrice) return;

    const existing = existingChildren.find((order) => order.linkType === linkType);
    if (existing) {
      linkedChildIds.push(existing.id);
      return;
    }

    const child: TradingOrder = {
      id: createTradingOrderId(),
      symbol: parentOrder.symbol,
      side: 'SELL',
      type,
      status: 'PENDING',
      qty: parentOrder.qty,
      notional: roundTradingValue(parentOrder.qty * normalizedPrice),
      ...(type === 'LIMIT' ? { limitPrice: normalizedPrice } : { triggerPrice: normalizedPrice }),
      parentOrderId: parentOrder.id,
      linkType,
      createdAt,
      updatedAt: createdAt,
    };

    paperTradingState.orders.push(child);
    linkedChildIds.push(child.id);
    createdCount += 1;
  };

  ensureChild('BRACKET_TAKE_PROFIT', 'LIMIT', parentOrder.takeProfitPrice);
  ensureChild('BRACKET_STOP_LOSS', 'STOP', parentOrder.stopLossPrice);

  if (linkedChildIds.length > 0) {
    parentOrder.bracketChildOrderIds = [...new Set(linkedChildIds)].slice(0, PAPER_TRADING_MAX_BRACKET_CHILDREN);
    parentOrder.updatedAt = Math.max(parentOrder.updatedAt, createdAt);
  }

  return createdCount;
}

function fillPendingPaperOrder(order: TradingOrder, fillPrice: number, now: number) {
  if (order.status !== 'PENDING') {
    return {
      changed: false as const,
      autoCanceledCount: 0,
      rejected: false,
      fill: null as TradingFill | null,
    };
  }

  const execution = applyPaperExecutionToPortfolio(order.symbol, order.side, order.qty, fillPrice, now);
  if (!execution.ok) {
    order.status = 'REJECTED';
    order.rejectReason = execution.message;
    order.updatedAt = now;
    delete order.canceledAt;
    delete order.canceledByOrderId;

    let autoCanceledCount = 0;
    if (order.parentOrderId) {
      autoCanceledCount += cancelSiblingBracketOrders(order, now);
    }

    paperTradingState.updatedAt = now;
    return {
      changed: true as const,
      autoCanceledCount,
      rejected: true,
      fill: null as TradingFill | null,
    };
  }

  order.status = 'FILLED';
  order.notional = execution.notional;
  order.fillPrice = execution.fillPrice;
  order.filledAt = now;
  order.updatedAt = now;
  delete order.rejectReason;
  delete order.canceledAt;
  delete order.canceledByOrderId;

  const fill: TradingFill = {
    id: createTradingFillId(),
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    qty: execution.qty,
    price: execution.fillPrice,
    notional: execution.notional,
    realizedPnl: execution.realizedPnlDelta,
    filledAt: now,
  };
  paperTradingState.fills.push(fill);

  let autoCanceledCount = 0;
  if (order.parentOrderId) {
    autoCanceledCount += cancelSiblingBracketOrders(order, now);
  } else {
    createBracketChildOrdersForFilledParent(order, now);
  }

  trimPaperTradingHistory();
  paperTradingState.updatedAt = now;

  return {
    changed: true as const,
    autoCanceledCount,
    rejected: false,
    fill,
  };
}

function evaluatePendingPaperOrdersForSymbol(symbol: string, marketPrice: number, evaluatedAt: number) {
  const normalizedPrice = normalizeTradingPrice(marketPrice);
  if (!normalizedPrice) {
    return {
      changed: false,
      filledCount: 0,
      rejectedCount: 0,
      autoCanceledCount: 0,
    };
  }

  let changed = false;
  let filledCount = 0;
  let rejectedCount = 0;
  let autoCanceledCount = 0;
  let safetyCounter = 0;

  while (safetyCounter < PAPER_TRADING_MAX_ORDERS) {
    safetyCounter += 1;

    // Deterministic same-tick conflict rule:
    // 1) bracket stop-loss, 2) bracket take-profit, 3) other pending orders, then createdAt/id.
    const pending = paperTradingState.orders
      .filter((order) => order.symbol === symbol && order.status === 'PENDING')
      .filter((order) => shouldTriggerPendingOrder(order, normalizedPrice))
      .sort((a, b) => {
        const priorityDiff = getPendingOrderTriggerPriority(a) - getPendingOrderTriggerPriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      });

    if (!pending.length) break;

    const outcome = fillPendingPaperOrder(pending[0], normalizedPrice, evaluatedAt);
    if (!outcome.changed) break;

    changed = true;
    if (outcome.fill) {
      filledCount += 1;
    }
    if (outcome.rejected) {
      rejectedCount += 1;
    }
    autoCanceledCount += outcome.autoCanceledCount;
  }

  return {
    changed,
    filledCount,
    rejectedCount,
    autoCanceledCount,
  };
}

async function refreshPaperTradingPositionMarks() {
  const symbolSet = new Set<string>(paperTradingState.positions.keys());
  for (const order of paperTradingState.orders) {
    if (order.status === 'PENDING') {
      symbolSet.add(order.symbol);
    }
  }

  const symbols = [...symbolSet];
  if (!symbols.length) {
    return {
      updated: false,
      filledCount: 0,
      rejectedCount: 0,
      autoCanceledCount: 0,
    };
  }

  const settled = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const quote = await fetchLiveQuote(symbol, { skipCache: true });
      return { symbol, marketPrice: quote.lastPrice };
    }),
  );

  let updated = false;
  let filledCount = 0;
  let rejectedCount = 0;
  let autoCanceledCount = 0;

  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      app.log.warn({ error: result.reason }, 'Unable to refresh paper trading mark price');
      continue;
    }

    const normalizedPrice = normalizeTradingPrice(result.value.marketPrice);
    if (!normalizedPrice) continue;

    const evaluatedAt = Date.now();
    const matchResult = evaluatePendingPaperOrdersForSymbol(result.value.symbol, normalizedPrice, evaluatedAt);
    if (matchResult.changed) {
      updated = true;
      filledCount += matchResult.filledCount;
      rejectedCount += matchResult.rejectedCount;
      autoCanceledCount += matchResult.autoCanceledCount;
    }

    const position = paperTradingState.positions.get(result.value.symbol);
    if (!position) continue;

    position.marketPrice = normalizedPrice;
    position.unrealizedPnl = roundTradingValue((normalizedPrice - position.avgPrice) * position.qty);
    position.updatedAt = evaluatedAt;
    updated = true;
  }

  if (updated) {
    paperTradingState.updatedAt = Date.now();
  }

  return {
    updated,
    filledCount,
    rejectedCount,
    autoCanceledCount,
  };
}

function buildPaperTradingStateSnapshot() {
  const positions = [...paperTradingState.positions.values()]
    .map(cloneTradingPosition)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const marketValue = roundTradingValue(
    positions.reduce((sum, position) => sum + position.qty * position.marketPrice, 0),
  );
  const realizedPnl = roundTradingValue(
    paperTradingState.fills.reduce((sum, fill) => sum + fill.realizedPnl, 0),
  );
  const unrealizedPnl = roundTradingValue(
    positions.reduce((sum, position) => sum + position.unrealizedPnl, 0),
  );
  const cash = roundTradingValue(paperTradingState.cash);
  const equity = roundTradingValue(cash + marketValue);

  return {
    mode: paperTradingState.mode,
    startingCash: paperTradingState.startingCash,
    cash,
    summary: {
      equity,
      marketValue,
      realizedPnl,
      unrealizedPnl,
    },
    positions,
    orders: [...paperTradingState.orders].map(cloneTradingOrder).reverse(),
    fills: [...paperTradingState.fills].map(cloneTradingFill).reverse(),
    updatedAt: paperTradingState.updatedAt,
  };
}

function executePaperMarketOrder(input: {
  symbol: string;
  side: TradingOrderSide;
  qty: number;
  fillPrice: number;
  now: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}) {
  const bracketValidation = validateBracketPriceInput(
    input.side,
    input.fillPrice,
    input.takeProfitPrice,
    input.stopLossPrice,
  );
  if (!bracketValidation.ok) {
    return bracketValidation;
  }

  const execution = applyPaperExecutionToPortfolio(input.symbol, input.side, input.qty, input.fillPrice, input.now);
  if (!execution.ok) {
    return execution;
  }

  const order: TradingOrder = {
    id: createTradingOrderId(),
    symbol: input.symbol,
    side: input.side,
    type: 'MARKET',
    status: 'FILLED',
    qty: execution.qty,
    notional: execution.notional,
    ...(typeof input.takeProfitPrice === 'number'
      ? { takeProfitPrice: roundTradingValue(input.takeProfitPrice) }
      : {}),
    ...(typeof input.stopLossPrice === 'number' ? { stopLossPrice: roundTradingValue(input.stopLossPrice) } : {}),
    fillPrice: execution.fillPrice,
    filledAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const fill: TradingFill = {
    id: createTradingFillId(),
    orderId: order.id,
    symbol: input.symbol,
    side: input.side,
    qty: execution.qty,
    price: execution.fillPrice,
    notional: execution.notional,
    realizedPnl: execution.realizedPnlDelta,
    filledAt: input.now,
  };

  paperTradingState.orders.push(order);
  paperTradingState.fills.push(fill);
  createBracketChildOrdersForFilledParent(order, input.now);
  trimPaperTradingHistory();
  paperTradingState.updatedAt = input.now;

  return {
    ok: true as const,
    order: cloneTradingOrder(order),
    fill: cloneTradingFill(fill),
  };
}

function createPaperPendingOrder(input: {
  symbol: string;
  side: TradingOrderSide;
  type: Exclude<TradingOrderType, 'MARKET'>;
  qty: number;
  now: number;
  limitPrice?: number;
  triggerPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}) {
  const normalizedQty = normalizeTradingQty(input.qty);
  if (!normalizedQty) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'Order quantity must be greater than zero',
    };
  }

  const rawReferencePrice = input.type === 'LIMIT' ? input.limitPrice : input.triggerPrice;
  const normalizedReferencePrice = normalizeTradingPrice(rawReferencePrice ?? NaN);
  if (!normalizedReferencePrice) {
    return {
      ok: false as const,
      statusCode: 400,
      code: 'VALIDATION_ERROR' as TradingErrorCode,
      message: 'Order trigger/limit price must be greater than zero',
    };
  }

  const bracketValidation = validateBracketPriceInput(
    input.side,
    normalizedReferencePrice,
    input.takeProfitPrice,
    input.stopLossPrice,
  );
  if (!bracketValidation.ok) {
    return bracketValidation;
  }

  const order: TradingOrder = {
    id: createTradingOrderId(),
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    status: 'PENDING',
    qty: normalizedQty,
    notional: roundTradingValue(normalizedQty * normalizedReferencePrice),
    ...(typeof input.limitPrice === 'number' ? { limitPrice: roundTradingValue(input.limitPrice) } : {}),
    ...(typeof input.triggerPrice === 'number' ? { triggerPrice: roundTradingValue(input.triggerPrice) } : {}),
    ...(typeof input.takeProfitPrice === 'number' ? { takeProfitPrice: roundTradingValue(input.takeProfitPrice) } : {}),
    ...(typeof input.stopLossPrice === 'number' ? { stopLossPrice: roundTradingValue(input.stopLossPrice) } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };

  paperTradingState.orders.push(order);
  trimPaperTradingHistory();
  paperTradingState.updatedAt = input.now;

  return {
    ok: true as const,
    order: cloneTradingOrder(order),
  };
}

function cancelPaperTradingOrder(orderId: string, canceledAt: number) {
  const target = paperTradingState.orders.find((order) => order.id === orderId);
  if (!target) {
    return {
      ok: false as const,
      statusCode: 404,
      code: 'ORDER_NOT_FOUND' as TradingErrorCode,
      message: 'Paper order not found',
    };
  }

  if (target.status !== 'PENDING') {
    return {
      ok: false as const,
      statusCode: 409,
      code: 'ORDER_NOT_CANCELABLE' as TradingErrorCode,
      message: `Only pending paper orders can be canceled (current status: ${target.status})`,
    };
  }

  markTradingOrderCanceled(target, canceledAt);

  if (target.parentOrderId) {
    cancelSiblingBracketOrders(target, canceledAt);
  } else {
    cancelPendingBracketChildren(target.id, canceledAt, target.id);
  }

  paperTradingState.updatedAt = canceledAt;

  return {
    ok: true as const,
    order: cloneTradingOrder(target),
  };
}

function serializePaperTradingStateForPersistence() {
  return {
    mode: paperTradingState.mode,
    startingCash: paperTradingState.startingCash,
    cash: paperTradingState.cash,
    positions: [...paperTradingState.positions.values()].map(cloneTradingPosition),
    orders: paperTradingState.orders.map(cloneTradingOrder),
    fills: paperTradingState.fills.map(cloneTradingFill),
    updatedAt: paperTradingState.updatedAt,
  };
}

function restorePaperTradingState(rawTrading: unknown) {
  resetPaperTradingState();

  if (rawTrading === undefined || rawTrading === null) {
    return {
      restored: false,
      invalid: false,
      skippedPositions: 0,
      skippedOrders: 0,
      skippedFills: 0,
    };
  }

  const parsedTrading = persistedTradingStateSchema.safeParse(rawTrading);
  if (!parsedTrading.success) {
    return {
      restored: false,
      invalid: true,
      skippedPositions: 0,
      skippedOrders: 0,
      skippedFills: 0,
    };
  }

  if (typeof parsedTrading.data.startingCash === 'number') {
    resetPaperTradingState(Math.max(parsedTrading.data.startingCash, 0));
  }

  if (typeof parsedTrading.data.cash === 'number' && Number.isFinite(parsedTrading.data.cash)) {
    paperTradingState.cash = roundTradingValue(parsedTrading.data.cash);
  }

  let skippedPositions = 0;
  for (const rawPosition of parsedTrading.data.positions ?? []) {
    const parsedPosition = persistedTradingPositionSchema.safeParse(rawPosition);
    if (!parsedPosition.success) {
      skippedPositions += 1;
      continue;
    }

    const symbol = normalizeSymbol(parsedPosition.data.symbol);
    const qty = roundTradingValue(parsedPosition.data.qty);
    if (qty <= PAPER_TRADING_EPSILON) {
      continue;
    }

    paperTradingState.positions.set(symbol, {
      symbol,
      qty,
      avgPrice: roundTradingValue(parsedPosition.data.avgPrice),
      marketPrice: roundTradingValue(parsedPosition.data.marketPrice),
      unrealizedPnl: roundTradingValue(parsedPosition.data.unrealizedPnl),
      realizedPnl: roundTradingValue(parsedPosition.data.realizedPnl),
      updatedAt: parsedPosition.data.updatedAt,
    });
  }

  let skippedOrders = 0;
  const restoredOrders: TradingOrder[] = [];
  for (const rawOrder of parsedTrading.data.orders ?? []) {
    const parsedOrder = persistedTradingOrderSchema.safeParse(rawOrder);
    if (!parsedOrder.success) {
      skippedOrders += 1;
      continue;
    }

    restoredOrders.push({
      id: parsedOrder.data.id,
      symbol: normalizeSymbol(parsedOrder.data.symbol),
      side: parsedOrder.data.side,
      type: parsedOrder.data.type,
      status: parsedOrder.data.status,
      qty: roundTradingValue(parsedOrder.data.qty),
      notional: roundTradingValue(parsedOrder.data.notional),
      ...(typeof parsedOrder.data.triggerPrice === 'number'
        ? { triggerPrice: roundTradingValue(parsedOrder.data.triggerPrice) }
        : {}),
      ...(typeof parsedOrder.data.limitPrice === 'number'
        ? { limitPrice: roundTradingValue(parsedOrder.data.limitPrice) }
        : {}),
      ...(typeof parsedOrder.data.takeProfitPrice === 'number'
        ? { takeProfitPrice: roundTradingValue(parsedOrder.data.takeProfitPrice) }
        : {}),
      ...(typeof parsedOrder.data.stopLossPrice === 'number'
        ? { stopLossPrice: roundTradingValue(parsedOrder.data.stopLossPrice) }
        : {}),
      ...(parsedOrder.data.parentOrderId ? { parentOrderId: parsedOrder.data.parentOrderId } : {}),
      ...(parsedOrder.data.linkType ? { linkType: parsedOrder.data.linkType } : {}),
      ...(parsedOrder.data.bracketChildOrderIds?.length
        ? { bracketChildOrderIds: [...new Set(parsedOrder.data.bracketChildOrderIds)] }
        : {}),
      ...(parsedOrder.data.canceledByOrderId ? { canceledByOrderId: parsedOrder.data.canceledByOrderId } : {}),
      ...(typeof parsedOrder.data.fillPrice === 'number'
        ? { fillPrice: roundTradingValue(parsedOrder.data.fillPrice) }
        : {}),
      ...(typeof parsedOrder.data.filledAt === 'number' ? { filledAt: parsedOrder.data.filledAt } : {}),
      ...(typeof parsedOrder.data.canceledAt === 'number' ? { canceledAt: parsedOrder.data.canceledAt } : {}),
      ...(parsedOrder.data.rejectReason ? { rejectReason: parsedOrder.data.rejectReason } : {}),
      createdAt: parsedOrder.data.createdAt,
      updatedAt: parsedOrder.data.updatedAt,
    });
  }

  const restoredOrderById = new Map(restoredOrders.map((order) => [order.id, order]));
  for (const order of restoredOrders) {
    if (order.bracketChildOrderIds?.length) {
      order.bracketChildOrderIds = order.bracketChildOrderIds
        .filter((childId) => {
          const child = restoredOrderById.get(childId);
          return Boolean(child && child.parentOrderId === order.id);
        })
        .slice(0, PAPER_TRADING_MAX_BRACKET_CHILDREN);
      if (!order.bracketChildOrderIds.length) {
        delete order.bracketChildOrderIds;
      }
    }
  }

  for (const order of restoredOrders) {
    if (!order.parentOrderId) continue;
    const parent = restoredOrderById.get(order.parentOrderId);
    if (!parent) continue;
    const existing = new Set(parent.bracketChildOrderIds ?? []);
    existing.add(order.id);
    parent.bracketChildOrderIds = [...existing].slice(0, PAPER_TRADING_MAX_BRACKET_CHILDREN);
  }

  let skippedFills = 0;
  const restoredFills: TradingFill[] = [];
  for (const rawFill of parsedTrading.data.fills ?? []) {
    const parsedFill = persistedTradingFillSchema.safeParse(rawFill);
    if (!parsedFill.success) {
      skippedFills += 1;
      continue;
    }

    restoredFills.push({
      id: parsedFill.data.id,
      orderId: parsedFill.data.orderId,
      symbol: normalizeSymbol(parsedFill.data.symbol),
      side: parsedFill.data.side,
      qty: roundTradingValue(parsedFill.data.qty),
      price: roundTradingValue(parsedFill.data.price),
      notional: roundTradingValue(parsedFill.data.notional),
      realizedPnl: roundTradingValue(parsedFill.data.realizedPnl),
      filledAt: parsedFill.data.filledAt,
    });
  }

  paperTradingState.orders = restoredOrders;
  paperTradingState.fills = restoredFills;
  trimPaperTradingHistory();
  paperTradingState.updatedAt = parsedTrading.data.updatedAt ?? Date.now();

  return {
    restored: true,
    invalid: false,
    skippedPositions,
    skippedOrders,
    skippedFills,
  };
}

function createRuntimeStatePayload() {
  return {
    version: RUNTIME_STATE_VERSION,
    alertRules: [...alertRuleStore.values()].map(serializeAlertRule),
    alertHistory: alertHistoryStore.map((eventItem) => ({
      ruleId: eventItem.ruleId,
      symbol: eventItem.symbol,
      metric: eventItem.metric,
      operator: eventItem.operator,
      threshold: eventItem.threshold,
      ...(typeof eventItem.currentValue === 'number' ? { currentValue: eventItem.currentValue } : {}),
      triggeredAt: eventItem.triggeredAt,
      cooldownSec: eventItem.cooldownSec,
      eventType: normalizeAlertEventType(eventItem.eventType),
      state: normalizeAlertLifecycleState(
        eventItem.state ?? (normalizeAlertEventType(eventItem.eventType) === 'error' ? 'error' : 'triggered'),
      ),
      ...(eventItem.transition ? { transition: cloneAlertStateTransition(eventItem.transition)! } : {}),
      ...(eventItem.errorMessage?.trim() ? { errorMessage: eventItem.errorMessage.trim() } : {}),
      ...(eventItem.indicatorConditions?.length
        ? { indicatorConditions: cloneIndicatorConditions(eventItem.indicatorConditions) }
        : {}),
      ...(eventItem.source ? { source: eventItem.source } : {}),
      ...(eventItem.sourceSymbol ? { sourceSymbol: eventItem.sourceSymbol } : {}),
    })),
    opsErrors: opsErrorStore.map((eventItem) => ({
      ...eventItem,
      ...(eventItem.context ? { context: cloneOpsContext(eventItem.context) } : {}),
    })),
    opsRecoveries: opsRecoveryStore.map((eventItem) => ({
      ...eventItem,
      ...(eventItem.context ? { context: cloneOpsContext(eventItem.context) } : {}),
    })),
    watchlists: [...watchlistStore.entries()].map(([name, items]) => ({
      name,
      items: items.map(cloneSymbolItem),
    })),
    drawings: [...drawingStore.entries()]
      .map(([key, drawings]) => {
        const parsedKey = parseDrawingStoreKey(key);
        if (!parsedKey) {
          return null;
        }

        return {
          symbol: parsedKey.symbol,
          interval: parsedKey.interval,
          drawings: drawings.map((drawing) => ({ ...drawing })),
        };
      })
      .filter((entry): entry is { symbol: string; interval: string; drawings: DrawingItem[] } => Boolean(entry)),
    trading: serializePaperTradingStateForPersistence(),
  };
}

async function writeRuntimeStateFile() {
  const stateFile = resolveRuntimeStateFilePath();
  const tempFile = `${stateFile}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(tempFile, `${JSON.stringify(createRuntimeStatePayload(), null, 2)}\n`, 'utf8');
    await rename(tempFile, stateFile);
  } catch (error) {
    app.log.warn({ error, stateFile }, 'Unable to persist runtime state');
    try {
      await rm(tempFile, { force: true });
    } catch {}
  }
}

let persistRuntimeStateQueue: Promise<void> = Promise.resolve();

function persistRuntimeState() {
  persistRuntimeStateQueue = persistRuntimeStateQueue.then(async () => {
    await writeRuntimeStateFile();
  });
  return persistRuntimeStateQueue;
}

async function loadRuntimeStateFromDisk() {
  const stateFile = resolveRuntimeStateFilePath();
  let rawState = '';

  try {
    rawState = await readFile(stateFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    app.log.warn({ error, stateFile }, 'Unable to read runtime state file. Starting with empty state.');
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawState);
  } catch (error) {
    app.log.warn({ error, stateFile }, 'Runtime state file is malformed JSON. Starting with empty state.');
    return;
  }

  const parsedState = persistedRuntimeStateSchema.safeParse(parsedJson);
  if (!parsedState.success) {
    app.log.warn(
      { stateFile, issues: parsedState.error.issues },
      'Runtime state file failed validation. Starting with empty state.',
    );
    return;
  }

  alertRuleStore.clear();
  alertHistoryStore.length = 0;
  opsErrorStore.length = 0;
  opsRecoveryStore.length = 0;
  watchlistStore.clear();
  drawingStore.clear();
  resetPaperTradingState();

  let skippedAlertRules = 0;
  for (const rawRule of parsedState.data.alertRules ?? []) {
    const parsedRule = persistedAlertRuleSchema.safeParse(rawRule);
    if (!parsedRule.success) {
      skippedAlertRules += 1;
      continue;
    }

    const normalizedRule: AlertRule = {
      id: parsedRule.data.id.trim(),
      symbol: normalizeSymbol(parsedRule.data.symbol),
      metric: parsedRule.data.metric,
      operator: parsedRule.data.operator,
      threshold: parsedRule.data.threshold,
      cooldownSec: parsedRule.data.cooldownSec,
      ...(parsedRule.data.indicatorConditions?.length
        ? { indicatorConditions: parsedRule.data.indicatorConditions.map((condition) => ({ ...condition })) }
        : {}),
      createdAt: parsedRule.data.createdAt,
      lastTriggeredAt: parsedRule.data.lastTriggeredAt,
      state: normalizeAlertLifecycleState(parsedRule.data.state),
      stateUpdatedAt: parsedRule.data.stateUpdatedAt ?? parsedRule.data.createdAt,
      lastStateTransition: createInitialAlertStateTransition(parsedRule.data.createdAt),
      ...(parsedRule.data.lastTrigger
        ? {
            lastTrigger: {
              triggeredAt: parsedRule.data.lastTrigger.triggeredAt,
              currentValue: parsedRule.data.lastTrigger.currentValue,
              source: parsedRule.data.lastTrigger.source,
              ...(parsedRule.data.lastTrigger.sourceSymbol
                ? { sourceSymbol: normalizeSymbol(parsedRule.data.lastTrigger.sourceSymbol) }
                : {}),
            },
          }
        : {}),
      ...(parsedRule.data.lastError
        ? {
            lastError: {
              failedAt: parsedRule.data.lastError.failedAt,
              message: parsedRule.data.lastError.message.trim(),
              source: parsedRule.data.lastError.source,
              ...(parsedRule.data.lastError.sourceSymbol
                ? { sourceSymbol: normalizeSymbol(parsedRule.data.lastError.sourceSymbol) }
                : {}),
            },
          }
        : {}),
    };

    if (parsedRule.data.lastStateTransition) {
      const transition: AlertStateTransition = {
        from: parsedRule.data.lastStateTransition.from
          ? normalizeAlertLifecycleState(parsedRule.data.lastStateTransition.from)
          : null,
        to: normalizeAlertLifecycleState(parsedRule.data.lastStateTransition.to),
        transitionedAt: parsedRule.data.lastStateTransition.transitionedAt,
        reason: parsedRule.data.lastStateTransition.reason,
        ...(parsedRule.data.lastStateTransition.message?.trim()
          ? { message: parsedRule.data.lastStateTransition.message.trim() }
          : {}),
      };

      normalizedRule.lastStateTransition = transition;
      normalizedRule.stateUpdatedAt = parsedRule.data.stateUpdatedAt ?? transition.transitionedAt;
      normalizedRule.state = normalizeAlertLifecycleState(parsedRule.data.state ?? transition.to);

      if (transition.to !== normalizedRule.state) {
        normalizedRule.lastStateTransition = {
          from: transition.to,
          to: normalizedRule.state,
          transitionedAt: normalizedRule.stateUpdatedAt,
          reason: transition.reason,
          ...(transition.message ? { message: transition.message } : {}),
        };
      }
    } else {
      normalizedRule.lastStateTransition = {
        ...normalizedRule.lastStateTransition,
        to: normalizedRule.state,
        transitionedAt: normalizedRule.stateUpdatedAt,
      };
    }

    alertRuleStore.set(normalizedRule.id, normalizedRule);
  }

  let skippedAlertHistoryEvents = 0;
  for (const rawEvent of parsedState.data.alertHistory ?? []) {
    const parsedEvent = persistedAlertHistoryEventSchema.safeParse(rawEvent);
    if (!parsedEvent.success) {
      skippedAlertHistoryEvents += 1;
      continue;
    }

    const normalizedEvent: AlertHistoryEvent = {
      ruleId: parsedEvent.data.ruleId.trim(),
      symbol: normalizeSymbol(parsedEvent.data.symbol),
      metric: parsedEvent.data.metric,
      operator: parsedEvent.data.operator,
      threshold: parsedEvent.data.threshold,
      ...(typeof parsedEvent.data.currentValue === 'number'
        ? { currentValue: parsedEvent.data.currentValue }
        : {}),
      triggeredAt: parsedEvent.data.triggeredAt,
      cooldownSec: parsedEvent.data.cooldownSec,
      eventType: normalizeAlertEventType(parsedEvent.data.eventType),
      state: normalizeAlertLifecycleState(
        parsedEvent.data.state ??
          (normalizeAlertEventType(parsedEvent.data.eventType) === 'error' ? 'error' : 'triggered'),
      ),
      ...(parsedEvent.data.transition
        ? {
            transition: {
              from: parsedEvent.data.transition.from
                ? normalizeAlertLifecycleState(parsedEvent.data.transition.from)
                : null,
              to: normalizeAlertLifecycleState(parsedEvent.data.transition.to),
              transitionedAt: parsedEvent.data.transition.transitionedAt,
              reason: parsedEvent.data.transition.reason,
              ...(parsedEvent.data.transition.message?.trim()
                ? { message: parsedEvent.data.transition.message.trim() }
                : {}),
            },
          }
        : {}),
      ...(parsedEvent.data.errorMessage?.trim()
        ? { errorMessage: parsedEvent.data.errorMessage.trim() }
        : {}),
      ...(parsedEvent.data.indicatorConditions?.length
        ? { indicatorConditions: parsedEvent.data.indicatorConditions.map((condition) => ({ ...condition })) }
        : {}),
      ...(parsedEvent.data.source ? { source: parsedEvent.data.source } : {}),
      ...(parsedEvent.data.sourceSymbol
        ? { sourceSymbol: normalizeSymbol(parsedEvent.data.sourceSymbol) }
        : {}),
    };

    alertHistoryStore.push(normalizedEvent);
  }
  trimAlertHistoryOverflow();

  let skippedOpsErrors = 0;
  for (const rawEvent of parsedState.data.opsErrors ?? []) {
    const parsedEvent = persistedOpsErrorEventSchema.safeParse(rawEvent);
    if (!parsedEvent.success) {
      skippedOpsErrors += 1;
      continue;
    }

    const normalizedEvent: OpsErrorEvent = {
      id: parsedEvent.data.id.trim(),
      level: parsedEvent.data.level,
      source: parsedEvent.data.source,
      code: parsedEvent.data.code,
      message: parsedEvent.data.message,
      ...(parsedEvent.data.context ? { context: cloneOpsContext(parsedEvent.data.context) } : {}),
      occurredAt: parsedEvent.data.occurredAt,
      recordedAt: parsedEvent.data.recordedAt,
    };

    opsErrorStore.push(normalizedEvent);
  }
  trimOpsErrorOverflow();

  let skippedOpsRecoveries = 0;
  for (const rawEvent of parsedState.data.opsRecoveries ?? []) {
    const parsedEvent = persistedOpsRecoveryEventSchema.safeParse(rawEvent);
    if (!parsedEvent.success) {
      skippedOpsRecoveries += 1;
      continue;
    }

    const normalizedEvent: OpsRecoveryEvent = {
      id: parsedEvent.data.id.trim(),
      source: parsedEvent.data.source,
      action: parsedEvent.data.action,
      status: parsedEvent.data.status,
      ...(parsedEvent.data.message ? { message: parsedEvent.data.message } : {}),
      ...(parsedEvent.data.errorCode ? { errorCode: parsedEvent.data.errorCode } : {}),
      ...(parsedEvent.data.context ? { context: cloneOpsContext(parsedEvent.data.context) } : {}),
      occurredAt: parsedEvent.data.occurredAt,
      recordedAt: parsedEvent.data.recordedAt,
    };

    opsRecoveryStore.push(normalizedEvent);
  }
  trimOpsRecoveryOverflow();

  let skippedWatchlists = 0;
  let skippedWatchlistItems = 0;
  for (const rawWatchlist of parsedState.data.watchlists ?? []) {
    const parsedWatchlist = persistedWatchlistEntrySchema.safeParse(rawWatchlist);
    if (!parsedWatchlist.success) {
      skippedWatchlists += 1;
      continue;
    }

    const name = normalizeWatchlistName(parsedWatchlist.data.name);
    const normalizedItems: SymbolItem[] = [];

    for (const rawItem of parsedWatchlist.data.items) {
      const parsedItem = symbolItemSchema.safeParse(rawItem);
      if (!parsedItem.success) {
        skippedWatchlistItems += 1;
        continue;
      }

      normalizedItems.push(normalizeSymbolItem(parsedItem.data));
    }

    watchlistStore.set(name, normalizedItems.map(cloneSymbolItem));
  }

  let skippedDrawingCollections = 0;
  let skippedDrawings = 0;
  for (const rawDrawingEntry of parsedState.data.drawings ?? []) {
    const parsedDrawingEntry = persistedDrawingEntrySchema.safeParse(rawDrawingEntry);
    if (!parsedDrawingEntry.success) {
      skippedDrawingCollections += 1;
      continue;
    }

    const symbol = normalizeSymbol(parsedDrawingEntry.data.symbol);
    const interval = normalizeInterval(parsedDrawingEntry.data.interval);
    const normalizedDrawings: DrawingItem[] = [];

    for (const rawDrawing of parsedDrawingEntry.data.drawings) {
      const parsedDrawing = drawingItemSchema.safeParse(rawDrawing);
      if (!parsedDrawing.success) {
        skippedDrawings += 1;
        continue;
      }

      normalizedDrawings.push(...normalizeDrawingItems([parsedDrawing.data]));
    }

    drawingStore.set(createDrawingStoreKey(symbol, interval), normalizedDrawings);
  }

  const tradingRestore = restorePaperTradingState(parsedState.data.trading);

  app.log.info(
    {
      stateFile,
      restored: {
        alertRules: alertRuleStore.size,
        alertHistoryEvents: alertHistoryStore.length,
        opsErrors: opsErrorStore.length,
        opsRecoveries: opsRecoveryStore.length,
        watchlists: watchlistStore.size,
        drawingSets: drawingStore.size,
        tradingPositions: paperTradingState.positions.size,
        tradingOrders: paperTradingState.orders.length,
        tradingFills: paperTradingState.fills.length,
      },
      skipped: {
        alertRules: skippedAlertRules,
        alertHistoryEvents: skippedAlertHistoryEvents,
        opsErrors: skippedOpsErrors,
        opsRecoveries: skippedOpsRecoveries,
        watchlists: skippedWatchlists,
        watchlistItems: skippedWatchlistItems,
        drawingCollections: skippedDrawingCollections,
        drawings: skippedDrawings,
        tradingInvalidPayload: tradingRestore.invalid ? 1 : 0,
        tradingPositions: tradingRestore.skippedPositions,
        tradingOrders: tradingRestore.skippedOrders,
        tradingFills: tradingRestore.skippedFills,
      },
    },
    'Loaded runtime state from disk',
  );
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

type AlertIndicatorEvaluationCache = {
  closeValues: number[];
  rsiByPeriod: Map<number, Array<number | null>>;
  macdByPeriod: Map<string, MacdValues>;
  bollingerByPeriod: Map<string, BollingerBandsValues>;
};

function normalizeAlertLifecycleState(state?: AlertLifecycleState | null): AlertLifecycleState {
  if (state === 'active' || state === 'triggered' || state === 'cooldown' || state === 'error') {
    return state;
  }
  return 'active';
}

function normalizeAlertEventType(type?: AlertHistoryEventType | null): AlertHistoryEventType {
  if (type === 'triggered' || type === 'error') {
    return type;
  }
  return 'triggered';
}

function cloneAlertStateTransition(transition?: AlertStateTransition) {
  if (!transition) return undefined;
  const message = transition.message?.trim();
  return {
    from: transition.from,
    to: transition.to,
    transitionedAt: transition.transitionedAt,
    reason: transition.reason,
    ...(message ? { message } : {}),
  } satisfies AlertStateTransition;
}

function cloneAlertLastTrigger(lastTrigger?: AlertLastTriggerMetadata) {
  if (!lastTrigger) return undefined;
  return {
    triggeredAt: lastTrigger.triggeredAt,
    currentValue: lastTrigger.currentValue,
    source: lastTrigger.source,
    ...(lastTrigger.sourceSymbol ? { sourceSymbol: normalizeSymbol(lastTrigger.sourceSymbol) } : {}),
  } satisfies AlertLastTriggerMetadata;
}

function cloneAlertLastError(lastError?: AlertLastErrorMetadata) {
  if (!lastError) return undefined;
  const message = lastError.message.trim();
  return {
    failedAt: lastError.failedAt,
    message,
    source: lastError.source,
    ...(lastError.sourceSymbol ? { sourceSymbol: normalizeSymbol(lastError.sourceSymbol) } : {}),
  } satisfies AlertLastErrorMetadata;
}

function createInitialAlertStateTransition(createdAt: number): AlertStateTransition {
  return {
    from: null,
    to: 'active',
    transitionedAt: createdAt,
    reason: 'ruleCreated',
  };
}

function transitionAlertRuleState(
  rule: AlertRule,
  nextState: AlertLifecycleState,
  transitionedAt: number,
  reason: AlertStateTransitionReason,
  message?: string | null,
) {
  const normalizedMessage = typeof message === 'string' && message.trim().length > 0 ? message.trim() : undefined;
  const previousTransition = rule.lastStateTransition;
  const stateChanged = rule.state !== nextState;
  const reasonChanged = previousTransition.reason !== reason;
  const messageChanged = (previousTransition.message ?? undefined) !== normalizedMessage;

  if (!stateChanged && !reasonChanged && !messageChanged) {
    return null;
  }

  const transition: AlertStateTransition = {
    from: rule.state,
    to: nextState,
    transitionedAt,
    reason,
    ...(normalizedMessage ? { message: normalizedMessage } : {}),
  };

  rule.state = nextState;
  rule.stateUpdatedAt = transitionedAt;
  rule.lastStateTransition = transition;

  if (nextState !== 'error') {
    delete rule.lastError;
  }

  return transition;
}

function cloneIndicatorConditions(conditions?: AlertIndicatorCondition[]) {
  if (!conditions?.length) return undefined;
  return conditions.map((condition) => ({ ...condition }));
}

function hasIndicatorConditions(rule: Pick<AlertRule, 'indicatorConditions'>) {
  return Boolean(rule.indicatorConditions?.length);
}

function isIndicatorAwareEvent(eventItem: Pick<AlertCheckEvent, 'indicatorConditions'>) {
  return Boolean(eventItem.indicatorConditions?.length);
}

function createMacdPeriodKey(fastPeriod: number, slowPeriod: number, signalPeriod: number) {
  return `${fastPeriod}:${slowPeriod}:${signalPeriod}`;
}

function createBollingerPeriodKey(period: number, stdDev: number) {
  return `${period}:${stdDev}`;
}

function collectScopedSymbols(symbol?: string | null, symbols?: string[] | null) {
  const scopedSymbols = new Set<string>();

  if (typeof symbol === 'string' && symbol.trim().length > 0) {
    scopedSymbols.add(normalizeSymbol(symbol));
  }

  for (const rawSymbol of symbols ?? []) {
    if (!rawSymbol?.trim()) continue;
    scopedSymbols.add(normalizeSymbol(rawSymbol));
  }

  return scopedSymbols.size > 0 ? scopedSymbols : null;
}

function createIndicatorEvaluationCache(candles: Candle[]) {
  const closeValues = candles
    .map((candle) => Number(candle.close))
    .filter((value) => Number.isFinite(value));

  if (closeValues.length < 2) {
    return null;
  }

  return {
    closeValues,
    rsiByPeriod: new Map(),
    macdByPeriod: new Map(),
    bollingerByPeriod: new Map(),
  } satisfies AlertIndicatorEvaluationCache;
}

function getLastNumber(values: Array<number | null>) {
  if (!values.length) return null;
  const lastValue = values[values.length - 1];
  return typeof lastValue === 'number' && Number.isFinite(lastValue) ? lastValue : null;
}

function evaluateIndicatorCondition(
  condition: AlertIndicatorCondition,
  cache: AlertIndicatorEvaluationCache,
  quoteValues: { lastPrice: number; changePercent: number },
) {
  if (condition.type === 'rsiThreshold') {
    const cached = cache.rsiByPeriod.get(condition.period) ?? calculateRSI(cache.closeValues, condition.period);
    cache.rsiByPeriod.set(condition.period, cached);
    const latestRsi = getLastNumber(cached);
    if (latestRsi === null) return false;
    return compareWithOperator(latestRsi, condition.operator, condition.threshold);
  }

  if (condition.type === 'macdCrossSignal' || condition.type === 'macdHistogramSign') {
    const cacheKey = createMacdPeriodKey(condition.fastPeriod, condition.slowPeriod, condition.signalPeriod);
    const cached =
      cache.macdByPeriod.get(cacheKey) ??
      calculateMACD(cache.closeValues, condition.fastPeriod, condition.slowPeriod, condition.signalPeriod);
    cache.macdByPeriod.set(cacheKey, cached);

    if (condition.type === 'macdHistogramSign') {
      const latestHistogram = getLastNumber(cached.histogram);
      if (latestHistogram === null) return false;
      return condition.sign === 'positive' ? latestHistogram > 0 : latestHistogram < 0;
    }

    const lastIndex = cached.macdLine.length - 1;
    if (lastIndex < 1) return false;

    const previousMacd = cached.macdLine[lastIndex - 1];
    const previousSignal = cached.signalLine[lastIndex - 1];
    const currentMacd = cached.macdLine[lastIndex];
    const currentSignal = cached.signalLine[lastIndex];

    if (
      typeof previousMacd !== 'number' ||
      typeof previousSignal !== 'number' ||
      typeof currentMacd !== 'number' ||
      typeof currentSignal !== 'number' ||
      !Number.isFinite(previousMacd) ||
      !Number.isFinite(previousSignal) ||
      !Number.isFinite(currentMacd) ||
      !Number.isFinite(currentSignal)
    ) {
      return false;
    }

    if (condition.signal === 'bullish') {
      return previousMacd <= previousSignal && currentMacd > currentSignal;
    }

    return previousMacd >= previousSignal && currentMacd < currentSignal;
  }

  const cacheKey = createBollingerPeriodKey(condition.period, condition.stdDev);
  const cached =
    cache.bollingerByPeriod.get(cacheKey) ??
    calculateBollingerBands(cache.closeValues, condition.period, condition.stdDev);
  cache.bollingerByPeriod.set(cacheKey, cached);

  const latestUpper = getLastNumber(cached.upper);
  const latestLower = getLastNumber(cached.lower);
  if (latestUpper === null || latestLower === null) return false;

  if (condition.position === 'aboveUpper') {
    return quoteValues.lastPrice > latestUpper;
  }

  return quoteValues.lastPrice < latestLower;
}

function evaluateRuleIndicatorConditions(
  rule: AlertRule,
  quoteValues: { lastPrice: number; changePercent: number },
  indicatorCacheBySymbol: Map<string, AlertIndicatorEvaluationCache>,
) {
  if (!hasIndicatorConditions(rule)) {
    return true;
  }

  const symbolCache = indicatorCacheBySymbol.get(rule.symbol);
  if (!symbolCache) return false;

  return rule.indicatorConditions!.every((condition) =>
    evaluateIndicatorCondition(condition, symbolCache, quoteValues),
  );
}

function serializeAlertRule(rule: AlertRule) {
  return {
    id: rule.id,
    symbol: rule.symbol,
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    cooldownSec: rule.cooldownSec,
    createdAt: rule.createdAt,
    lastTriggeredAt: rule.lastTriggeredAt,
    state: rule.state,
    stateUpdatedAt: rule.stateUpdatedAt,
    lastStateTransition: cloneAlertStateTransition(rule.lastStateTransition)!,
    ...(rule.lastTrigger ? { lastTrigger: cloneAlertLastTrigger(rule.lastTrigger)! } : {}),
    ...(rule.lastError ? { lastError: cloneAlertLastError(rule.lastError)! } : {}),
    ...(rule.indicatorConditions?.length ? { indicatorConditions: cloneIndicatorConditions(rule.indicatorConditions) } : {}),
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

function appendAlertHistoryEvents(
  events: AlertCheckEvent[],
  source: AlertHistoryEventSource,
  sourceSymbol?: string | null,
) {
  if (!events.length) return;

  const normalizedSourceSymbol = sourceSymbol ? normalizeSymbol(sourceSymbol) : null;

  for (const eventItem of events) {
    const normalizedEventType = normalizeAlertEventType(eventItem.eventType);
    const defaultState: AlertLifecycleState = normalizedEventType === 'error' ? 'error' : 'triggered';

    alertHistoryStore.push({
      ruleId: eventItem.ruleId,
      symbol: eventItem.symbol,
      metric: eventItem.metric,
      operator: eventItem.operator,
      threshold: eventItem.threshold,
      ...(typeof eventItem.currentValue === 'number' ? { currentValue: eventItem.currentValue } : {}),
      triggeredAt: eventItem.triggeredAt,
      cooldownSec: eventItem.cooldownSec,
      eventType: normalizedEventType,
      state: normalizeAlertLifecycleState(eventItem.state ?? defaultState),
      ...(eventItem.transition ? { transition: cloneAlertStateTransition(eventItem.transition)! } : {}),
      ...(eventItem.errorMessage?.trim() ? { errorMessage: eventItem.errorMessage.trim() } : {}),
      ...(eventItem.indicatorConditions?.length
        ? { indicatorConditions: cloneIndicatorConditions(eventItem.indicatorConditions) }
        : {}),
      source,
      ...(normalizedSourceSymbol ? { sourceSymbol: normalizedSourceSymbol } : {}),
    });
  }

  trimAlertHistoryOverflow();
}

function getAlertHistory(
  symbols: Set<string> | null,
  source: AlertHistoryEventSource | null,
  fromTs: number | null,
  toTs: number | null,
  limit: number,
  indicatorAwareOnly: boolean,
  lifecycleState: AlertLifecycleState | null,
  eventType: AlertHistoryEventType | 'all',
) {
  const filtered = alertHistoryStore.filter((eventItem) => {
    if (symbols && !symbols.has(eventItem.symbol)) {
      return false;
    }

    if (source && eventItem.source !== source) {
      return false;
    }

    if (indicatorAwareOnly && !isIndicatorAwareEvent(eventItem)) {
      return false;
    }

    const normalizedEventType = normalizeAlertEventType(eventItem.eventType);
    const normalizedState = normalizeAlertLifecycleState(
      eventItem.state ?? (normalizedEventType === 'error' ? 'error' : 'triggered'),
    );

    if (eventType !== 'all' && normalizedEventType !== eventType) {
      return false;
    }

    if (lifecycleState && normalizedState !== lifecycleState) {
      return false;
    }

    if (typeof fromTs === 'number' && eventItem.triggeredAt < fromTs) {
      return false;
    }

    if (typeof toTs === 'number' && eventItem.triggeredAt > toTs) {
      return false;
    }

    return true;
  });
  const total = filtered.length;
  const start = Math.max(total - limit, 0);

  return {
    total,
    events: filtered.slice(start).reverse().map((eventItem) => ({
      ruleId: eventItem.ruleId,
      symbol: eventItem.symbol,
      metric: eventItem.metric,
      operator: eventItem.operator,
      threshold: eventItem.threshold,
      ...(typeof eventItem.currentValue === 'number' ? { currentValue: eventItem.currentValue } : {}),
      triggeredAt: eventItem.triggeredAt,
      cooldownSec: eventItem.cooldownSec,
      eventType: normalizeAlertEventType(eventItem.eventType),
      state: normalizeAlertLifecycleState(
        eventItem.state ?? (normalizeAlertEventType(eventItem.eventType) === 'error' ? 'error' : 'triggered'),
      ),
      ...(eventItem.transition ? { transition: cloneAlertStateTransition(eventItem.transition)! } : {}),
      ...(eventItem.errorMessage?.trim() ? { errorMessage: eventItem.errorMessage.trim() } : {}),
      ...(eventItem.indicatorConditions?.length
        ? { indicatorConditions: cloneIndicatorConditions(eventItem.indicatorConditions) }
        : {}),
      ...(eventItem.source ? { source: eventItem.source } : {}),
      ...(eventItem.sourceSymbol ? { sourceSymbol: eventItem.sourceSymbol } : {}),
    })),
  };
}

function clearAlertHistory() {
  const cleared = alertHistoryStore.length;
  alertHistoryStore.length = 0;
  return cleared;
}

function evaluateAlertRules(
  rules: AlertRule[],
  quoteBySymbol: Map<string, { lastPrice: number; changePercent: number }>,
  evaluatedAt: number,
  indicatorCacheBySymbol: Map<string, AlertIndicatorEvaluationCache>,
  source: AlertHistoryEventSource,
  sourceSymbol?: string | null,
) {
  const triggered: AlertCheckEvent[] = [];
  const suppressed: AlertCooldownSuppression[] = [];
  let suppressedByCooldown = 0;
  let stateTransitionCount = 0;
  const normalizedSourceSymbol = sourceSymbol ? normalizeSymbol(sourceSymbol) : undefined;

  for (const rule of rules) {
    const values = quoteBySymbol.get(rule.symbol);
    if (!values) continue;

    const currentValue = selectMetricValue(rule.metric, values);
    const met = compareWithOperator(currentValue, rule.operator, rule.threshold);
    const indicatorMatched = met && evaluateRuleIndicatorConditions(rule, values, indicatorCacheBySymbol);

    if (!met || !indicatorMatched) {
      if (transitionAlertRuleState(rule, 'active', evaluatedAt, 'conditionNotMet')) {
        stateTransitionCount += 1;
      }
      continue;
    }

    const cooldownMs = rule.cooldownSec * 1000;
    const inCooldown =
      cooldownMs > 0 &&
      typeof rule.lastTriggeredAt === 'number' &&
      evaluatedAt - rule.lastTriggeredAt < cooldownMs;

    if (inCooldown) {
      const remainingMs = Math.max(rule.lastTriggeredAt! + cooldownMs - evaluatedAt, 0);
      const transition = transitionAlertRuleState(rule, 'cooldown', evaluatedAt, 'cooldownSuppressed');
      if (transition) {
        stateTransitionCount += 1;
      }
      suppressedByCooldown += 1;
      suppressed.push({
        ruleId: rule.id,
        symbol: rule.symbol,
        metric: rule.metric,
        suppressedAt: evaluatedAt,
        cooldownSec: rule.cooldownSec,
        remainingMs,
        state: 'cooldown',
        ...(transition ? { transition: cloneAlertStateTransition(transition)! } : {}),
      });
      continue;
    }

    rule.lastTriggeredAt = evaluatedAt;
    rule.lastTrigger = {
      triggeredAt: evaluatedAt,
      currentValue,
      source,
      ...(normalizedSourceSymbol ? { sourceSymbol: normalizedSourceSymbol } : {}),
    };
    const transition = transitionAlertRuleState(rule, 'triggered', evaluatedAt, 'conditionMet');
    if (transition) {
      stateTransitionCount += 1;
    }
    triggered.push({
      ruleId: rule.id,
      symbol: rule.symbol,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      currentValue,
      triggeredAt: evaluatedAt,
      cooldownSec: rule.cooldownSec,
      eventType: 'triggered',
      state: 'triggered',
      ...(transition ? { transition: cloneAlertStateTransition(transition)! } : {}),
      ...(rule.indicatorConditions?.length
        ? { indicatorConditions: cloneIndicatorConditions(rule.indicatorConditions) }
        : {}),
    });
  }

  return {
    triggered,
    suppressedByCooldown,
    suppressed,
    stateTransitionCount,
  };
}

function markAlertRulesAsError(
  rules: AlertRule[],
  failedAt: number,
  source: AlertHistoryEventSource,
  message: string,
  sourceSymbol?: string | null,
) {
  const normalizedMessage = message.trim() || 'Alert evaluation failed';
  const normalizedSourceSymbol = sourceSymbol ? normalizeSymbol(sourceSymbol) : undefined;
  const errorEvents: AlertCheckEvent[] = [];
  let changedRuleCount = 0;

  for (const rule of rules) {
    const previousError = rule.lastError;
    const duplicateError =
      rule.state === 'error' &&
      previousError?.message === normalizedMessage &&
      previousError.source === source &&
      previousError.sourceSymbol === normalizedSourceSymbol &&
      failedAt - previousError.failedAt < ALERT_ERROR_EVENT_DEDUP_WINDOW_MS;

    const transition = transitionAlertRuleState(rule, 'error', failedAt, 'evaluationError', normalizedMessage);
    if (transition) {
      changedRuleCount += 1;
    }

    if (duplicateError) {
      continue;
    }

    rule.lastError = {
      failedAt,
      message: normalizedMessage,
      source,
      ...(normalizedSourceSymbol ? { sourceSymbol: normalizedSourceSymbol } : {}),
    };
    changedRuleCount += 1;

    errorEvents.push({
      ruleId: rule.id,
      symbol: rule.symbol,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      triggeredAt: failedAt,
      cooldownSec: rule.cooldownSec,
      eventType: 'error',
      state: 'error',
      ...(transition ? { transition: cloneAlertStateTransition(transition)! } : {}),
      errorMessage: normalizedMessage,
      ...(rule.indicatorConditions?.length
        ? { indicatorConditions: cloneIndicatorConditions(rule.indicatorConditions) }
        : {}),
    });
  }

  if (errorEvents.length > 0) {
    appendAlertHistoryEvents(errorEvents, source, sourceSymbol);
  }

  return {
    changedRuleCount,
    errorEventCount: errorEvents.length,
  };
}

function filterAlertRulesByScope(
  rules: AlertRule[],
  scopedSymbols: Set<string> | null,
  indicatorAwareOnly: boolean,
) {
  return rules.filter((rule) => {
    if (scopedSymbols && !scopedSymbols.has(rule.symbol)) {
      return false;
    }

    if (indicatorAwareOnly && !hasIndicatorConditions(rule)) {
      return false;
    }

    return true;
  });
}

async function refreshKrxSymbols(force = false, signal?: AbortSignal) {
  if (!force && krxSymbols.length > 0 && Date.now() - krxLoadedAtMs < KRX_REFRESH_MS) {
    return;
  }

  const response = await fetch(KRX_LIST_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage',
    },
    signal,
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

function shouldSkipKrxStartupPreload() {
  const skipByEnv = process.env.TRADINGSERVICE_SKIP_KRX_PRELOAD === '1';
  const skipByTest = process.env.NODE_ENV === 'test' || typeof process.env.VITEST !== 'undefined';
  return skipByEnv || skipByTest;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

async function preloadKrxSymbolsWithTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    await refreshKrxSymbols(false, controller.signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`KRX preload timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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

async function fetchLiveQuote(symbol: string, options?: { skipCache?: boolean }) {
  const skipCache = options?.skipCache === true;
  if (!skipCache) {
    const cached = getCachedQuote(symbol);
    if (cached) return cached;
  }

  const quote = isKrxSymbol(symbol)
    ? await fetchKrxQuote(symbol)
    : await fetchCryptoQuote(symbol);

  setCachedQuote(symbol, quote);
  return quote;
}

async function fetchCandlesForIndicatorCheck(symbol: string) {
  const cacheKey = `${symbol}:${ALERT_INDICATOR_INTERVAL}:${ALERT_INDICATOR_CANDLE_LIMIT}`;
  const cached = getCachedCandles(cacheKey);
  if (cached) return cached;

  const candles = isKrxSymbol(symbol)
    ? await fetchKrxCandles(symbol, ALERT_INDICATOR_INTERVAL, ALERT_INDICATOR_CANDLE_LIMIT)
    : await fetchCryptoCandles(symbol, ALERT_INDICATOR_INTERVAL, ALERT_INDICATOR_CANDLE_LIMIT);

  setCachedCandles(cacheKey, candles);
  return candles;
}

async function loadIndicatorEvaluationCache(
  rules: AlertRule[],
): Promise<Map<string, AlertIndicatorEvaluationCache>> {
  const symbolSet = new Set(
    rules.filter((rule) => hasIndicatorConditions(rule)).map((rule) => rule.symbol),
  );

  const cacheBySymbol = new Map<string, AlertIndicatorEvaluationCache>();
  if (!symbolSet.size) return cacheBySymbol;

  await Promise.all(
    [...symbolSet].map(async (symbol) => {
      const candles = await fetchCandlesForIndicatorCheck(symbol);
      const cache = createIndicatorEvaluationCache(candles);
      if (cache) {
        cacheBySymbol.set(symbol, cache);
      }
    }),
  );

  return cacheBySymbol;
}

try {
  await loadRuntimeStateFromDisk();
} catch (error) {
  app.log.warn({ error }, 'Unable to restore runtime state. Starting with empty state.');
}

if (shouldSkipKrxStartupPreload()) {
  app.log.info('Skipping KRX preload at startup');
} else {
  try {
    await preloadKrxSymbolsWithTimeout(KRX_STARTUP_PRELOAD_TIMEOUT_MS);
    app.log.info(`Loaded ${krxSymbols.length} KRX symbols`);
  } catch (error) {
    app.log.warn({ error }, 'Unable to preload KRX symbols. Fallback list will be used.');
  }
}

app.get('/health', async () => ({
  ok: true,
  service: 'tradingservice-api',
  krxSymbolCount: krxSymbols.length,
}));

app.get('/api/ops/errors', async (request, reply) => {
  const parsed = opsErrorsQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return sendOpsTelemetryError(reply, 400, 'VALIDATION_ERROR', 'Invalid query', parsed.error.format());
  }

  const level = parsed.data.level ?? null;
  const source = parsed.data.source ?? null;
  const errors = getOpsErrorEvents(level, source, parsed.data.limit);
  const recoveries = getOpsRecoveryEvents(source, parsed.data.recoveryLimit);

  return {
    total: errors.total,
    limit: parsed.data.limit,
    errors: errors.events,
    recoveryTotal: recoveries.total,
    recoveryLimit: parsed.data.recoveryLimit,
    recoveries: recoveries.events,
  };
});

app.post('/api/ops/errors', async (request, reply) => {
  const parsed = opsErrorCreateBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return sendOpsTelemetryError(reply, 400, 'VALIDATION_ERROR', 'Invalid body', parsed.error.format());
  }

  const event = recordOpsErrorEvent({
    level: parsed.data.level,
    source: parsed.data.source,
    code: parsed.data.code,
    message: parsed.data.message,
    ...(parsed.data.context ? { context: parsed.data.context } : {}),
    occurredAt: parsed.data.occurredAt,
  });
  await persistRuntimeState();

  return reply.code(201).send({
    event: {
      ...event,
      ...(event.context ? { context: cloneOpsContext(event.context) } : {}),
    },
  });
});

app.post('/api/ops/recovery', async (request, reply) => {
  const parsed = opsRecoveryCreateBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return sendOpsTelemetryError(reply, 400, 'VALIDATION_ERROR', 'Invalid body', parsed.error.format());
  }

  const event = recordOpsRecoveryEvent({
    source: parsed.data.source,
    action: parsed.data.action,
    status: parsed.data.status,
    ...(parsed.data.message ? { message: parsed.data.message } : {}),
    ...(parsed.data.errorCode ? { errorCode: parsed.data.errorCode } : {}),
    ...(parsed.data.context ? { context: parsed.data.context } : {}),
    occurredAt: parsed.data.occurredAt,
  });
  await persistRuntimeState();

  return reply.code(201).send({
    event: {
      ...event,
      ...(event.context ? { context: cloneOpsContext(event.context) } : {}),
    },
  });
});

app.get('/api/symbols', async () => {
  try {
    await refreshKrxSymbols();
  } catch (error) {
    app.log.warn({ error }, 'Failed refreshing KRX symbols for /api/symbols');
  }

  return { symbols: getDefaultSymbols() };
});

app.get('/api/watchlist', async (request, reply) => {
  const parsed = watchlistQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const name = normalizeWatchlistName(parsed.data.name);

  return {
    name,
    items: getWatchlistItems(name),
  };
});

app.put('/api/watchlist', async (request, reply) => {
  const parsed = watchlistPutBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const name = normalizeWatchlistName(parsed.data.name);
  const items = setWatchlistItems(name, parsed.data.items);
  await persistRuntimeState();

  return {
    name,
    items,
  };
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

app.post('/api/strategy/backtest', async (request, reply) => {
  const parsed = strategyBacktestBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const symbol = normalizeSymbol(parsed.data.symbol);
  const interval = normalizeInterval(parsed.data.interval);
  const limit = parsed.data.limit;
  const cacheKey = `${symbol}:${interval}:${limit}`;
  let candles = getCachedCandles(cacheKey);

  if (!candles) {
    try {
      candles = isKrxSymbol(symbol)
        ? await fetchKrxCandles(symbol, interval, limit)
        : await fetchCryptoCandles(symbol, interval, limit);

      setCachedCandles(cacheKey, candles);
    } catch (error) {
      app.log.error({ error, symbol, interval }, 'Failed to fetch candles for strategy backtest');
      return reply.code(502).send({ error: 'Failed to fetch candle data from upstream exchange' });
    }
  }

  if (!candles.length) {
    return reply.code(422).send({ error: 'Insufficient candle data for backtest' });
  }

  const result = runMaCrossoverBacktest(
    candles,
    {
      initialCapital: parsed.data.params.initialCapital,
      feeBps: parsed.data.params.feeBps,
      positionSizeMode: parsed.data.params.positionSizeMode,
      fixedPercent: parsed.data.params.fixedPercent,
    },
    {
      fastPeriod: parsed.data.strategy.fastPeriod,
      slowPeriod: parsed.data.strategy.slowPeriod,
    },
  );

  return {
    symbol,
    interval,
    limit,
    params: parsed.data.params,
    strategy: {
      type: parsed.data.strategy.type,
      fastPeriod: parsed.data.strategy.fastPeriod,
      slowPeriod: parsed.data.strategy.slowPeriod,
    },
    ...result,
  };
});

app.get('/api/quote', async (request, reply) => {
  const parsed = quoteQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const symbol = parsed.data.symbol.toUpperCase();
  try {
    const quote = await fetchLiveQuote(symbol);
    const matchResult = evaluatePendingPaperOrdersForSymbol(symbol, quote.lastPrice, Date.now());
    if (matchResult.filledCount > 0 || matchResult.rejectedCount > 0 || matchResult.autoCanceledCount > 0) {
      await persistRuntimeState();
    }
    return quote;
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

app.get('/api/trading/state', async () => {
  const refreshed = await refreshPaperTradingPositionMarks();
  if (refreshed.filledCount > 0 || refreshed.rejectedCount > 0 || refreshed.autoCanceledCount > 0) {
    await persistRuntimeState();
  }
  return buildPaperTradingStateSnapshot();
});

app.post('/api/trading/orders', async (request, reply) => {
  const parsed = tradingOrderCreateBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return sendTradingError(reply, 400, 'VALIDATION_ERROR', 'Invalid trading order payload', parsed.error.format());
  }

  const symbol = normalizeSymbol(parsed.data.symbol);
  const side = parsed.data.side;
  const orderType = parsed.data.orderType ?? 'MARKET';

  let quote: Quote;
  try {
    quote = await fetchLiveQuote(symbol, { skipCache: true });
  } catch (error) {
    app.log.error({ error, symbol }, 'Failed to fetch quote for paper order');
    return sendTradingError(reply, 502, 'QUOTE_UNAVAILABLE', 'Unable to fetch quote for this symbol');
  }

  const fillPrice = normalizeTradingPrice(quote.lastPrice);
  if (!fillPrice) {
    return sendTradingError(reply, 502, 'QUOTE_UNAVAILABLE', 'Unable to determine fill price from quote');
  }

  const requestAt = Date.now();
  const preMatchResult = evaluatePendingPaperOrdersForSymbol(symbol, fillPrice, requestAt);
  const preMatchChanged =
    preMatchResult.filledCount > 0 || preMatchResult.rejectedCount > 0 || preMatchResult.autoCanceledCount > 0;

  let responseOrder: TradingOrder | null = null;
  let responseFill: TradingFill | null = null;

  if (orderType === 'MARKET') {
    const requestedQty =
      typeof parsed.data.qty === 'number'
        ? parsed.data.qty
        : typeof parsed.data.notional === 'number'
          ? parsed.data.notional / fillPrice
          : NaN;
    const normalizedQty = normalizeTradingQty(requestedQty);

    if (!normalizedQty) {
      if (preMatchChanged) {
        await persistRuntimeState();
      }
      return sendTradingError(reply, 400, 'VALIDATION_ERROR', 'Resolved order quantity must be greater than zero');
    }

    const execution = executePaperMarketOrder({
      symbol,
      side,
      qty: normalizedQty,
      fillPrice,
      now: requestAt,
      takeProfitPrice: parsed.data.takeProfitPrice,
      stopLossPrice: parsed.data.stopLossPrice,
    });
    if (!execution.ok) {
      if (preMatchChanged) {
        await persistRuntimeState();
      }
      return sendTradingError(reply, execution.statusCode, execution.code, execution.message);
    }

    responseOrder = execution.order;
    responseFill = execution.fill;
  } else {
    const pending = createPaperPendingOrder({
      symbol,
      side,
      type: orderType,
      qty: parsed.data.qty ?? NaN,
      now: requestAt,
      limitPrice: parsed.data.limitPrice,
      triggerPrice: parsed.data.triggerPrice,
      takeProfitPrice: parsed.data.takeProfitPrice,
      stopLossPrice: parsed.data.stopLossPrice,
    });
    if (!pending.ok) {
      if (preMatchChanged) {
        await persistRuntimeState();
      }
      return sendTradingError(reply, pending.statusCode, pending.code, pending.message);
    }

    evaluatePendingPaperOrdersForSymbol(symbol, fillPrice, requestAt);
    const currentOrder = paperTradingState.orders.find((order) => order.id === pending.order.id);
    responseOrder = currentOrder ? cloneTradingOrder(currentOrder) : pending.order;

    if (responseOrder.status === 'FILLED') {
      for (let index = paperTradingState.fills.length - 1; index >= 0; index -= 1) {
        const candidate = paperTradingState.fills[index];
        if (candidate.orderId === responseOrder.id) {
          responseFill = cloneTradingFill(candidate);
          break;
        }
      }
    }
  }

  await persistRuntimeState();

  return reply.code(201).send({
    mode: PAPER_TRADING_MODE,
    order: responseOrder,
    ...(responseFill ? { fill: responseFill } : {}),
    state: buildPaperTradingStateSnapshot(),
  });
});

app.post('/api/trading/orders/:id/cancel', async (request, reply) => {
  const parsed = tradingOrderCancelParamSchema.safeParse(request.params);

  if (!parsed.success) {
    return sendTradingError(reply, 400, 'VALIDATION_ERROR', 'Invalid order id', parsed.error.format());
  }

  const canceled = cancelPaperTradingOrder(parsed.data.id, Date.now());
  if (!canceled.ok) {
    return sendTradingError(reply, canceled.statusCode, canceled.code, canceled.message);
  }

  await persistRuntimeState();

  return {
    mode: PAPER_TRADING_MODE,
    order: canceled.order,
    state: buildPaperTradingStateSnapshot(),
  };
});

app.get('/api/drawings', async (request, reply) => {
  const parsed = drawingsQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const symbol = normalizeSymbol(parsed.data.symbol);
  const interval = normalizeInterval(parsed.data.interval);
  const key = createDrawingStoreKey(symbol, interval);
  const drawings = drawingStore.get(key) ?? [];

  return { symbol, interval, drawings, lines: toLegacyDrawingLines(drawings) };
});

app.put('/api/drawings', async (request, reply) => {
  const parsed = drawingsPutBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const symbol = normalizeSymbol(parsed.data.symbol);
  const interval = normalizeInterval(parsed.data.interval);
  const key = createDrawingStoreKey(symbol, interval);
  const drawings = parsed.data.drawings
    ? normalizeDrawingItems(parsed.data.drawings)
    : normalizeDrawingLines(parsed.data.lines ?? []);

  drawingStore.set(key, drawings);
  await persistRuntimeState();

  return { symbol, interval, drawings, lines: toLegacyDrawingLines(drawings) };
});

app.get('/api/alerts/rules', async (request, reply) => {
  const parsed = alertRuleQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const scopedSymbols = collectScopedSymbols(parsed.data.symbol, parsed.data.symbols);
  const indicatorAwareOnly = parsed.data.indicatorAwareOnly === true;
  const rules = filterAlertRulesByScope([...alertRuleStore.values()], scopedSymbols, indicatorAwareOnly)
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
  const initialTransition = createInitialAlertStateTransition(now);
  const rule: AlertRule = {
    id: createAlertRuleId(),
    symbol: normalizeSymbol(parsed.data.symbol),
    metric: parsed.data.metric,
    operator: parsed.data.operator,
    threshold: parsed.data.threshold,
    cooldownSec: parsed.data.cooldownSec,
    ...(parsed.data.indicatorConditions?.length
      ? { indicatorConditions: cloneIndicatorConditions(parsed.data.indicatorConditions) }
      : {}),
    createdAt: now,
    lastTriggeredAt: null,
    state: 'active',
    stateUpdatedAt: now,
    lastStateTransition: initialTransition,
  };

  alertRuleStore.set(rule.id, rule);
  await persistRuntimeState();

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
  await persistRuntimeState();
  return { ok: true };
});

app.post('/api/alerts/check', async (request, reply) => {
  const parsed = alertCheckBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const source = parsed.data.source ?? 'manual';
  const scopedSymbols = collectScopedSymbols(parsed.data.symbol, parsed.data.symbols);
  const rules = filterAlertRulesByScope(
    [...alertRuleStore.values()],
    scopedSymbols,
    parsed.data.indicatorAwareOnly === true,
  );

  if (!rules.length) {
    return {
      evaluatedAt: Date.now(),
      checkedRuleCount: 0,
      triggeredCount: 0,
      suppressedByCooldown: 0,
      suppressed: [],
      stateTransitionCount: 0,
      triggered: [],
    };
  }

  const quoteBySymbol = new Map<string, { lastPrice: number; changePercent: number }>();
  const singleScopedSymbol = scopedSymbols?.size === 1 ? [...scopedSymbols][0] : null;
  const fallbackProvidedSymbol =
    singleScopedSymbol ??
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
    const failedAt = Date.now();
    const errorMessage = 'Failed to evaluate alert rules due to quote fetch failure';
    const { changedRuleCount } = markAlertRulesAsError(rules, failedAt, source, errorMessage, singleScopedSymbol);
    if (changedRuleCount > 0) {
      await persistRuntimeState();
    }
    app.log.error({ error, symbolsToFetch }, 'Failed to fetch quotes for alert checks');
    return reply.code(502).send({ error: errorMessage });
  }

  let indicatorCacheBySymbol = new Map<string, AlertIndicatorEvaluationCache>();
  try {
    indicatorCacheBySymbol = await loadIndicatorEvaluationCache(rules);
  } catch (error) {
    const failedAt = Date.now();
    const errorMessage = 'Failed to evaluate indicator conditions due to candle fetch failure';
    const { changedRuleCount } = markAlertRulesAsError(rules, failedAt, source, errorMessage, singleScopedSymbol);
    if (changedRuleCount > 0) {
      await persistRuntimeState();
    }
    app.log.error({ error }, 'Failed to fetch candles for indicator alert checks');
    return reply.code(502).send({ error: errorMessage });
  }

  const now = Date.now();
  const { triggered, suppressedByCooldown, suppressed, stateTransitionCount } = evaluateAlertRules(
    rules,
    quoteBySymbol,
    now,
    indicatorCacheBySymbol,
    source,
    singleScopedSymbol,
  );
  if (triggered.length > 0) {
    appendAlertHistoryEvents(triggered, source, singleScopedSymbol);
  }
  if (triggered.length > 0 || stateTransitionCount > 0) {
    await persistRuntimeState();
  }

  return {
    evaluatedAt: now,
    checkedRuleCount: rules.length,
    triggeredCount: triggered.length,
    suppressedByCooldown,
    suppressed,
    stateTransitionCount,
    triggered,
  };
});

app.post('/api/alerts/check-watchlist', async (request, reply) => {
  const parsed = alertCheckWatchlistBodySchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', detail: parsed.error.format() });
  }

  const source = parsed.data.source ?? 'watchlist';
  const checkedSymbols = [...new Set(parsed.data.symbols.map((symbol) => normalizeSymbol(symbol)))];
  const checkedSet = new Set(checkedSymbols);
  const rules = filterAlertRulesByScope(
    [...alertRuleStore.values()],
    checkedSet,
    parsed.data.indicatorAwareOnly === true,
  );

  if (!rules.length) {
    return {
      checkedAt: Date.now(),
      checkedSymbols,
      checkedRuleCount: 0,
      triggeredCount: 0,
      suppressedByCooldown: 0,
      suppressed: [],
      stateTransitionCount: 0,
      events: [],
    };
  }

  const quoteBySymbol = new Map<string, { lastPrice: number; changePercent: number }>();

  try {
    await Promise.all(
      checkedSymbols.map(async (symbol) => {
        const quote = await fetchLiveQuote(symbol);
        quoteBySymbol.set(symbol, {
          lastPrice: quote.lastPrice,
          changePercent: quote.changePercent,
        });
      }),
    );
  } catch (error) {
    const failedAt = Date.now();
    const errorMessage = 'Failed to evaluate watchlist alert rules due to quote fetch failure';
    const { changedRuleCount } = markAlertRulesAsError(rules, failedAt, source, errorMessage);
    if (changedRuleCount > 0) {
      await persistRuntimeState();
    }
    app.log.error({ error, checkedSymbols }, 'Failed to fetch quotes for watchlist alert checks');
    return reply.code(502).send({ error: errorMessage });
  }

  let indicatorCacheBySymbol = new Map<string, AlertIndicatorEvaluationCache>();
  try {
    indicatorCacheBySymbol = await loadIndicatorEvaluationCache(rules);
  } catch (error) {
    const failedAt = Date.now();
    const errorMessage = 'Failed to evaluate indicator conditions due to candle fetch failure';
    const { changedRuleCount } = markAlertRulesAsError(rules, failedAt, source, errorMessage);
    if (changedRuleCount > 0) {
      await persistRuntimeState();
    }
    app.log.error({ error }, 'Failed to fetch candles for watchlist indicator alert checks');
    return reply.code(502).send({ error: errorMessage });
  }

  const checkedAt = Date.now();
  const { triggered, suppressedByCooldown, suppressed, stateTransitionCount } = evaluateAlertRules(
    rules,
    quoteBySymbol,
    checkedAt,
    indicatorCacheBySymbol,
    source,
  );
  if (triggered.length > 0) {
    appendAlertHistoryEvents(triggered, source);
  }
  if (triggered.length > 0 || stateTransitionCount > 0) {
    await persistRuntimeState();
  }

  return {
    checkedAt,
    checkedSymbols,
    checkedRuleCount: rules.length,
    triggeredCount: triggered.length,
    suppressedByCooldown,
    suppressed,
    stateTransitionCount,
    events: triggered,
  };
});

app.get('/api/alerts/history', async (request, reply) => {
  const parsed = alertHistoryQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid query', detail: parsed.error.format() });
  }

  const symbols = collectScopedSymbols(parsed.data.symbol, parsed.data.symbols);
  const symbol = parsed.data.symbol ? normalizeSymbol(parsed.data.symbol) : null;
  const source = parsed.data.source ?? null;
  const fromTs = parsed.data.fromTs ?? null;
  const toTs = parsed.data.toTs ?? null;
  const indicatorAwareOnly = parsed.data.indicatorAwareOnly === true;
  const lifecycleState = parsed.data.state ?? null;
  const eventType = parsed.data.type ?? 'triggered';
  const { total, events } = getAlertHistory(
    symbols,
    source,
    fromTs,
    toTs,
    parsed.data.limit,
    indicatorAwareOnly,
    lifecycleState,
    eventType,
  );

  return {
    symbol,
    limit: parsed.data.limit,
    total,
    events,
  };
});

app.delete('/api/alerts/history', async () => {
  const cleared = clearAlertHistory();
  await persistRuntimeState();
  return { ok: true, cleared };
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
