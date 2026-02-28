import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type IPriceLine,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import './App.css';
import {
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  normalizeCompareOverlay,
  toTimeValuePoints,
} from './lib/chartMath';
import {
  BOLLINGER_PERIOD_RANGE,
  BOLLINGER_STD_DEV_RANGE,
  DEFAULT_INDICATOR_SETTINGS,
  MACD_FAST_RANGE,
  MACD_SIGNAL_RANGE,
  MACD_SLOW_RANGE,
  RSI_PERIOD_RANGE,
  normalizeIndicatorSettings,
  type IndicatorSettings,
} from './lib/indicatorSettings';
import {
  REPLAY_TICK_MS_BY_SPEED,
  getReplayProgress,
  getReplayStartVisibleCount,
  replaySpeedOptions,
  stepReplayVisibleCount,
  type ReplaySpeed,
} from './lib/replay';
import {
  formatSigned,
  getDisplayCode,
  getOptionLabel,
  marketExchangeText,
  shortTicker,
  type MarketType,
} from './lib/symbol';
import {
  applyLogicalRangeSync,
  createChartRangeSyncState,
  shouldSkipSyncedRangeEvent,
  type ChartLayoutMode,
  type ChartSyncSource,
  type LogicalRangeLike,
} from './lib/chartLayout';
import { readUnifiedLayoutState, writeUnifiedLayoutState } from './lib/layoutPersistence';
import { createUndoRedoHistory, type UndoRedoState } from './lib/history';
import {
  emitOpsErrorTelemetry,
  emitOpsRecoveryTelemetry,
  fetchOpsTelemetryFeed,
  normalizeApiOperationError,
  type OpsErrorEvent,
  type OpsRecoveryEvent,
  type OpsTelemetrySource,
} from './lib/apiOperations';

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

type MarketStatusState = 'OPEN' | 'CLOSED';
type MarketStatusReason = 'WEEKEND' | 'OUT_OF_SESSION' | 'SESSION_ACTIVE';

type MarketStatus = {
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

type AlertMetric = 'price' | 'changePercent';
type AlertOperator = '>=' | '<=' | '>' | '<';
type AlertIndicatorComparator = '>=' | '<=';
type AlertIndicatorType = 'rsiThreshold' | 'macdCrossSignal' | 'macdHistogramSign' | 'bollingerBandPosition';

type AlertIndicatorCondition =
  | {
      type: 'rsiThreshold';
      operator: AlertIndicatorComparator;
      threshold: number;
      period?: number;
    }
  | {
      type: 'macdCrossSignal';
      signal: 'bullish' | 'bearish';
      fastPeriod?: number;
      slowPeriod?: number;
      signalPeriod?: number;
    }
  | {
      type: 'macdHistogramSign';
      sign: 'positive' | 'negative';
      fastPeriod?: number;
      slowPeriod?: number;
      signalPeriod?: number;
    }
  | {
      type: 'bollingerBandPosition';
      position: 'aboveUpper' | 'belowLower';
      period?: number;
      stdDev?: number;
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
};

type AlertCheckEvent = {
  ruleId: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  currentValue: number;
  triggeredAt: number;
  cooldownSec: number;
  indicatorConditions?: AlertIndicatorCondition[];
};

type AlertHistorySource = 'manual' | 'watchlist';
type AlertHistorySourceFilter = 'all' | AlertHistorySource;

type AlertHistoryEvent = AlertCheckEvent & {
  source?: AlertHistorySource;
  sourceSymbol?: string;
};

type WorkflowKey = 'alerts' | 'strategy' | 'trading';
type RecoveryActionKind = 'retry-backtest' | 'retry-trading-state' | 'retry-alerts-refresh';
type WorkflowRecoveryState = {
  workflow: WorkflowKey;
  message: string;
  actionKind: RecoveryActionKind;
};

type OpsTimelineItem =
  | {
      id: string;
      kind: 'error';
      source: OpsTelemetrySource;
      label: string;
      detail: string;
      occurredAt: number;
    }
  | {
      id: string;
      kind: 'recovery';
      source: OpsTelemetrySource;
      label: string;
      detail: string;
      occurredAt: number;
    };

type WatchTab = 'watchlist' | 'detail' | 'alerts';
type BottomTab = 'pine' | 'strategy' | 'trading';
type TopActionKey = 'indicator' | 'compare' | 'alerts' | 'replay';
type WatchSortKey = 'symbol' | 'price' | 'changePercent';
type WatchSortDir = 'asc' | 'desc';
type WatchMarketFilter = 'ALL' | MarketType;
type IndicatorKey = 'sma20' | 'sma60' | 'ema20' | 'rsi' | 'macd' | 'bbands';
type IndicatorSeriesKey =
  | 'sma20'
  | 'sma60'
  | 'ema20'
  | 'rsi'
  | 'macd'
  | 'macdSignal'
  | 'bbBasis'
  | 'bbUpper'
  | 'bbLower';
type IndicatorConfig = {
  key: IndicatorKey;
  label: string;
  color: string;
};

type IndicatorPrefs = {
  version: number;
  enabledIndicators: Record<IndicatorKey, boolean>;
  settings: IndicatorSettings;
};

type WatchPrefs = {
  watchSortKey: WatchSortKey;
  watchSortDir: WatchSortDir;
  watchMarketFilter: WatchMarketFilter;
};

type AlertAutoCheckIntervalSec = 30 | 60 | 120;

type AlertAutoCheckPrefs = {
  enabled: boolean;
  intervalSec: AlertAutoCheckIntervalSec;
};

type StrategyTesterFormState = {
  symbol: string;
  interval: string;
  limit: string;
  initialCapital: string;
  feeBps: string;
  fixedPercent: string;
  fastPeriod: string;
  slowPeriod: string;
};

type StrategyFormField = keyof StrategyTesterFormState;

type StrategyBacktestSummary = {
  netPnl: number;
  returnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  tradeCount: number;
};

type StrategyBacktestPoint = {
  time: number;
  value: number;
};

type StrategyBacktestTrade = {
  entryTime: number;
  exitTime: number;
  side: 'LONG';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
};

type StrategyBacktestResult = {
  symbol: string;
  interval: string;
  limit: number;
  summary: StrategyBacktestSummary;
  equityCurve: StrategyBacktestPoint[];
  drawdownCurve: StrategyBacktestPoint[];
  trades: StrategyBacktestTrade[];
};

type TradingMode = 'PAPER';
type TradingOrderSide = 'BUY' | 'SELL';
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
  type: 'MARKET';
  status: TradingOrderStatus;
  qty: number;
  notional: number;
  fillPrice?: number;
  filledAt?: number;
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
  summary: {
    equity: number;
    marketValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
  };
  positions: TradingPosition[];
  orders: TradingOrder[];
  fills: TradingFill[];
  updatedAt: number;
};

type TradingOrderFormState = {
  side: TradingOrderSide;
  qty: string;
  notional: string;
};

type HorizontalLine = {
  id: string;
  price: number;
  line: IPriceLine;
};

type HorizontalLineState = Pick<HorizontalLine, 'id' | 'price'>;
type VerticalLineState = {
  id: string;
  time: UTCTimestamp;
};
type TrendlineState = {
  id: string;
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
};
type RayState = {
  id: string;
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
};
type RectangleState = {
  id: string;
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
};
type NoteState = {
  id: string;
  time: UTCTimestamp;
  price: number;
  text: string;
};
type ToolKey = 'cursor' | 'crosshair' | 'vertical' | 'horizontal' | 'trendline' | 'ray' | 'rectangle' | 'note' | 'magnet';
type DrawingKind = 'horizontal' | 'vertical' | 'trendline' | 'ray' | 'rectangle' | 'note';
type PendingShapeTool = 'trendline' | 'ray' | 'rectangle';
type DrawingPayloadItem =
  | { id: string; type: 'horizontal'; price: number }
  | { id: string; type: 'vertical'; time: number }
  | { id: string; type: 'trendline'; startTime: number; startPrice: number; endTime: number; endPrice: number }
  | { id: string; type: 'ray'; startTime: number; startPrice: number; endTime: number; endPrice: number }
  | { id: string; type: 'rectangle'; startTime: number; startPrice: number; endTime: number; endPrice: number }
  | { id: string; type: 'note'; time: number; price: number; text: string };

type DrawingHit = {
  id: string;
  kind: DrawingKind;
  distance: number;
  score: number;
};

type DragState =
  | {
      pointerId: number;
      kind: 'horizontal';
      id: string;
      startPrice: number;
      originPrice: number;
      moved: boolean;
    }
  | {
      pointerId: number;
      kind: 'vertical';
      id: string;
      startTime: UTCTimestamp;
      originTime: UTCTimestamp;
      moved: boolean;
    }
  | {
      pointerId: number;
      kind: 'trendline';
      id: string;
      startTime: UTCTimestamp;
      startPrice: number;
      origin: TrendlineState;
      moved: boolean;
    }
  | {
      pointerId: number;
      kind: 'ray';
      id: string;
      startTime: UTCTimestamp;
      startPrice: number;
      origin: RayState;
      moved: boolean;
    }
  | {
      pointerId: number;
      kind: 'rectangle';
      id: string;
      startTime: UTCTimestamp;
      startPrice: number;
      origin: RectangleState;
      moved: boolean;
    }
  | {
      pointerId: number;
      kind: 'note';
      id: string;
      startTime: UTCTimestamp;
      startPrice: number;
      origin: NoteState;
      moved: boolean;
    };

type ChartHistorySnapshot = {
  horizontalLines: HorizontalLineState[];
  verticalLines: VerticalLineState[];
  trendlines: TrendlineState[];
  rays: RayState[];
  rectangles: RectangleState[];
  notes: NoteState[];
  enabledIndicators: Record<IndicatorKey, boolean>;
  indicatorSettings: IndicatorSettings;
  compareSymbol: string;
  chartLayoutMode: ChartLayoutMode;
};

type ChartHistoryDrawingSnapshot = Pick<
  ChartHistorySnapshot,
  'horizontalLines' | 'verticalLines' | 'trendlines' | 'rays' | 'rectangles' | 'notes'
>;

const intervals = ['1', '5', '15', '60', '240', '1D', '1W'];
const chartLayoutOptions: Array<{ key: ChartLayoutMode; label: string }> = [
  { key: 'single', label: '단일' },
  { key: 'split', label: '2분할' },
];
const leftTools: Array<{ key: ToolKey; icon: string; label: string }> = [
  { key: 'cursor', icon: '↖', label: '커서' },
  { key: 'crosshair', icon: '＋', label: '크로스헤어' },
  { key: 'vertical', icon: '｜', label: '수직선' },
  { key: 'horizontal', icon: '―', label: '수평선' },
  { key: 'trendline', icon: 'T', label: '추세선' },
  { key: 'ray', icon: 'Y', label: '레이' },
  { key: 'rectangle', icon: 'R', label: '사각형' },
  { key: 'note', icon: 'N', label: '노트' },
  { key: 'magnet', icon: '🧲', label: '자석' },
];
const topActions: Array<{ key: TopActionKey; label: string }> = [
  { key: 'indicator', label: '지표' },
  { key: 'compare', label: '비교' },
  { key: 'alerts', label: '알림' },
  { key: 'replay', label: '리플레이' },
];
const indicatorConfigs: IndicatorConfig[] = [
  { key: 'sma20', label: 'SMA 20', color: '#f0b429' },
  { key: 'sma60', label: 'SMA 60', color: '#4da4ff' },
  { key: 'ema20', label: 'EMA 20', color: '#ff7f50' },
  { key: 'rsi', label: 'RSI', color: '#c792ea' },
  { key: 'macd', label: 'MACD', color: '#4cc9f0' },
  { key: 'bbands', label: 'Bollinger Bands', color: '#9ad1ff' },
];
const compareOverlayColor = '#85d47b';
const bottomTabs: Array<{ id: BottomTab; label: string }> = [
  { id: 'pine', label: 'Pine Editor' },
  { id: 'strategy', label: '전략 테스터' },
  { id: 'trading', label: '트레이딩 패널' },
];

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';
const WATCH_PREFS_STORAGE_KEY = 'tradingservice.watchprefs.v1';
const ALERT_AUTO_CHECK_STORAGE_KEY = 'tradingservice.alerts.autocheck.v1';
const INDICATOR_PREFS_STORAGE_KEY = 'tradingservice.indicators.v2';
const STRATEGY_TESTER_STORAGE_KEY = 'tradingservice.strategytester.v1';
const DEFAULT_WATCHLIST_NAME = 'default';
const ALERT_EVENT_DEDUP_WINDOW_MS = 10_000;
const ALERT_EVENT_MAX_ITEMS = 20;
const STRATEGY_RECENT_TRADES_LIMIT = 8;
const HOVER_TOOLTIP_WIDTH = 232;
const HOVER_TOOLTIP_HEIGHT = 174;
const HOVER_TOOLTIP_MARGIN = 14;
const DRAWING_HIT_TOLERANCE_PX = 8;
const NOTE_HIT_RADIUS_PX = 14;
const INDICATOR_PREFS_VERSION = 2;
const CHART_HISTORY_LIMIT = 100;
const DEFAULT_STRATEGY_TESTER_FORM: StrategyTesterFormState = {
  symbol: 'BTCUSDT',
  interval: '60',
  limit: '500',
  initialCapital: '10000',
  feeBps: '10',
  fixedPercent: '100',
  fastPeriod: '12',
  slowPeriod: '26',
};
const DEFAULT_TRADING_ORDER_FORM: TradingOrderFormState = {
  side: 'BUY',
  qty: '',
  notional: '',
};

const DEFAULT_ENABLED_INDICATORS: Record<IndicatorKey, boolean> = {
  sma20: false,
  sma60: false,
  ema20: false,
  rsi: false,
  macd: false,
  bbands: false,
};

function createIndicatorSeriesRefs(): Record<IndicatorSeriesKey, ISeriesApi<'Line'> | null> {
  return {
    sma20: null,
    sma60: null,
    ema20: null,
    rsi: null,
    macd: null,
    macdSignal: null,
    bbBasis: null,
    bbUpper: null,
    bbLower: null,
  };
}

function toTimestampValue(value: number) {
  return Math.max(1, Math.floor(value)) as UTCTimestamp;
}

function pointDistance(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-9) {
    return pointDistance(px, py, x1, y1);
  }

  const projected = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, projected));
  const nearestX = x1 + dx * t;
  const nearestY = y1 + dy * t;
  return pointDistance(px, py, nearestX, nearestY);
}

function distanceToRay(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-9) {
    return pointDistance(px, py, x1, y1);
  }

  const projected = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  const t = Math.max(0, projected);
  const nearestX = x1 + dx * t;
  const nearestY = y1 + dy * t;
  return pointDistance(px, py, nearestX, nearestY);
}

function cloneChartHistorySnapshot(snapshot: ChartHistorySnapshot): ChartHistorySnapshot {
  return {
    horizontalLines: snapshot.horizontalLines.map((line) => ({ ...line })),
    verticalLines: snapshot.verticalLines.map((line) => ({ ...line })),
    trendlines: snapshot.trendlines.map((line) => ({ ...line })),
    rays: snapshot.rays.map((line) => ({ ...line })),
    rectangles: snapshot.rectangles.map((shape) => ({ ...shape })),
    notes: snapshot.notes.map((note) => ({ ...note })),
    enabledIndicators: { ...snapshot.enabledIndicators },
    indicatorSettings: normalizeIndicatorSettings(snapshot.indicatorSettings),
    compareSymbol: snapshot.compareSymbol,
    chartLayoutMode: snapshot.chartLayoutMode,
  };
}

function areChartHistorySnapshotsEqual(left: ChartHistorySnapshot, right: ChartHistorySnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areChartHistoryDrawingSnapshotsEqual(left: ChartHistoryDrawingSnapshot, right: ChartHistoryDrawingSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getStoredWatchPrefs(): Partial<WatchPrefs> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(WATCH_PREFS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Partial<WatchPrefs>;

    return {
      watchSortKey:
        parsed.watchSortKey === 'symbol' ||
        parsed.watchSortKey === 'price' ||
        parsed.watchSortKey === 'changePercent'
          ? parsed.watchSortKey
          : undefined,
      watchSortDir: parsed.watchSortDir === 'asc' || parsed.watchSortDir === 'desc' ? parsed.watchSortDir : undefined,
      watchMarketFilter:
        parsed.watchMarketFilter === 'ALL' ||
        parsed.watchMarketFilter === 'CRYPTO' ||
        parsed.watchMarketFilter === 'KOSPI' ||
        parsed.watchMarketFilter === 'KOSDAQ'
          ? parsed.watchMarketFilter
          : undefined,
    };
  } catch {
    return {};
  }
}

function getStoredAlertAutoCheckPrefs(): Partial<AlertAutoCheckPrefs> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(ALERT_AUTO_CHECK_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Partial<AlertAutoCheckPrefs>;

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined,
      intervalSec:
        parsed.intervalSec === 30 || parsed.intervalSec === 60 || parsed.intervalSec === 120
          ? parsed.intervalSec
          : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeStoredEnabledIndicators(value: unknown): Record<IndicatorKey, boolean> {
  const parsed = (value ?? {}) as Partial<Record<IndicatorKey, unknown>>;

  return {
    sma20: parsed.sma20 === true,
    sma60: parsed.sma60 === true,
    ema20: parsed.ema20 === true,
    rsi: parsed.rsi === true,
    macd: parsed.macd === true,
    bbands: parsed.bbands === true,
  };
}

function getStoredIndicatorPrefs(): IndicatorPrefs {
  const defaults: IndicatorPrefs = {
    version: INDICATOR_PREFS_VERSION,
    enabledIndicators: { ...DEFAULT_ENABLED_INDICATORS },
    settings: normalizeIndicatorSettings(DEFAULT_INDICATOR_SETTINGS),
  };

  if (typeof window === 'undefined') return defaults;

  try {
    const raw = window.localStorage.getItem(INDICATOR_PREFS_STORAGE_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as Partial<IndicatorPrefs>;
    return {
      version: INDICATOR_PREFS_VERSION,
      enabledIndicators: {
        ...DEFAULT_ENABLED_INDICATORS,
        ...normalizeStoredEnabledIndicators(parsed.enabledIndicators),
      },
      settings: normalizeIndicatorSettings(parsed.settings),
    };
  } catch {
    return defaults;
  }
}

function toStoredStrategyField(value: unknown, fallback: string) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length > 0) return normalized;
  }

  return fallback;
}

function getStoredStrategyTesterForm(): StrategyTesterFormState {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_STRATEGY_TESTER_FORM };
  }

  try {
    const raw = window.localStorage.getItem(STRATEGY_TESTER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STRATEGY_TESTER_FORM };

    const parsed = JSON.parse(raw) as Partial<Record<StrategyFormField, unknown>>;

    return {
      symbol: toStoredStrategyField(parsed.symbol, DEFAULT_STRATEGY_TESTER_FORM.symbol).toUpperCase(),
      interval: toStoredStrategyField(parsed.interval, DEFAULT_STRATEGY_TESTER_FORM.interval).toUpperCase(),
      limit: toStoredStrategyField(parsed.limit, DEFAULT_STRATEGY_TESTER_FORM.limit),
      initialCapital: toStoredStrategyField(parsed.initialCapital, DEFAULT_STRATEGY_TESTER_FORM.initialCapital),
      feeBps: toStoredStrategyField(parsed.feeBps, DEFAULT_STRATEGY_TESTER_FORM.feeBps),
      fixedPercent: toStoredStrategyField(parsed.fixedPercent, DEFAULT_STRATEGY_TESTER_FORM.fixedPercent),
      fastPeriod: toStoredStrategyField(parsed.fastPeriod, DEFAULT_STRATEGY_TESTER_FORM.fastPeriod),
      slowPeriod: toStoredStrategyField(parsed.slowPeriod, DEFAULT_STRATEGY_TESTER_FORM.slowPeriod),
    };
  } catch {
    return { ...DEFAULT_STRATEGY_TESTER_FORM };
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderMatchedText(text: string, query: string): ReactNode {
  const normalized = query.trim();
  if (!normalized) return text;

  const matcher = new RegExp(`(${escapeRegExp(normalized)})`, 'ig');
  const parts = text.split(matcher);
  const normalizedLower = normalized.toLowerCase();

  return parts.map((part, index) =>
    part.toLowerCase() === normalizedLower ? <mark key={`${part}-${index}`}>{part}</mark> : <span key={`${part}-${index}`}>{part}</span>,
  );
}

function formatPrice(value: number) {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString('en-US');
}

function formatAlertMetric(metric: AlertMetric) {
  return metric === 'price' ? '가격' : '변동률';
}

function formatAlertValue(metric: AlertMetric, value: number) {
  if (metric === 'price') return formatPrice(value);
  return `${value.toFixed(2)}%`;
}

function formatAlertIndicatorCondition(condition: AlertIndicatorCondition) {
  if (condition.type === 'rsiThreshold') {
    return `RSI${condition.period ? `(${condition.period})` : ''} ${condition.operator} ${condition.threshold.toFixed(2)}`;
  }

  if (condition.type === 'macdCrossSignal') {
    return `MACD cross ${condition.signal === 'bullish' ? 'bullish' : 'bearish'}`;
  }

  if (condition.type === 'macdHistogramSign') {
    return `MACD hist ${condition.sign === 'positive' ? '> 0' : '< 0'}`;
  }

  return `BB ${condition.position === 'aboveUpper' ? 'price > upper' : 'price < lower'}`;
}

function formatAlertIndicatorSummary(conditions?: AlertIndicatorCondition[]) {
  if (!conditions?.length) return null;
  return conditions.map(formatAlertIndicatorCondition).join(' · ');
}

function formatMarketStatusReason(reason: MarketStatusReason) {
  if (reason === 'WEEKEND') return '주말';
  if (reason === 'OUT_OF_SESSION') return '장외 시간';
  return '세션 진행중';
}

function createHorizontalLineId() {
  return `line_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createVerticalLineId() {
  return `vline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTrendlineId() {
  return `trend_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRayId() {
  return `ray_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRectangleId() {
  return `rect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createNoteId() {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLinePrice(price: number) {
  return Number(price.toFixed(Math.abs(price) < 10 ? 4 : 2));
}

function formatDrawingTime(time: UTCTimestamp) {
  return new Date(Number(time) * 1000).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizeNoteText(text: string) {
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

function formatCandleDateTime(time: number) {
  return new Date(time * 1000).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? '+' : '-'}${formatPrice(Math.abs(value))}`;
}

function formatQty(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}

function createMiniChartPath(points: StrategyBacktestPoint[]) {
  if (points.length === 0) {
    return null;
  }

  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1e-9);

  const path = points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = ((maxValue - point.value) / range) * 100;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const zeroY =
    minValue <= 0 && maxValue >= 0
      ? Number((((maxValue - 0) / range) * 100).toFixed(2))
      : null;

  return {
    path,
    zeroY,
  };
}

function MiniLineChart({
  points,
  stroke,
  emptyText,
}: {
  points: StrategyBacktestPoint[];
  stroke: string;
  emptyText: string;
}) {
  const chart = createMiniChartPath(points);

  if (!chart) {
    return <div className="strategy-mini-empty">{emptyText}</div>;
  }

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="strategy-mini-chart" aria-hidden="true">
      {typeof chart.zeroY === 'number' ? <line x1="0" y1={chart.zeroY} x2="100" y2={chart.zeroY} className="strategy-mini-zero" /> : null}
      <path d={chart.path} className="strategy-mini-line" style={{ stroke }} />
    </svg>
  );
}

function formatIndicatorLegend(config: IndicatorConfig, settings: IndicatorSettings) {
  if (config.key === 'rsi') {
    return `RSI ${settings.rsi.period}`;
  }

  if (config.key === 'macd') {
    return `MACD ${settings.macd.fast}/${settings.macd.slow}/${settings.macd.signal}`;
  }

  if (config.key === 'bbands') {
    const stdDevText = Number.isInteger(settings.bollinger.stdDev)
      ? `${settings.bollinger.stdDev}`
      : settings.bollinger.stdDev.toFixed(1);
    return `BB ${settings.bollinger.period}, ${stdDevText}`;
  }

  return config.label;
}

function App() {
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const secondaryContainerRef = useRef<HTMLDivElement | null>(null);
  const verticalOverlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const secondaryChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const secondaryCandleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const secondaryVolumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const secondaryCloseSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const indicatorSeriesRefs = useRef<Record<IndicatorSeriesKey, ISeriesApi<'Line'> | null>>(createIndicatorSeriesRefs());
  const compareSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const chartRangeSyncStateRef = useRef(createChartRangeSyncState());
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const activeToolRef = useRef<ToolKey>('cursor');
  const horizontalLinesRef = useRef<HorizontalLine[]>([]);
  const verticalLinesRef = useRef<VerticalLineState[]>([]);
  const trendlinesRef = useRef<TrendlineState[]>([]);
  const raysRef = useRef<RayState[]>([]);
  const rectanglesRef = useRef<RectangleState[]>([]);
  const notesRef = useRef<NoteState[]>([]);
  const verticalLineNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStateRef = useRef<DragState | null>(null);
  const dragHistoryStartRef = useRef<ChartHistorySnapshot | null>(null);
  const historyRef = useRef(createUndoRedoHistory<ChartHistorySnapshot>({ limit: CHART_HISTORY_LIMIT }));
  const historyApplyingRef = useRef(false);
  const selectedSymbolRef = useRef('BTCUSDT');
  const selectedIntervalRef = useRef('60');
  const watchlistAlertCheckInFlightRef = useRef(false);
  const recentAlertEventByRuleRef = useRef<Map<string, number>>(new Map());

  const [watchlistSymbols, setWatchlistSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('60');
  const [chartLayoutMode, setChartLayoutMode] = useState<ChartLayoutMode>(() => readUnifiedLayoutState().chartLayoutMode);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [marketStatusError, setMarketStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<ToolKey>('cursor');
  const [watchTab, setWatchTab] = useState<WatchTab>('watchlist');
  const [watchQuery, setWatchQuery] = useState('');
  const [watchSortKey, setWatchSortKey] = useState<WatchSortKey>(() => getStoredWatchPrefs().watchSortKey ?? 'symbol');
  const [watchSortDir, setWatchSortDir] = useState<WatchSortDir>(() => getStoredWatchPrefs().watchSortDir ?? 'asc');
  const [watchMarketFilter, setWatchMarketFilter] = useState<WatchMarketFilter>(() => getStoredWatchPrefs().watchMarketFilter ?? 'ALL');
  const [searchResults, setSearchResults] = useState<SymbolItem[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('pine');
  const [strategyForm, setStrategyForm] = useState<StrategyTesterFormState>(() => getStoredStrategyTesterForm());
  const [strategyResult, setStrategyResult] = useState<StrategyBacktestResult | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [strategyRecovery, setStrategyRecovery] = useState<WorkflowRecoveryState | null>(null);
  const [tradingOrderForm, setTradingOrderForm] = useState<TradingOrderFormState>(() => ({
    ...DEFAULT_TRADING_ORDER_FORM,
  }));
  const [tradingState, setTradingState] = useState<TradingState | null>(null);
  const [tradingLoading, setTradingLoading] = useState(false);
  const [tradingRefreshing, setTradingRefreshing] = useState(false);
  const [tradingSubmitting, setTradingSubmitting] = useState(false);
  const [tradingError, setTradingError] = useState<string | null>(null);
  const [tradingFormError, setTradingFormError] = useState<string | null>(null);
  const [tradingRecovery, setTradingRecovery] = useState<WorkflowRecoveryState | null>(null);
  const [tradingLastUpdatedAt, setTradingLastUpdatedAt] = useState<number | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [indicatorPanelOpen, setIndicatorPanelOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [enabledIndicators, setEnabledIndicators] = useState<Record<IndicatorKey, boolean>>(
    () => getStoredIndicatorPrefs().enabledIndicators,
  );
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings>(() => getStoredIndicatorPrefs().settings);
  const [compareSymbol, setCompareSymbol] = useState('');
  const [compareCandles, setCompareCandles] = useState<Candle[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [topActionFeedback, setTopActionFeedback] = useState<string | null>(null);
  const [replayMode, setReplayMode] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const [replayStartBars, setReplayStartBars] = useState(0);
  const [replayVisibleBars, setReplayVisibleBars] = useState(0);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number } | null>(null);
  const [horizontalLines, setHorizontalLines] = useState<HorizontalLineState[]>([]);
  const [verticalLines, setVerticalLines] = useState<VerticalLineState[]>([]);
  const [trendlines, setTrendlines] = useState<TrendlineState[]>([]);
  const [rays, setRays] = useState<RayState[]>([]);
  const [rectangles, setRectangles] = useState<RectangleState[]>([]);
  const [notes, setNotes] = useState<NoteState[]>([]);
  const [isDraggingDrawing, setIsDraggingDrawing] = useState(false);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [pendingShapeStart, setPendingShapeStart] = useState<{
    tool: PendingShapeTool;
    time: UTCTimestamp;
    price: number;
  } | null>(null);
  const [overlayTick, setOverlayTick] = useState(0);
  const [chartReady, setChartReady] = useState(false);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsSubmitting, setAlertsSubmitting] = useState(false);
  const [alertsChecking, setAlertsChecking] = useState(false);
  const [alertsWatchlistChecking, setAlertsWatchlistChecking] = useState(false);
  const [alertsAutoCheckEnabled, setAlertsAutoCheckEnabled] = useState<boolean>(
    () => getStoredAlertAutoCheckPrefs().enabled ?? false,
  );
  const [alertsAutoCheckIntervalSec, setAlertsAutoCheckIntervalSec] = useState<AlertAutoCheckIntervalSec>(
    () => getStoredAlertAutoCheckPrefs().intervalSec ?? 60,
  );
  const [alertMetric, setAlertMetric] = useState<AlertMetric>('price');
  const [alertOperator, setAlertOperator] = useState<AlertOperator>('>=');
  const [alertThresholdInput, setAlertThresholdInput] = useState('');
  const [alertCooldownInput, setAlertCooldownInput] = useState('60');
  const [alertIndicatorEnabled, setAlertIndicatorEnabled] = useState(false);
  const [alertIndicatorType, setAlertIndicatorType] = useState<AlertIndicatorType>('rsiThreshold');
  const [alertRsiOperator, setAlertRsiOperator] = useState<AlertIndicatorComparator>('>=');
  const [alertRsiThresholdInput, setAlertRsiThresholdInput] = useState('70');
  const [alertMacdCrossSignal, setAlertMacdCrossSignal] = useState<'bullish' | 'bearish'>('bullish');
  const [alertMacdHistogramSign, setAlertMacdHistogramSign] = useState<'positive' | 'negative'>('positive');
  const [alertBollingerPosition, setAlertBollingerPosition] = useState<'aboveUpper' | 'belowLower'>('aboveUpper');
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertTriggeredEvents, setAlertTriggeredEvents] = useState<AlertCheckEvent[]>([]);
  const [alertLastCheckedAt, setAlertLastCheckedAt] = useState<number | null>(null);
  const [alertRuleSymbolFilter, setAlertRuleSymbolFilter] = useState('BTCUSDT');
  const [alertRuleIndicatorAwareOnly, setAlertRuleIndicatorAwareOnly] = useState(false);
  const [alertHistoryEvents, setAlertHistoryEvents] = useState<AlertHistoryEvent[]>([]);
  const [alertHistorySymbolFilter, setAlertHistorySymbolFilter] = useState('');
  const [alertHistorySourceFilter, setAlertHistorySourceFilter] = useState<AlertHistorySourceFilter>('all');
  const [alertHistoryIndicatorAwareOnly, setAlertHistoryIndicatorAwareOnly] = useState(false);
  const [alertsHistoryLoading, setAlertsHistoryLoading] = useState(false);
  const [alertsHistoryClearing, setAlertsHistoryClearing] = useState(false);
  const [alertsRecovery, setAlertsRecovery] = useState<WorkflowRecoveryState | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsPanelError, setOpsPanelError] = useState<string | null>(null);
  const [opsErrors, setOpsErrors] = useState<OpsErrorEvent[]>([]);
  const [opsRecoveries, setOpsRecoveries] = useState<OpsRecoveryEvent[]>([]);
  const [historyState, setHistoryState] = useState<UndoRedoState>(() => historyRef.current.getState());
  const chartLayoutModeStateRef = useRef<ChartLayoutMode>(chartLayoutMode);
  const enabledIndicatorsRef = useRef<Record<IndicatorKey, boolean>>(enabledIndicators);
  const indicatorSettingsRef = useRef<IndicatorSettings>(indicatorSettings);
  const compareSymbolStateRef = useRef(compareSymbol);
  const hasTradingState = tradingState !== null;

  const replayProgress = useMemo(
    () => getReplayProgress(candles.length, replayStartBars, replayVisibleBars),
    [candles.length, replayStartBars, replayVisibleBars],
  );
  const activeCandles = useMemo(() => {
    if (!replayMode) return candles;
    return candles.slice(0, replayProgress.visibleBars);
  }, [candles, replayMode, replayProgress.visibleBars]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    setAlertRuleSymbolFilter(selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    setTradingFormError(null);
  }, [selectedSymbol]);

  useEffect(() => {
    selectedIntervalRef.current = selectedInterval;
  }, [selectedInterval]);

  useEffect(() => {
    chartLayoutModeStateRef.current = chartLayoutMode;
  }, [chartLayoutMode]);

  useEffect(() => {
    enabledIndicatorsRef.current = enabledIndicators;
  }, [enabledIndicators]);

  useEffect(() => {
    indicatorSettingsRef.current = indicatorSettings;
  }, [indicatorSettings]);

  useEffect(() => {
    compareSymbolStateRef.current = compareSymbol;
  }, [compareSymbol]);

  useEffect(() => {
    chartRangeSyncStateRef.current = createChartRangeSyncState();
  }, [chartLayoutMode]);

  useEffect(() => {
    setReplayMode(false);
    setReplayPlaying(false);
    setReplayStartBars(0);
    setReplayVisibleBars(0);
  }, [selectedInterval, selectedSymbol]);

  useEffect(() => {
    if (activeTool !== 'trendline' && activeTool !== 'ray' && activeTool !== 'rectangle') {
      setPendingShapeStart(null);
    }
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'cursor' && dragStateRef.current) {
      dragStateRef.current = null;
      setIsDraggingDrawing(false);
    }
  }, [activeTool]);

  useEffect(() => {
    if (!selectedDrawingId) return;

    const exists =
      horizontalLines.some((item) => item.id === selectedDrawingId) ||
      verticalLines.some((item) => item.id === selectedDrawingId) ||
      trendlines.some((item) => item.id === selectedDrawingId) ||
      rays.some((item) => item.id === selectedDrawingId) ||
      rectangles.some((item) => item.id === selectedDrawingId) ||
      notes.some((item) => item.id === selectedDrawingId);

    if (!exists) {
      setSelectedDrawingId(null);
    }
  }, [horizontalLines, notes, rays, rectangles, selectedDrawingId, trendlines, verticalLines]);

  useEffect(() => {
    if (!topActionFeedback) return;

    const timer = window.setTimeout(() => {
      setTopActionFeedback(null);
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [topActionFeedback]);

  const loadOpsTelemetry = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) {
        setOpsLoading(true);
      }

      try {
        const feed = await fetchOpsTelemetryFeed(apiBase, { limit: 20, recoveryLimit: 20 });
        setOpsErrors(feed.errors);
        setOpsRecoveries(feed.recoveries);
        setOpsPanelError(null);
        return true;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : '운영 텔레메트리를 불러오지 못했습니다.';
        setOpsPanelError(message);
        return false;
      } finally {
        if (!silent) {
          setOpsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (rightPanelCollapsed) return;

    let canceled = false;

    const runLoad = async (silent = false) => {
      if (canceled) return;
      await loadOpsTelemetry({ silent });
    };

    void runLoad(false);
    const timer = window.setInterval(() => {
      void runLoad(true);
    }, 30000);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [loadOpsTelemetry, rightPanelCollapsed]);

  const reportOpsError = useCallback(
    (input: {
      source: OpsTelemetrySource;
      code: string;
      message: string;
      level: 'recoverable' | 'critical';
      context?: Record<string, unknown>;
    }) => {
      void (async () => {
        const sent = await emitOpsErrorTelemetry(apiBase, {
          source: input.source,
          code: input.code,
          message: input.message,
          level: input.level,
          ...(input.context ? { context: input.context } : {}),
        });

        if (sent) {
          void loadOpsTelemetry({ silent: true });
        }
      })();
    },
    [loadOpsTelemetry],
  );

  const reportOpsRecovery = useCallback(
    (input: {
      source: OpsTelemetrySource;
      action: string;
      status: 'attempted' | 'succeeded' | 'failed';
      message?: string;
      errorCode?: string;
      context?: Record<string, unknown>;
    }) => {
      void (async () => {
        const sent = await emitOpsRecoveryTelemetry(apiBase, {
          source: input.source,
          action: input.action,
          status: input.status,
          ...(input.message ? { message: input.message } : {}),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.context ? { context: input.context } : {}),
        });

        if (sent) {
          void loadOpsTelemetry({ silent: true });
        }
      })();
    },
    [loadOpsTelemetry],
  );

  const clearHoveredCandle = useCallback(() => {
    setHoveredCandle(null);
    setHoveredPoint(null);
  }, []);

  useEffect(() => {
    if (!hoveredCandle) return;

    const stillVisible = activeCandles.some((candle) => candle.time === hoveredCandle.time);
    if (!stillVisible) {
      clearHoveredCandle();
    }
  }, [activeCandles, clearHoveredCandle, hoveredCandle]);

  useEffect(() => {
    if (!replayMode || !replayPlaying || replayProgress.isAtEnd) return;

    const timer = window.setTimeout(() => {
      setReplayVisibleBars((previous) => stepReplayVisibleCount(previous, candles.length, 1));
    }, REPLAY_TICK_MS_BY_SPEED[replaySpeed]);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    candles.length,
    replayMode,
    replayPlaying,
    replayProgress.completedSteps,
    replayProgress.isAtEnd,
    replaySpeed,
  ]);

  useEffect(() => {
    if (!replayMode || !replayPlaying || !replayProgress.isAtEnd) return;
    setReplayPlaying(false);
  }, [replayMode, replayPlaying, replayProgress.isAtEnd]);

  const refreshDrawingOverlay = useCallback(() => {
    setOverlayTick((previous) => previous + 1);
  }, []);

  const syncVisibleLogicalRange = useCallback((source: ChartSyncSource, sourceRange: LogicalRangeLike) => {
    const targetChart = source === 'primary' ? secondaryChartRef.current : chartRef.current;
    if (!targetChart) return;

    applyLogicalRangeSync({
      state: chartRangeSyncStateRef.current,
      source,
      sourceRange,
      getTargetRange: () => targetChart.timeScale().getVisibleLogicalRange(),
      setTargetRange: (nextRange) => {
        targetChart.timeScale().setVisibleLogicalRange(nextRange);
      },
    });
  }, []);

  const toHorizontalLineState = useCallback((line: { id?: string; price: number }) => {
    const normalizedPrice = Number(line.price);
    if (!Number.isFinite(normalizedPrice)) return null;

    return {
      id: line.id?.trim() || createHorizontalLineId(),
      price: normalizeLinePrice(normalizedPrice),
    };
  }, []);

  const toVerticalLineState = useCallback((line: { id?: string; time: number }) => {
    const normalizedTime = Number(line.time);
    if (!Number.isFinite(normalizedTime)) return null;

    const timestamp = Math.floor(normalizedTime);
    if (timestamp <= 0) return null;

    return {
      id: line.id?.trim() || createVerticalLineId(),
      time: timestamp as UTCTimestamp,
    };
  }, []);

  const toTrendlineState = useCallback(
    (drawing: { id?: string; startTime: number; startPrice: number; endTime: number; endPrice: number }) => {
      const startTime = Math.floor(Number(drawing.startTime));
      const endTime = Math.floor(Number(drawing.endTime));
      const startPrice = Number(drawing.startPrice);
      const endPrice = Number(drawing.endPrice);

      if (startTime <= 0 || endTime <= 0) return null;
      if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice)) return null;

      return {
        id: drawing.id?.trim() || createTrendlineId(),
        startTime: startTime as UTCTimestamp,
        startPrice: normalizeLinePrice(startPrice),
        endTime: endTime as UTCTimestamp,
        endPrice: normalizeLinePrice(endPrice),
      };
    },
    [],
  );

  const toRayState = useCallback(
    (drawing: { id?: string; startTime: number; startPrice: number; endTime: number; endPrice: number }) => {
      const startTime = Math.floor(Number(drawing.startTime));
      const endTime = Math.floor(Number(drawing.endTime));
      const startPrice = Number(drawing.startPrice);
      const endPrice = Number(drawing.endPrice);

      if (startTime <= 0 || endTime <= 0) return null;
      if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice)) return null;
      if (startTime === endTime && Math.abs(startPrice - endPrice) < 0.0001) return null;

      return {
        id: drawing.id?.trim() || createRayId(),
        startTime: startTime as UTCTimestamp,
        startPrice: normalizeLinePrice(startPrice),
        endTime: endTime as UTCTimestamp,
        endPrice: normalizeLinePrice(endPrice),
      };
    },
    [],
  );

  const toRectangleState = useCallback(
    (drawing: { id?: string; startTime: number; startPrice: number; endTime: number; endPrice: number }) => {
      const startTime = Math.floor(Number(drawing.startTime));
      const endTime = Math.floor(Number(drawing.endTime));
      const startPrice = Number(drawing.startPrice);
      const endPrice = Number(drawing.endPrice);

      if (startTime <= 0 || endTime <= 0) return null;
      if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice)) return null;

      return {
        id: drawing.id?.trim() || createRectangleId(),
        startTime: startTime as UTCTimestamp,
        startPrice: normalizeLinePrice(startPrice),
        endTime: endTime as UTCTimestamp,
        endPrice: normalizeLinePrice(endPrice),
      };
    },
    [],
  );

  const toNoteState = useCallback((drawing: { id?: string; time: number; price: number; text: string }) => {
    const time = Math.floor(Number(drawing.time));
    const price = Number(drawing.price);
    const text = drawing.text.trim();

    if (time <= 0 || !Number.isFinite(price) || text.length === 0) return null;

    return {
      id: drawing.id?.trim() || createNoteId(),
      time: time as UTCTimestamp,
      price: normalizeLinePrice(price),
      text,
    };
  }, []);

  const snapshotHorizontalLines = useCallback((): HorizontalLineState[] => {
    return horizontalLinesRef.current.map((item) => ({
      id: item.id,
      price: item.price,
    }));
  }, []);

  const snapshotVerticalLines = useCallback((): VerticalLineState[] => {
    return verticalLinesRef.current.map((item) => ({
      id: item.id,
      time: item.time,
    }));
  }, []);

  const snapshotTrendlines = useCallback((): TrendlineState[] => {
    return trendlinesRef.current.map((item) => ({ ...item }));
  }, []);

  const snapshotRays = useCallback((): RayState[] => {
    return raysRef.current.map((item) => ({ ...item }));
  }, []);

  const snapshotRectangles = useCallback((): RectangleState[] => {
    return rectanglesRef.current.map((item) => ({ ...item }));
  }, []);

  const snapshotNotes = useCallback((): NoteState[] => {
    return notesRef.current.map((item) => ({ ...item }));
  }, []);

  const toDrawingPayload = useCallback(
    (
      lines: HorizontalLineState[],
      markers: VerticalLineState[],
      trendShapes: TrendlineState[],
      rayShapes: RayState[],
      rectangleShapes: RectangleState[],
      noteShapes: NoteState[],
    ): DrawingPayloadItem[] => {
      return [
        ...lines.map((line) => ({
          id: line.id,
          type: 'horizontal' as const,
          price: line.price,
        })),
        ...markers.map((marker) => ({
          id: marker.id,
          type: 'vertical' as const,
          time: Number(marker.time),
        })),
        ...trendShapes.map((shape) => ({
          id: shape.id,
          type: 'trendline' as const,
          startTime: Number(shape.startTime),
          startPrice: shape.startPrice,
          endTime: Number(shape.endTime),
          endPrice: shape.endPrice,
        })),
        ...rayShapes.map((shape) => ({
          id: shape.id,
          type: 'ray' as const,
          startTime: Number(shape.startTime),
          startPrice: shape.startPrice,
          endTime: Number(shape.endTime),
          endPrice: shape.endPrice,
        })),
        ...rectangleShapes.map((shape) => ({
          id: shape.id,
          type: 'rectangle' as const,
          startTime: Number(shape.startTime),
          startPrice: shape.startPrice,
          endTime: Number(shape.endTime),
          endPrice: shape.endPrice,
        })),
        ...noteShapes.map((shape) => ({
          id: shape.id,
          type: 'note' as const,
          time: Number(shape.time),
          price: shape.price,
          text: shape.text,
        })),
      ];
    },
    [],
  );

  const syncVerticalLinePositions = useCallback(() => {
    const chart = chartRef.current;
    const overlay = verticalOverlayRef.current;
    if (!chart || !overlay) return;

    const overlayWidth = overlay.clientWidth;

    for (const item of verticalLinesRef.current) {
      const node = verticalLineNodesRef.current.get(item.id);
      if (!node) continue;

      const x = chart.timeScale().timeToCoordinate(item.time as Time);
      if (x === null || !Number.isFinite(x) || x < 0 || x > overlayWidth) {
        node.style.display = 'none';
        continue;
      }

      node.style.display = 'block';
      node.style.left = `${x}px`;
    }
  }, []);

  const renderHorizontalLines = useCallback((lines: HorizontalLineState[]) => {
    const series = candleSeriesRef.current;
    if (!series) return;

    for (const item of horizontalLinesRef.current) {
      series.removePriceLine(item.line);
    }

    horizontalLinesRef.current = lines.map((item) => ({
      id: item.id,
      price: item.price,
      line: series.createPriceLine({
        price: item.price,
        color: '#f5a623',
        lineWidth: 1,
        axisLabelVisible: true,
        title: `H ${formatPrice(item.price)}`,
      }),
    }));

    setHorizontalLines(lines);
    refreshDrawingOverlay();
  }, [refreshDrawingOverlay]);

  const renderVerticalLines = useCallback((lines: VerticalLineState[]) => {
    verticalLinesRef.current = lines;
    setVerticalLines(lines);

    const overlay = verticalOverlayRef.current;
    if (!overlay) return;

    const keepIds = new Set(lines.map((item) => item.id));

    for (const [id, node] of verticalLineNodesRef.current.entries()) {
      if (keepIds.has(id)) continue;
      node.remove();
      verticalLineNodesRef.current.delete(id);
    }

    for (const item of lines) {
      if (verticalLineNodesRef.current.has(item.id)) continue;
      const node = document.createElement('div');
      node.className = 'vertical-line-marker';
      overlay.appendChild(node);
      verticalLineNodesRef.current.set(item.id, node);
    }

    syncVerticalLinePositions();
    refreshDrawingOverlay();
  }, [refreshDrawingOverlay, syncVerticalLinePositions]);

  const renderTrendlines = useCallback((items: TrendlineState[]) => {
    trendlinesRef.current = items;
    setTrendlines(items);
    refreshDrawingOverlay();
  }, [refreshDrawingOverlay]);

  const renderRays = useCallback((items: RayState[]) => {
    raysRef.current = items;
    setRays(items);
    refreshDrawingOverlay();
  }, [refreshDrawingOverlay]);

  const renderRectangles = useCallback((items: RectangleState[]) => {
    rectanglesRef.current = items;
    setRectangles(items);
    refreshDrawingOverlay();
  }, [refreshDrawingOverlay]);

  const renderNotes = useCallback((items: NoteState[]) => {
    notesRef.current = items;
    setNotes(items);
    refreshDrawingOverlay();
  }, [refreshDrawingOverlay]);

  useEffect(() => {
    for (const item of horizontalLinesRef.current) {
      const selected = selectedDrawingId === item.id;
      item.line.applyOptions({
        color: selected ? '#ffcf66' : '#f5a623',
        lineWidth: selected ? 2 : 1,
      });
    }
  }, [horizontalLines, selectedDrawingId]);

  useEffect(() => {
    syncVerticalLinePositions();
  }, [syncVerticalLinePositions, verticalLines]);

  useEffect(() => {
    for (const [id, node] of verticalLineNodesRef.current.entries()) {
      node.className = `vertical-line-marker${selectedDrawingId === id ? ' selected' : ''}`;
    }
  }, [selectedDrawingId, verticalLines]);

  const persistDrawings = useCallback(
    async (
      symbol: string,
      interval: string,
      lines: HorizontalLineState[],
      markers: VerticalLineState[],
      trendShapes: TrendlineState[],
      rayShapes: RayState[],
      rectangleShapes: RectangleState[],
      noteShapes: NoteState[],
    ) => {
      try {
        const response = await fetch(`${apiBase}/api/drawings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            interval,
            lines,
            drawings: toDrawingPayload(lines, markers, trendShapes, rayShapes, rectangleShapes, noteShapes),
          }),
        });

        if (!response.ok) {
          throw new Error('persist drawings failed');
        }
      } catch {
        setError((prev) => prev ?? '도형 저장에 실패했습니다.');
      }
    },
    [toDrawingPayload],
  );

  const persistWatchlist = useCallback(async (items: SymbolItem[]) => {
    const response = await fetch(`${apiBase}/api/watchlist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DEFAULT_WATCHLIST_NAME,
        items,
      }),
    });

    if (!response.ok) {
      throw new Error('persist watchlist failed');
    }

    const data = (await response.json()) as { items?: SymbolItem[] };
    return data.items ?? items;
  }, []);

  const loadDrawings = useCallback(
    async (
      symbol: string,
      interval: string,
    ): Promise<{
      horizontalLines: HorizontalLineState[];
      verticalLines: VerticalLineState[];
      trendlines: TrendlineState[];
      rays: RayState[];
      rectangles: RectangleState[];
      notes: NoteState[];
    }> => {
      try {
        const response = await fetch(
          `${apiBase}/api/drawings?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,
        );

        if (!response.ok) {
          throw new Error('load drawings failed');
        }

        const data = (await response.json()) as {
          drawings?: Array<{
            id?: string;
            type?: string;
            price?: number;
            time?: number;
            startTime?: number;
            startPrice?: number;
            endTime?: number;
            endPrice?: number;
            text?: string;
          }>;
          lines?: Array<{ id?: string; price: number }>;
        };

        const nextHorizontalLines: HorizontalLineState[] = [];
        const nextVerticalLines: VerticalLineState[] = [];
        const nextTrendlines: TrendlineState[] = [];
        const nextRays: RayState[] = [];
        const nextRectangles: RectangleState[] = [];
        const nextNotes: NoteState[] = [];

        if (data.drawings?.length) {
          for (const drawing of data.drawings) {
            if (drawing.type === 'horizontal' && typeof drawing.price === 'number') {
              const horizontalLine = toHorizontalLineState({ id: drawing.id, price: drawing.price });
              if (horizontalLine) {
                nextHorizontalLines.push(horizontalLine);
              }
            }

            if (drawing.type === 'vertical' && typeof drawing.time === 'number') {
              const verticalLine = toVerticalLineState({ id: drawing.id, time: drawing.time });
              if (verticalLine) {
                nextVerticalLines.push(verticalLine);
              }
            }

            if (
              drawing.type === 'trendline' &&
              typeof drawing.startTime === 'number' &&
              typeof drawing.startPrice === 'number' &&
              typeof drawing.endTime === 'number' &&
              typeof drawing.endPrice === 'number'
            ) {
              const trendline = toTrendlineState({
                id: drawing.id,
                startTime: drawing.startTime,
                startPrice: drawing.startPrice,
                endTime: drawing.endTime,
                endPrice: drawing.endPrice,
              });
              if (trendline) {
                nextTrendlines.push(trendline);
              }
            }

            if (
              drawing.type === 'ray' &&
              typeof drawing.startTime === 'number' &&
              typeof drawing.startPrice === 'number' &&
              typeof drawing.endTime === 'number' &&
              typeof drawing.endPrice === 'number'
            ) {
              const ray = toRayState({
                id: drawing.id,
                startTime: drawing.startTime,
                startPrice: drawing.startPrice,
                endTime: drawing.endTime,
                endPrice: drawing.endPrice,
              });
              if (ray) {
                nextRays.push(ray);
              }
            }

            if (
              drawing.type === 'rectangle' &&
              typeof drawing.startTime === 'number' &&
              typeof drawing.startPrice === 'number' &&
              typeof drawing.endTime === 'number' &&
              typeof drawing.endPrice === 'number'
            ) {
              const rectangle = toRectangleState({
                id: drawing.id,
                startTime: drawing.startTime,
                startPrice: drawing.startPrice,
                endTime: drawing.endTime,
                endPrice: drawing.endPrice,
              });
              if (rectangle) {
                nextRectangles.push(rectangle);
              }
            }

            if (
              drawing.type === 'note' &&
              typeof drawing.time === 'number' &&
              typeof drawing.price === 'number' &&
              typeof drawing.text === 'string'
            ) {
              const note = toNoteState({
                id: drawing.id,
                time: drawing.time,
                price: drawing.price,
                text: drawing.text,
              });
              if (note) {
                nextNotes.push(note);
              }
            }
          }
        } else {
          nextHorizontalLines.push(
            ...(data.lines ?? [])
              .map((line) => toHorizontalLineState(line))
              .filter((line): line is HorizontalLineState => Boolean(line)),
          );
        }

        return {
          horizontalLines: nextHorizontalLines,
          verticalLines: nextVerticalLines,
          trendlines: nextTrendlines,
          rays: nextRays,
          rectangles: nextRectangles,
          notes: nextNotes,
        };
      } catch {
        setError((prev) => prev ?? '도형을 불러오지 못했습니다.');
        return { horizontalLines: [], verticalLines: [], trendlines: [], rays: [], rectangles: [], notes: [] };
      }
    },
    [toHorizontalLineState, toNoteState, toRayState, toRectangleState, toTrendlineState, toVerticalLineState],
  );

  const syncHistoryState = useCallback(() => {
    setHistoryState(historyRef.current.getState());
  }, []);

  const captureChartHistorySnapshot = useCallback(
    (overrides?: Partial<ChartHistorySnapshot>): ChartHistorySnapshot => {
      const baseSnapshot: ChartHistorySnapshot = {
        horizontalLines: snapshotHorizontalLines(),
        verticalLines: snapshotVerticalLines(),
        trendlines: snapshotTrendlines(),
        rays: snapshotRays(),
        rectangles: snapshotRectangles(),
        notes: snapshotNotes(),
        enabledIndicators: { ...enabledIndicatorsRef.current },
        indicatorSettings: normalizeIndicatorSettings(indicatorSettingsRef.current),
        compareSymbol: compareSymbolStateRef.current,
        chartLayoutMode: chartLayoutModeStateRef.current,
      };

      return cloneChartHistorySnapshot({
        ...baseSnapshot,
        ...overrides,
        horizontalLines: overrides?.horizontalLines ?? baseSnapshot.horizontalLines,
        verticalLines: overrides?.verticalLines ?? baseSnapshot.verticalLines,
        trendlines: overrides?.trendlines ?? baseSnapshot.trendlines,
        rays: overrides?.rays ?? baseSnapshot.rays,
        rectangles: overrides?.rectangles ?? baseSnapshot.rectangles,
        notes: overrides?.notes ?? baseSnapshot.notes,
        enabledIndicators: overrides?.enabledIndicators ?? baseSnapshot.enabledIndicators,
        indicatorSettings: overrides?.indicatorSettings ?? baseSnapshot.indicatorSettings,
        compareSymbol: overrides?.compareSymbol ?? baseSnapshot.compareSymbol,
        chartLayoutMode: overrides?.chartLayoutMode ?? baseSnapshot.chartLayoutMode,
      });
    },
    [
      snapshotHorizontalLines,
      snapshotNotes,
      snapshotRays,
      snapshotRectangles,
      snapshotTrendlines,
      snapshotVerticalLines,
    ],
  );

  const recordHistoryTransition = useCallback(
    (before: ChartHistorySnapshot, after: ChartHistorySnapshot) => {
      if (historyApplyingRef.current) return;

      const previous = cloneChartHistorySnapshot(before);
      const next = cloneChartHistorySnapshot(after);
      if (areChartHistorySnapshotsEqual(previous, next)) return;

      historyRef.current.push({ before: previous, after: next });
      syncHistoryState();
    },
    [syncHistoryState],
  );

  const applyChartHistorySnapshot = useCallback(
    (snapshot: ChartHistorySnapshot) => {
      const nextSnapshot = cloneChartHistorySnapshot(snapshot);
      const previousDrawingSnapshot: ChartHistoryDrawingSnapshot = {
        horizontalLines: snapshotHorizontalLines(),
        verticalLines: snapshotVerticalLines(),
        trendlines: snapshotTrendlines(),
        rays: snapshotRays(),
        rectangles: snapshotRectangles(),
        notes: snapshotNotes(),
      };
      historyApplyingRef.current = true;

      renderHorizontalLines(nextSnapshot.horizontalLines);
      renderVerticalLines(nextSnapshot.verticalLines);
      renderTrendlines(nextSnapshot.trendlines);
      renderRays(nextSnapshot.rays);
      renderRectangles(nextSnapshot.rectangles);
      renderNotes(nextSnapshot.notes);
      setEnabledIndicators({ ...nextSnapshot.enabledIndicators });
      setIndicatorSettings(normalizeIndicatorSettings(nextSnapshot.indicatorSettings));
      setCompareSymbol(nextSnapshot.compareSymbol);
      setCompareError(null);
      if (!nextSnapshot.compareSymbol) {
        setCompareCandles([]);
      }
      setChartLayoutMode(nextSnapshot.chartLayoutMode);
      setPendingShapeStart(null);
      setSelectedDrawingId(null);
      dragStateRef.current = null;
      setIsDraggingDrawing(false);

      historyApplyingRef.current = false;

      const nextDrawingSnapshot: ChartHistoryDrawingSnapshot = {
        horizontalLines: nextSnapshot.horizontalLines,
        verticalLines: nextSnapshot.verticalLines,
        trendlines: nextSnapshot.trendlines,
        rays: nextSnapshot.rays,
        rectangles: nextSnapshot.rectangles,
        notes: nextSnapshot.notes,
      };
      if (!areChartHistoryDrawingSnapshotsEqual(previousDrawingSnapshot, nextDrawingSnapshot)) {
        void persistDrawings(
          selectedSymbolRef.current,
          selectedIntervalRef.current,
          nextSnapshot.horizontalLines,
          nextSnapshot.verticalLines,
          nextSnapshot.trendlines,
          nextSnapshot.rays,
          nextSnapshot.rectangles,
          nextSnapshot.notes,
        );
      }
    },
    [
      persistDrawings,
      renderHorizontalLines,
      renderNotes,
      renderRays,
      renderRectangles,
      renderTrendlines,
      renderVerticalLines,
      snapshotHorizontalLines,
      snapshotNotes,
      snapshotRays,
      snapshotRectangles,
      snapshotTrendlines,
      snapshotVerticalLines,
    ],
  );

  const undoHistory = useCallback(() => {
    const transition = historyRef.current.undo();
    if (!transition) return false;

    applyChartHistorySnapshot(transition.before);
    syncHistoryState();
    return true;
  }, [applyChartHistorySnapshot, syncHistoryState]);

  const redoHistory = useCallback(() => {
    const transition = historyRef.current.redo();
    if (!transition) return false;

    applyChartHistorySnapshot(transition.after);
    syncHistoryState();
    return true;
  }, [applyChartHistorySnapshot, syncHistoryState]);

  useEffect(() => {
    historyRef.current.clear();
    syncHistoryState();
  }, [selectedInterval, selectedSymbol, syncHistoryState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const payload: WatchPrefs = {
      watchSortKey,
      watchSortDir,
      watchMarketFilter,
    };

    window.localStorage.setItem(WATCH_PREFS_STORAGE_KEY, JSON.stringify(payload));
  }, [watchMarketFilter, watchSortDir, watchSortKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const payload: AlertAutoCheckPrefs = {
      enabled: alertsAutoCheckEnabled,
      intervalSec: alertsAutoCheckIntervalSec,
    };

    window.localStorage.setItem(ALERT_AUTO_CHECK_STORAGE_KEY, JSON.stringify(payload));
  }, [alertsAutoCheckEnabled, alertsAutoCheckIntervalSec]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const payload: IndicatorPrefs = {
      version: INDICATOR_PREFS_VERSION,
      enabledIndicators,
      settings: normalizeIndicatorSettings(indicatorSettings),
    };

    window.localStorage.setItem(INDICATOR_PREFS_STORAGE_KEY, JSON.stringify(payload));
  }, [enabledIndicators, indicatorSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeUnifiedLayoutState({ chartLayoutMode });
  }, [chartLayoutMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STRATEGY_TESTER_STORAGE_KEY, JSON.stringify(strategyForm));
  }, [strategyForm]);

  useEffect(() => {
    let canceled = false;

    const applyWatchlist = (nextSymbols: SymbolItem[]) => {
      if (canceled) return;

      setWatchlistSymbols(nextSymbols);
      setSelectedSymbol((prev) => {
        if (nextSymbols.some((item) => item.symbol === prev)) {
          return prev;
        }

        return nextSymbols[0]?.symbol ?? prev;
      });
    };

    const loadSymbolsFallback = async () => {
      const response = await fetch(`${apiBase}/api/symbols`);
      if (!response.ok) {
        throw new Error('symbols fetch failed');
      }

      const data = (await response.json()) as { symbols?: SymbolItem[] };
      return data.symbols ?? [];
    };

    const loadWatchlist = async () => {
      try {
        const watchlistResponse = await fetch(
          `${apiBase}/api/watchlist?name=${encodeURIComponent(DEFAULT_WATCHLIST_NAME)}`,
        );

        if (!watchlistResponse.ok) {
          throw new Error('watchlist fetch failed');
        }

        const watchlistData = (await watchlistResponse.json()) as { items?: SymbolItem[] };
        const items = watchlistData.items ?? [];

        if (items.length > 0) {
          applyWatchlist(items);
          return;
        }

        const fallbackSymbols = await loadSymbolsFallback();
        applyWatchlist(fallbackSymbols);
      } catch {
        try {
          const fallbackSymbols = await loadSymbolsFallback();
          applyWatchlist(fallbackSymbols);
        } catch {
          if (!canceled) {
            setError('심볼 목록을 불러오지 못했습니다. API 상태를 확인해주세요.');
          }
        }
      }
    };

    void loadWatchlist();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#B2B5BE',
        fontFamily: 'Inter, Pretendard, Apple SD Gothic Neo, sans-serif',
      },
      grid: {
        vertLines: { color: '#1F2433' },
        horzLines: { color: '#1F2433' },
      },
      rightPriceScale: {
        borderColor: '#2B2F3A',
      },
      timeScale: {
        borderColor: '#2B2F3A',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#758696', width: 1, style: 3 },
        horzLine: { color: '#758696', width: 1, style: 3 },
      },
      localization: {
        locale: 'ko-KR',
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26A69A',
      downColor: '#EF5350',
      wickUpColor: '#26A69A',
      wickDownColor: '#EF5350',
      borderVisible: false,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
      priceFormat: {
        type: 'volume',
      },
      color: '#2962FF66',
    });

    const sma20Series = chart.addSeries(LineSeries, {
      color: indicatorConfigs[0].color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma60Series = chart.addSeries(LineSeries, {
      color: indicatorConfigs[1].color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const ema20Series = chart.addSeries(LineSeries, {
      color: indicatorConfigs[2].color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const rsiSeries = chart.addSeries(LineSeries, {
      priceScaleId: 'rsi',
      color: indicatorConfigs[3].color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const macdSeries = chart.addSeries(LineSeries, {
      priceScaleId: 'macd',
      color: indicatorConfigs[4].color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const macdSignalSeries = chart.addSeries(LineSeries, {
      priceScaleId: 'macd',
      color: '#f5c06f',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const bbBasisSeries = chart.addSeries(LineSeries, {
      color: indicatorConfigs[5].color,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: '#85c6ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: '#85c6ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const compareSeries = chart.addSeries(LineSeries, {
      color: compareOverlayColor,
      lineWidth: 2,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.9,
        bottom: 0,
      },
    });
    chart.priceScale('rsi').applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: {
        top: 0.66,
        bottom: 0.24,
      },
    });
    chart.priceScale('macd').applyOptions({
      visible: false,
      borderVisible: false,
      scaleMargins: {
        top: 0.78,
        bottom: 0.12,
      },
    });

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const rawTime = param.time;
      const point = param.point;
      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;

      if (
        typeof rawTime !== 'number' ||
        !bar ||
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      ) {
        clearHoveredCandle();
        return;
      }

      const matched = candleMapRef.current.get(rawTime);

      setHoveredCandle({
        time: rawTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: matched?.volume ?? 0,
      });
      setHoveredPoint({
        x: point.x,
        y: point.y,
      });
    };

    const onChartClick = (param: MouseEventParams<Time>) => {
      const nextTool = activeToolRef.current;

      if (nextTool === 'horizontal') {
        if (!param.point) return;

        const price = candleSeries.coordinateToPrice(param.point.y);
        if (typeof price !== 'number' || !Number.isFinite(price)) return;

        const normalizedPrice = normalizeLinePrice(price);
        const duplicated = horizontalLinesRef.current.some((item) => Math.abs(item.price - normalizedPrice) < 0.0001);
        if (duplicated) return;
        const beforeSnapshot = captureChartHistorySnapshot();

        const id = createHorizontalLineId();
        const line = candleSeries.createPriceLine({
          price: normalizedPrice,
          color: '#f5a623',
          lineWidth: 1,
          axisLabelVisible: true,
          title: `H ${formatPrice(normalizedPrice)}`,
        });

        horizontalLinesRef.current.push({
          id,
          price: normalizedPrice,
          line,
        });

        const nextHorizontalLines = snapshotHorizontalLines();
        setHorizontalLines(nextHorizontalLines);
        void persistDrawings(
          selectedSymbolRef.current,
          selectedIntervalRef.current,
          nextHorizontalLines,
          snapshotVerticalLines(),
          snapshotTrendlines(),
          snapshotRays(),
          snapshotRectangles(),
          snapshotNotes(),
        );
        recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
        return;
      }

      if (nextTool === 'vertical') {
        if (typeof param.time !== 'number') return;

        const timestamp = Math.floor(param.time) as UTCTimestamp;
        const duplicated = verticalLinesRef.current.some((item) => Number(item.time) === Number(timestamp));
        if (duplicated) return;
        const beforeSnapshot = captureChartHistorySnapshot();

        const nextVerticalLines = [...snapshotVerticalLines(), { id: createVerticalLineId(), time: timestamp }];
        renderVerticalLines(nextVerticalLines);
        void persistDrawings(
          selectedSymbolRef.current,
          selectedIntervalRef.current,
          snapshotHorizontalLines(),
          nextVerticalLines,
          snapshotTrendlines(),
          snapshotRays(),
          snapshotRectangles(),
          snapshotNotes(),
        );
        recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
        return;
      }

      if (nextTool === 'trendline' || nextTool === 'ray' || nextTool === 'rectangle') {
        if (!param.point || typeof param.time !== 'number') return;

        const price = candleSeries.coordinateToPrice(param.point.y);
        if (typeof price !== 'number' || !Number.isFinite(price)) return;

        const timestamp = Math.floor(param.time) as UTCTimestamp;
        const normalizedPrice = normalizeLinePrice(price);
        const pending = pendingShapeStart;

        if (pending?.tool === nextTool) {
          const samePoint =
            Number(pending.time) === Number(timestamp) &&
            Math.abs(pending.price - normalizedPrice) < 0.0001;
          if (samePoint) return;
          const beforeSnapshot = captureChartHistorySnapshot();

          if (nextTool === 'trendline') {
            const nextTrendlines = [
              ...snapshotTrendlines(),
              {
                id: createTrendlineId(),
                startTime: pending.time,
                startPrice: pending.price,
                endTime: timestamp,
                endPrice: normalizedPrice,
              },
            ];
            renderTrendlines(nextTrendlines);
            void persistDrawings(
              selectedSymbolRef.current,
              selectedIntervalRef.current,
              snapshotHorizontalLines(),
              snapshotVerticalLines(),
              nextTrendlines,
              snapshotRays(),
              snapshotRectangles(),
              snapshotNotes(),
            );
          } else if (nextTool === 'ray') {
            const nextRays = [
              ...snapshotRays(),
              {
                id: createRayId(),
                startTime: pending.time,
                startPrice: pending.price,
                endTime: timestamp,
                endPrice: normalizedPrice,
              },
            ];
            renderRays(nextRays);
            void persistDrawings(
              selectedSymbolRef.current,
              selectedIntervalRef.current,
              snapshotHorizontalLines(),
              snapshotVerticalLines(),
              snapshotTrendlines(),
              nextRays,
              snapshotRectangles(),
              snapshotNotes(),
            );
          } else {
            const nextRectangles = [
              ...snapshotRectangles(),
              {
                id: createRectangleId(),
                startTime: pending.time,
                startPrice: pending.price,
                endTime: timestamp,
                endPrice: normalizedPrice,
              },
            ];
            renderRectangles(nextRectangles);
            void persistDrawings(
              selectedSymbolRef.current,
              selectedIntervalRef.current,
              snapshotHorizontalLines(),
              snapshotVerticalLines(),
              snapshotTrendlines(),
              snapshotRays(),
              nextRectangles,
              snapshotNotes(),
            );
          }

          recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
          setPendingShapeStart(null);
          return;
        }

        setPendingShapeStart({
          tool: nextTool,
          time: timestamp,
          price: normalizedPrice,
        });
        return;
      }

      if (nextTool !== 'note') return;
      if (!param.point || typeof param.time !== 'number') return;

      const price = candleSeries.coordinateToPrice(param.point.y);
      if (typeof price !== 'number' || !Number.isFinite(price)) return;

      const textInput = window.prompt('노트 내용을 입력하세요');
      if (textInput === null) return;

      const text = textInput.trim();
      if (!text) return;
      const beforeSnapshot = captureChartHistorySnapshot();

      const timestamp = Math.floor(param.time) as UTCTimestamp;
      const nextNotes = [
        ...snapshotNotes(),
        {
          id: createNoteId(),
          time: timestamp,
          price: normalizeLinePrice(price),
          text,
        },
      ];
      renderNotes(nextNotes);
      void persistDrawings(
        selectedSymbolRef.current,
        selectedIntervalRef.current,
        snapshotHorizontalLines(),
        snapshotVerticalLines(),
        snapshotTrendlines(),
        snapshotRays(),
        snapshotRectangles(),
        nextNotes,
      );
      recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    };

    const onVisibleLogicalRangeChange = (range: LogicalRangeLike) => {
      syncVerticalLinePositions();
      refreshDrawingOverlay();
      if (shouldSkipSyncedRangeEvent(chartRangeSyncStateRef.current, 'primary', range)) {
        return;
      }
      syncVisibleLogicalRange('primary', range);
    };

    chart.subscribeCrosshairMove(onCrosshairMove);
    chart.subscribeClick(onChartClick);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    indicatorSeriesRefs.current = {
      sma20: sma20Series,
      sma60: sma60Series,
      ema20: ema20Series,
      rsi: rsiSeries,
      macd: macdSeries,
      macdSignal: macdSignalSeries,
      bbBasis: bbBasisSeries,
      bbUpper: bbUpperSeries,
      bbLower: bbLowerSeries,
    };
    compareSeriesRef.current = compareSeries;
    setChartReady(true);

    const observer = new ResizeObserver(() => {
      chart.timeScale().fitContent();
      syncVerticalLinePositions();
      refreshDrawingOverlay();
    });
    observer.observe(containerRef.current);

    const verticalLineNodes = verticalLineNodesRef.current;

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.unsubscribeClick(onChartClick);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRefs.current = createIndicatorSeriesRefs();
      compareSeriesRef.current = null;
      horizontalLinesRef.current = [];
      verticalLinesRef.current = [];
      trendlinesRef.current = [];
      raysRef.current = [];
      rectanglesRef.current = [];
      notesRef.current = [];
      for (const node of verticalLineNodes.values()) {
        node.remove();
      }
      verticalLineNodes.clear();
      dragStateRef.current = null;
      dragHistoryStartRef.current = null;
      setHorizontalLines([]);
      setVerticalLines([]);
      setTrendlines([]);
      setRays([]);
      setRectangles([]);
      setNotes([]);
      setIsDraggingDrawing(false);
      setPendingShapeStart(null);
      setSelectedDrawingId(null);
      setChartReady(false);
    };
  }, [
    captureChartHistorySnapshot,
    clearHoveredCandle,
    pendingShapeStart,
    persistDrawings,
    refreshDrawingOverlay,
    recordHistoryTransition,
    renderNotes,
    renderRays,
    renderRectangles,
    renderTrendlines,
    renderVerticalLines,
    snapshotHorizontalLines,
    snapshotNotes,
    snapshotRays,
    snapshotRectangles,
    snapshotTrendlines,
    snapshotVerticalLines,
    syncVisibleLogicalRange,
    syncVerticalLinePositions,
  ]);

  useEffect(() => {
    if (chartLayoutMode !== 'split') return;
    if (!secondaryContainerRef.current) return;

    const chart = createChart(secondaryContainerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#B2B5BE',
        fontFamily: 'Inter, Pretendard, Apple SD Gothic Neo, sans-serif',
      },
      grid: {
        vertLines: { color: '#1F2433' },
        horzLines: { color: '#1F2433' },
      },
      rightPriceScale: {
        borderColor: '#2B2F3A',
      },
      timeScale: {
        borderColor: '#2B2F3A',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#758696', width: 1, style: 3 },
        horzLine: { color: '#758696', width: 1, style: 3 },
      },
      localization: {
        locale: 'ko-KR',
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26A69A',
      downColor: '#EF5350',
      wickUpColor: '#26A69A',
      wickDownColor: '#EF5350',
      borderVisible: false,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
      priceFormat: {
        type: 'volume',
      },
      color: '#2962FF66',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.9,
        bottom: 0,
      },
    });

    const closeSeries = chart.addSeries(LineSeries, {
      color: '#7ba7ff',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const onVisibleLogicalRangeChange = (range: LogicalRangeLike) => {
      if (shouldSkipSyncedRangeEvent(chartRangeSyncStateRef.current, 'secondary', range)) {
        return;
      }
      syncVisibleLogicalRange('secondary', range);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);

    secondaryChartRef.current = chart;
    secondaryCandleSeriesRef.current = candleSeries;
    secondaryVolumeSeriesRef.current = volumeSeries;
    secondaryCloseSeriesRef.current = closeSeries;

    const primaryRange = chartRef.current?.timeScale().getVisibleLogicalRange();
    if (primaryRange) {
      chart.timeScale().setVisibleLogicalRange(primaryRange);
    } else {
      chart.timeScale().fitContent();
    }

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      chart.remove();
      secondaryChartRef.current = null;
      secondaryCandleSeriesRef.current = null;
      secondaryVolumeSeriesRef.current = null;
      secondaryCloseSeriesRef.current = null;
    };
  }, [chartLayoutMode, syncVisibleLogicalRange]);

  useEffect(() => {
    if (!chartReady) return;

    let canceled = false;

    const loadPersistedDrawings = async () => {
      const loaded = await loadDrawings(selectedSymbol, selectedInterval);
      if (canceled) return;
      renderHorizontalLines(loaded.horizontalLines);
      renderVerticalLines(loaded.verticalLines);
      renderTrendlines(loaded.trendlines);
      renderRays(loaded.rays);
      renderRectangles(loaded.rectangles);
      renderNotes(loaded.notes);
      setPendingShapeStart(null);
      setSelectedDrawingId(null);
      dragHistoryStartRef.current = null;
      historyRef.current.clear();
      syncHistoryState();
    };

    void loadPersistedDrawings();

    return () => {
      canceled = true;
    };
  }, [
    chartReady,
    loadDrawings,
    renderHorizontalLines,
    renderNotes,
    renderRays,
    renderRectangles,
    renderTrendlines,
    renderVerticalLines,
    selectedInterval,
    selectedSymbol,
    syncHistoryState,
  ]);

  useEffect(() => {
    let canceled = false;

    const loadCandles = async () => {
      setLoading(true);
      setError(null);
      clearHoveredCandle();

      try {
        const response = await fetch(
          `${apiBase}/api/candles?symbol=${encodeURIComponent(selectedSymbol)}&interval=${encodeURIComponent(selectedInterval)}&limit=500`,
        );

        if (!response.ok) {
          throw new Error('candle fetch failed');
        }

        const data = (await response.json()) as { candles: Candle[] };

        if (!canceled) {
          setCandles(data.candles ?? []);
          clearHoveredCandle();
        }
      } catch {
        if (!canceled) {
          setError('캔들 데이터를 불러오지 못했습니다. 네트워크 또는 API를 확인해주세요.');
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    loadCandles();

    return () => {
      canceled = true;
    };
  }, [clearHoveredCandle, selectedSymbol, selectedInterval]);

  useEffect(() => {
    if (!compareSymbol) {
      setCompareCandles([]);
      setCompareError(null);
      setCompareLoading(false);
      return;
    }

    if (compareSymbol === selectedSymbol) {
      setCompareCandles([]);
      setCompareError('비교 심볼은 현재 심볼과 달라야 합니다.');
      return;
    }

    let canceled = false;

    const loadCompareCandles = async () => {
      setCompareLoading(true);
      setCompareError(null);

      try {
        const response = await fetch(
          `${apiBase}/api/candles?symbol=${encodeURIComponent(compareSymbol)}&interval=${encodeURIComponent(selectedInterval)}&limit=500`,
        );

        if (!response.ok) {
          throw new Error('compare candle fetch failed');
        }

        const data = (await response.json()) as { candles: Candle[] };
        if (!canceled) {
          setCompareCandles(data.candles ?? []);
        }
      } catch {
        if (!canceled) {
          setCompareCandles([]);
          setCompareError('비교 심볼 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (!canceled) {
          setCompareLoading(false);
        }
      }
    };

    void loadCompareCandles();

    return () => {
      canceled = true;
    };
  }, [compareSymbol, selectedInterval, selectedSymbol]);

  const quoteTargetSymbols = useMemo(() => {
    const set = new Set<string>();

    watchlistSymbols.forEach((item) => {
      set.add(item.symbol);
    });

    if (selectedSymbol) {
      set.add(selectedSymbol);
    }

    return [...set].slice(0, 40);
  }, [selectedSymbol, watchlistSymbols]);

  useEffect(() => {
    if (!quoteTargetSymbols.length) return;

    let canceled = false;

    const pullQuotes = async () => {
      try {
        const entries = await Promise.all(
          quoteTargetSymbols.map(async (symbol) => {
            const res = await fetch(`${apiBase}/api/quote?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(symbol);
            const quote = (await res.json()) as Quote;
            return [symbol, quote] as const;
          }),
        );

        if (!canceled) {
          setQuotes((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        }
      } catch {
        if (!canceled) {
          setError((prev) => prev ?? '일부 시세 정보를 업데이트하지 못했습니다.');
        }
      }
    };

    pullQuotes();
    const timer = window.setInterval(pullQuotes, 15000);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [quoteTargetSymbols]);

  useEffect(() => {
    const query = watchQuery.trim();

    if (query.length < 2) {
      setSearchResults([]);
      setActiveSearchIndex(0);
      setSearching(false);
      return;
    }

    let canceled = false;

    const timer = window.setTimeout(async () => {
      setSearching(true);

      try {
        const response = await fetch(
          `${apiBase}/api/search?query=${encodeURIComponent(query)}&market=ALL&limit=30`,
        );

        if (!response.ok) throw new Error('search failed');

        const data = (await response.json()) as { items: SymbolItem[] };

        if (!canceled) {
          setSearchResults(data.items ?? []);
          setActiveSearchIndex(0);
        }
      } catch {
        if (!canceled) {
          setSearchResults([]);
          setActiveSearchIndex(0);
        }
      } finally {
        if (!canceled) {
          setSearching(false);
        }
      }
    }, 250);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [watchQuery]);

  const loadTradingState = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (silent) {
        setTradingRefreshing(true);
      } else {
        setTradingLoading(true);
      }

      try {
        const response = await fetch(`${apiBase}/api/trading/state`);
        if (!response.ok) {
          let payload: unknown;
          try {
            payload = (await response.json()) as unknown;
          } catch {
            payload = undefined;
          }

          throw normalizeApiOperationError({
            fallbackMessage: '트레이딩 상태를 불러오지 못했습니다.',
            status: response.status,
            payload,
          });
        }

        const data = (await response.json()) as TradingState;
        setTradingState(data);
        setTradingLastUpdatedAt(data.updatedAt);
        setTradingError(null);
        setTradingRecovery(null);
        return true;
      } catch (error) {
        const normalized =
          typeof error === 'object' && error !== null && 'retryable' in error
            ? (error as ReturnType<typeof normalizeApiOperationError>)
            : normalizeApiOperationError({
                fallbackMessage: '트레이딩 상태를 불러오지 못했습니다.',
                error,
              });
        setTradingError(normalized.message);
        setTradingRecovery({
          workflow: 'trading',
          message: normalized.message,
          actionKind: 'retry-trading-state',
        });
        reportOpsError({
          source: 'trading',
          code: normalized.code ?? 'TRADING_STATE_FETCH_FAILED',
          message: normalized.message,
          level: normalized.level,
          context: {
            operation: 'loadTradingState',
            retryable: normalized.retryable,
            ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
          },
        });
        return false;
      } finally {
        if (silent) {
          setTradingRefreshing(false);
        } else {
          setTradingLoading(false);
        }
      }
    },
    [reportOpsError],
  );

  const loadAlertRules = useCallback(async () => {
    setAlertsLoading(true);

    try {
      const params = new URLSearchParams();
      const normalizedSymbol = alertRuleSymbolFilter.trim().toUpperCase();

      if (normalizedSymbol) {
        params.set('symbol', normalizedSymbol);
      }
      if (alertRuleIndicatorAwareOnly) {
        params.set('indicatorAwareOnly', 'true');
      }

      const query = params.toString();
      const response = await fetch(`${apiBase}/api/alerts/rules${query ? `?${query}` : ''}`);
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = (await response.json()) as unknown;
        } catch {
          payload = undefined;
        }

        throw normalizeApiOperationError({
          fallbackMessage: '알림 규칙을 불러오지 못했습니다.',
          status: response.status,
          payload,
        });
      }

      const data = (await response.json()) as { rules: AlertRule[] };
      setAlertRules(data.rules ?? []);
      setAlertsRecovery(null);
      return true;
    } catch (error) {
      const normalized =
        typeof error === 'object' && error !== null && 'retryable' in error
          ? (error as ReturnType<typeof normalizeApiOperationError>)
          : normalizeApiOperationError({
              fallbackMessage: '알림 규칙을 불러오지 못했습니다.',
              error,
            });
      setAlertRules([]);
      setAlertMessage(normalized.message);
      setAlertsRecovery({
        workflow: 'alerts',
        message: normalized.message,
        actionKind: 'retry-alerts-refresh',
      });
      reportOpsError({
        source: 'alerts',
        code: normalized.code ?? 'ALERT_RULES_FETCH_FAILED',
        message: normalized.message,
        level: normalized.level,
        context: {
          operation: 'loadAlertRules',
          retryable: normalized.retryable,
          ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
        },
      });
      return false;
    } finally {
      setAlertsLoading(false);
    }
  }, [alertRuleIndicatorAwareOnly, alertRuleSymbolFilter, reportOpsError]);

  const loadAlertHistory = useCallback(async () => {
    setAlertsHistoryLoading(true);

    try {
      const params = new URLSearchParams({ limit: '50' });
      const normalizedSymbol = alertHistorySymbolFilter.trim().toUpperCase();

      if (normalizedSymbol) {
        params.set('symbol', normalizedSymbol);
      }

      if (alertHistorySourceFilter !== 'all') {
        params.set('source', alertHistorySourceFilter);
      }
      if (alertHistoryIndicatorAwareOnly) {
        params.set('indicatorAwareOnly', 'true');
      }

      const response = await fetch(`${apiBase}/api/alerts/history?${params.toString()}`);
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = (await response.json()) as unknown;
        } catch {
          payload = undefined;
        }

        throw normalizeApiOperationError({
          fallbackMessage: '알림 히스토리를 불러오지 못했습니다.',
          status: response.status,
          payload,
        });
      }

      const data = (await response.json()) as { events?: AlertHistoryEvent[] };
      setAlertHistoryEvents(data.events ?? []);
      return true;
    } catch (error) {
      const normalized =
        typeof error === 'object' && error !== null && 'retryable' in error
          ? (error as ReturnType<typeof normalizeApiOperationError>)
          : normalizeApiOperationError({
              fallbackMessage: '알림 히스토리를 불러오지 못했습니다.',
              error,
            });
      setAlertHistoryEvents([]);
      setAlertMessage((prev) => prev ?? normalized.message);
      setAlertsRecovery({
        workflow: 'alerts',
        message: normalized.message,
        actionKind: 'retry-alerts-refresh',
      });
      reportOpsError({
        source: 'alerts',
        code: normalized.code ?? 'ALERT_HISTORY_FETCH_FAILED',
        message: normalized.message,
        level: normalized.level,
        context: {
          operation: 'loadAlertHistory',
          retryable: normalized.retryable,
          ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
        },
      });
      return false;
    } finally {
      setAlertsHistoryLoading(false);
    }
  }, [alertHistoryIndicatorAwareOnly, alertHistorySourceFilter, alertHistorySymbolFilter, reportOpsError]);

  useEffect(() => {
    setAlertMessage(null);
    void loadAlertRules();
  }, [loadAlertRules]);

  useEffect(() => {
    if (watchTab !== 'alerts') return;
    void loadAlertHistory();
  }, [loadAlertHistory, watchTab]);

  useEffect(() => {
    if (bottomTab !== 'trading') return;
    void loadTradingState({ silent: hasTradingState });
  }, [bottomTab, hasTradingState, loadTradingState]);

  useEffect(() => {
    candleMapRef.current = new Map(activeCandles.map((candle) => [candle.time, candle]));
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;
    const secondaryCandleSeries = secondaryCandleSeriesRef.current;
    const secondaryVolumeSeries = secondaryVolumeSeriesRef.current;
    const secondaryCloseSeries = secondaryCloseSeriesRef.current;

    if (!activeCandles.length) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      if (secondaryCandleSeries && secondaryVolumeSeries && secondaryCloseSeries) {
        secondaryCandleSeries.setData([]);
        secondaryVolumeSeries.setData([]);
        secondaryCloseSeries.setData([]);
      }
      chartRef.current.timeScale().fitContent();
      syncVerticalLinePositions();
      refreshDrawingOverlay();
      return;
    }

    const candleData: CandlestickData[] = activeCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const volumeData: HistogramData[] = activeCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? '#26A69A66' : '#EF535066',
    }));
    const closeLineData: LineData[] = activeCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.close,
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    if (secondaryCandleSeries && secondaryVolumeSeries && secondaryCloseSeries) {
      secondaryCandleSeries.setData(candleData);
      secondaryVolumeSeries.setData(volumeData);
      secondaryCloseSeries.setData(closeLineData);
    }
    chartRef.current.timeScale().fitContent();
    syncVerticalLinePositions();
    refreshDrawingOverlay();
  }, [activeCandles, chartLayoutMode, refreshDrawingOverlay, syncVerticalLinePositions]);

  useEffect(() => {
    const seriesMap = indicatorSeriesRefs.current;
    const closeValues = activeCandles.map((candle) => candle.close);

    const clearSeries = (key: IndicatorSeriesKey) => {
      const series = seriesMap[key];
      if (!series) return;
      series.setData([]);
    };

    const setSeriesValues = (key: IndicatorSeriesKey, values: Array<number | null>) => {
      const series = seriesMap[key];
      if (!series) return;

      const points: LineData[] = toTimeValuePoints(activeCandles, values).map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      }));

      series.setData(points);
    };

    if (closeValues.length === 0) {
      for (const key of Object.keys(seriesMap) as IndicatorSeriesKey[]) {
        clearSeries(key);
      }
      return;
    }

    if (enabledIndicators.sma20) {
      setSeriesValues('sma20', calculateSMA(closeValues, 20));
    } else {
      clearSeries('sma20');
    }

    if (enabledIndicators.sma60) {
      setSeriesValues('sma60', calculateSMA(closeValues, 60));
    } else {
      clearSeries('sma60');
    }

    if (enabledIndicators.ema20) {
      setSeriesValues('ema20', calculateEMA(closeValues, 20));
    } else {
      clearSeries('ema20');
    }

    if (enabledIndicators.rsi) {
      setSeriesValues('rsi', calculateRSI(closeValues, indicatorSettings.rsi.period));
    } else {
      clearSeries('rsi');
    }

    if (enabledIndicators.macd) {
      const macd = calculateMACD(
        closeValues,
        indicatorSettings.macd.fast,
        indicatorSettings.macd.slow,
        indicatorSettings.macd.signal,
      );
      setSeriesValues('macd', macd.macdLine);
      setSeriesValues('macdSignal', macd.signalLine);
    } else {
      clearSeries('macd');
      clearSeries('macdSignal');
    }

    if (enabledIndicators.bbands) {
      const bollinger = calculateBollingerBands(
        closeValues,
        indicatorSettings.bollinger.period,
        indicatorSettings.bollinger.stdDev,
      );
      setSeriesValues('bbBasis', bollinger.basis);
      setSeriesValues('bbUpper', bollinger.upper);
      setSeriesValues('bbLower', bollinger.lower);
    } else {
      clearSeries('bbBasis');
      clearSeries('bbUpper');
      clearSeries('bbLower');
    }
  }, [activeCandles, enabledIndicators, indicatorSettings]);

  const normalizedComparePoints = useMemo(() => {
    if (!compareSymbol || compareLoading || compareError) return [];
    return normalizeCompareOverlay(activeCandles, compareCandles);
  }, [activeCandles, compareCandles, compareError, compareLoading, compareSymbol]);

  useEffect(() => {
    const series = compareSeriesRef.current;
    if (!series) return;

    if (!compareSymbol || compareLoading || compareError || normalizedComparePoints.length === 0) {
      series.setData([]);
      return;
    }

    const points: LineData[] = normalizedComparePoints.map((point) => ({
      time: point.time as UTCTimestamp,
      value: point.value,
    }));

    series.setData(points);
  }, [compareError, compareLoading, compareSymbol, normalizedComparePoints]);

  const selectedQuote = quotes[selectedSymbol];
  const selectedTradingPosition = useMemo(
    () => tradingState?.positions.find((position) => position.symbol === selectedSymbol) ?? null,
    [selectedSymbol, tradingState],
  );
  const tradingEstimatedNotional = useMemo(() => {
    const qtyInput = tradingOrderForm.qty.trim();
    const notionalInput = tradingOrderForm.notional.trim();

    if (qtyInput && selectedQuote) {
      const qty = Number(qtyInput);
      if (Number.isFinite(qty) && qty > 0) {
        return qty * selectedQuote.lastPrice;
      }
    }

    if (notionalInput) {
      const notional = Number(notionalInput);
      if (Number.isFinite(notional) && notional > 0) {
        return notional;
      }
    }

    return null;
  }, [selectedQuote, tradingOrderForm.notional, tradingOrderForm.qty]);
  const tradingUpdatedAt = tradingState?.updatedAt ?? tradingLastUpdatedAt;
  const latestCandle = activeCandles.at(-1) ?? null;
  const displayCandle = hoveredCandle ?? latestCandle;
  const hoveredCandleDiff = hoveredCandle ? hoveredCandle.close - hoveredCandle.open : 0;
  const hoveredCandleDiffPercent =
    hoveredCandle && hoveredCandle.open !== 0 ? ((hoveredCandle.close - hoveredCandle.open) / hoveredCandle.open) * 100 : 0;
  const hoverTooltipStyle = useMemo(() => {
    if (!hoveredPoint) return null;

    const chartWidth = containerRef.current?.clientWidth ?? 0;
    const chartHeight = containerRef.current?.clientHeight ?? 0;
    let left = hoveredPoint.x + HOVER_TOOLTIP_MARGIN;
    let top = hoveredPoint.y + HOVER_TOOLTIP_MARGIN;

    if (chartWidth > 0 && left + HOVER_TOOLTIP_WIDTH > chartWidth - 6) {
      left = hoveredPoint.x - HOVER_TOOLTIP_WIDTH - HOVER_TOOLTIP_MARGIN;
    }

    if (chartHeight > 0 && top + HOVER_TOOLTIP_HEIGHT > chartHeight - 6) {
      top = chartHeight - HOVER_TOOLTIP_HEIGHT - 6;
    }

    left = Math.max(6, left);
    top = Math.max(6, top);

    return { left, top };
  }, [hoveredPoint]);
  const watchlistAlertSymbols = useMemo(
    () =>
      [...new Set(watchlistSymbols.map((item) => item.symbol.trim().toUpperCase()).filter((symbol) => symbol.length > 0))].slice(
        0,
        40,
      ),
    [watchlistSymbols],
  );

  const selectedSymbolMeta = useMemo(
    () => watchlistSymbols.find((item) => item.symbol === selectedSymbol) ?? searchResults.find((item) => item.symbol === selectedSymbol),
    [searchResults, selectedSymbol, watchlistSymbols],
  );
  const selectedMarket = selectedSymbolMeta?.market ?? 'CRYPTO';

  useEffect(() => {
    let canceled = false;

    const loadMarketStatus = async () => {
      setMarketStatusError(null);

      try {
        const response = await fetch(
          `${apiBase}/api/market-status?market=${encodeURIComponent(selectedMarket)}`,
        );
        if (!response.ok) throw new Error('market status fetch failed');

        const data = (await response.json()) as MarketStatus;
        if (!canceled) {
          setMarketStatus(data);
        }
      } catch {
        if (!canceled) {
          setMarketStatus(null);
          setMarketStatusError('시장 상태 확인 실패');
        }
      }
    };

    void loadMarketStatus();

    return () => {
      canceled = true;
    };
  }, [selectedMarket, selectedSymbol]);

  const watchlist = useMemo(
    () =>
      watchlistSymbols.map((item) => {
        const quote = quotes[item.symbol];
        const hasQuote = quote && Number.isFinite(quote.lastPrice) && Number.isFinite(quote.changePercent);
        const previousClose = hasQuote ? quote.lastPrice / (1 + quote.changePercent / 100) : undefined;
        const changeValue = hasQuote && previousClose ? quote.lastPrice - previousClose : undefined;

        return {
          ...item,
          lastPrice: quote?.lastPrice,
          changePercent: quote?.changePercent,
          changeValue,
        };
      }),
    [watchlistSymbols, quotes],
  );

  const filteredWatchlist = useMemo(() => {
    const normalized = watchQuery.toLowerCase().trim();

    let result = watchlist.filter((item) => {
      const haystack = `${item.symbol} ${item.name} ${item.code ?? ''}`.toLowerCase();
      return normalized ? haystack.includes(normalized) : true;
    });

    if (watchMarketFilter !== 'ALL') {
      result = result.filter((item) => item.market === watchMarketFilter);
    }

    const direction = watchSortDir === 'asc' ? 1 : -1;

    result = [...result].sort((a, b) => {
      if (watchSortKey === 'symbol') {
        const aCode = getDisplayCode(a);
        const bCode = getDisplayCode(b);
        return aCode.localeCompare(bCode) * direction;
      }

      if (watchSortKey === 'price') {
        const aValue = a.lastPrice ?? Number.NEGATIVE_INFINITY;
        const bValue = b.lastPrice ?? Number.NEGATIVE_INFINITY;
        return (aValue - bValue) * direction;
      }

      const aValue = a.changePercent ?? Number.NEGATIVE_INFINITY;
      const bValue = b.changePercent ?? Number.NEGATIVE_INFINITY;
      return (aValue - bValue) * direction;
    });

    return result;
  }, [watchMarketFilter, watchQuery, watchSortDir, watchSortKey, watchlist]);

  const filteredSearchResults = useMemo(
    () =>
      searchResults.filter(
        (item) => !watchlistSymbols.some((watchItem) => watchItem.symbol === item.symbol),
      ),
    [searchResults, watchlistSymbols],
  );

  useEffect(() => {
    if (!filteredSearchResults.length) {
      setActiveSearchIndex(0);
      return;
    }

    setActiveSearchIndex((prev) => Math.min(prev, filteredSearchResults.length - 1));
  }, [filteredSearchResults]);

  const priceDiff = displayCandle ? displayCandle.close - displayCandle.open : 0;
  const priceDiffPercent =
    displayCandle && displayCandle.open !== 0 ? ((displayCandle.close - displayCandle.open) / displayCandle.open) * 100 : 0;
  const marketStatusBadgeText = marketStatus?.status === 'OPEN' ? '장중' : marketStatus?.status === 'CLOSED' ? '휴장' : '상태확인';
  const marketStatusBadgeClass = marketStatus?.status === 'OPEN' ? 'open' : marketStatus?.status === 'CLOSED' ? 'closed' : 'pending';
  const marketStatusHint = marketStatus
    ? `${formatMarketStatusReason(marketStatus.reason)} · ${marketStatus.session.text} · ${marketStatus.timezone}`
    : marketStatusError ?? '시장 상태 확인 중...';
  const alertBadgeCount = alertTriggeredEvents.length;

  const markRecentAlertEvents = useCallback((events: AlertCheckEvent[]) => {
    if (!events.length) return;

    const now = Date.now();
    const byRule = recentAlertEventByRuleRef.current;

    for (const eventItem of events) {
      byRule.set(eventItem.ruleId, Number.isFinite(eventItem.triggeredAt) ? eventItem.triggeredAt : now);
    }
  }, []);

  const appendWatchlistAlertEvents = useCallback((events: AlertCheckEvent[]) => {
    if (!events.length) return;

    setAlertTriggeredEvents((previous) => {
      const now = Date.now();
      const byRule = recentAlertEventByRuleRef.current;

      for (const [ruleId, seenAt] of byRule.entries()) {
        if (now - seenAt > ALERT_EVENT_DEDUP_WINDOW_MS) {
          byRule.delete(ruleId);
        }
      }

      const accepted: AlertCheckEvent[] = [];

      for (const eventItem of events) {
        const eventAt = Number.isFinite(eventItem.triggeredAt) ? eventItem.triggeredAt : now;
        const lastSeenAt = byRule.get(eventItem.ruleId);

        if (typeof lastSeenAt === 'number' && Math.abs(eventAt - lastSeenAt) < ALERT_EVENT_DEDUP_WINDOW_MS) {
          continue;
        }

        byRule.set(eventItem.ruleId, eventAt);
        accepted.push(eventItem);
      }

      if (!accepted.length) {
        return previous.slice(0, ALERT_EVENT_MAX_ITEMS);
      }

      return [...accepted, ...previous]
        .sort((a, b) => b.triggeredAt - a.triggeredAt)
        .slice(0, ALERT_EVENT_MAX_ITEMS);
    });
  }, []);

  const runWatchlistAlertCheck = useCallback(
    async (source: 'manual' | 'auto') => {
      if (!watchlistAlertSymbols.length) {
        if (source === 'manual') {
          setAlertMessage('관심종목에 등록된 심볼이 없습니다.');
        }
        return false;
      }

      if (watchlistAlertCheckInFlightRef.current) return false;

      watchlistAlertCheckInFlightRef.current = true;
      if (source === 'manual') {
        setAlertsRecovery(null);
      }
      if (source === 'manual') {
        setAlertsWatchlistChecking(true);
      }

      try {
        const response = await fetch(`${apiBase}/api/alerts/check-watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols: watchlistAlertSymbols,
            ...(alertRuleIndicatorAwareOnly ? { indicatorAwareOnly: true } : {}),
          }),
        });
        if (!response.ok) {
          let payload: unknown;
          try {
            payload = (await response.json()) as unknown;
          } catch {
            payload = undefined;
          }

          throw normalizeApiOperationError({
            fallbackMessage:
              source === 'manual'
                ? '관심종목 알림 체크에 실패했습니다.'
                : '관심종목 자동 체크에 실패했습니다.',
            status: response.status,
            payload,
          });
        }

        const data = (await response.json()) as {
          checkedAt: number;
          checkedSymbols: string[];
          events: AlertCheckEvent[];
        };
        const events = data.events ?? [];

        appendWatchlistAlertEvents(events);
        setAlertLastCheckedAt(data.checkedAt ?? Date.now());
        if (source === 'manual') {
          setAlertMessage(`관심종목 체크 완료: ${data.checkedSymbols.length}개 심볼, ${events.length}개 트리거`);
        } else if (events.length > 0) {
          setAlertMessage(`자동 체크 트리거 ${events.length}건`);
        }
        setAlertsRecovery(null);
        await loadAlertRules();
        await loadAlertHistory();
        return true;
      } catch (error) {
        const normalized =
          typeof error === 'object' && error !== null && 'retryable' in error
            ? (error as ReturnType<typeof normalizeApiOperationError>)
            : normalizeApiOperationError({
                fallbackMessage:
                  source === 'manual'
                    ? '관심종목 알림 체크에 실패했습니다.'
                    : '관심종목 자동 체크에 실패했습니다.',
                error,
              });
        setAlertMessage(normalized.message);
        setAlertsRecovery({
          workflow: 'alerts',
          message: normalized.message,
          actionKind: 'retry-alerts-refresh',
        });
        reportOpsError({
          source: 'alerts',
          code: normalized.code ?? 'ALERT_WATCHLIST_CHECK_FAILED',
          message: normalized.message,
          level: normalized.level,
          context: {
            operation: 'runWatchlistAlertCheck',
            mode: source,
            symbolCount: watchlistAlertSymbols.length,
            retryable: normalized.retryable,
            ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
          },
        });
        return false;
      } finally {
        if (source === 'manual') {
          setAlertsWatchlistChecking(false);
        }
        watchlistAlertCheckInFlightRef.current = false;
      }
    },
    [
      alertRuleIndicatorAwareOnly,
      appendWatchlistAlertEvents,
      loadAlertHistory,
      loadAlertRules,
      reportOpsError,
      watchlistAlertSymbols,
    ],
  );

  useEffect(() => {
    if (!alertsAutoCheckEnabled) return;
    if (!watchlistAlertSymbols.length) return;

    let canceled = false;

    const run = async () => {
      if (canceled) return;
      await runWatchlistAlertCheck('auto');
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, alertsAutoCheckIntervalSec * 1000);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [alertsAutoCheckEnabled, alertsAutoCheckIntervalSec, runWatchlistAlertCheck, watchlistAlertSymbols.length]);

  const toggleWatchSort = (key: WatchSortKey) => {
    if (watchSortKey === key) {
      setWatchSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setWatchSortKey(key);
    setWatchSortDir(key === 'symbol' ? 'asc' : 'desc');
  };

  const handlePickSymbol = useCallback(
    async (item: SymbolItem) => {
      const symbol = item.symbol.toUpperCase();
      const nextItem = symbol === item.symbol ? item : { ...item, symbol };
      const alreadyAdded = watchlistSymbols.some((saved) => saved.symbol === nextItem.symbol);
      const nextWatchlist = alreadyAdded ? watchlistSymbols : [nextItem, ...watchlistSymbols].slice(0, 40);

      if (!alreadyAdded) {
        setWatchlistSymbols(nextWatchlist);
      }

      setSelectedSymbol(nextItem.symbol);
      setWatchQuery('');
      setSearchResults([]);
      setActiveSearchIndex(0);

      if (alreadyAdded) {
        return;
      }

      try {
        const persistedItems = await persistWatchlist(nextWatchlist);
        setWatchlistSymbols(persistedItems);
      } catch {
        setError((prev) => prev ?? '관심종목 저장에 실패했습니다.');
      }
    },
    [persistWatchlist, watchlistSymbols],
  );

  const handleRemoveWatchSymbol = useCallback(
    async (symbolToRemove: string) => {
      const index = watchlistSymbols.findIndex((item) => item.symbol === symbolToRemove);
      if (index < 0) return;

      const nextWatchlist = watchlistSymbols.filter((item) => item.symbol !== symbolToRemove);
      const selectedIsRemoved = selectedSymbol === symbolToRemove;
      const nextSelected = selectedIsRemoved
        ? nextWatchlist[index]?.symbol ?? nextWatchlist[index - 1]?.symbol ?? nextWatchlist[0]?.symbol ?? 'BTCUSDT'
        : selectedSymbol;

      setWatchlistSymbols(nextWatchlist);
      if (selectedIsRemoved) {
        setSelectedSymbol(nextSelected);
      }

      try {
        const persistedItems = await persistWatchlist(nextWatchlist);
        setWatchlistSymbols(persistedItems);

        if (selectedIsRemoved && !persistedItems.some((item) => item.symbol === nextSelected)) {
          setSelectedSymbol(persistedItems[0]?.symbol ?? nextSelected);
        }
      } catch {
        setError((prev) => prev ?? '관심종목 저장에 실패했습니다.');
      }
    },
    [persistWatchlist, selectedSymbol, watchlistSymbols],
  );

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!filteredSearchResults.length) {
      if (event.key === 'Escape') {
        setWatchQuery('');
        setSearchResults([]);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSearchIndex((prev) => Math.min(prev + 1, filteredSearchResults.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSearchIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = filteredSearchResults[activeSearchIndex];
      if (picked) {
        handlePickSymbol(picked);
      }
      return;
    }

    if (event.key === 'Escape') {
      setWatchQuery('');
      setSearchResults([]);
    }
  };

  const updateStrategyField = useCallback((field: StrategyFormField, value: string) => {
    setStrategyError(null);
    setStrategyForm((previous) => ({
      ...previous,
      [field]: field === 'symbol' || field === 'interval' ? value.toUpperCase() : value,
    }));
  }, []);

  const applyCurrentChartToStrategy = useCallback(() => {
    setStrategyError(null);
    setStrategyForm((previous) => ({
      ...previous,
      symbol: selectedSymbol,
      interval: selectedInterval,
    }));
  }, [selectedInterval, selectedSymbol]);

  const runStrategyBacktest = useCallback(async () => {
    const symbol = strategyForm.symbol.trim().toUpperCase();
    const interval = strategyForm.interval.trim().toUpperCase();
    const limit = Number.parseInt(strategyForm.limit, 10);
    const initialCapital = Number(strategyForm.initialCapital);
    const feeBps = Number(strategyForm.feeBps);
    const fixedPercent = Number(strategyForm.fixedPercent);
    const fastPeriod = Number.parseInt(strategyForm.fastPeriod, 10);
    const slowPeriod = Number.parseInt(strategyForm.slowPeriod, 10);
    setStrategyRecovery(null);

    if (!symbol || !interval) {
      setStrategyError('심볼과 주기를 입력해주세요.');
      return false;
    }
    if (!Number.isInteger(limit) || limit < 50 || limit > 1000) {
      setStrategyError('캔들 개수는 50~1000 사이 정수여야 합니다.');
      return false;
    }
    if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
      setStrategyError('초기 자본은 0보다 커야 합니다.');
      return false;
    }
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 2000) {
      setStrategyError('수수료(bps)는 0~2000 범위여야 합니다.');
      return false;
    }
    if (!Number.isFinite(fixedPercent) || fixedPercent <= 0 || fixedPercent > 100) {
      setStrategyError('포지션 크기(%)는 0 초과 100 이하로 입력해주세요.');
      return false;
    }
    if (!Number.isInteger(fastPeriod) || fastPeriod < 2 || fastPeriod > 300) {
      setStrategyError('빠른 이동평균 기간은 2~300 정수여야 합니다.');
      return false;
    }
    if (!Number.isInteger(slowPeriod) || slowPeriod < 3 || slowPeriod > 600) {
      setStrategyError('느린 이동평균 기간은 3~600 정수여야 합니다.');
      return false;
    }
    if (fastPeriod >= slowPeriod) {
      setStrategyError('빠른 이동평균 기간은 느린 기간보다 작아야 합니다.');
      return false;
    }

    setStrategyLoading(true);
    setStrategyError(null);
    setStrategyRecovery(null);

    try {
      const response = await fetch(`${apiBase}/api/strategy/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          limit,
          params: {
            initialCapital,
            feeBps,
            positionSizeMode: 'fixed-percent',
            fixedPercent,
          },
          strategy: {
            type: 'maCrossover',
            fastPeriod,
            slowPeriod,
          },
        }),
      });

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = (await response.json()) as unknown;
        } catch {
          payload = undefined;
        }

        throw normalizeApiOperationError({
          fallbackMessage: '전략 백테스트 실행에 실패했습니다.',
          status: response.status,
          payload,
        });
      }

      const data = (await response.json()) as StrategyBacktestResult;
      setStrategyResult(data);
      return true;
    } catch (error) {
      const normalized =
        typeof error === 'object' && error !== null && 'retryable' in error
          ? (error as ReturnType<typeof normalizeApiOperationError>)
          : normalizeApiOperationError({
              fallbackMessage: '전략 백테스트 실행에 실패했습니다.',
              error,
            });
      setStrategyError(normalized.message);
      setStrategyRecovery({
        workflow: 'strategy',
        message: normalized.message,
        actionKind: 'retry-backtest',
      });
      reportOpsError({
        source: 'strategy',
        code: normalized.code ?? 'STRATEGY_BACKTEST_FAILED',
        message: normalized.message,
        level: normalized.level,
        context: {
          operation: 'runStrategyBacktest',
          symbol,
          interval,
          retryable: normalized.retryable,
          ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
        },
      });
      return false;
    } finally {
      setStrategyLoading(false);
    }
  }, [reportOpsError, strategyForm]);

  const handleRunStrategyBacktest = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runStrategyBacktest();
  }, [runStrategyBacktest]);

  const handleRefreshTradingState = useCallback(() => {
    void loadTradingState({ silent: hasTradingState });
  }, [hasTradingState, loadTradingState]);

  const handleSubmitTradingOrder = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTradingRecovery(null);

      const qtyInput = tradingOrderForm.qty.trim();
      const notionalInput = tradingOrderForm.notional.trim();
      const qty = qtyInput.length > 0 ? Number(qtyInput) : null;
      const notional = notionalInput.length > 0 ? Number(notionalInput) : null;

      if (qty === null && notional === null) {
        setTradingFormError('수량 또는 금액 중 하나를 입력해주세요.');
        return;
      }

      if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
        setTradingFormError('수량은 0보다 큰 숫자여야 합니다.');
        return;
      }

      if (notional !== null && (!Number.isFinite(notional) || notional <= 0)) {
        setTradingFormError('금액은 0보다 큰 숫자여야 합니다.');
        return;
      }

      setTradingSubmitting(true);
      setTradingFormError(null);
      setTradingRecovery(null);

      try {
        const payload: {
          symbol: string;
          side: TradingOrderSide;
          qty?: number;
          notional?: number;
        } = {
          symbol: selectedSymbol,
          side: tradingOrderForm.side,
        };

        if (qty !== null) {
          payload.qty = qty;
        }

        if (notional !== null) {
          payload.notional = notional;
        }

        const response = await fetch(`${apiBase}/api/trading/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          let errorPayload: unknown;
          try {
            errorPayload = (await response.json()) as unknown;
          } catch {
            errorPayload = undefined;
          }

          throw normalizeApiOperationError({
            fallbackMessage: '주문 전송에 실패했습니다.',
            status: response.status,
            payload: errorPayload,
          });
        }

        const data = (await response.json()) as { state?: TradingState };
        if (data.state) {
          setTradingState(data.state);
          setTradingLastUpdatedAt(data.state.updatedAt);
          setTradingError(null);
        } else {
          await loadTradingState({ silent: true });
        }

        setTradingOrderForm((previous) => ({
          ...previous,
          qty: '',
          notional: '',
        }));
      } catch (error) {
        const normalized =
          typeof error === 'object' && error !== null && 'retryable' in error
            ? (error as ReturnType<typeof normalizeApiOperationError>)
            : normalizeApiOperationError({
                fallbackMessage: '주문 전송에 실패했습니다.',
                error,
              });
        setTradingFormError(normalized.message);
        setTradingRecovery({
          workflow: 'trading',
          message: normalized.message,
          actionKind: 'retry-trading-state',
        });
        reportOpsError({
          source: 'trading',
          code: normalized.code ?? 'TRADING_ORDER_SUBMIT_FAILED',
          message: normalized.message,
          level: normalized.level,
          context: {
            operation: 'submitTradingOrder',
            symbol: selectedSymbol,
            side: tradingOrderForm.side,
            retryable: normalized.retryable,
            ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
          },
        });
      } finally {
        setTradingSubmitting(false);
      }
    },
    [loadTradingState, reportOpsError, selectedSymbol, tradingOrderForm],
  );

  const handleCreateAlertRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlertsRecovery(null);

    const threshold = Number(alertThresholdInput);
    if (!Number.isFinite(threshold)) {
      setAlertMessage('기준값을 숫자로 입력해주세요.');
      return;
    }

    const cooldownSec = Number.parseInt(alertCooldownInput, 10);
    if (!Number.isInteger(cooldownSec) || cooldownSec < 0) {
      setAlertMessage('쿨다운은 0 이상의 정수여야 합니다.');
      return;
    }

    let indicatorConditions: AlertIndicatorCondition[] | undefined;
    if (alertIndicatorEnabled) {
      if (alertIndicatorType === 'rsiThreshold') {
        const rsiThreshold = Number(alertRsiThresholdInput);
        if (!Number.isFinite(rsiThreshold) || rsiThreshold < 0 || rsiThreshold > 100) {
          setAlertMessage('RSI 기준값은 0~100 사이 숫자여야 합니다.');
          return;
        }

        indicatorConditions = [
          {
            type: 'rsiThreshold',
            operator: alertRsiOperator,
            threshold: rsiThreshold,
          },
        ];
      } else if (alertIndicatorType === 'macdCrossSignal') {
        indicatorConditions = [
          {
            type: 'macdCrossSignal',
            signal: alertMacdCrossSignal,
          },
        ];
      } else if (alertIndicatorType === 'macdHistogramSign') {
        indicatorConditions = [
          {
            type: 'macdHistogramSign',
            sign: alertMacdHistogramSign,
          },
        ];
      } else {
        indicatorConditions = [
          {
            type: 'bollingerBandPosition',
            position: alertBollingerPosition,
          },
        ];
      }
    }

    setAlertsSubmitting(true);

    try {
      const response = await fetch(`${apiBase}/api/alerts/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          metric: alertMetric,
          operator: alertOperator,
          threshold,
          cooldownSec,
          ...(indicatorConditions ? { indicatorConditions } : {}),
        }),
      });

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = (await response.json()) as unknown;
        } catch {
          payload = undefined;
        }

        throw normalizeApiOperationError({
          fallbackMessage: '알림 규칙 생성에 실패했습니다.',
          status: response.status,
          payload,
        });
      }

      setAlertThresholdInput('');
      setAlertMessage('알림 규칙이 추가되었습니다.');
      setAlertsRecovery(null);
      await loadAlertRules();
    } catch (error) {
      const normalized =
        typeof error === 'object' && error !== null && 'retryable' in error
          ? (error as ReturnType<typeof normalizeApiOperationError>)
          : normalizeApiOperationError({
              fallbackMessage: '알림 규칙 생성에 실패했습니다.',
              error,
            });
      setAlertMessage(normalized.message);
      setAlertsRecovery({
        workflow: 'alerts',
        message: normalized.message,
        actionKind: 'retry-alerts-refresh',
      });
      reportOpsError({
        source: 'alerts',
        code: normalized.code ?? 'ALERT_RULE_CREATE_FAILED',
        message: normalized.message,
        level: normalized.level,
        context: {
          operation: 'handleCreateAlertRule',
          symbol: selectedSymbol,
          retryable: normalized.retryable,
          ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
        },
      });
    } finally {
      setAlertsSubmitting(false);
    }
  };

  const handleDeleteAlertRule = async (ruleId: string) => {
    try {
      const response = await fetch(`${apiBase}/api/alerts/rules/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('delete alert rule failed');

      setAlertMessage('알림 규칙을 삭제했습니다.');
      setAlertRules((prev) => prev.filter((rule) => rule.id !== ruleId));
      setAlertTriggeredEvents((prev) => prev.filter((eventItem) => eventItem.ruleId !== ruleId));
      recentAlertEventByRuleRef.current.delete(ruleId);
    } catch {
      setAlertMessage('알림 규칙 삭제에 실패했습니다.');
    }
  };

  const handleCheckAlerts = async () => {
    setAlertsChecking(true);
    setAlertsRecovery(null);

    try {
      const body: {
        symbol: string;
        values?: { symbol: string; lastPrice: number; changePercent: number };
        indicatorAwareOnly?: boolean;
      } = {
        symbol: selectedSymbol,
      };

      if (alertRuleIndicatorAwareOnly) {
        body.indicatorAwareOnly = true;
      }

      if (selectedQuote) {
        body.values = {
          symbol: selectedSymbol,
          lastPrice: selectedQuote.lastPrice,
          changePercent: selectedQuote.changePercent,
        };
      }

      const response = await fetch(`${apiBase}/api/alerts/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = (await response.json()) as unknown;
        } catch {
          payload = undefined;
        }

        throw normalizeApiOperationError({
          fallbackMessage: '알림 체크에 실패했습니다.',
          status: response.status,
          payload,
        });
      }

      const data = (await response.json()) as {
        evaluatedAt: number;
        checkedRuleCount: number;
        triggeredCount: number;
        suppressedByCooldown: number;
        triggered: AlertCheckEvent[];
      };

      const triggered = data.triggered ?? [];
      setAlertTriggeredEvents(triggered);
      markRecentAlertEvents(triggered);
      setAlertLastCheckedAt(data.evaluatedAt ?? Date.now());
      setAlertMessage(
        `체크 완료: ${data.checkedRuleCount}개 규칙, ${data.triggeredCount}개 트리거, 쿨다운 억제 ${data.suppressedByCooldown}개`,
      );
      setAlertsRecovery(null);
      await loadAlertRules();
      await loadAlertHistory();
      return true;
    } catch (error) {
      const normalized =
        typeof error === 'object' && error !== null && 'retryable' in error
          ? (error as ReturnType<typeof normalizeApiOperationError>)
          : normalizeApiOperationError({
              fallbackMessage: '알림 체크에 실패했습니다.',
              error,
            });
      setAlertMessage(normalized.message);
      setAlertsRecovery({
        workflow: 'alerts',
        message: normalized.message,
        actionKind: 'retry-alerts-refresh',
      });
      reportOpsError({
        source: 'alerts',
        code: normalized.code ?? 'ALERT_CHECK_FAILED',
        message: normalized.message,
        level: normalized.level,
        context: {
          operation: 'handleCheckAlerts',
          symbol: selectedSymbol,
          retryable: normalized.retryable,
          ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
        },
      });
      return false;
    } finally {
      setAlertsChecking(false);
    }
  };

  const handleCheckWatchlistAlerts = () => {
    void runWatchlistAlertCheck('manual');
  };

  const handleClearAlertHistory = async () => {
    setAlertsHistoryClearing(true);

    try {
      const response = await fetch(`${apiBase}/api/alerts/history`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('clear alert history failed');

      setAlertHistoryEvents([]);
      setAlertMessage('알림 히스토리를 비웠습니다.');
    } catch {
      setAlertMessage('알림 히스토리 비우기에 실패했습니다.');
    } finally {
      setAlertsHistoryClearing(false);
    }
  };

  const handleRetryStrategyBacktest = useCallback(async () => {
    reportOpsRecovery({
      source: 'strategy',
      action: 'retry_backtest',
      status: 'attempted',
      context: {
        workflow: 'strategy',
      },
    });

    const ok = await runStrategyBacktest();

    reportOpsRecovery({
      source: 'strategy',
      action: 'retry_backtest',
      status: ok ? 'succeeded' : 'failed',
      ...(ok ? {} : { errorCode: 'STRATEGY_BACKTEST_RETRY_FAILED' }),
      context: {
        workflow: 'strategy',
      },
    });
  }, [reportOpsRecovery, runStrategyBacktest]);

  const handleRetryTradingState = useCallback(async () => {
    reportOpsRecovery({
      source: 'trading',
      action: 'retry_load_trading_state',
      status: 'attempted',
      context: {
        workflow: 'trading',
      },
    });

    const ok = await loadTradingState({ silent: hasTradingState });

    reportOpsRecovery({
      source: 'trading',
      action: 'retry_load_trading_state',
      status: ok ? 'succeeded' : 'failed',
      ...(ok ? {} : { errorCode: 'TRADING_STATE_RETRY_FAILED' }),
      context: {
        workflow: 'trading',
      },
    });
  }, [hasTradingState, loadTradingState, reportOpsRecovery]);

  const handleRetryAlertsRefresh = useCallback(async () => {
    reportOpsRecovery({
      source: 'alerts',
      action: 'retry_alerts_refresh',
      status: 'attempted',
      context: {
        workflow: 'alerts',
      },
    });

    const [rulesOk, historyOk] = await Promise.all([loadAlertRules(), loadAlertHistory()]);
    const ok = rulesOk && historyOk;

    reportOpsRecovery({
      source: 'alerts',
      action: 'retry_alerts_refresh',
      status: ok ? 'succeeded' : 'failed',
      ...(ok ? {} : { errorCode: 'ALERTS_REFRESH_RETRY_FAILED' }),
      context: {
        workflow: 'alerts',
      },
    });
  }, [loadAlertHistory, loadAlertRules, reportOpsRecovery]);

  const getLocalChartPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const area = chartAreaRef.current;
    if (!area) return null;

    const bounds = area.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }, []);

  const toTimePriceFromCoordinates = useCallback((x: number, y: number) => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return null;

    const rawTime = chart.timeScale().coordinateToTime(x);
    const rawPrice = series.coordinateToPrice(y);
    if (typeof rawTime !== 'number' || !Number.isFinite(rawTime)) return null;
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice)) return null;

    return {
      time: toTimestampValue(rawTime),
      price: normalizeLinePrice(rawPrice),
    };
  }, []);

  const findDrawingAtPoint = useCallback(
    (x: number, y: number): DrawingHit | null => {
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      if (!chart || !series) return null;

      let best: DrawingHit | null = null;
      const upsertHit = (id: string, kind: DrawingKind, distance: number) => {
        if (distance > DRAWING_HIT_TOLERANCE_PX) return;
        const score = distance + (id === selectedDrawingId ? -0.75 : 0);

        if (!best || score < best.score) {
          best = { id, kind, distance, score };
        }
      };

      for (const line of horizontalLinesRef.current) {
        const yCoord = series.priceToCoordinate(line.price);
        if (yCoord === null || !Number.isFinite(yCoord)) continue;
        upsertHit(line.id, 'horizontal', Math.abs(y - Number(yCoord)));
      }

      for (const line of verticalLinesRef.current) {
        const xCoord = chart.timeScale().timeToCoordinate(line.time as Time);
        if (xCoord === null || !Number.isFinite(xCoord)) continue;
        upsertHit(line.id, 'vertical', Math.abs(x - Number(xCoord)));
      }

      const toCoordinate = (time: UTCTimestamp, price: number) => {
        const xCoord = chart.timeScale().timeToCoordinate(time as Time);
        const yCoord = series.priceToCoordinate(price);
        if (xCoord === null || yCoord === null) return null;
        if (!Number.isFinite(xCoord) || !Number.isFinite(yCoord)) return null;
        return { x: Number(xCoord), y: Number(yCoord) };
      };

      for (const line of trendlinesRef.current) {
        const start = toCoordinate(line.startTime, line.startPrice);
        const end = toCoordinate(line.endTime, line.endPrice);
        if (!start || !end) continue;

        upsertHit(line.id, 'trendline', distanceToSegment(x, y, start.x, start.y, end.x, end.y));
      }

      for (const line of raysRef.current) {
        const start = toCoordinate(line.startTime, line.startPrice);
        const end = toCoordinate(line.endTime, line.endPrice);
        if (!start || !end) continue;

        upsertHit(line.id, 'ray', distanceToRay(x, y, start.x, start.y, end.x, end.y));
      }

      for (const shape of rectanglesRef.current) {
        const start = toCoordinate(shape.startTime, shape.startPrice);
        const end = toCoordinate(shape.endTime, shape.endPrice);
        if (!start || !end) continue;

        const left = Math.min(start.x, end.x);
        const right = Math.max(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const bottom = Math.max(start.y, end.y);
        const withinX = x >= left - DRAWING_HIT_TOLERANCE_PX && x <= right + DRAWING_HIT_TOLERANCE_PX;
        const withinY = y >= top - DRAWING_HIT_TOLERANCE_PX && y <= bottom + DRAWING_HIT_TOLERANCE_PX;
        if (!withinX || !withinY) continue;

        const edgeDistance = Math.min(
          Math.abs(x - left),
          Math.abs(x - right),
          Math.abs(y - top),
          Math.abs(y - bottom),
        );
        upsertHit(shape.id, 'rectangle', edgeDistance);
      }

      for (const note of notesRef.current) {
        const point = toCoordinate(note.time, note.price);
        if (!point) continue;
        const distance = pointDistance(x, y, point.x, point.y);
        if (distance <= NOTE_HIT_RADIUS_PX) {
          upsertHit(note.id, 'note', distance);
        }
      }

      return best;
    },
    [selectedDrawingId],
  );

  const startDragState = useCallback((hit: DrawingHit, pointerId: number, time: UTCTimestamp, price: number): DragState | null => {
    if (hit.kind === 'horizontal') {
      const origin = horizontalLinesRef.current.find((item) => item.id === hit.id);
      if (!origin) return null;
      return {
        pointerId,
        kind: 'horizontal',
        id: hit.id,
        startPrice: price,
        originPrice: origin.price,
        moved: false,
      };
    }

    if (hit.kind === 'vertical') {
      const origin = verticalLinesRef.current.find((item) => item.id === hit.id);
      if (!origin) return null;
      return {
        pointerId,
        kind: 'vertical',
        id: hit.id,
        startTime: time,
        originTime: origin.time,
        moved: false,
      };
    }

    if (hit.kind === 'trendline') {
      const origin = trendlinesRef.current.find((item) => item.id === hit.id);
      if (!origin) return null;
      return {
        pointerId,
        kind: 'trendline',
        id: hit.id,
        startTime: time,
        startPrice: price,
        origin: { ...origin },
        moved: false,
      };
    }

    if (hit.kind === 'ray') {
      const origin = raysRef.current.find((item) => item.id === hit.id);
      if (!origin) return null;
      return {
        pointerId,
        kind: 'ray',
        id: hit.id,
        startTime: time,
        startPrice: price,
        origin: { ...origin },
        moved: false,
      };
    }

    if (hit.kind === 'rectangle') {
      const origin = rectanglesRef.current.find((item) => item.id === hit.id);
      if (!origin) return null;
      return {
        pointerId,
        kind: 'rectangle',
        id: hit.id,
        startTime: time,
        startPrice: price,
        origin: { ...origin },
        moved: false,
      };
    }

    const origin = notesRef.current.find((item) => item.id === hit.id);
    if (!origin) return null;
    return {
      pointerId,
      kind: 'note',
      id: hit.id,
      startTime: time,
      startPrice: price,
      origin: { ...origin },
      moved: false,
    };
  }, []);

  const handleChartPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activeToolRef.current !== 'cursor') return;
      if (event.button !== 0) return;

      const point = getLocalChartPoint(event);
      if (!point) return;

      const hit = findDrawingAtPoint(point.x, point.y);
      if (!hit) {
        dragHistoryStartRef.current = null;
        setSelectedDrawingId(null);
        return;
      }

      setSelectedDrawingId(hit.id);

      const mapped = toTimePriceFromCoordinates(point.x, point.y);
      if (!mapped) {
        dragHistoryStartRef.current = null;
        return;
      }

      const dragState = startDragState(hit, event.pointerId, mapped.time, mapped.price);
      if (!dragState) {
        dragHistoryStartRef.current = null;
        return;
      }

      dragStateRef.current = dragState;
      dragHistoryStartRef.current = captureChartHistorySnapshot();
      setIsDraggingDrawing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [captureChartHistorySnapshot, findDrawingAtPoint, getLocalChartPoint, startDragState, toTimePriceFromCoordinates],
  );

  const handleChartPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const point = getLocalChartPoint(event);
      if (!point) return;

      const mapped = toTimePriceFromCoordinates(point.x, point.y);
      if (!mapped) return;

      let moved = false;

      if (dragState.kind === 'horizontal') {
        const nextPrice = normalizeLinePrice(dragState.originPrice + (mapped.price - dragState.startPrice));
        const nextLines = horizontalLinesRef.current.map((line) =>
          line.id === dragState.id ? { id: line.id, price: nextPrice } : { id: line.id, price: line.price },
        );
        moved = nextLines.some((line, index) => Math.abs(line.price - horizontalLinesRef.current[index].price) > 0.0001);
        if (moved) {
          renderHorizontalLines(nextLines);
        }
      }

      if (dragState.kind === 'vertical') {
        const deltaTime = Number(mapped.time) - Number(dragState.startTime);
        const nextTime = toTimestampValue(Number(dragState.originTime) + deltaTime);
        const nextLines = verticalLinesRef.current.map((line) =>
          line.id === dragState.id ? { ...line, time: nextTime } : line,
        );
        moved = nextLines.some((line, index) => Number(line.time) !== Number(verticalLinesRef.current[index].time));
        if (moved) {
          renderVerticalLines(nextLines);
        }
      }

      if (dragState.kind === 'trendline') {
        const deltaTime = Number(mapped.time) - Number(dragState.startTime);
        const deltaPrice = mapped.price - dragState.startPrice;
        const nextTrendlines = trendlinesRef.current.map((line) =>
          line.id === dragState.id
            ? {
                ...line,
                startTime: toTimestampValue(Number(dragState.origin.startTime) + deltaTime),
                endTime: toTimestampValue(Number(dragState.origin.endTime) + deltaTime),
                startPrice: normalizeLinePrice(dragState.origin.startPrice + deltaPrice),
                endPrice: normalizeLinePrice(dragState.origin.endPrice + deltaPrice),
              }
            : line,
        );
        moved = nextTrendlines.some((line, index) => {
          const previous = trendlinesRef.current[index];
          return (
            Number(line.startTime) !== Number(previous.startTime) ||
            Number(line.endTime) !== Number(previous.endTime) ||
            Math.abs(line.startPrice - previous.startPrice) > 0.0001 ||
            Math.abs(line.endPrice - previous.endPrice) > 0.0001
          );
        });
        if (moved) {
          renderTrendlines(nextTrendlines);
        }
      }

      if (dragState.kind === 'ray') {
        const deltaTime = Number(mapped.time) - Number(dragState.startTime);
        const deltaPrice = mapped.price - dragState.startPrice;
        const nextRays = raysRef.current.map((line) =>
          line.id === dragState.id
            ? {
                ...line,
                startTime: toTimestampValue(Number(dragState.origin.startTime) + deltaTime),
                endTime: toTimestampValue(Number(dragState.origin.endTime) + deltaTime),
                startPrice: normalizeLinePrice(dragState.origin.startPrice + deltaPrice),
                endPrice: normalizeLinePrice(dragState.origin.endPrice + deltaPrice),
              }
            : line,
        );
        moved = nextRays.some((line, index) => {
          const previous = raysRef.current[index];
          return (
            Number(line.startTime) !== Number(previous.startTime) ||
            Number(line.endTime) !== Number(previous.endTime) ||
            Math.abs(line.startPrice - previous.startPrice) > 0.0001 ||
            Math.abs(line.endPrice - previous.endPrice) > 0.0001
          );
        });
        if (moved) {
          renderRays(nextRays);
        }
      }

      if (dragState.kind === 'rectangle') {
        const deltaTime = Number(mapped.time) - Number(dragState.startTime);
        const deltaPrice = mapped.price - dragState.startPrice;
        const nextRectangles = rectanglesRef.current.map((shape) =>
          shape.id === dragState.id
            ? {
                ...shape,
                startTime: toTimestampValue(Number(dragState.origin.startTime) + deltaTime),
                endTime: toTimestampValue(Number(dragState.origin.endTime) + deltaTime),
                startPrice: normalizeLinePrice(dragState.origin.startPrice + deltaPrice),
                endPrice: normalizeLinePrice(dragState.origin.endPrice + deltaPrice),
              }
            : shape,
        );
        moved = nextRectangles.some((shape, index) => {
          const previous = rectanglesRef.current[index];
          return (
            Number(shape.startTime) !== Number(previous.startTime) ||
            Number(shape.endTime) !== Number(previous.endTime) ||
            Math.abs(shape.startPrice - previous.startPrice) > 0.0001 ||
            Math.abs(shape.endPrice - previous.endPrice) > 0.0001
          );
        });
        if (moved) {
          renderRectangles(nextRectangles);
        }
      }

      if (dragState.kind === 'note') {
        const deltaTime = Number(mapped.time) - Number(dragState.startTime);
        const deltaPrice = mapped.price - dragState.startPrice;
        const nextNotes = notesRef.current.map((note) =>
          note.id === dragState.id
            ? {
                ...note,
                time: toTimestampValue(Number(dragState.origin.time) + deltaTime),
                price: normalizeLinePrice(dragState.origin.price + deltaPrice),
              }
            : note,
        );
        moved = nextNotes.some((note, index) => {
          const previous = notesRef.current[index];
          return Number(note.time) !== Number(previous.time) || Math.abs(note.price - previous.price) > 0.0001;
        });
        if (moved) {
          renderNotes(nextNotes);
        }
      }

      if (moved) {
        dragState.moved = true;
      }
      event.preventDefault();
    },
    [
      getLocalChartPoint,
      renderHorizontalLines,
      renderNotes,
      renderRays,
      renderRectangles,
      renderTrendlines,
      renderVerticalLines,
      toTimePriceFromCoordinates,
    ],
  );

  const handleChartPointerUpOrCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const beforeSnapshot = dragHistoryStartRef.current;
      dragHistoryStartRef.current = null;
      dragStateRef.current = null;
      setIsDraggingDrawing(false);
      if (!dragState.moved) return;

      const nextHorizontalLines = snapshotHorizontalLines();
      const nextVerticalLines = snapshotVerticalLines();
      const nextTrendlines = snapshotTrendlines();
      const nextRays = snapshotRays();
      const nextRectangles = snapshotRectangles();
      const nextNotes = snapshotNotes();

      void persistDrawings(
        selectedSymbolRef.current,
        selectedIntervalRef.current,
        nextHorizontalLines,
        nextVerticalLines,
        nextTrendlines,
        nextRays,
        nextRectangles,
        nextNotes,
      );
      if (beforeSnapshot) {
        recordHistoryTransition(
          beforeSnapshot,
          captureChartHistorySnapshot({
            horizontalLines: nextHorizontalLines,
            verticalLines: nextVerticalLines,
            trendlines: nextTrendlines,
            rays: nextRays,
            rectangles: nextRectangles,
            notes: nextNotes,
          }),
        );
      }
    },
    [
      captureChartHistorySnapshot,
      persistDrawings,
      recordHistoryTransition,
      snapshotHorizontalLines,
      snapshotNotes,
      snapshotRays,
      snapshotRectangles,
      snapshotTrendlines,
      snapshotVerticalLines,
    ],
  );

  const removeHorizontalLine = useCallback((id: string) => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const targetIndex = horizontalLinesRef.current.findIndex((item) => item.id === id);
    if (targetIndex < 0) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    const [target] = horizontalLinesRef.current.splice(targetIndex, 1);
    series.removePriceLine(target.line);
    const nextHorizontalLines = snapshotHorizontalLines();
    setHorizontalLines(nextHorizontalLines);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      nextHorizontalLines,
      snapshotVerticalLines(),
      snapshotTrendlines(),
      snapshotRays(),
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearHorizontalLines = useCallback(() => {
    if (!horizontalLinesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    const series = candleSeriesRef.current;
    if (series) {
      for (const item of horizontalLinesRef.current) {
        series.removePriceLine(item.line);
      }
    }

    horizontalLinesRef.current = [];
    setHorizontalLines([]);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      [],
      snapshotVerticalLines(),
      snapshotTrendlines(),
      snapshotRays(),
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) =>
      previous && horizontalLinesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const removeVerticalLine = useCallback((id: string) => {
    const nextVerticalLines = verticalLinesRef.current.filter((item) => item.id !== id);
    if (nextVerticalLines.length === verticalLinesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderVerticalLines(nextVerticalLines);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      nextVerticalLines,
      snapshotTrendlines(),
      snapshotRays(),
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderVerticalLines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines]);

  const clearVerticalLines = useCallback(() => {
    if (!verticalLinesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderVerticalLines([]);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      [],
      snapshotTrendlines(),
      snapshotRays(),
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) =>
      previous && verticalLinesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderVerticalLines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines]);

  const removeTrendline = useCallback((id: string) => {
    const nextTrendlines = trendlinesRef.current.filter((item) => item.id !== id);
    if (nextTrendlines.length === trendlinesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderTrendlines(nextTrendlines);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      nextTrendlines,
      snapshotRays(),
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderTrendlines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotVerticalLines]);

  const clearTrendlines = useCallback(() => {
    if (!trendlinesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderTrendlines([]);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      [],
      snapshotRays(),
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) =>
      previous && trendlinesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderTrendlines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotVerticalLines]);

  const removeRay = useCallback((id: string) => {
    const nextRays = raysRef.current.filter((item) => item.id !== id);
    if (nextRays.length === raysRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderRays(nextRays);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      snapshotTrendlines(),
      nextRays,
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderRays, snapshotHorizontalLines, snapshotNotes, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearRays = useCallback(() => {
    if (!raysRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderRays([]);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      snapshotTrendlines(),
      [],
      snapshotRectangles(),
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) =>
      previous && raysRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderRays, snapshotHorizontalLines, snapshotNotes, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const removeRectangle = useCallback((id: string) => {
    const nextRectangles = rectanglesRef.current.filter((item) => item.id !== id);
    if (nextRectangles.length === rectanglesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderRectangles(nextRectangles);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      snapshotTrendlines(),
      snapshotRays(),
      nextRectangles,
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderRectangles, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotTrendlines, snapshotVerticalLines]);

  const clearRectangles = useCallback(() => {
    if (!rectanglesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderRectangles([]);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      snapshotTrendlines(),
      snapshotRays(),
      [],
      snapshotNotes(),
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) =>
      previous && rectanglesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderRectangles, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotTrendlines, snapshotVerticalLines]);

  const removeNote = useCallback((id: string) => {
    const nextNotes = notesRef.current.filter((item) => item.id !== id);
    if (nextNotes.length === notesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderNotes(nextNotes);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      snapshotTrendlines(),
      snapshotRays(),
      snapshotRectangles(),
      nextNotes,
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderNotes, snapshotHorizontalLines, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearNotes = useCallback(() => {
    if (!notesRef.current.length) return;
    const beforeSnapshot = captureChartHistorySnapshot();

    renderNotes([]);
    void persistDrawings(
      selectedSymbolRef.current,
      selectedIntervalRef.current,
      snapshotHorizontalLines(),
      snapshotVerticalLines(),
      snapshotTrendlines(),
      snapshotRays(),
      snapshotRectangles(),
      [],
    );
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
    setSelectedDrawingId((previous) =>
      previous && notesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderNotes, snapshotHorizontalLines, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearAllDrawings = useCallback(() => {
    const beforeSnapshot = captureChartHistorySnapshot();
    const series = candleSeriesRef.current;
    if (series) {
      for (const item of horizontalLinesRef.current) {
        series.removePriceLine(item.line);
      }
    }

    horizontalLinesRef.current = [];
    setHorizontalLines([]);
    trendlinesRef.current = [];
    raysRef.current = [];
    rectanglesRef.current = [];
    notesRef.current = [];
    setTrendlines([]);
    setRays([]);
    setRectangles([]);
    setNotes([]);
    renderVerticalLines([]);
    setSelectedDrawingId(null);
    setPendingShapeStart(null);
    void persistDrawings(selectedSymbolRef.current, selectedIntervalRef.current, [], [], [], [], [], []);
    recordHistoryTransition(beforeSnapshot, captureChartHistorySnapshot());
  }, [captureChartHistorySnapshot, persistDrawings, recordHistoryTransition, renderVerticalLines]);

  const deleteDrawingById = useCallback((id: string) => {
    if (horizontalLinesRef.current.some((item) => item.id === id)) {
      removeHorizontalLine(id);
      return;
    }
    if (verticalLinesRef.current.some((item) => item.id === id)) {
      removeVerticalLine(id);
      return;
    }
    if (trendlinesRef.current.some((item) => item.id === id)) {
      removeTrendline(id);
      return;
    }
    if (raysRef.current.some((item) => item.id === id)) {
      removeRay(id);
      return;
    }
    if (rectanglesRef.current.some((item) => item.id === id)) {
      removeRectangle(id);
      return;
    }
    if (notesRef.current.some((item) => item.id === id)) {
      removeNote(id);
    }
  }, [removeHorizontalLine, removeNote, removeRay, removeRectangle, removeTrendline, removeVerticalLine]);

  const deleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    deleteDrawingById(selectedDrawingId);
  }, [deleteDrawingById, selectedDrawingId]);

  useEffect(() => {
    const isTextInputTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;

      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTextInputTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const hasHistoryModifier = event.ctrlKey || event.metaKey;
      if (hasHistoryModifier && !event.altKey) {
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            redoHistory();
            return;
          }
          undoHistory();
          return;
        }

        if (key === 'y' && !event.shiftKey) {
          event.preventDefault();
          redoHistory();
          return;
        }
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (key === 'h') {
        event.preventDefault();
        setActiveTool('horizontal');
        return;
      }

      if (key === 'v') {
        event.preventDefault();
        setActiveTool('vertical');
        return;
      }

      if (key === 't') {
        event.preventDefault();
        setActiveTool('trendline');
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        setActiveTool('ray');
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        setActiveTool('rectangle');
        return;
      }

      if (key === 'n') {
        event.preventDefault();
        setActiveTool('note');
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveTool('cursor');
        setPendingShapeStart(null);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedDrawingId) return;
        event.preventDefault();
        deleteSelectedDrawing();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deleteSelectedDrawing, redoHistory, selectedDrawingId, undoHistory]);

  const toggleIndicator = useCallback((key: IndicatorKey) => {
    const beforeSnapshot = captureChartHistorySnapshot();
    const nextEnabledIndicators = {
      ...enabledIndicators,
      [key]: !enabledIndicators[key],
    };

    setEnabledIndicators(nextEnabledIndicators);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        enabledIndicators: nextEnabledIndicators,
      }),
    );
  }, [captureChartHistorySnapshot, enabledIndicators, recordHistoryTransition]);

  const updateRsiPeriod = useCallback((value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const nextIndicatorSettings = normalizeIndicatorSettings({
      ...indicatorSettings,
      rsi: {
        ...indicatorSettings.rsi,
        period: numeric,
      },
    });
    if (nextIndicatorSettings.rsi.period === indicatorSettings.rsi.period) return;

    const beforeSnapshot = captureChartHistorySnapshot();
    setIndicatorSettings(nextIndicatorSettings);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        indicatorSettings: nextIndicatorSettings,
      }),
    );
  }, [captureChartHistorySnapshot, indicatorSettings, recordHistoryTransition]);

  const updateMacdSetting = useCallback((field: keyof IndicatorSettings['macd'], value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const nextIndicatorSettings = normalizeIndicatorSettings({
      ...indicatorSettings,
      macd: {
        ...indicatorSettings.macd,
        [field]: numeric,
      },
    });
    if (nextIndicatorSettings.macd[field] === indicatorSettings.macd[field]) return;

    const beforeSnapshot = captureChartHistorySnapshot();
    setIndicatorSettings(nextIndicatorSettings);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        indicatorSettings: nextIndicatorSettings,
      }),
    );
  }, [captureChartHistorySnapshot, indicatorSettings, recordHistoryTransition]);

  const updateBollingerPeriod = useCallback((value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const nextIndicatorSettings = normalizeIndicatorSettings({
      ...indicatorSettings,
      bollinger: {
        ...indicatorSettings.bollinger,
        period: numeric,
      },
    });
    if (nextIndicatorSettings.bollinger.period === indicatorSettings.bollinger.period) return;

    const beforeSnapshot = captureChartHistorySnapshot();
    setIndicatorSettings(nextIndicatorSettings);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        indicatorSettings: nextIndicatorSettings,
      }),
    );
  }, [captureChartHistorySnapshot, indicatorSettings, recordHistoryTransition]);

  const updateBollingerStdDev = useCallback((value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const nextIndicatorSettings = normalizeIndicatorSettings({
      ...indicatorSettings,
      bollinger: {
        ...indicatorSettings.bollinger,
        stdDev: numeric,
      },
    });
    if (nextIndicatorSettings.bollinger.stdDev === indicatorSettings.bollinger.stdDev) return;

    const beforeSnapshot = captureChartHistorySnapshot();
    setIndicatorSettings(nextIndicatorSettings);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        indicatorSettings: nextIndicatorSettings,
      }),
    );
  }, [captureChartHistorySnapshot, indicatorSettings, recordHistoryTransition]);

  const startReplay = useCallback(() => {
    if (candles.length === 0) return false;

    const initialBars = getReplayStartVisibleCount(candles.length);
    setReplayMode(true);
    setReplayPlaying(false);
    setReplaySpeed(1);
    setReplayStartBars(initialBars);
    setReplayVisibleBars(initialBars);
    clearHoveredCandle();
    return true;
  }, [candles.length, clearHoveredCandle]);

  const exitReplay = useCallback(() => {
    setReplayMode(false);
    setReplayPlaying(false);
    setReplayStartBars(0);
    setReplayVisibleBars(0);
    clearHoveredCandle();
  }, [clearHoveredCandle]);

  const toggleReplayPlayback = useCallback(() => {
    if (!replayMode) return;

    if (replayProgress.isAtEnd) {
      setReplayPlaying(false);
      return;
    }

    setReplayPlaying((previous) => !previous);
  }, [replayMode, replayProgress.isAtEnd]);

  const stepReplayForward = useCallback(() => {
    if (!replayMode) return;

    setReplayPlaying(false);
    setReplayVisibleBars((previous) => stepReplayVisibleCount(previous, candles.length, 1));
  }, [candles.length, replayMode]);

  const updateChartLayoutMode = useCallback((mode: ChartLayoutMode) => {
    if (mode === chartLayoutMode) return;
    const beforeSnapshot = captureChartHistorySnapshot();
    setChartLayoutMode(mode);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        chartLayoutMode: mode,
      }),
    );
  }, [captureChartHistorySnapshot, chartLayoutMode, recordHistoryTransition]);

  const updateCompareSymbol = useCallback((nextSymbol: string) => {
    const normalizedSymbol = nextSymbol.trim();
    if (normalizedSymbol === compareSymbol) {
      setCompareError(null);
      return;
    }

    const beforeSnapshot = captureChartHistorySnapshot();
    setCompareSymbol(normalizedSymbol);
    if (!normalizedSymbol) {
      setCompareCandles([]);
    }
    setCompareError(null);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        compareSymbol: normalizedSymbol,
      }),
    );
  }, [captureChartHistorySnapshot, compareSymbol, recordHistoryTransition]);

  const handleTopActionClick = useCallback((key: TopActionKey) => {
    if (key === 'indicator') {
      setIndicatorPanelOpen((prev) => !prev);
      return;
    }

    if (key === 'compare') {
      setComparisonPanelOpen((prev) => !prev);
      return;
    }

    if (key === 'alerts') {
      setRightPanelCollapsed(false);
      setWatchTab('alerts');
      return;
    }

    if (replayMode) {
      exitReplay();
      setTopActionFeedback('리플레이 모드를 종료했습니다.');
      return;
    }

    const started = startReplay();
    if (!started) {
      setTopActionFeedback('리플레이를 시작할 캔들 데이터가 없습니다.');
      return;
    }

    setTopActionFeedback('리플레이 모드를 시작했습니다.');
  }, [exitReplay, replayMode, startReplay]);

  const clearCompareSymbol = useCallback(() => {
    updateCompareSymbol('');
  }, [updateCompareSymbol]);

  const selectedCode = selectedSymbolMeta ? getDisplayCode(selectedSymbolMeta) : shortTicker(selectedSymbol);
  const selectedName = selectedSymbolMeta?.name ?? shortTicker(selectedSymbol);
  const exchangeText = marketExchangeText(selectedMarket);
  const totalDrawings = horizontalLines.length + verticalLines.length + trendlines.length + rays.length + rectangles.length + notes.length;
  const activeToolDescription =
    activeTool === 'horizontal'
      ? `수평선 툴 활성화 · 클릭으로 추가 (${horizontalLines.length})`
      : activeTool === 'vertical'
        ? `수직선 툴 활성화 · 클릭으로 추가 (${verticalLines.length})`
        : activeTool === 'trendline'
          ? `추세선 툴 활성화 · 2회 클릭으로 추가 (${trendlines.length})`
          : activeTool === 'ray'
            ? `레이 툴 활성화 · 2회 클릭으로 추가 (${rays.length})`
          : activeTool === 'rectangle'
            ? `사각형 툴 활성화 · 2회 클릭으로 추가 (${rectangles.length})`
            : activeTool === 'note'
              ? `노트 툴 활성화 · 클릭 후 텍스트 입력 (${notes.length})`
              : null;
  const drawingChips = useMemo(
    () => [
      ...horizontalLines.map((line) => ({
        id: line.id,
        kind: 'horizontal' as const,
        label: `H ${formatPrice(line.price)}`,
      })),
      ...verticalLines.map((line) => ({
        id: line.id,
        kind: 'vertical' as const,
        label: `V ${formatDrawingTime(line.time)}`,
      })),
      ...trendlines.map((line) => ({
        id: line.id,
        kind: 'trendline' as const,
        label: `T ${formatDrawingTime(line.startTime)}→${formatDrawingTime(line.endTime)}`,
      })),
      ...rays.map((line) => ({
        id: line.id,
        kind: 'ray' as const,
        label: `Y ${formatDrawingTime(line.startTime)}→${formatDrawingTime(line.endTime)}`,
      })),
      ...rectangles.map((line) => ({
        id: line.id,
        kind: 'rectangle' as const,
        label: `R ${formatDrawingTime(line.startTime)}→${formatDrawingTime(line.endTime)}`,
      })),
      ...notes.map((note) => ({
        id: note.id,
        kind: 'note' as const,
        label: `N ${summarizeNoteText(note.text)}`,
      })),
    ],
    [horizontalLines, notes, rays, rectangles, trendlines, verticalLines],
  );
  const drawingOverlayGeometry = useMemo(() => {
    void overlayTick;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;

    const width = container?.clientWidth ?? 0;
    const height = container?.clientHeight ?? 0;

    if (!chart || !series || width <= 0 || height <= 0) {
      return { width, height, trendlines: [], rays: [], rectangles: [], notes: [] };
    }

    const toCoordinate = (time: UTCTimestamp, price: number) => {
      const x = chart.timeScale().timeToCoordinate(time as Time);
      const y = series.priceToCoordinate(price);
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

      return { x, y };
    };

    const trendlineShapes: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (const shape of trendlines) {
      const start = toCoordinate(shape.startTime, shape.startPrice);
      const end = toCoordinate(shape.endTime, shape.endPrice);
      if (!start || !end) continue;

      trendlineShapes.push({
        id: shape.id,
        x1: Number(start.x),
        y1: Number(start.y),
        x2: Number(end.x),
        y2: Number(end.y),
      });
    }

    const rectangleShapes: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const shape of rectangles) {
      const start = toCoordinate(shape.startTime, shape.startPrice);
      const end = toCoordinate(shape.endTime, shape.endPrice);
      if (!start || !end) continue;

      const startX = Number(start.x);
      const endX = Number(end.x);
      const startY = Number(start.y);
      const endY = Number(end.y);

      rectangleShapes.push({
        id: shape.id,
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
      });
    }

    const rayShapes: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];
    for (const shape of rays) {
      const start = toCoordinate(shape.startTime, shape.startPrice);
      const end = toCoordinate(shape.endTime, shape.endPrice);
      if (!start || !end) continue;

      const x1 = Number(start.x);
      const y1 = Number(start.y);
      const x2 = Number(end.x);
      const y2 = Number(end.y);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length <= 1e-6) continue;

      const extendDistance = Math.max(width, height) * 2;
      rayShapes.push({
        id: shape.id,
        x1,
        y1,
        x2: x2 + (dx / length) * extendDistance,
        y2: y2 + (dy / length) * extendDistance,
      });
    }

    const noteShapes: Array<{ id: string; x: number; y: number; text: string }> = [];
    for (const note of notes) {
      const point = toCoordinate(note.time, note.price);
      if (!point) continue;

      noteShapes.push({
        id: note.id,
        x: Number(point.x),
        y: Number(point.y),
        text: note.text,
      });
    }

    return {
      width,
      height,
      trendlines: trendlineShapes,
      rays: rayShapes,
      rectangles: rectangleShapes,
      notes: noteShapes,
    };
  }, [notes, overlayTick, rays, rectangles, trendlines]);
  const activeIndicatorConfigs = indicatorConfigs.filter((config) => enabledIndicators[config.key]);
  const activeIndicatorLegends = activeIndicatorConfigs.map((config) => ({
    ...config,
    legend: formatIndicatorLegend(config, indicatorSettings),
  }));
  const compareSymbolMeta =
    watchlistSymbols.find((item) => item.symbol === compareSymbol) ??
    searchResults.find((item) => item.symbol === compareSymbol) ??
    null;
  const compareCandidates = watchlistSymbols.filter((item) => item.symbol !== selectedSymbol);
  const compareStatus = compareError
    ? compareError
    : compareLoading
      ? '비교 데이터를 불러오는 중...'
      : compareSymbol && compareCandles.length > 0 && normalizedComparePoints.length === 0
        ? '비교 가능한 공통 구간이 없습니다.'
        : null;
  const replayStatusText = replayMode
    ? `리플레이 ${replayPlaying ? '재생중' : replayProgress.isAtEnd ? '완료' : '일시정지'} · 스텝 ${replayProgress.completedSteps}/${replayProgress.totalSteps} · 속도 x${replaySpeed}`
    : null;
  const strategyRecentTrades = useMemo(
    () => (strategyResult ? [...strategyResult.trades].slice(-STRATEGY_RECENT_TRADES_LIMIT).reverse() : []),
    [strategyResult],
  );
  const opsTimelineItems = useMemo<OpsTimelineItem[]>(() => {
    const errorItems: OpsTimelineItem[] = opsErrors.map((eventItem) => ({
      id: `error-${eventItem.id}`,
      kind: 'error',
      source: eventItem.source,
      label: `[${eventItem.level}] ${eventItem.code}`,
      detail: eventItem.message,
      occurredAt: eventItem.occurredAt,
    }));

    const recoveryItems: OpsTimelineItem[] = opsRecoveries.map((eventItem) => ({
      id: `recovery-${eventItem.id}`,
      kind: 'recovery',
      source: eventItem.source,
      label: `${eventItem.action} · ${eventItem.status}`,
      detail: eventItem.message ?? eventItem.errorCode ?? '',
      occurredAt: eventItem.occurredAt,
    }));

    return [...errorItems, ...recoveryItems]
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 8);
  }, [opsErrors, opsRecoveries]);
  const hasOpsTimeline = opsTimelineItems.length > 0;
  const handleRecoveryAction = useCallback(
    (recovery: WorkflowRecoveryState | null) => {
      if (!recovery) return;

      if (recovery.actionKind === 'retry-backtest') {
        void handleRetryStrategyBacktest();
        return;
      }

      if (recovery.actionKind === 'retry-trading-state') {
        void handleRetryTradingState();
        return;
      }

      void handleRetryAlertsRefresh();
    },
    [handleRetryAlertsRefresh, handleRetryStrategyBacktest, handleRetryTradingState],
  );

  return (
    <div className="tv-app">
      <header className="tv-topbar">
        <div className="brand-wrap">
          <div className="brand">TradingService</div>
          <span className="phase-chip">Phase 1</span>
        </div>

        <div className="top-controls">
          <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
            {watchlistSymbols.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {getOptionLabel(item)}
              </option>
            ))}
          </select>

          <div className="intervals">
            {intervals.map((interval) => (
              <button
                key={interval}
                className={interval === selectedInterval ? 'active' : ''}
                onClick={() => setSelectedInterval(interval)}
              >
                {interval}
              </button>
            ))}
          </div>

          <div className="layout-modes" aria-label="차트 레이아웃">
            {chartLayoutOptions.map((layout) => (
              <button
                key={layout.key}
                type="button"
                className={chartLayoutMode === layout.key ? 'active' : ''}
                onClick={() => updateChartLayoutMode(layout.key)}
              >
                {layout.label}
              </button>
            ))}
          </div>

          <div className="top-actions">
            {topActions.map((action) => (
              <button
                key={action.key}
                className={
                  (action.key === 'indicator' && indicatorPanelOpen) ||
                  (action.key === 'compare' && comparisonPanelOpen) ||
                  (action.key === 'alerts' && !rightPanelCollapsed && watchTab === 'alerts') ||
                  (action.key === 'replay' && replayMode)
                    ? 'active'
                    : ''
                }
                onClick={() => handleTopActionClick(action.key)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div className="quote-summary">
          {selectedQuote ? (
            <>
              <span className="price">{formatPrice(selectedQuote.lastPrice)}</span>
              <span className={selectedQuote.changePercent >= 0 ? 'up' : 'down'}>
                {selectedQuote.changePercent >= 0 ? '+' : ''}
                {selectedQuote.changePercent.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="muted">시세 로딩중...</span>
          )}

          <button className="panel-toggle" onClick={() => setRightPanelCollapsed((prev) => !prev)}>
            {rightPanelCollapsed ? '패널 열기' : '패널 닫기'}
          </button>
        </div>
      </header>

      <main className={`tv-main ${rightPanelCollapsed ? 'right-collapsed' : ''}`}>
        <aside className="left-toolbar">
          {leftTools.map((item) => (
            <button
              key={item.key}
              className={item.key === activeTool ? 'active' : ''}
              onClick={() => setActiveTool(item.key)}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </aside>

        <section className="center-panel">
          <div className="chart-header">
            <div className="chart-title-block">
              <strong className="chart-title-main">
                {selectedCode} · {selectedName} · {selectedInterval}
              </strong>
              <div className="market-status-row">
                <span className={`market-status-badge ${marketStatusBadgeClass}`}>{marketStatusBadgeText}</span>
                <span className="market-status-text">{marketStatusHint}</span>
              </div>
              <span>{exchangeText} · 실시간 데이터</span>
            </div>

            <div className="chart-meta-wrap">
              <div className="chart-meta">
                <span>O {displayCandle ? formatPrice(displayCandle.open) : '--'}</span>
                <span>H {displayCandle ? formatPrice(displayCandle.high) : '--'}</span>
                <span>L {displayCandle ? formatPrice(displayCandle.low) : '--'}</span>
                <span>C {displayCandle ? formatPrice(displayCandle.close) : '--'}</span>
                <span className={priceDiff >= 0 ? 'up' : 'down'}>
                  {priceDiff >= 0 ? '+' : ''}
                  {priceDiff.toFixed(2)} ({priceDiffPercent.toFixed(2)}%)
                </span>
                <span>Vol {displayCandle ? formatVolume(displayCandle.volume) : '--'}</span>
              </div>

              {activeIndicatorLegends.length > 0 || compareSymbol ? (
                <div className="chart-legend-row">
                  {activeIndicatorLegends.map((config) => (
                    <span key={config.key} className="chart-legend-item">
                      <span className="legend-dot" style={{ backgroundColor: config.color }} />
                      {config.legend}
                    </span>
                  ))}
                  {compareSymbol ? (
                    <span className="chart-legend-item">
                      <span className="legend-dot" style={{ backgroundColor: compareOverlayColor }} />
                      비교 {compareSymbolMeta ? getDisplayCode(compareSymbolMeta) : shortTicker(compareSymbol)} (정규화)
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {indicatorPanelOpen || comparisonPanelOpen || replayMode ? (
            <div className="chart-control-panels">
              {indicatorPanelOpen ? (
                <div className="chart-control-group">
                  <strong>지표</strong>
                  <div className="indicator-toggle-list">
                    {indicatorConfigs.map((config) => (
                      <div key={config.key} className="indicator-item">
                        <label className="indicator-item-toggle">
                          <input
                            type="checkbox"
                            checked={enabledIndicators[config.key]}
                            onChange={() => toggleIndicator(config.key)}
                          />
                          <span className="legend-dot" style={{ backgroundColor: config.color }} />
                          <span>{config.label}</span>
                        </label>

                        {config.key === 'rsi' ? (
                          <div className="indicator-setting-fields">
                            <label>
                              <span>기간</span>
                              <input
                                type="number"
                                min={RSI_PERIOD_RANGE.min}
                                max={RSI_PERIOD_RANGE.max}
                                step={1}
                                value={indicatorSettings.rsi.period}
                                onChange={(event) => updateRsiPeriod(event.target.value)}
                              />
                            </label>
                          </div>
                        ) : null}

                        {config.key === 'macd' ? (
                          <div className="indicator-setting-fields">
                            <label>
                              <span>Fast</span>
                              <input
                                type="number"
                                min={MACD_FAST_RANGE.min}
                                max={MACD_FAST_RANGE.max}
                                step={1}
                                value={indicatorSettings.macd.fast}
                                onChange={(event) => updateMacdSetting('fast', event.target.value)}
                              />
                            </label>
                            <label>
                              <span>Slow</span>
                              <input
                                type="number"
                                min={MACD_SLOW_RANGE.min}
                                max={MACD_SLOW_RANGE.max}
                                step={1}
                                value={indicatorSettings.macd.slow}
                                onChange={(event) => updateMacdSetting('slow', event.target.value)}
                              />
                            </label>
                            <label>
                              <span>Signal</span>
                              <input
                                type="number"
                                min={MACD_SIGNAL_RANGE.min}
                                max={MACD_SIGNAL_RANGE.max}
                                step={1}
                                value={indicatorSettings.macd.signal}
                                onChange={(event) => updateMacdSetting('signal', event.target.value)}
                              />
                            </label>
                          </div>
                        ) : null}

                        {config.key === 'bbands' ? (
                          <div className="indicator-setting-fields">
                            <label>
                              <span>기간</span>
                              <input
                                type="number"
                                min={BOLLINGER_PERIOD_RANGE.min}
                                max={BOLLINGER_PERIOD_RANGE.max}
                                step={1}
                                value={indicatorSettings.bollinger.period}
                                onChange={(event) => updateBollingerPeriod(event.target.value)}
                              />
                            </label>
                            <label>
                              <span>표준편차</span>
                              <input
                                type="number"
                                min={BOLLINGER_STD_DEV_RANGE.min}
                                max={BOLLINGER_STD_DEV_RANGE.max}
                                step={0.1}
                                value={indicatorSettings.bollinger.stdDev}
                                onChange={(event) => updateBollingerStdDev(event.target.value)}
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {comparisonPanelOpen ? (
                <div className="chart-control-group">
                  <strong>비교</strong>
                  <div className="compare-controls">
                    <select
                      value={compareSymbol}
                      onChange={(event) => updateCompareSymbol(event.target.value)}
                    >
                      <option value="">비교 심볼 선택</option>
                      {compareCandidates.map((item) => (
                        <option key={item.symbol} value={item.symbol}>
                          {getOptionLabel(item)}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={clearCompareSymbol} disabled={!compareSymbol}>
                      비교 해제
                    </button>
                  </div>
                  {compareCandidates.length === 0 ? (
                    <p className="control-feedback">관심종목에 비교 가능한 심볼이 없습니다.</p>
                  ) : null}
                  {compareStatus ? <p className="control-feedback">{compareStatus}</p> : null}
                </div>
              ) : null}

              {replayMode ? (
                <div className="chart-control-group replay-group">
                  <strong>리플레이</strong>
                  <div className="replay-controls">
                    <button type="button" onClick={toggleReplayPlayback} disabled={replayProgress.isAtEnd}>
                      {replayPlaying ? '일시정지' : '재생'}
                    </button>
                    <button type="button" onClick={stepReplayForward} disabled={replayProgress.isAtEnd}>
                      +1 bar
                    </button>
                    <label className="replay-speed-select">
                      <span>속도</span>
                      <select
                        value={replaySpeed}
                        onChange={(event) => {
                          const nextSpeed = Number(event.target.value);
                          if (nextSpeed === 1 || nextSpeed === 2 || nextSpeed === 4) {
                            setReplaySpeed(nextSpeed);
                          }
                        }}
                      >
                        {replaySpeedOptions.map((speed) => (
                          <option key={speed} value={speed}>
                            x{speed}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={exitReplay}>
                      리플레이 종료
                    </button>
                  </div>
                  <p className="control-feedback">
                    모드: 리플레이 · 스텝 {replayProgress.completedSteps}/{replayProgress.totalSteps} · 표시{' '}
                    {replayProgress.visibleBars}/{replayProgress.totalBars} bars · 속도 x{replaySpeed}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={`chart-layout ${chartLayoutMode === 'split' ? 'split' : 'single'}`}>
            <div
              ref={chartAreaRef}
              className={`chart-area chart-area-primary${isDraggingDrawing ? ' is-dragging' : ''}`}
              onMouseLeave={clearHoveredCandle}
              onPointerDown={handleChartPointerDown}
              onPointerMove={handleChartPointerMove}
              onPointerUp={handleChartPointerUpOrCancel}
              onPointerCancel={handleChartPointerUpOrCancel}
            >
            <div className="chart-canvas" ref={containerRef} />
            <div className="vertical-lines-overlay" ref={verticalOverlayRef} />
            {drawingOverlayGeometry.width > 0 && drawingOverlayGeometry.height > 0 ? (
              <svg
                className="drawing-shape-overlay"
                width={drawingOverlayGeometry.width}
                height={drawingOverlayGeometry.height}
                viewBox={`0 0 ${drawingOverlayGeometry.width} ${drawingOverlayGeometry.height}`}
                preserveAspectRatio="none"
              >
                {drawingOverlayGeometry.trendlines.map((shape) => (
                  <line
                    key={shape.id}
                    x1={shape.x1}
                    y1={shape.y1}
                    x2={shape.x2}
                    y2={shape.y2}
                    className={`drawing-shape trendline${selectedDrawingId === shape.id ? ' selected' : ''}`}
                  />
                ))}
                {drawingOverlayGeometry.rays.map((shape) => (
                  <line
                    key={shape.id}
                    x1={shape.x1}
                    y1={shape.y1}
                    x2={shape.x2}
                    y2={shape.y2}
                    className={`drawing-shape ray${selectedDrawingId === shape.id ? ' selected' : ''}`}
                  />
                ))}
                {drawingOverlayGeometry.rectangles.map((shape) => (
                  <rect
                    key={shape.id}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width}
                    height={shape.height}
                    className={`drawing-shape rectangle${selectedDrawingId === shape.id ? ' selected' : ''}`}
                  />
                ))}
                {drawingOverlayGeometry.notes.map((shape) => (
                  <g key={shape.id} className={`drawing-shape note${selectedDrawingId === shape.id ? ' selected' : ''}`}>
                    <circle cx={shape.x} cy={shape.y} r={4} />
                    <text x={shape.x + 8} y={shape.y - 8}>
                      {summarizeNoteText(shape.text)}
                    </text>
                  </g>
                ))}
              </svg>
            ) : null}
            {hoveredCandle && hoverTooltipStyle ? (
              <div className="candle-hover-tooltip" style={hoverTooltipStyle}>
                <div className="candle-hover-tooltip-time">{formatCandleDateTime(hoveredCandle.time)}</div>
                <div className="candle-hover-tooltip-row">
                  <span>시가 (O)</span>
                  <strong>{formatPrice(hoveredCandle.open)}</strong>
                </div>
                <div className="candle-hover-tooltip-row">
                  <span>고가 (H)</span>
                  <strong>{formatPrice(hoveredCandle.high)}</strong>
                </div>
                <div className="candle-hover-tooltip-row">
                  <span>저가 (L)</span>
                  <strong>{formatPrice(hoveredCandle.low)}</strong>
                </div>
                <div className="candle-hover-tooltip-row">
                  <span>종가 (C)</span>
                  <strong>{formatPrice(hoveredCandle.close)}</strong>
                </div>
                <div className={`candle-hover-tooltip-change ${hoveredCandleDiff >= 0 ? 'up' : 'down'}`}>
                  {hoveredCandleDiff >= 0 ? '+' : ''}
                  {hoveredCandleDiff.toFixed(2)} ({hoveredCandleDiffPercent.toFixed(2)}%)
                </div>
                <div className="candle-hover-tooltip-volume">거래량 Vol {formatVolume(hoveredCandle.volume)}</div>
              </div>
            ) : null}
            </div>

            {chartLayoutMode === 'split' ? (
              <div className="chart-area chart-area-secondary">
                <div className="chart-canvas" ref={secondaryContainerRef} />
                <div className="secondary-chart-badge">보조 차트 · 범위 동기화</div>
              </div>
            ) : null}
          </div>

          <div className="status-row">
            <span>{loading ? '데이터를 불러오는 중...' : '실시간 UI 프로토타입'}</span>
            {topActionFeedback ? <span className="status-chip">{topActionFeedback}</span> : null}
            {activeToolDescription ? <span className="status-chip">{activeToolDescription}</span> : null}
            {replayStatusText ? <span className="status-chip replay-status-chip">{replayStatusText}</span> : null}
            <span className="status-chip">단축키 H/V/T/Y/R/N · Esc · Delete/Backspace · Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z</span>
            <div className="status-actions status-actions-history">
              <button className="status-button" type="button" onClick={undoHistory} disabled={!historyState.canUndo}>
                Undo
              </button>
              <button className="status-button" type="button" onClick={redoHistory} disabled={!historyState.canRedo}>
                Redo
              </button>
            </div>
            {pendingShapeStart ? (
              <span className="status-chip">
                {pendingShapeStart.tool === 'trendline' ? '추세선' : pendingShapeStart.tool === 'ray' ? '레이' : '사각형'} 시작점 고정 · 다음 클릭으로 완료
              </span>
            ) : null}

            {totalDrawings > 0 ? (
              <div className="status-actions">
                <span className="status-chip">저장된 도형 {totalDrawings}</span>
                {activeTool === 'horizontal' && horizontalLines.length > 0 ? (
                  <button className="status-button" onClick={clearHorizontalLines}>
                    수평선 전체 삭제
                  </button>
                ) : null}
                {activeTool === 'vertical' && verticalLines.length > 0 ? (
                  <button className="status-button" onClick={clearVerticalLines}>
                    수직선 전체 삭제
                  </button>
                ) : null}
                {activeTool === 'trendline' && trendlines.length > 0 ? (
                  <button className="status-button" onClick={clearTrendlines}>
                    추세선 전체 삭제
                  </button>
                ) : null}
                {activeTool === 'ray' && rays.length > 0 ? (
                  <button className="status-button" onClick={clearRays}>
                    레이 전체 삭제
                  </button>
                ) : null}
                {activeTool === 'rectangle' && rectangles.length > 0 ? (
                  <button className="status-button" onClick={clearRectangles}>
                    사각형 전체 삭제
                  </button>
                ) : null}
                {activeTool === 'note' && notes.length > 0 ? (
                  <button className="status-button" onClick={clearNotes}>
                    노트 전체 삭제
                  </button>
                ) : null}
                {selectedDrawingId ? (
                  <button className="status-button" onClick={deleteSelectedDrawing}>
                    선택 도형 삭제
                  </button>
                ) : null}
                <button className="status-button" onClick={clearAllDrawings}>
                  도형 전체 삭제
                </button>
              </div>
            ) : null}

            {drawingChips.length > 0 ? (
              <div className="line-tags" aria-label="도형 목록">
                {drawingChips.slice(-12).map((chip) => (
                  <button
                    key={chip.id}
                    className={`line-tag ${chip.kind}${selectedDrawingId === chip.id ? ' selected' : ''}`}
                    onClick={() => setSelectedDrawingId(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}

            <span className="status-time">
              {displayCandle ? new Date(displayCandle.time * 1000).toLocaleString('ko-KR') : '시간 정보 없음'}
            </span>
            {error ? <span className="error">{error}</span> : null}
          </div>
        </section>

        {!rightPanelCollapsed ? (
          <aside className="right-panel">
            <div className="right-panel-header">
              <h3>시장 패널</h3>
            </div>

            <div className="watch-tabs">
              <button className={watchTab === 'watchlist' ? 'active' : ''} onClick={() => setWatchTab('watchlist')}>
                관심종목
              </button>
              <button className={watchTab === 'detail' ? 'active' : ''} onClick={() => setWatchTab('detail')}>
                상세정보
              </button>
              <button className={watchTab === 'alerts' ? 'active' : ''} onClick={() => setWatchTab('alerts')}>
                알림
                {alertBadgeCount > 0 ? <span className="watch-tab-badge">{Math.min(alertBadgeCount, ALERT_EVENT_MAX_ITEMS)}</span> : null}
              </button>
            </div>

            <div className="ops-mini-panel">
              <div className="ops-mini-head">
                <strong>운영 로그</strong>
                <button type="button" onClick={() => void loadOpsTelemetry()} disabled={opsLoading}>
                  {opsLoading ? '로딩중...' : '새로고침'}
                </button>
              </div>
              {opsPanelError ? <p className="ops-mini-error">{opsPanelError}</p> : null}
              {!opsPanelError && !hasOpsTimeline ? (
                <p className="ops-mini-empty">최근 오류/복구 이벤트가 없습니다.</p>
              ) : null}
              {hasOpsTimeline ? (
                <ul className="ops-mini-list">
                  {opsTimelineItems.map((item) => (
                    <li key={item.id}>
                      <div className="ops-mini-row">
                        <span className={`ops-mini-kind ${item.kind}`}>{item.kind === 'error' ? 'ERR' : 'REC'}</span>
                        <span className="ops-mini-label">{item.label}</span>
                      </div>
                      <div className="ops-mini-sub">
                        <span>{item.source}</span>
                        <span>{new Date(item.occurredAt).toLocaleTimeString('ko-KR')}</span>
                        {item.detail ? <span>{item.detail}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className={`right-panel-body${watchTab === 'watchlist' ? ' watchlist-body' : ''}`}>
              {watchTab === 'watchlist' ? (
                <>
                  <div className="watch-search-wrap">
                    <input
                      value={watchQuery}
                      onChange={(e) => setWatchQuery(e.target.value)}
                      onKeyDown={handleSearchInputKeyDown}
                      placeholder="종목 코드/종목명 검색 (예: 005930, 삼성전자, BTC)"
                      autoComplete="off"
                    />
                  </div>
                  <div className="watch-filters">
                    {(['ALL', 'KOSPI', 'KOSDAQ', 'CRYPTO'] as const).map((market) => (
                      <button
                        key={market}
                        className={watchMarketFilter === market ? 'active' : ''}
                        onClick={() => setWatchMarketFilter(market)}
                      >
                        {market}
                      </button>
                    ))}
                  </div>

                  <div className="watchlist-head">
                    <button onClick={() => toggleWatchSort('symbol')}>
                      심볼
                      {watchSortKey === 'symbol' ? (watchSortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                    <button onClick={() => toggleWatchSort('price')}>
                      현재가
                      {watchSortKey === 'price' ? (watchSortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                    <button onClick={() => toggleWatchSort('changePercent')}>
                      변동%
                      {watchSortKey === 'changePercent' ? (watchSortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </div>

                  <ul className="watchlist-list">
                    {filteredWatchlist.map((item) => {
                      const hasLastPrice = typeof item.lastPrice === 'number';
                      const hasChangePercent = typeof item.changePercent === 'number';

                      return (
                        <li
                          key={item.symbol}
                          className={`watch-row${item.symbol === selectedSymbol ? ' selected' : ''}`}
                          onClick={() => setSelectedSymbol(item.symbol)}
                        >
                          <div className="watch-item-meta">
                            <strong>{getDisplayCode(item)}</strong>
                            <small>
                              {item.name} · {item.market}
                            </small>
                          </div>
                          <div className="watch-value">
                            <span>{hasLastPrice ? formatPrice(item.lastPrice) : '--'}</span>
                            <span className={hasChangePercent && item.changePercent >= 0 ? 'up' : 'down'}>
                              {hasChangePercent ? `${formatSigned(item.changePercent, 2)}%` : '--'}
                            </span>
                            <small className={hasChangePercent && item.changePercent >= 0 ? 'up' : 'down'}>
                              {typeof item.changeValue === 'number'
                                ? formatSigned(item.changeValue)
                                : '--'}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="watch-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleRemoveWatchSymbol(item.symbol);
                            }}
                            aria-label={`${getDisplayCode(item)} 삭제`}
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {watchQuery.trim().length >= 2 ? (
                    <div className="search-section">
                      <div className="search-section-title">검색결과 (코드/종목명)</div>
                      <div className="search-shortcut">↑↓ 선택 · Enter 추가 · Esc 초기화</div>
                      {searching ? <div className="search-state">검색 중...</div> : null}
                      {!searching && filteredSearchResults.length === 0 ? (
                        <div className="search-state">추가 가능한 결과가 없습니다.</div>
                      ) : null}
                      {!searching && filteredSearchResults.length ? (
                        <ul className="search-result-list">
                          {filteredSearchResults.map((item, index) => (
                            <li
                              key={item.symbol}
                              className={index === activeSearchIndex ? 'active' : ''}
                              onMouseEnter={() => setActiveSearchIndex(index)}
                              onClick={() => handlePickSymbol(item)}
                            >
                              <div>
                                <strong>{renderMatchedText(getDisplayCode(item), watchQuery)}</strong>
                                <small>{renderMatchedText(item.name, watchQuery)}</small>
                              </div>
                              <span className="market-pill">{item.market}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              {watchTab === 'detail' ? (
                <div className="panel-content">
                  <h4>
                    {selectedCode} · {selectedName} 상세
                  </h4>
                  <dl>
                    <div>
                      <dt>현재가</dt>
                      <dd>{selectedQuote ? formatPrice(selectedQuote.lastPrice) : '--'}</dd>
                    </div>
                    <div>
                      <dt>변동률</dt>
                      <dd className={selectedQuote && selectedQuote.changePercent >= 0 ? 'up' : 'down'}>
                        {selectedQuote
                          ? `${selectedQuote.changePercent >= 0 ? '+' : ''}${selectedQuote.changePercent.toFixed(2)}%`
                          : '--'}
                      </dd>
                    </div>
                    <div>
                      <dt>고가</dt>
                      <dd>{selectedQuote ? formatPrice(selectedQuote.highPrice) : '--'}</dd>
                    </div>
                    <div>
                      <dt>저가</dt>
                      <dd>{selectedQuote ? formatPrice(selectedQuote.lowPrice) : '--'}</dd>
                    </div>
                    <div>
                      <dt>거래량</dt>
                      <dd>{selectedQuote ? formatVolume(selectedQuote.volume) : '--'}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}

              {watchTab === 'alerts' ? (
                <div className="panel-content alerts-panel">
                  <h4>
                    {selectedCode} · 알림 규칙
                  </h4>

                  {alertsRecovery ? (
                    <div className="workflow-recovery-banner">
                      <span>{alertsRecovery.message}</span>
                      <button
                        type="button"
                        onClick={() => handleRecoveryAction(alertsRecovery)}
                        disabled={alertsLoading || alertsChecking || alertsWatchlistChecking || alertsSubmitting}
                      >
                        다시 시도
                      </button>
                    </div>
                  ) : null}

                  <form className="alert-form" onSubmit={handleCreateAlertRule}>
                    <div className="alert-form-row">
                      <label>
                        <span>지표</span>
                        <select value={alertMetric} onChange={(event) => setAlertMetric(event.target.value as AlertMetric)}>
                          <option value="price">가격</option>
                          <option value="changePercent">변동률</option>
                        </select>
                      </label>

                      <label>
                        <span>연산자</span>
                        <select
                          value={alertOperator}
                          onChange={(event) => setAlertOperator(event.target.value as AlertOperator)}
                        >
                          <option value=">=">{'>='}</option>
                          <option value="<=">{'<='}</option>
                          <option value=">">{'>'}</option>
                          <option value="<">{'<'}</option>
                        </select>
                      </label>
                    </div>

                    <div className="alert-form-row">
                      <label>
                        <span>기준값</span>
                        <input
                          type="number"
                          step={alertMetric === 'price' ? '0.01' : '0.1'}
                          value={alertThresholdInput}
                          onChange={(event) => setAlertThresholdInput(event.target.value)}
                          placeholder={alertMetric === 'price' ? '예: 50000' : '예: 3.5'}
                        />
                      </label>

                      <label>
                        <span>쿨다운(초)</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={alertCooldownInput}
                          onChange={(event) => setAlertCooldownInput(event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="alert-indicator-controls">
                      <label className="alert-inline-toggle">
                        <input
                          type="checkbox"
                          checked={alertIndicatorEnabled}
                          onChange={(event) => setAlertIndicatorEnabled(event.target.checked)}
                        />
                        <span>지표 조건 추가</span>
                      </label>

                      {alertIndicatorEnabled ? (
                        <>
                          <label>
                            <span>조건 타입</span>
                            <select
                              value={alertIndicatorType}
                              onChange={(event) => setAlertIndicatorType(event.target.value as AlertIndicatorType)}
                            >
                              <option value="rsiThreshold">RSI threshold</option>
                              <option value="macdCrossSignal">MACD cross</option>
                              <option value="macdHistogramSign">MACD histogram sign</option>
                              <option value="bollingerBandPosition">Bollinger position</option>
                            </select>
                          </label>

                          {alertIndicatorType === 'rsiThreshold' ? (
                            <div className="alert-form-row">
                              <label>
                                <span>RSI 연산자</span>
                                <select
                                  value={alertRsiOperator}
                                  onChange={(event) => setAlertRsiOperator(event.target.value as AlertIndicatorComparator)}
                                >
                                  <option value=">=">{'>='}</option>
                                  <option value="<=">{'<='}</option>
                                </select>
                              </label>
                              <label>
                                <span>RSI 기준값</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.1"
                                  value={alertRsiThresholdInput}
                                  onChange={(event) => setAlertRsiThresholdInput(event.target.value)}
                                  placeholder="예: 70"
                                />
                              </label>
                            </div>
                          ) : null}

                          {alertIndicatorType === 'macdCrossSignal' ? (
                            <label>
                              <span>MACD cross</span>
                              <select
                                value={alertMacdCrossSignal}
                                onChange={(event) => setAlertMacdCrossSignal(event.target.value as 'bullish' | 'bearish')}
                              >
                                <option value="bullish">bullish</option>
                                <option value="bearish">bearish</option>
                              </select>
                            </label>
                          ) : null}

                          {alertIndicatorType === 'macdHistogramSign' ? (
                            <label>
                              <span>MACD histogram sign</span>
                              <select
                                value={alertMacdHistogramSign}
                                onChange={(event) => setAlertMacdHistogramSign(event.target.value as 'positive' | 'negative')}
                              >
                                <option value="positive">positive (&gt; 0)</option>
                                <option value="negative">negative (&lt; 0)</option>
                              </select>
                            </label>
                          ) : null}

                          {alertIndicatorType === 'bollingerBandPosition' ? (
                            <label>
                              <span>Bollinger position</span>
                              <select
                                value={alertBollingerPosition}
                                onChange={(event) => setAlertBollingerPosition(event.target.value as 'aboveUpper' | 'belowLower')}
                              >
                                <option value="aboveUpper">price above upper</option>
                                <option value="belowLower">price below lower</option>
                              </select>
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </div>

                    <div className="alert-actions">
                      <button type="submit" disabled={alertsSubmitting}>
                        {alertsSubmitting ? '추가 중...' : '규칙 추가'}
                      </button>
                      <button type="button" onClick={handleCheckAlerts} disabled={alertsChecking}>
                        {alertsChecking ? '체크 중...' : 'Check now'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCheckWatchlistAlerts}
                        disabled={alertsWatchlistChecking || watchlistAlertSymbols.length === 0}
                      >
                        {alertsWatchlistChecking ? '체크 중...' : 'Check watchlist now'}
                      </button>
                    </div>
                  </form>

                  <div className="alert-watchlist-controls">
                    <label className="alert-auto-toggle">
                      <input
                        type="checkbox"
                        checked={alertsAutoCheckEnabled}
                        onChange={(event) => setAlertsAutoCheckEnabled(event.target.checked)}
                      />
                      <span>Auto-check</span>
                    </label>
                    <label className="alert-interval-select">
                      <span>Interval</span>
                      <select
                        value={alertsAutoCheckIntervalSec}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (next === 30 || next === 60 || next === 120) {
                            setAlertsAutoCheckIntervalSec(next);
                          }
                        }}
                        disabled={!alertsAutoCheckEnabled}
                      >
                        <option value={30}>30s</option>
                        <option value={60}>60s</option>
                        <option value={120}>120s</option>
                      </select>
                    </label>
                    <span className="alert-watchlist-meta">관심종목 대상: {watchlistAlertSymbols.length}개</span>
                  </div>

                  {alertMessage ? <p className="alert-message">{alertMessage}</p> : null}
                  {alertLastCheckedAt ? (
                    <p className="alert-message muted">
                      마지막 체크: {new Date(alertLastCheckedAt).toLocaleTimeString('ko-KR')}
                    </p>
                  ) : null}

                  <div className="alert-rule-filters">
                    <label>
                      <span>규칙 심볼</span>
                      <input
                        type="text"
                        value={alertRuleSymbolFilter}
                        onChange={(event) => setAlertRuleSymbolFilter(event.target.value.toUpperCase())}
                        placeholder="비우면 전체"
                      />
                    </label>
                    <label className="alert-inline-toggle">
                      <input
                        type="checkbox"
                        checked={alertRuleIndicatorAwareOnly}
                        onChange={(event) => setAlertRuleIndicatorAwareOnly(event.target.checked)}
                      />
                      <span>지표 조건 규칙만</span>
                    </label>
                    <button type="button" onClick={() => void loadAlertRules()} disabled={alertsLoading}>
                      새로고침
                    </button>
                  </div>

                  {alertsLoading ? (
                    <p className="alert-empty">규칙을 불러오는 중...</p>
                  ) : alertRules.length === 0 ? (
                    <p className="alert-empty">현재 필터에 맞는 알림 규칙이 없습니다.</p>
                  ) : (
                    <ul className="alert-list">
                      {alertRules.map((rule) => (
                        <li key={rule.id}>
                          <div className="alert-rule-row">
                            <strong>
                              {formatAlertMetric(rule.metric)} {rule.operator} {formatAlertValue(rule.metric, rule.threshold)}
                            </strong>
                            <button type="button" onClick={() => handleDeleteAlertRule(rule.id)}>
                              삭제
                            </button>
                          </div>
                          <div className="alert-rule-sub">
                            <span>심볼: {rule.symbol}</span>
                            <span>쿨다운: {rule.cooldownSec}s</span>
                            {formatAlertIndicatorSummary(rule.indicatorConditions) ? (
                              <span>지표: {formatAlertIndicatorSummary(rule.indicatorConditions)}</span>
                            ) : null}
                            <span>
                              마지막 트리거:{' '}
                              {typeof rule.lastTriggeredAt === 'number'
                                ? new Date(rule.lastTriggeredAt).toLocaleTimeString('ko-KR')
                                : '-'}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {alertTriggeredEvents.length > 0 ? (
                    <div className="alert-triggered">
                      <div className="alert-triggered-title">트리거 결과</div>
                      <ul className="alert-list">
                        {alertTriggeredEvents.map((eventItem) => (
                          <li key={`${eventItem.ruleId}-${eventItem.triggeredAt}`}>
                            <div className="alert-rule-row">
                              <strong>
                                {formatAlertMetric(eventItem.metric)} {eventItem.operator}{' '}
                                {formatAlertValue(eventItem.metric, eventItem.threshold)}
                              </strong>
                              <span>{eventItem.symbol}</span>
                            </div>
                            <div className="alert-rule-sub">
                              <span>현재값: {formatAlertValue(eventItem.metric, eventItem.currentValue)}</span>
                              {formatAlertIndicatorSummary(eventItem.indicatorConditions) ? (
                                <span>지표: {formatAlertIndicatorSummary(eventItem.indicatorConditions)}</span>
                              ) : null}
                              <span>트리거: {new Date(eventItem.triggeredAt).toLocaleTimeString('ko-KR')}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="alert-history">
                    <div className="alert-history-head">
                      <div className="alert-triggered-title">최근 알림 히스토리</div>
                      <div className="alert-history-head-actions">
                        <button
                          type="button"
                          onClick={() => void loadAlertHistory()}
                          disabled={alertsHistoryLoading || alertsHistoryClearing}
                        >
                          {alertsHistoryLoading ? '불러오는 중...' : '새로고침'}
                        </button>
                        <button
                          type="button"
                          onClick={handleClearAlertHistory}
                          disabled={alertsHistoryClearing || alertsHistoryLoading || alertHistoryEvents.length === 0}
                        >
                          {alertsHistoryClearing ? '비우는 중...' : '히스토리 비우기'}
                        </button>
                      </div>
                    </div>
                    <div className="alert-history-controls">
                      <label>
                        <span>심볼</span>
                        <input
                          type="text"
                          value={alertHistorySymbolFilter}
                          onChange={(event) => setAlertHistorySymbolFilter(event.target.value.toUpperCase())}
                          placeholder="예: BTCUSDT"
                        />
                      </label>
                      <label>
                        <span>소스</span>
                        <select
                          value={alertHistorySourceFilter}
                          onChange={(event) => setAlertHistorySourceFilter(event.target.value as AlertHistorySourceFilter)}
                        >
                          <option value="all">all</option>
                          <option value="manual">manual</option>
                          <option value="watchlist">watchlist</option>
                        </select>
                      </label>
                      <div className="alert-history-toggle">
                        <span>조건</span>
                        <label className="alert-inline-toggle">
                          <input
                            type="checkbox"
                            checked={alertHistoryIndicatorAwareOnly}
                            onChange={(event) => setAlertHistoryIndicatorAwareOnly(event.target.checked)}
                          />
                          <span>지표 조건만</span>
                        </label>
                      </div>
                    </div>
                    {alertsHistoryLoading ? (
                      <p className="alert-empty">히스토리를 불러오는 중...</p>
                    ) : alertHistoryEvents.length === 0 ? (
                      <p className="alert-empty">최근 알림 히스토리가 없습니다.</p>
                    ) : (
                      <ul className="alert-list">
                        {alertHistoryEvents.map((eventItem, index) => (
                          <li key={`${eventItem.ruleId}-${eventItem.triggeredAt}-${index}`}>
                            <div className="alert-rule-row">
                              <strong>
                                {formatAlertMetric(eventItem.metric)} {eventItem.operator}{' '}
                                {formatAlertValue(eventItem.metric, eventItem.threshold)}
                              </strong>
                              <div className="alert-history-meta">
                                {eventItem.source ? (
                                  <span className={`alert-source-tag ${eventItem.source}`}>{eventItem.source}</span>
                                ) : null}
                                <span>{eventItem.symbol}</span>
                              </div>
                            </div>
                            <div className="alert-rule-sub">
                              <span>현재값: {formatAlertValue(eventItem.metric, eventItem.currentValue)}</span>
                              {formatAlertIndicatorSummary(eventItem.indicatorConditions) ? (
                                <span>지표: {formatAlertIndicatorSummary(eventItem.indicatorConditions)}</span>
                              ) : null}
                              <span>시간: {new Date(eventItem.triggeredAt).toLocaleString('ko-KR')}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </main>

      <footer className="tv-bottom-panel">
        <div className="bottom-tabs">
          {bottomTabs.map((tab) => (
            <button key={tab.id} className={bottomTab === tab.id ? 'active' : ''} onClick={() => setBottomTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bottom-content">
          {bottomTab === 'pine' ? (
            <p className="bottom-placeholder">Pine Script 편집기 연동 준비 중 (키워드 자동완성 / 저장소 연결 예정)</p>
          ) : null}

          {bottomTab === 'strategy' ? (
            <div className="strategy-tester-panel">
              <form className="strategy-form" onSubmit={handleRunStrategyBacktest}>
                <div className="strategy-form-grid">
                  <label>
                    <span>심볼</span>
                    <input
                      type="text"
                      value={strategyForm.symbol}
                      onChange={(event) => updateStrategyField('symbol', event.target.value)}
                      placeholder="예: BTCUSDT"
                    />
                  </label>
                  <label>
                    <span>주기</span>
                    <input
                      type="text"
                      value={strategyForm.interval}
                      onChange={(event) => updateStrategyField('interval', event.target.value)}
                      placeholder="예: 60"
                    />
                  </label>
                  <label>
                    <span>캔들 개수</span>
                    <input
                      type="number"
                      min={50}
                      max={1000}
                      step={1}
                      value={strategyForm.limit}
                      onChange={(event) => updateStrategyField('limit', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>초기 자본</span>
                    <input
                      type="number"
                      min={1}
                      step="100"
                      value={strategyForm.initialCapital}
                      onChange={(event) => updateStrategyField('initialCapital', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>수수료 (bps)</span>
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      step="0.1"
                      value={strategyForm.feeBps}
                      onChange={(event) => updateStrategyField('feeBps', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>포지션 크기 (%)</span>
                    <input
                      type="number"
                      min={0.1}
                      max={100}
                      step="0.1"
                      value={strategyForm.fixedPercent}
                      onChange={(event) => updateStrategyField('fixedPercent', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>MA Fast</span>
                    <input
                      type="number"
                      min={2}
                      max={300}
                      step={1}
                      value={strategyForm.fastPeriod}
                      onChange={(event) => updateStrategyField('fastPeriod', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>MA Slow</span>
                    <input
                      type="number"
                      min={3}
                      max={600}
                      step={1}
                      value={strategyForm.slowPeriod}
                      onChange={(event) => updateStrategyField('slowPeriod', event.target.value)}
                    />
                  </label>
                </div>

                <div className="strategy-form-actions">
                  <button type="button" onClick={applyCurrentChartToStrategy} disabled={strategyLoading}>
                    현재 차트 적용
                  </button>
                  <button type="submit" disabled={strategyLoading}>
                    {strategyLoading ? '백테스트 실행 중...' : '백테스트 실행'}
                  </button>
                </div>

                {strategyRecovery ? (
                  <div className="workflow-recovery-banner">
                    <span>{strategyRecovery.message}</span>
                    <button type="button" onClick={() => handleRecoveryAction(strategyRecovery)} disabled={strategyLoading}>
                      다시 시도
                    </button>
                  </div>
                ) : null}
                {strategyError ? <p className="strategy-error">{strategyError}</p> : null}
              </form>

              {strategyResult ? (
                <div className="strategy-results">
                  <div className="strategy-summary-grid">
                    <div className="strategy-summary-card">
                      <span>순손익</span>
                      <strong className={strategyResult.summary.netPnl >= 0 ? 'up' : 'down'}>
                        {formatSignedCurrency(strategyResult.summary.netPnl)}
                      </strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>수익률</span>
                      <strong className={strategyResult.summary.returnPct >= 0 ? 'up' : 'down'}>
                        {formatSigned(strategyResult.summary.returnPct, 2)}%
                      </strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>최대 낙폭</span>
                      <strong>{strategyResult.summary.maxDrawdownPct.toFixed(2)}%</strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>승률</span>
                      <strong>{strategyResult.summary.winRate.toFixed(2)}%</strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>거래 횟수</span>
                      <strong>{strategyResult.summary.tradeCount.toLocaleString('en-US')}</strong>
                    </div>
                  </div>

                  <div className="strategy-chart-grid">
                    <div className="strategy-chart-card">
                      <div className="strategy-chart-title">Equity Curve</div>
                      <MiniLineChart
                        points={strategyResult.equityCurve}
                        stroke="#4da4ff"
                        emptyText="에쿼티 데이터 없음"
                      />
                    </div>
                    <div className="strategy-chart-card">
                      <div className="strategy-chart-title">Drawdown Curve</div>
                      <MiniLineChart
                        points={strategyResult.drawdownCurve}
                        stroke="#ef5350"
                        emptyText="드로우다운 데이터 없음"
                      />
                    </div>
                  </div>

                  <div className="strategy-trades-card">
                    <div className="strategy-trades-title">
                      최근 체결 ({strategyRecentTrades.length}/{strategyResult.trades.length})
                    </div>

                    {strategyRecentTrades.length === 0 ? (
                      <p className="strategy-empty">체결 내역이 없습니다.</p>
                    ) : (
                      <div className="strategy-trades-table-wrap">
                        <table className="strategy-trades-table">
                          <thead>
                            <tr>
                              <th>진입</th>
                              <th>청산</th>
                              <th>방향</th>
                              <th>수량</th>
                              <th>진입가</th>
                              <th>청산가</th>
                              <th>손익</th>
                            </tr>
                          </thead>
                          <tbody>
                            {strategyRecentTrades.map((trade, index) => (
                              <tr key={`${trade.entryTime}-${trade.exitTime}-${trade.qty}-${index}`}>
                                <td>{formatCandleDateTime(trade.entryTime)}</td>
                                <td>{formatCandleDateTime(trade.exitTime)}</td>
                                <td>{trade.side}</td>
                                <td>{trade.qty.toFixed(6)}</td>
                                <td>{formatPrice(trade.entryPrice)}</td>
                                <td>{formatPrice(trade.exitPrice)}</td>
                                <td className={trade.pnl >= 0 ? 'up' : 'down'}>{formatSignedCurrency(trade.pnl)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="strategy-empty">MA 교차 전략 파라미터를 입력한 뒤 백테스트를 실행하세요.</p>
              )}
            </div>
          ) : null}

          {bottomTab === 'trading' ? (
            <div className="trading-panel">
              <div className="trading-panel-head">
                <div className="trading-head-labels">
                  <strong>Paper Trading</strong>
                  <span className="trading-mode-chip">{tradingState?.mode ?? 'PAPER'}</span>
                  <span>{selectedSymbol}</span>
                  {selectedQuote ? (
                    <span className={selectedQuote.changePercent >= 0 ? 'up' : 'down'}>
                      {formatPrice(selectedQuote.lastPrice)} ({formatSigned(selectedQuote.changePercent, 2)}%)
                    </span>
                  ) : (
                    <span className="muted">시세 대기중</span>
                  )}
                </div>
                <div className="trading-head-actions">
                  {tradingUpdatedAt ? <span>업데이트: {new Date(tradingUpdatedAt).toLocaleString('ko-KR')}</span> : null}
                  <button type="button" onClick={handleRefreshTradingState} disabled={tradingLoading || tradingRefreshing}>
                    {tradingLoading || tradingRefreshing ? '새로고침 중...' : '새로고침'}
                  </button>
                </div>
              </div>

              {tradingRecovery ? (
                <div className="workflow-recovery-banner">
                  <span>{tradingRecovery.message}</span>
                  <button
                    type="button"
                    onClick={() => handleRecoveryAction(tradingRecovery)}
                    disabled={tradingLoading || tradingRefreshing || tradingSubmitting}
                  >
                    다시 시도
                  </button>
                </div>
              ) : null}
              {tradingError ? <p className="trading-error">{tradingError}</p> : null}

              {tradingLoading && !tradingState ? (
                <p className="trading-empty">트레이딩 상태를 불러오는 중...</p>
              ) : tradingState ? (
                <>
                  <div className="trading-summary-grid">
                    <div className="trading-summary-card">
                      <span>현금</span>
                      <strong>{formatPrice(tradingState.cash)}</strong>
                    </div>
                    <div className="trading-summary-card">
                      <span>평가금액</span>
                      <strong>{formatPrice(tradingState.summary.equity)}</strong>
                    </div>
                    <div className="trading-summary-card">
                      <span>미실현 손익</span>
                      <strong className={tradingState.summary.unrealizedPnl >= 0 ? 'up' : 'down'}>
                        {formatSignedCurrency(tradingState.summary.unrealizedPnl)}
                      </strong>
                    </div>
                    <div className="trading-summary-card">
                      <span>실현 손익</span>
                      <strong className={tradingState.summary.realizedPnl >= 0 ? 'up' : 'down'}>
                        {formatSignedCurrency(tradingState.summary.realizedPnl)}
                      </strong>
                    </div>
                  </div>

                  <form className="trading-order-form" onSubmit={handleSubmitTradingOrder}>
                    <div className="trading-order-grid">
                      <label>
                        <span>심볼</span>
                        <input type="text" value={selectedSymbol} readOnly />
                      </label>
                      <label>
                        <span>방향</span>
                        <select
                          value={tradingOrderForm.side}
                          onChange={(event) =>
                            setTradingOrderForm((previous) => ({
                              ...previous,
                              side: event.target.value as TradingOrderSide,
                            }))
                          }
                          disabled={tradingSubmitting}
                        >
                          <option value="BUY">BUY</option>
                          <option value="SELL">SELL</option>
                        </select>
                      </label>
                      <label>
                        <span>수량</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          inputMode="decimal"
                          value={tradingOrderForm.qty}
                          onChange={(event) =>
                            setTradingOrderForm((previous) => ({
                              ...previous,
                              qty: event.target.value,
                            }))
                          }
                          placeholder="예: 0.5"
                          disabled={tradingSubmitting}
                        />
                      </label>
                      <label>
                        <span>금액 (선택)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={tradingOrderForm.notional}
                          onChange={(event) =>
                            setTradingOrderForm((previous) => ({
                              ...previous,
                              notional: event.target.value,
                            }))
                          }
                          placeholder="예: 1000"
                          disabled={tradingSubmitting}
                        />
                      </label>
                    </div>

                    <div className="trading-order-meta">
                      <span>
                        예상 체결금액:{' '}
                        {tradingEstimatedNotional !== null ? formatPrice(tradingEstimatedNotional) : '--'}
                      </span>
                      <span>
                        현재 포지션:{' '}
                        {selectedTradingPosition ? formatQty(selectedTradingPosition.qty) : '0'}
                      </span>
                    </div>

                    <div className="trading-order-actions">
                      <button type="submit" disabled={tradingSubmitting}>
                        {tradingSubmitting ? '주문 전송 중...' : '시장가 주문'}
                      </button>
                    </div>

                    {tradingFormError ? <p className="trading-error">{tradingFormError}</p> : null}
                  </form>

                  <div className="trading-lists-grid">
                    <section className="trading-list-card">
                      <div className="trading-list-title">포지션</div>
                      {tradingState.positions.length === 0 ? (
                        <p className="trading-empty">보유 포지션이 없습니다.</p>
                      ) : (
                        <div className="trading-table-wrap">
                          <table className="trading-table">
                            <thead>
                              <tr>
                                <th>심볼</th>
                                <th>수량</th>
                                <th>평단</th>
                                <th>현재가</th>
                                <th>미실현</th>
                                <th>실현</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tradingState.positions.map((position) => (
                                <tr key={position.symbol} className={position.symbol === selectedSymbol ? 'selected' : ''}>
                                  <td>{position.symbol}</td>
                                  <td>{formatQty(position.qty)}</td>
                                  <td>{formatPrice(position.avgPrice)}</td>
                                  <td>{formatPrice(position.marketPrice)}</td>
                                  <td className={position.unrealizedPnl >= 0 ? 'up' : 'down'}>
                                    {formatSignedCurrency(position.unrealizedPnl)}
                                  </td>
                                  <td className={position.realizedPnl >= 0 ? 'up' : 'down'}>
                                    {formatSignedCurrency(position.realizedPnl)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section className="trading-list-card">
                      <div className="trading-list-title">주문 내역</div>
                      {tradingState.orders.length === 0 ? (
                        <p className="trading-empty">주문 내역이 없습니다.</p>
                      ) : (
                        <div className="trading-table-wrap">
                          <table className="trading-table">
                            <thead>
                              <tr>
                                <th>시간</th>
                                <th>심볼</th>
                                <th>방향</th>
                                <th>수량</th>
                                <th>체결가</th>
                                <th>상태</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tradingState.orders.slice(0, 30).map((order) => (
                                <tr key={order.id}>
                                  <td>{new Date(order.createdAt).toLocaleString('ko-KR')}</td>
                                  <td>{order.symbol}</td>
                                  <td className={order.side === 'BUY' ? 'trading-side-buy' : 'trading-side-sell'}>
                                    {order.side}
                                  </td>
                                  <td>{formatQty(order.qty)}</td>
                                  <td>{typeof order.fillPrice === 'number' ? formatPrice(order.fillPrice) : '--'}</td>
                                  <td>{order.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section className="trading-list-card">
                      <div className="trading-list-title">체결 내역</div>
                      {tradingState.fills.length === 0 ? (
                        <p className="trading-empty">체결 내역이 없습니다.</p>
                      ) : (
                        <div className="trading-table-wrap">
                          <table className="trading-table">
                            <thead>
                              <tr>
                                <th>시간</th>
                                <th>심볼</th>
                                <th>방향</th>
                                <th>수량</th>
                                <th>가격</th>
                                <th>실현</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tradingState.fills.slice(0, 30).map((fill) => (
                                <tr key={fill.id}>
                                  <td>{new Date(fill.filledAt).toLocaleString('ko-KR')}</td>
                                  <td>{fill.symbol}</td>
                                  <td className={fill.side === 'BUY' ? 'trading-side-buy' : 'trading-side-sell'}>
                                    {fill.side}
                                  </td>
                                  <td>{formatQty(fill.qty)}</td>
                                  <td>{formatPrice(fill.price)}</td>
                                  <td className={fill.realizedPnl >= 0 ? 'up' : 'down'}>
                                    {formatSignedCurrency(fill.realizedPnl)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <p className="trading-empty">트레이딩 상태를 불러오지 못했습니다.</p>
              )}
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

export default App;
