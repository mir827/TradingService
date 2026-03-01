import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  computeCompareOverlay,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  type CompareScaleMode,
  toTimeValuePoints,
} from './lib/chartMath';
import {
  COMPARE_OVERLAY_COLORS,
  FETCH_COMPARE_ERROR,
  MAX_COMPARE_SYMBOLS,
  SAME_SYMBOL_COMPARE_ERROR,
  createEmptyCompareOverlaySlot,
  createInitialCompareOverlaySlots,
  finalizeCompareSlotFetch,
  normalizeCompareScaleMode,
  startCompareSlotFetch,
  type CompareOverlaySlot,
  type CompareSlotFetchResult,
} from './lib/compareOverlay';
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
  normalizeVenueForSymbol,
  normalizeVenuePreference,
  marketExchangeText,
  shortTicker,
  type KrVenue,
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
import { getFavoriteIntervalHotkeyIndex, isTypingInputTarget } from './lib/hotkeys';
import { parsePineStrategyTesterDirectivesWithMeta } from './lib/pineStrategyDirectives';
import {
  DEFAULT_PINE_SCRIPT_SOURCE,
  clampPineScriptName,
  clampPineScriptSource,
  createPineScriptId,
  createUniquePineScriptName,
  duplicatePineScript,
  deletePineScript,
  filterPineScriptsByName,
  getPineEditorGuardrailWarnings,
  renamePineScript,
  readPineWorkspace,
  setActivePineScript,
  upsertPineScript,
  writePineWorkspace,
  type PineScript,
  type PineWorkspaceState,
} from './lib/pineStorage';
import {
  readStrategyTesterForm,
  writeStrategyTesterForm,
  type StrategyTesterFormState,
  type StrategyTesterLinkedScript,
} from './lib/strategyTesterStorage';
import {
  emitOpsErrorTelemetry,
  emitOpsRecoveryTelemetry,
  fetchOpsTelemetryFeed,
  normalizeApiOperationError,
  type OpsErrorEvent,
  type OpsRecoveryEvent,
  type OpsTelemetrySource,
} from './lib/apiOperations';
import {
  filterAlertCenterEvents,
  normalizeAlertCenterEventType,
  normalizeAlertLifecycleState,
  summarizeAlertRuleStates,
  type AlertCenterEventType,
  type AlertLifecycleState,
} from './lib/alertCenter';
import { normalizeKrxNxtComparisonInfo, normalizeQuoteDisplayBasis, type NxtQuoteInfo } from './lib/nxt';
import {
  formatMarketStatusReason,
  normalizeVenueCheckedAt,
  normalizeVenueSessionBadges,
  type MarketStatusWithVenues,
} from './lib/marketStatus';
import {
  normalizeCrosshairInspectorSnapshot,
  toInspectorTimeValueMap,
  type CrosshairInspectorCompareInput,
  type CrosshairInspectorIndicatorInput,
} from './lib/crosshairInspector';
import { buildDrawingOverlayGeometry } from './lib/drawingOverlay';
import { snapToNearestCandleAnchor } from './lib/drawingMagnet';

type SymbolItem = {
  symbol: string;
  code?: string;
  name: string;
  market: MarketType;
  exchange?: string;
  venue?: KrVenue;
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CompareOverlayState = CompareOverlaySlot<Candle>;
type CompareOverlayConfig = {
  symbol: string;
  visible: boolean;
};

type Quote = {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  requestedVenue?: KrVenue | 'COMBINED';
  effectiveVenue?: KrVenue;
  venueFallback?: string;
  nxt?: NxtQuoteInfo;
};

type MarketStatus = MarketStatusWithVenues;

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
  venue?: KrVenue;
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
  venue?: KrVenue;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  currentValue?: number;
  triggeredAt: number;
  cooldownSec: number;
  indicatorConditions?: AlertIndicatorCondition[];
  eventType?: AlertCenterEventType;
  state?: AlertLifecycleState;
  transition?: AlertStateTransition;
  errorMessage?: string;
};

type AlertHistorySource = 'manual' | 'watchlist';
type AlertHistorySourceFilter = 'all' | AlertHistorySource;
type AlertHistoryStateFilter = 'all' | AlertLifecycleState;
type AlertHistoryTypeFilter = 'all' | AlertCenterEventType;

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
  source: AlertHistorySource;
  sourceSymbol?: string;
};

type AlertLastErrorMetadata = {
  failedAt: number;
  message: string;
  source: AlertHistorySource;
  sourceSymbol?: string;
};

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
type PineStatusMessage = {
  tone: 'info' | 'error';
  text: string;
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
type BottomTab = 'pine' | 'strategy' | 'trading' | 'objects' | 'ops';
type TopActionKey = 'indicator' | 'compare' | 'replay';
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

type StrategyFormField = Exclude<keyof StrategyTesterFormState, 'linkedScript'>;

type StrategyBacktestSummary = {
  grossPnl?: number;
  netPnl: number;
  grossReturnPct?: number;
  returnPct: number;
  totalFees?: number;
  totalSlippage?: number;
  totalCosts?: number;
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
  signalEntryPrice?: number;
  signalExitPrice?: number;
  grossPnl?: number;
  netPnl?: number;
  feePaid?: number;
  slippageCost?: number;
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
type TradingOrderType = 'MARKET' | 'LIMIT' | 'STOP';
type TradingOrderStatus = 'PENDING' | 'FILLED' | 'CANCELED' | 'REJECTED';
type TradingOrderLinkType = 'BRACKET_TAKE_PROFIT' | 'BRACKET_STOP_LOSS';

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
  orderType: TradingOrderType;
  qty: string;
  limitPrice: string;
  triggerPrice: string;
  useBracket: boolean;
  takeProfitPrice: string;
  stopLossPrice: string;
};

type HorizontalLine = DrawingFlagState & {
  id: string;
  price: number;
  line: IPriceLine;
};

type DrawingFlagState = {
  visible: boolean;
  locked: boolean;
};

type HorizontalLineState = Pick<HorizontalLine, 'id' | 'price'> & DrawingFlagState;
type VerticalLineState = DrawingFlagState & {
  id: string;
  time: UTCTimestamp;
};
type TrendlineState = DrawingFlagState & {
  id: string;
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
};
type RayState = DrawingFlagState & {
  id: string;
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
};
type RectangleState = DrawingFlagState & {
  id: string;
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
};
type NoteState = DrawingFlagState & {
  id: string;
  time: UTCTimestamp;
  price: number;
  text: string;
};
type ToolKey = 'cursor' | 'crosshair' | 'vertical' | 'horizontal' | 'trendline' | 'ray' | 'rectangle' | 'note';
type DrawingKind = 'horizontal' | 'vertical' | 'trendline' | 'ray' | 'rectangle' | 'note';
type PendingShapeTool = 'trendline' | 'ray' | 'rectangle';
type DrawingPayloadItem =
  | { id: string; type: 'horizontal'; price: number; visible: boolean; locked: boolean }
  | { id: string; type: 'vertical'; time: number; visible: boolean; locked: boolean }
  | {
      id: string;
      type: 'trendline';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible: boolean;
      locked: boolean;
    }
  | {
      id: string;
      type: 'ray';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible: boolean;
      locked: boolean;
    }
  | {
      id: string;
      type: 'rectangle';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible: boolean;
      locked: boolean;
    }
  | { id: string; type: 'note'; time: number; price: number; text: string; visible: boolean; locked: boolean };

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
  compareOverlays: CompareOverlayConfig[];
  compareScaleMode: CompareScaleMode;
  chartLayoutMode: ChartLayoutMode;
};

type ChartHistoryDrawingSnapshot = Pick<
  ChartHistorySnapshot,
  'horizontalLines' | 'verticalLines' | 'trendlines' | 'rays' | 'rectangles' | 'notes'
>;

const intervals = ['1', '5', '15', '60', '240', '1D', '1W', '1M', '1Y'];
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
];
const topActions: Array<{ key: TopActionKey; label: string }> = [
  { key: 'indicator', label: '지표' },
  { key: 'compare', label: '비교' },
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
const compareScaleModeOptions: Array<{ key: CompareScaleMode; label: string }> = [
  { key: 'normalized', label: '% 정규화' },
  { key: 'absolute', label: '절대값' },
];
const DUPLICATE_COMPARE_SYMBOL_ERROR = '이미 비교 목록에 추가된 심볼입니다.';
const bottomTabs: Array<{ id: BottomTab; label: string }> = [
  { id: 'pine', label: 'Pine Editor' },
  { id: 'strategy', label: '전략 테스터' },
  { id: 'trading', label: '트레이딩 패널' },
  { id: 'objects', label: '도형 오브젝트' },
  { id: 'ops', label: '운영 로그' },
];

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';
const WATCH_PREFS_STORAGE_KEY = 'tradingservice.watchprefs.v1';
const ALERT_AUTO_CHECK_STORAGE_KEY = 'tradingservice.alerts.autocheck.v1';
const INDICATOR_PREFS_STORAGE_KEY = 'tradingservice.indicators.v2';
const BOTTOM_PANEL_HEIGHT_STORAGE_KEY = 'tradingservice.bottompanel.height.v1';
const DEFAULT_WATCHLIST_NAME = 'default';
const ALERT_EVENT_DEDUP_WINDOW_MS = 10_000;
const ALERT_EVENT_MAX_ITEMS = 20;
const STRATEGY_RECENT_TRADES_LIMIT = 8;
const STRATEGY_MAX_FEE_BPS = 2000;
const STRATEGY_MAX_FEE_PERCENT = STRATEGY_MAX_FEE_BPS / 100;
const STRATEGY_MAX_SLIPPAGE_TICK = 1_000_000;
const STRATEGY_MAX_SLIPPAGE_PERCENT = 10;
const STRATEGY_MAX_FIXED_QTY = 1_000_000_000;
const HOVER_TOOLTIP_WIDTH = 232;
const HOVER_TOOLTIP_HEIGHT = 174;
const HOVER_TOOLTIP_MARGIN = 14;
const DRAWING_HIT_TOLERANCE_PX = 8;
const NOTE_HIT_RADIUS_PX = 14;
const INDICATOR_PREFS_VERSION = 2;
const CHART_HISTORY_LIMIT = 100;
const TOPBAR_HEIGHT_PX = 52;
const BOTTOM_PANEL_MIN_HEIGHT_PX = 180;
const BOTTOM_PANEL_MAX_HEIGHT_PX = 560;
const CENTER_PANEL_MIN_HEIGHT_PX = 260;
const DEFAULT_TRADING_ORDER_FORM: TradingOrderFormState = {
  side: 'BUY',
  orderType: 'MARKET',
  qty: '',
  limitPrice: '',
  triggerPrice: '',
  useBracket: false,
  takeProfitPrice: '',
  stopLossPrice: '',
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

function createIndicatorValueLookups(): Record<IndicatorSeriesKey, Map<number, number>> {
  return {
    sma20: new Map<number, number>(),
    sma60: new Map<number, number>(),
    ema20: new Map<number, number>(),
    rsi: new Map<number, number>(),
    macd: new Map<number, number>(),
    macdSignal: new Map<number, number>(),
    bbBasis: new Map<number, number>(),
    bbUpper: new Map<number, number>(),
    bbLower: new Map<number, number>(),
  };
}

const EMPTY_TIME_VALUE_LOOKUP = new Map<number, number>();

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
    compareOverlays: snapshot.compareOverlays.map((overlay) => ({ ...overlay })),
    compareScaleMode: normalizeCompareScaleMode(snapshot.compareScaleMode),
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

function getDefaultBottomPanelHeight(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return 224;
  if (viewportWidth <= 960) return 196;
  if (viewportWidth <= 1200) return 208;
  return 224;
}

function getBottomPanelHeightBounds(viewportHeight: number): { min: number; max: number } {
  const normalizedViewportHeight = Number.isFinite(viewportHeight) ? viewportHeight : 900;
  const maxByViewport = Math.max(120, normalizedViewportHeight - TOPBAR_HEIGHT_PX - CENTER_PANEL_MIN_HEIGHT_PX);
  const max = Math.max(120, Math.min(BOTTOM_PANEL_MAX_HEIGHT_PX, Math.floor(maxByViewport)));
  const min = Math.min(BOTTOM_PANEL_MIN_HEIGHT_PX, max);

  return { min, max };
}

function clampBottomPanelHeight(height: number, viewportHeight: number): number {
  const { min, max } = getBottomPanelHeightBounds(viewportHeight);

  if (!Number.isFinite(height)) return min;

  return Math.min(max, Math.max(min, Math.round(height)));
}

function getStoredBottomPanelHeight(): number {
  if (typeof window === 'undefined') return getDefaultBottomPanelHeight(1280);

  const defaultHeight = getDefaultBottomPanelHeight(window.innerWidth);
  const raw = window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const initialHeight = Number.isFinite(parsed) ? parsed : defaultHeight;

  return clampBottomPanelHeight(initialHeight, window.innerHeight);
}

type PineEditorBootstrap = {
  workspace: PineWorkspaceState;
  activeScriptId: string | null;
  scriptName: string;
  scriptSource: string;
  status: PineStatusMessage | null;
};

function getInitialPineEditorBootstrap(): PineEditorBootstrap {
  const loaded = readPineWorkspace();
  const activeScript =
    loaded.state.activeScriptId !== null
      ? loaded.state.scripts.find((script) => script.id === loaded.state.activeScriptId) ?? null
      : null;
  const initialName = activeScript?.name ?? createUniquePineScriptName('New Script', loaded.state.scripts);
  const status = loaded.error
    ? {
        tone: 'error' as const,
        text: loaded.error,
      }
    : null;

  return {
    workspace: loaded.state,
    activeScriptId: activeScript?.id ?? null,
    scriptName: initialName,
    scriptSource: activeScript?.source ?? DEFAULT_PINE_SCRIPT_SOURCE,
    status,
  };
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

function formatOptionalTimestamp(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return new Date(value).toLocaleString('ko-KR');
}

function formatStrategyDirectiveValue(value: number) {
  return Number.isInteger(value) ? String(Math.trunc(value)) : String(value);
}

type VenuePreferenceValue = '' | KrVenue;

function normalizeSymbolItemVenue(item: SymbolItem): SymbolItem {
  const rest = { ...item };
  delete rest.venue;
  const normalizedVenue = normalizeVenueForSymbol(item, item.venue);
  return normalizedVenue ? { ...rest, venue: normalizedVenue } : rest;
}

function toVenuePreferenceValue(venue?: string | null): VenuePreferenceValue {
  return normalizeVenuePreference(venue) ?? '';
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

function formatAlertState(state?: AlertLifecycleState | null) {
  const normalized = normalizeAlertLifecycleState(state);
  if (normalized === 'active') return 'active';
  if (normalized === 'triggered') return 'triggered';
  if (normalized === 'cooldown') return 'cooldown';
  return 'error';
}

function formatAlertEventType(eventType?: AlertCenterEventType | null) {
  const normalized = normalizeAlertCenterEventType(eventType);
  return normalized === 'error' ? 'error' : 'triggered';
}

function formatAlertTransitionReason(reason?: AlertStateTransitionReason) {
  if (reason === 'ruleCreated') return 'rule created';
  if (reason === 'conditionMet') return 'condition met';
  if (reason === 'conditionNotMet') return 'condition not met';
  if (reason === 'cooldownSuppressed') return 'cooldown suppression';
  if (reason === 'evaluationError') return 'evaluation error';
  return 'state update';
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

function toNormalizedMagnetPoint(time: number, price: number, magnetEnabled: boolean, candles: Candle[]) {
  const normalizedTime = toTimestampValue(time);
  const normalizedPrice = normalizeLinePrice(price);

  if (!magnetEnabled || candles.length === 0) {
    return {
      time: normalizedTime,
      price: normalizedPrice,
    };
  }

  const snapped = snapToNearestCandleAnchor(
    {
      time: normalizedTime,
      price: normalizedPrice,
    },
    candles,
  );

  if (!snapped) {
    return {
      time: normalizedTime,
      price: normalizedPrice,
    };
  }

  return {
    time: toTimestampValue(snapped.time),
    price: normalizeLinePrice(snapped.price),
  };
}

function normalizeDrawingFlag(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
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

function formatDrawingKindLabel(kind: DrawingKind) {
  if (kind === 'horizontal') return '수평선';
  if (kind === 'vertical') return '수직선';
  if (kind === 'trendline') return '추세선';
  if (kind === 'ray') return '레이';
  if (kind === 'rectangle') return '사각형';
  return '노트';
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

function formatTradingOrderType(orderType: TradingOrderType) {
  if (orderType === 'MARKET') return '시장가';
  if (orderType === 'LIMIT') return '지정가';
  return '스탑';
}

function shortenTradingOrderId(orderId: string) {
  return orderId.length > 14 ? `${orderId.slice(0, 7)}…${orderId.slice(-4)}` : orderId;
}

function formatTradingOrderCondition(order: TradingOrder) {
  if (order.type === 'LIMIT') {
    return typeof order.limitPrice === 'number' ? `L ${formatPrice(order.limitPrice)}` : '--';
  }

  if (order.type === 'STOP') {
    return typeof order.triggerPrice === 'number' ? `S ${formatPrice(order.triggerPrice)}` : '--';
  }

  return '--';
}

function formatTradingOrderLink(order: TradingOrder) {
  if (order.parentOrderId) {
    const role = order.linkType === 'BRACKET_STOP_LOSS' ? 'SL' : order.linkType === 'BRACKET_TAKE_PROFIT' ? 'TP' : 'CHILD';
    return `${role} ← ${shortenTradingOrderId(order.parentOrderId)}`;
  }

  if (order.bracketChildOrderIds?.length) {
    return `CHILD x${order.bracketChildOrderIds.length}`;
  }

  return '--';
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

function TradingServiceMark() {
  return (
    <svg viewBox="0 0 24 24" className="brand-mark" aria-hidden="true">
      <rect x="1.25" y="1.25" width="21.5" height="21.5" rx="6" className="brand-mark-frame" />
      <line x1="6" y1="7" x2="18" y2="7" className="brand-mark-grid" />
      <line x1="6" y1="12" x2="18" y2="12" className="brand-mark-grid" />
      <line x1="6" y1="17" x2="18" y2="17" className="brand-mark-grid" />
      <line x1="8" y1="7.8" x2="8" y2="15.9" className="brand-mark-wick-up" />
      <rect x="6.8" y="10" width="2.4" height="3.8" rx="0.8" className="brand-mark-candle-up" />
      <line x1="15.2" y1="8.2" x2="15.2" y2="16.8" className="brand-mark-wick-down" />
      <rect x="14" y="12.2" width="2.4" height="3.2" rx="0.8" className="brand-mark-candle-down" />
      <path d="M5.6 15.2L10 11.4L12.6 12.8L18.4 8.6" className="brand-mark-trend" />
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

function toCompareOverlayConfigs(overlays: CompareOverlayState[]): CompareOverlayConfig[] {
  return overlays.slice(0, MAX_COMPARE_SYMBOLS).map((overlay) => ({
    symbol: overlay.symbol.trim(),
    visible: overlay.visible,
  }));
}

function buildCompareOverlayStates(configs: CompareOverlayConfig[]): CompareOverlayState[] {
  const seenSymbols = new Set<string>();

  return Array.from({ length: MAX_COMPARE_SYMBOLS }, (_, index) => {
    const source = configs[index];
    const symbol = typeof source?.symbol === 'string' ? source.symbol.trim() : '';
    const visible = typeof source?.visible === 'boolean' ? source.visible : true;

    if (symbol && !seenSymbols.has(symbol)) {
      seenSymbols.add(symbol);
      return {
        symbol,
        visible,
        candles: [],
        loading: false,
        error: null,
      };
    }

    return createEmptyCompareOverlaySlot<Candle>();
  });
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
  const compareSeriesRefs = useRef<Array<ISeriesApi<'Line'> | null>>([]);
  const chartRangeSyncStateRef = useRef(createChartRangeSyncState());
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const activeToolRef = useRef<ToolKey>('cursor');
  const magnetEnabledRef = useRef(false);
  const activeCandlesRef = useRef<Candle[]>([]);
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
  const bottomPanelResizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const pineBootstrap = useMemo(() => getInitialPineEditorBootstrap(), []);

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
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [watchTab, setWatchTab] = useState<WatchTab>('watchlist');
  const [watchQuery, setWatchQuery] = useState('');
  const [watchSortKey, setWatchSortKey] = useState<WatchSortKey>(() => getStoredWatchPrefs().watchSortKey ?? 'symbol');
  const [watchSortDir, setWatchSortDir] = useState<WatchSortDir>(() => getStoredWatchPrefs().watchSortDir ?? 'asc');
  const [watchMarketFilter, setWatchMarketFilter] = useState<WatchMarketFilter>(() => getStoredWatchPrefs().watchMarketFilter ?? 'ALL');
  const [watchlistAddVenuePreference, setWatchlistAddVenuePreference] = useState<VenuePreferenceValue>('');
  const [searchResults, setSearchResults] = useState<SymbolItem[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(() => getStoredBottomPanelHeight());
  const [bottomPanelResizing, setBottomPanelResizing] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('pine');
  const [pineWorkspace, setPineWorkspace] = useState<PineWorkspaceState>(() => pineBootstrap.workspace);
  const [pineEditorScriptId, setPineEditorScriptId] = useState<string | null>(() => pineBootstrap.activeScriptId);
  const [pineEditorName, setPineEditorName] = useState(() => pineBootstrap.scriptName);
  const [pineEditorSource, setPineEditorSource] = useState(() => pineBootstrap.scriptSource);
  const [pineLibraryQuery, setPineLibraryQuery] = useState('');
  const [pineStatusMessage, setPineStatusMessage] = useState<PineStatusMessage | null>(() => pineBootstrap.status);
  const [strategyForm, setStrategyForm] = useState<StrategyTesterFormState>(() => readStrategyTesterForm());
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
  const [compareOverlays, setCompareOverlays] = useState<CompareOverlayState[]>(() =>
    createInitialCompareOverlaySlots<Candle>(),
  );
  const [compareScaleMode, setCompareScaleMode] = useState<CompareScaleMode>('normalized');
  const [topActionFeedback, setTopActionFeedback] = useState<string | null>(null);
  const [replayMode, setReplayMode] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const [replayStartBars, setReplayStartBars] = useState(0);
  const [replayVisibleBars, setReplayVisibleBars] = useState(0);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number } | null>(null);
  const [crosshairInspectorTime, setCrosshairInspectorTime] = useState<number | null>(null);
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
  const [alertVenuePreference, setAlertVenuePreference] = useState<VenuePreferenceValue>('');
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
  const [alertHistoryStateFilter, setAlertHistoryStateFilter] = useState<AlertHistoryStateFilter>('all');
  const [alertHistoryTypeFilter, setAlertHistoryTypeFilter] = useState<AlertHistoryTypeFilter>('all');
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
  const compareOverlaysStateRef = useRef(compareOverlays);
  const compareScaleModeStateRef = useRef<CompareScaleMode>(compareScaleMode);
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
    magnetEnabledRef.current = magnetEnabled;
  }, [magnetEnabled]);

  useEffect(() => {
    activeCandlesRef.current = activeCandles;
  }, [activeCandles]);

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
    compareOverlaysStateRef.current = compareOverlays;
  }, [compareOverlays]);

  useEffect(() => {
    compareScaleModeStateRef.current = compareScaleMode;
  }, [compareScaleMode]);

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
    setCrosshairInspectorTime(null);
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

  const toHorizontalLineState = useCallback((line: { id?: string; price: number; visible?: boolean; locked?: boolean }) => {
    const normalizedPrice = Number(line.price);
    if (!Number.isFinite(normalizedPrice)) return null;

    return {
      id: line.id?.trim() || createHorizontalLineId(),
      price: normalizeLinePrice(normalizedPrice),
      visible: normalizeDrawingFlag(line.visible, true),
      locked: normalizeDrawingFlag(line.locked, false),
    };
  }, []);

  const toVerticalLineState = useCallback((line: { id?: string; time: number; visible?: boolean; locked?: boolean }) => {
    const normalizedTime = Number(line.time);
    if (!Number.isFinite(normalizedTime)) return null;

    const timestamp = Math.floor(normalizedTime);
    if (timestamp <= 0) return null;

    return {
      id: line.id?.trim() || createVerticalLineId(),
      time: timestamp as UTCTimestamp,
      visible: normalizeDrawingFlag(line.visible, true),
      locked: normalizeDrawingFlag(line.locked, false),
    };
  }, []);

  const toTrendlineState = useCallback(
    (drawing: {
      id?: string;
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible?: boolean;
      locked?: boolean;
    }) => {
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
        visible: normalizeDrawingFlag(drawing.visible, true),
        locked: normalizeDrawingFlag(drawing.locked, false),
      };
    },
    [],
  );

  const toRayState = useCallback(
    (drawing: {
      id?: string;
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible?: boolean;
      locked?: boolean;
    }) => {
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
        visible: normalizeDrawingFlag(drawing.visible, true),
        locked: normalizeDrawingFlag(drawing.locked, false),
      };
    },
    [],
  );

  const toRectangleState = useCallback(
    (drawing: {
      id?: string;
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible?: boolean;
      locked?: boolean;
    }) => {
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
        visible: normalizeDrawingFlag(drawing.visible, true),
        locked: normalizeDrawingFlag(drawing.locked, false),
      };
    },
    [],
  );

  const toNoteState = useCallback((drawing: { id?: string; time: number; price: number; text: string; visible?: boolean; locked?: boolean }) => {
    const time = Math.floor(Number(drawing.time));
    const price = Number(drawing.price);
    const text = drawing.text.trim();

    if (time <= 0 || !Number.isFinite(price) || text.length === 0) return null;

    return {
      id: drawing.id?.trim() || createNoteId(),
      time: time as UTCTimestamp,
      price: normalizeLinePrice(price),
      text,
      visible: normalizeDrawingFlag(drawing.visible, true),
      locked: normalizeDrawingFlag(drawing.locked, false),
    };
  }, []);

  const snapshotHorizontalLines = useCallback((): HorizontalLineState[] => {
    return horizontalLinesRef.current.map((item) => ({
      id: item.id,
      price: item.price,
      visible: item.visible,
      locked: item.locked,
    }));
  }, []);

  const snapshotVerticalLines = useCallback((): VerticalLineState[] => {
    return verticalLinesRef.current.map((item) => ({
      id: item.id,
      time: item.time,
      visible: item.visible,
      locked: item.locked,
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
          visible: line.visible,
          locked: line.locked,
        })),
        ...markers.map((marker) => ({
          id: marker.id,
          type: 'vertical' as const,
          time: Number(marker.time),
          visible: marker.visible,
          locked: marker.locked,
        })),
        ...trendShapes.map((shape) => ({
          id: shape.id,
          type: 'trendline' as const,
          startTime: Number(shape.startTime),
          startPrice: shape.startPrice,
          endTime: Number(shape.endTime),
          endPrice: shape.endPrice,
          visible: shape.visible,
          locked: shape.locked,
        })),
        ...rayShapes.map((shape) => ({
          id: shape.id,
          type: 'ray' as const,
          startTime: Number(shape.startTime),
          startPrice: shape.startPrice,
          endTime: Number(shape.endTime),
          endPrice: shape.endPrice,
          visible: shape.visible,
          locked: shape.locked,
        })),
        ...rectangleShapes.map((shape) => ({
          id: shape.id,
          type: 'rectangle' as const,
          startTime: Number(shape.startTime),
          startPrice: shape.startPrice,
          endTime: Number(shape.endTime),
          endPrice: shape.endPrice,
          visible: shape.visible,
          locked: shape.locked,
        })),
        ...noteShapes.map((shape) => ({
          id: shape.id,
          type: 'note' as const,
          time: Number(shape.time),
          price: shape.price,
          text: shape.text,
          visible: shape.visible,
          locked: shape.locked,
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

      if (!item.visible) {
        node.style.display = 'none';
        continue;
      }

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
      visible: item.visible,
      locked: item.locked,
      line: series.createPriceLine({
        price: item.price,
        color: '#f5a623',
        lineWidth: 1,
        lineVisible: item.visible,
        axisLabelVisible: item.visible,
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
        lineVisible: item.visible,
        axisLabelVisible: item.visible,
      });
    }
  }, [horizontalLines, selectedDrawingId]);

  useEffect(() => {
    syncVerticalLinePositions();
  }, [syncVerticalLinePositions, verticalLines]);

  useEffect(() => {
    for (const [id, node] of verticalLineNodesRef.current.entries()) {
      const line = verticalLinesRef.current.find((item) => item.id === id);
      node.className = `vertical-line-marker${selectedDrawingId === id ? ' selected' : ''}${line?.locked ? ' locked' : ''}${
        line?.visible === false ? ' hidden' : ''
      }`;
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
            lines: lines.map((line) => ({
              id: line.id,
              price: line.price,
            })),
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
    const normalizedItems = items.map(normalizeSymbolItemVenue);
    const response = await fetch(`${apiBase}/api/watchlist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DEFAULT_WATCHLIST_NAME,
        items: normalizedItems,
      }),
    });

    if (!response.ok) {
      throw new Error('persist watchlist failed');
    }

    const data = (await response.json()) as { items?: SymbolItem[] };
    return (data.items ?? normalizedItems).map(normalizeSymbolItemVenue);
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
            visible?: boolean;
            locked?: boolean;
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
              const horizontalLine = toHorizontalLineState({
                id: drawing.id,
                price: drawing.price,
                visible: drawing.visible,
                locked: drawing.locked,
              });
              if (horizontalLine) {
                nextHorizontalLines.push(horizontalLine);
              }
            }

            if (drawing.type === 'vertical' && typeof drawing.time === 'number') {
              const verticalLine = toVerticalLineState({
                id: drawing.id,
                time: drawing.time,
                visible: drawing.visible,
                locked: drawing.locked,
              });
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
                visible: drawing.visible,
                locked: drawing.locked,
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
                visible: drawing.visible,
                locked: drawing.locked,
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
                visible: drawing.visible,
                locked: drawing.locked,
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
                visible: drawing.visible,
                locked: drawing.locked,
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
        compareOverlays: toCompareOverlayConfigs(compareOverlaysStateRef.current),
        compareScaleMode: compareScaleModeStateRef.current,
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
        compareOverlays: overrides?.compareOverlays ?? baseSnapshot.compareOverlays,
        compareScaleMode: overrides?.compareScaleMode ?? baseSnapshot.compareScaleMode,
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
      const previousCompareBySymbol = new Map(
        compareOverlaysStateRef.current
          .filter((overlay) => overlay.symbol)
          .map((overlay) => [overlay.symbol, overlay] as const),
      );
      const nextCompareOverlays = buildCompareOverlayStates(nextSnapshot.compareOverlays).map((overlay) => {
        if (!overlay.symbol) return overlay;
        const previous = previousCompareBySymbol.get(overlay.symbol);
        if (!previous) return overlay;
        return {
          ...previous,
          visible: overlay.visible,
          error: null,
          loading: false,
        };
      });
      setCompareOverlays(nextCompareOverlays);
      setCompareScaleMode(normalizeCompareScaleMode(nextSnapshot.compareScaleMode));
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

    window.localStorage.setItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, String(Math.round(bottomPanelHeight)));
  }, [bottomPanelHeight]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleWindowResize = () => {
      setBottomPanelHeight((prev) => clampBottomPanelHeight(prev, window.innerHeight));
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeUnifiedLayoutState({ chartLayoutMode });
  }, [chartLayoutMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeStrategyTesterForm(strategyForm);
  }, [strategyForm]);

  useEffect(() => {
    let canceled = false;

    const applyWatchlist = (nextSymbols: SymbolItem[]) => {
      if (canceled) return;
      const normalizedSymbols = nextSymbols.map(normalizeSymbolItemVenue);

      setWatchlistSymbols(normalizedSymbols);
      setSelectedSymbol((prev) => {
        if (normalizedSymbols.some((item) => item.symbol === prev)) {
          return prev;
        }

        return normalizedSymbols[0]?.symbol ?? prev;
      });
    };

    const loadSymbolsFallback = async () => {
      const response = await fetch(`${apiBase}/api/symbols`);
      if (!response.ok) {
        throw new Error('symbols fetch failed');
      }

      const data = (await response.json()) as { symbols?: SymbolItem[] };
      return (data.symbols ?? []).map(normalizeSymbolItemVenue);
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
        const items = (watchlistData.items ?? []).map(normalizeSymbolItemVenue);

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
    const compareSeries = COMPARE_OVERLAY_COLORS.map((color) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }),
    );

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
      setCrosshairInspectorTime(rawTime);
    };

    const onChartClick = (param: MouseEventParams<Time>) => {
      const nextTool = activeToolRef.current;
      const magnetOn = magnetEnabledRef.current;
      const magnetCandles = activeCandlesRef.current;

      if (nextTool === 'horizontal') {
        if (!param.point) return;

        const price = candleSeries.coordinateToPrice(param.point.y);
        if (typeof price !== 'number' || !Number.isFinite(price)) return;

        const normalizedPrice =
          typeof param.time === 'number'
            ? toNormalizedMagnetPoint(param.time, price, magnetOn, magnetCandles).price
            : normalizeLinePrice(price);
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
          visible: true,
          locked: false,
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

        const timestamp = toNormalizedMagnetPoint(param.time, 0, magnetOn, magnetCandles).time;
        const duplicated = verticalLinesRef.current.some((item) => Number(item.time) === Number(timestamp));
        if (duplicated) return;
        const beforeSnapshot = captureChartHistorySnapshot();

        const nextVerticalLines = [
          ...snapshotVerticalLines(),
          { id: createVerticalLineId(), time: timestamp, visible: true, locked: false },
        ];
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

        const snappedPoint = toNormalizedMagnetPoint(param.time, price, magnetOn, magnetCandles);
        const timestamp = snappedPoint.time;
        const normalizedPrice = snappedPoint.price;
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
                visible: true,
                locked: false,
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
                visible: true,
                locked: false,
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
                visible: true,
                locked: false,
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

      const snappedPoint = toNormalizedMagnetPoint(param.time, price, magnetOn, magnetCandles);
      const nextNotes = [
        ...snapshotNotes(),
        {
          id: createNoteId(),
          time: snappedPoint.time,
          price: snappedPoint.price,
          text,
          visible: true,
          locked: false,
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
    compareSeriesRefs.current = compareSeries;
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
      compareSeriesRefs.current = [];
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
      setCrosshairInspectorTime(null);
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

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const rawTime = param.time;
      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;

      if (typeof rawTime !== 'number' || !bar) {
        setCrosshairInspectorTime(null);
        return;
      }

      setCrosshairInspectorTime(rawTime);
    };

    chart.subscribeCrosshairMove(onCrosshairMove);
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
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      chart.remove();
      secondaryChartRef.current = null;
      secondaryCandleSeriesRef.current = null;
      secondaryVolumeSeriesRef.current = null;
      secondaryCloseSeriesRef.current = null;
      setCrosshairInspectorTime(null);
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
        const selectedMeta =
          watchlistSymbols.find((item) => item.symbol === selectedSymbol) ??
          searchResults.find((item) => item.symbol === selectedSymbol);
        const selectedMarketForCandles = selectedMeta?.market ?? 'CRYPTO';
        const selectedCandleVenue = normalizeVenueForSymbol(
          { symbol: selectedSymbol, market: selectedMarketForCandles },
          selectedMeta?.venue,
        );
        const venueQuery = selectedCandleVenue ? `&venue=${encodeURIComponent(selectedCandleVenue)}` : '';
        const response = await fetch(
          `${apiBase}/api/candles?symbol=${encodeURIComponent(selectedSymbol)}&interval=${encodeURIComponent(selectedInterval)}&limit=500${venueQuery}`,
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
  }, [clearHoveredCandle, searchResults, selectedInterval, selectedSymbol, watchlistSymbols]);

  const compareSymbolSignature = useMemo(
    () => compareOverlays.map((overlay) => overlay.symbol.trim()).join('|'),
    [compareOverlays],
  );

  useEffect(() => {
    let canceled = false;

    const loadCompareCandles = async () => {
      setCompareOverlays((prev) => startCompareSlotFetch(prev, selectedSymbol, SAME_SYMBOL_COMPARE_ERROR));

      const compareRequests = compareOverlaysStateRef.current
        .map((overlay, slotIndex) => ({
          slotIndex,
          symbol: overlay.symbol.trim(),
        }))
        .filter(({ symbol }) => symbol.length > 0 && symbol !== selectedSymbol);

      if (!compareRequests.length) return;

      const settled = await Promise.allSettled(
        compareRequests.map(async ({ slotIndex, symbol }) => {
          const response = await fetch(
            `${apiBase}/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(selectedInterval)}&limit=500`,
          );

          if (!response.ok) {
            throw new Error('compare candle fetch failed');
          }

          const data = (await response.json()) as { candles: Candle[] };
          return {
            slotIndex,
            symbol,
            candles: data.candles ?? [],
          };
        }),
      );

      if (canceled) return;

      const results: CompareSlotFetchResult<Candle>[] = settled.map((result, resultIndex) => {
        const request = compareRequests[resultIndex];
        if (result.status === 'fulfilled') {
          return {
            slotIndex: request.slotIndex,
            symbol: request.symbol,
            candles: result.value.candles,
          };
        }

        return {
          slotIndex: request.slotIndex,
          symbol: request.symbol,
          error: FETCH_COMPARE_ERROR,
        };
      });

      setCompareOverlays((prev) =>
        finalizeCompareSlotFetch({
          slots: prev,
          selectedSymbol,
          results,
          sameSymbolError: SAME_SYMBOL_COMPARE_ERROR,
          fetchError: FETCH_COMPARE_ERROR,
        }),
      );
    };

    void loadCompareCandles();

    return () => {
      canceled = true;
    };
  }, [compareSymbolSignature, selectedInterval, selectedSymbol]);

  const quoteTargets = useMemo(() => {
    const bySymbol = new Map<string, { symbol: string; venue?: KrVenue }>();

    for (const item of watchlistSymbols) {
      const symbol = item.symbol.trim().toUpperCase();
      if (!symbol) continue;

      const normalizedVenue = normalizeVenueForSymbol(item, item.venue);
      const existing = bySymbol.get(symbol);
      if (!existing) {
        bySymbol.set(symbol, normalizedVenue ? { symbol, venue: normalizedVenue } : { symbol });
        continue;
      }

      if (!existing.venue && normalizedVenue) {
        bySymbol.set(symbol, { symbol, venue: normalizedVenue });
      }
    }

    if (selectedSymbol) {
      const selected = selectedSymbol.trim().toUpperCase();
      const selectedMeta =
        watchlistSymbols.find((item) => item.symbol === selected) ?? searchResults.find((item) => item.symbol === selected);
      const selectedVenue = selectedMeta ? normalizeVenueForSymbol(selectedMeta, selectedMeta.venue) : undefined;
      const existing = bySymbol.get(selected);

      if (!existing) {
        bySymbol.set(selected, selectedVenue ? { symbol: selected, venue: selectedVenue } : { symbol: selected });
      } else if (!existing.venue && selectedVenue) {
        bySymbol.set(selected, { symbol: selected, venue: selectedVenue });
      }
    }

    return [...bySymbol.values()].slice(0, 40);
  }, [searchResults, selectedSymbol, watchlistSymbols]);

  useEffect(() => {
    if (!quoteTargets.length) return;

    let canceled = false;

    const pullQuotes = async () => {
      const settled = await Promise.allSettled(
        quoteTargets.map(async ({ symbol, venue }) => {
          const venueQuery = venue ? `&venue=${encodeURIComponent(venue)}` : '';
          const res = await fetch(`${apiBase}/api/quote?symbol=${encodeURIComponent(symbol)}${venueQuery}`);
          if (!res.ok) throw new Error(symbol);
          const quote = (await res.json()) as Quote;
          return [symbol, quote] as const;
        }),
      );

      if (canceled) {
        return;
      }

      const successfulEntries = settled
        .filter((result): result is PromiseFulfilledResult<readonly [string, Quote]> => result.status === 'fulfilled')
        .map((result) => result.value);

      if (successfulEntries.length) {
        setQuotes((prev) => ({ ...prev, ...Object.fromEntries(successfulEntries) }));
      }

      if (settled.some((result) => result.status === 'rejected')) {
        setError((prev) => prev ?? '일부 시세 정보를 업데이트하지 못했습니다.');
      }
    };

    pullQuotes();
    const timer = window.setInterval(pullQuotes, 15000);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [quoteTargets]);

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
          setSearchResults((data.items ?? []).map(normalizeSymbolItemVenue));
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
      const normalizedRules = (data.rules ?? []).map((rule) => {
        const venue = normalizeVenuePreference(rule.venue);
        return {
          ...rule,
          ...(venue ? { venue } : {}),
        } satisfies AlertRule;
      });
      setAlertRules(normalizedRules);
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
      if (alertHistoryStateFilter !== 'all') {
        params.set('state', alertHistoryStateFilter);
      }
      if (alertHistoryTypeFilter !== 'all') {
        params.set('type', alertHistoryTypeFilter);
      } else {
        params.set('type', 'all');
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
      const normalizedEvents = (data.events ?? []).map((eventItem) => {
        const eventType = normalizeAlertCenterEventType(eventItem.eventType);
        const venue = normalizeVenuePreference(eventItem.venue);
        return {
          ...eventItem,
          ...(venue ? { venue } : {}),
          eventType,
          state: normalizeAlertLifecycleState(eventItem.state ?? (eventType === 'error' ? 'error' : 'triggered')),
        } satisfies AlertHistoryEvent;
      });
      setAlertHistoryEvents(normalizedEvents);
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
  }, [
    alertHistoryIndicatorAwareOnly,
    alertHistorySourceFilter,
    alertHistoryStateFilter,
    alertHistorySymbolFilter,
    alertHistoryTypeFilter,
    reportOpsError,
  ]);

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

  const compareComputedOverlays = useMemo(
    () =>
      compareOverlays.map((overlay, slotIndex) => {
        const symbol = overlay.symbol.trim();
        if (!symbol || overlay.loading || overlay.error) {
          return {
            slotIndex,
            symbol,
            points: [],
            anchor: null,
            lastValue: null,
          };
        }

        const computed = computeCompareOverlay(activeCandles, overlay.candles, compareScaleMode);
        const lastPoint = computed.points.length > 0 ? computed.points[computed.points.length - 1] : null;

        return {
          slotIndex,
          symbol,
          points: computed.points,
          anchor: computed.anchor,
          lastValue: typeof lastPoint?.value === 'number' ? lastPoint.value : null,
        };
      }),
    [activeCandles, compareOverlays, compareScaleMode],
  );

  const indicatorValueLookups = useMemo(() => {
    const lookups = createIndicatorValueLookups();
    if (activeCandles.length === 0) return lookups;

    const closeValues = activeCandles.map((candle) => candle.close);

    if (enabledIndicators.sma20) {
      lookups.sma20 = toInspectorTimeValueMap(activeCandles, calculateSMA(closeValues, 20));
    }
    if (enabledIndicators.sma60) {
      lookups.sma60 = toInspectorTimeValueMap(activeCandles, calculateSMA(closeValues, 60));
    }
    if (enabledIndicators.ema20) {
      lookups.ema20 = toInspectorTimeValueMap(activeCandles, calculateEMA(closeValues, 20));
    }
    if (enabledIndicators.rsi) {
      lookups.rsi = toInspectorTimeValueMap(activeCandles, calculateRSI(closeValues, indicatorSettings.rsi.period));
    }
    if (enabledIndicators.macd) {
      const macd = calculateMACD(
        closeValues,
        indicatorSettings.macd.fast,
        indicatorSettings.macd.slow,
        indicatorSettings.macd.signal,
      );
      lookups.macd = toInspectorTimeValueMap(activeCandles, macd.macdLine);
      lookups.macdSignal = toInspectorTimeValueMap(activeCandles, macd.signalLine);
    }
    if (enabledIndicators.bbands) {
      const bollinger = calculateBollingerBands(
        closeValues,
        indicatorSettings.bollinger.period,
        indicatorSettings.bollinger.stdDev,
      );
      lookups.bbBasis = toInspectorTimeValueMap(activeCandles, bollinger.basis);
      lookups.bbUpper = toInspectorTimeValueMap(activeCandles, bollinger.upper);
      lookups.bbLower = toInspectorTimeValueMap(activeCandles, bollinger.lower);
    }

    return lookups;
  }, [activeCandles, enabledIndicators, indicatorSettings]);

  const compareValueLookups = useMemo(
    () =>
      compareComputedOverlays.map((overlay) =>
        toInspectorTimeValueMap(
          overlay.points,
          overlay.points.map((point) => point.value),
        ),
      ),
    [compareComputedOverlays],
  );

  useEffect(() => {
    for (let slotIndex = 0; slotIndex < MAX_COMPARE_SYMBOLS; slotIndex += 1) {
      const series = compareSeriesRefs.current[slotIndex];
      if (!series) continue;

      const overlay = compareOverlays[slotIndex];
      const computed = compareComputedOverlays[slotIndex];

      if (
        !overlay ||
        !overlay.symbol ||
        !overlay.visible ||
        overlay.loading ||
        overlay.error ||
        !computed ||
        computed.points.length === 0
      ) {
        series.setData([]);
        continue;
      }

      const points: LineData[] = computed.points.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      }));
      series.setData(points);
    }
  }, [compareComputedOverlays, compareOverlays]);

  const selectedQuote = quotes[selectedSymbol];
  const selectedTradingPosition = useMemo(
    () => tradingState?.positions.find((position) => position.symbol === selectedSymbol) ?? null,
    [selectedSymbol, tradingState],
  );
  const tradingEstimatedNotional = useMemo(() => {
    const qtyInput = tradingOrderForm.qty.trim();
    if (!qtyInput) return null;

    const qty = Number(qtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      return null;
    }

    if (tradingOrderForm.orderType === 'LIMIT') {
      const limitPrice = Number(tradingOrderForm.limitPrice.trim());
      if (Number.isFinite(limitPrice) && limitPrice > 0) {
        return qty * limitPrice;
      }
      return null;
    }

    if (tradingOrderForm.orderType === 'STOP') {
      const triggerPrice = Number(tradingOrderForm.triggerPrice.trim());
      if (Number.isFinite(triggerPrice) && triggerPrice > 0) {
        return qty * triggerPrice;
      }
      return null;
    }

    if (selectedQuote) {
      return qty * selectedQuote.lastPrice;
    }

    return null;
  }, [
    selectedQuote,
    tradingOrderForm.limitPrice,
    tradingOrderForm.orderType,
    tradingOrderForm.qty,
    tradingOrderForm.triggerPrice,
  ]);
  const tradingUpdatedAt = tradingState?.updatedAt ?? tradingLastUpdatedAt;
  const latestCandle = activeCandles.at(-1) ?? null;
  const activeCandleByTime = useMemo(() => new Map(activeCandles.map((candle) => [candle.time, candle])), [activeCandles]);
  const crosshairInspectorIndicatorInputs = useMemo<CrosshairInspectorIndicatorInput[]>(() => {
    const inputs: CrosshairInspectorIndicatorInput[] = [];

    if (enabledIndicators.sma20) {
      inputs.push({ key: 'sma20', label: 'SMA 20', valuesByTime: indicatorValueLookups.sma20 });
    }
    if (enabledIndicators.sma60) {
      inputs.push({ key: 'sma60', label: 'SMA 60', valuesByTime: indicatorValueLookups.sma60 });
    }
    if (enabledIndicators.ema20) {
      inputs.push({ key: 'ema20', label: 'EMA 20', valuesByTime: indicatorValueLookups.ema20 });
    }
    if (enabledIndicators.rsi) {
      inputs.push({ key: 'rsi', label: `RSI ${indicatorSettings.rsi.period}`, valuesByTime: indicatorValueLookups.rsi });
    }
    if (enabledIndicators.macd) {
      inputs.push({ key: 'macd', label: 'MACD', valuesByTime: indicatorValueLookups.macd });
      inputs.push({ key: 'macdSignal', label: 'MACD Signal', valuesByTime: indicatorValueLookups.macdSignal });
    }
    if (enabledIndicators.bbands) {
      inputs.push({ key: 'bbBasis', label: 'BB Basis', valuesByTime: indicatorValueLookups.bbBasis });
      inputs.push({ key: 'bbUpper', label: 'BB Upper', valuesByTime: indicatorValueLookups.bbUpper });
      inputs.push({ key: 'bbLower', label: 'BB Lower', valuesByTime: indicatorValueLookups.bbLower });
    }

    return inputs;
  }, [enabledIndicators, indicatorSettings, indicatorValueLookups]);
  const crosshairInspectorCompareInputs = useMemo<CrosshairInspectorCompareInput[]>(
    () =>
      compareOverlays.flatMap((overlay, slotIndex) => {
        const symbol = overlay.symbol.trim();
        if (!symbol || !overlay.visible || overlay.loading || overlay.error) {
          return [];
        }

        return [
          {
            slotIndex,
            symbol: `비교 ${slotIndex + 1} ${shortTicker(symbol)}`,
            visible: overlay.visible,
            valuesByTime: compareValueLookups[slotIndex] ?? EMPTY_TIME_VALUE_LOOKUP,
          },
        ];
      }),
    [compareOverlays, compareValueLookups],
  );
  const crosshairInspectorSnapshot = useMemo(
    () =>
      normalizeCrosshairInspectorSnapshot({
        crosshairTime: crosshairInspectorTime,
        latestCandle,
        candlesByTime: activeCandleByTime,
        indicatorInputs: crosshairInspectorIndicatorInputs,
        compareInputs: crosshairInspectorCompareInputs,
      }),
    [
      activeCandleByTime,
      crosshairInspectorCompareInputs,
      crosshairInspectorIndicatorInputs,
      crosshairInspectorTime,
      latestCandle,
    ],
  );
  const crosshairInspectorCandle = crosshairInspectorSnapshot.candle;
  const crosshairInspectorCompareModeLabel = compareScaleMode === 'normalized' ? '% 정규화' : '절대값';
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
  const watchlistAlertItems = useMemo(() => {
    const bySymbol = new Map<string, { symbol: string; venue?: KrVenue }>();

    for (const item of watchlistSymbols) {
      const symbol = item.symbol.trim().toUpperCase();
      if (!symbol) continue;

      const venue = normalizeVenueForSymbol(item, item.venue);
      const existing = bySymbol.get(symbol);

      if (!existing) {
        bySymbol.set(symbol, venue ? { symbol, venue } : { symbol });
        continue;
      }

      if (!existing.venue && venue) {
        bySymbol.set(symbol, { symbol, venue });
      }
    }

    return [...bySymbol.values()].slice(0, 40);
  }, [watchlistSymbols]);
  const watchlistAlertSymbols = useMemo(() => watchlistAlertItems.map((item) => item.symbol), [watchlistAlertItems]);
  const watchlistAlertVenues = useMemo(() => {
    const entries = watchlistAlertItems
      .filter((item): item is { symbol: string; venue: KrVenue } => Boolean(item.venue))
      .map((item) => [item.symbol, item.venue] as const);
    return entries.length ? Object.fromEntries(entries) : null;
  }, [watchlistAlertItems]);

  const selectedSymbolMeta = useMemo(
    () => watchlistSymbols.find((item) => item.symbol === selectedSymbol) ?? searchResults.find((item) => item.symbol === selectedSymbol),
    [searchResults, selectedSymbol, watchlistSymbols],
  );
  const selectedMarket = selectedSymbolMeta?.market ?? 'CRYPTO';
  const selectedSymbolVenueSupported =
    normalizeVenueForSymbol({ symbol: selectedSymbol, market: selectedMarket }, 'KRX') === 'KRX';
  const selectedSymbolDefaultVenue = useMemo(
    () => (selectedSymbolVenueSupported ? toVenuePreferenceValue(selectedSymbolMeta?.venue) : ''),
    [selectedSymbolMeta?.venue, selectedSymbolVenueSupported],
  );
  const selectedChartVenue = useMemo(
    () =>
      selectedSymbolVenueSupported
        ? normalizeVenueForSymbol({ symbol: selectedSymbol, market: selectedMarket }, selectedSymbolMeta?.venue)
        : undefined,
    [selectedMarket, selectedSymbol, selectedSymbolMeta?.venue, selectedSymbolVenueSupported],
  );
  const selectedVenueCheckedAt = useMemo(() => normalizeVenueCheckedAt(marketStatus), [marketStatus]);
  const selectedKrxNxtComparison = useMemo(
    () => normalizeKrxNxtComparisonInfo(selectedMarket, selectedQuote, selectedVenueCheckedAt),
    [selectedMarket, selectedQuote, selectedVenueCheckedAt],
  );
  const selectedQuoteDisplayBasis = useMemo(
    () => normalizeQuoteDisplayBasis(selectedMarket, selectedQuote),
    [selectedMarket, selectedQuote],
  );
  const selectedVenueSessionBadges = useMemo(
    () => normalizeVenueSessionBadges(selectedMarket, marketStatus),
    [selectedMarket, marketStatus],
  );
  const appStyle = useMemo(
    () =>
      ({
        '--tv-bottom-panel-height': `${bottomPanelHeight}px`,
      }) as CSSProperties,
    [bottomPanelHeight],
  );

  useEffect(() => {
    setAlertVenuePreference(selectedSymbolDefaultVenue);
  }, [selectedSymbol, selectedSymbolDefaultVenue]);

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

  const pineActiveScript = useMemo(
    () => (pineEditorScriptId ? pineWorkspace.scripts.find((script) => script.id === pineEditorScriptId) ?? null : null),
    [pineEditorScriptId, pineWorkspace.scripts],
  );
  const pineLibraryScripts = useMemo(
    () => filterPineScriptsByName(pineWorkspace.scripts, pineLibraryQuery),
    [pineLibraryQuery, pineWorkspace.scripts],
  );
  const pineActiveScriptName = pineActiveScript?.name ?? '';
  const pineEditorGuardrailWarnings = useMemo(
    () => getPineEditorGuardrailWarnings(pineEditorName, pineEditorSource),
    [pineEditorName, pineEditorSource],
  );
  const pineEditorDirty = useMemo(() => {
    if (!pineActiveScript) return true;
    const normalizedName = clampPineScriptName(pineEditorName);
    const normalizedSource = clampPineScriptSource(pineEditorSource);
    return pineActiveScript.name !== normalizedName || pineActiveScript.source !== normalizedSource;
  }, [pineActiveScript, pineEditorName, pineEditorSource]);

  const priceDiff = displayCandle ? displayCandle.close - displayCandle.open : 0;
  const priceDiffPercent =
    displayCandle && displayCandle.open !== 0 ? ((displayCandle.close - displayCandle.open) / displayCandle.open) * 100 : 0;
  const marketStatusBadgeText = marketStatus?.status === 'OPEN' ? '장중' : marketStatus?.status === 'CLOSED' ? '휴장' : '상태확인';
  const marketStatusBadgeClass = marketStatus?.status === 'OPEN' ? 'open' : marketStatus?.status === 'CLOSED' ? 'closed' : 'pending';
  const marketStatusHint = marketStatus
    ? `${formatMarketStatusReason(marketStatus.reason)} · ${marketStatus.session.text} · ${marketStatus.timezone}`
    : marketStatusError ?? '시장 상태 확인 중...';
  const alertBadgeCount = alertTriggeredEvents.length;
  const alertRuleStateSummary = useMemo(() => summarizeAlertRuleStates(alertRules), [alertRules]);
  const alertCenterEvents = useMemo(
    () =>
      filterAlertCenterEvents(alertHistoryEvents, {
        symbolQuery: alertHistorySymbolFilter,
        state: alertHistoryStateFilter,
        type: alertHistoryTypeFilter,
      }),
    [alertHistoryEvents, alertHistoryStateFilter, alertHistorySymbolFilter, alertHistoryTypeFilter],
  );
  const alertErroredRules = useMemo(
    () => alertRules.filter((rule) => normalizeAlertLifecycleState(rule.state) === 'error'),
    [alertRules],
  );

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
            ...(watchlistAlertVenues ? { venues: watchlistAlertVenues } : {}),
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
          checkedRuleCount?: number;
          triggeredCount?: number;
          suppressedByCooldown?: number;
          events: AlertCheckEvent[];
        };
        const events = data.events ?? [];

        appendWatchlistAlertEvents(events);
        setAlertLastCheckedAt(data.checkedAt ?? Date.now());
        if (source === 'manual') {
          setAlertMessage(
            `관심종목 체크 완료: ${
              data.checkedRuleCount ?? data.checkedSymbols.length
            }개 규칙, ${data.triggeredCount ?? events.length}개 트리거, 쿨다운 억제 ${data.suppressedByCooldown ?? 0}개`,
          );
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
      watchlistAlertVenues,
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
      const baseItem = normalizeSymbolItemVenue(symbol === item.symbol ? item : { ...item, symbol });
      const pickedVenue = normalizeVenueForSymbol(baseItem, watchlistAddVenuePreference);
      const nextItem = pickedVenue ? { ...baseItem, venue: pickedVenue } : baseItem;
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
    [persistWatchlist, watchlistAddVenuePreference, watchlistSymbols],
  );

  const handleUpdateWatchSymbolVenue = useCallback(
    async (symbolToUpdate: string, nextVenueValue: VenuePreferenceValue) => {
      let changed = false;
      const nextWatchlist = watchlistSymbols.map((item) => {
        if (item.symbol !== symbolToUpdate) {
          return item;
        }

        const normalizedVenue = normalizeVenueForSymbol(item, nextVenueValue);
        if (normalizedVenue === item.venue) {
          return item;
        }

        changed = true;
        if (normalizedVenue) {
          return { ...item, venue: normalizedVenue };
        }

        const rest = { ...item };
        delete rest.venue;
        return rest;
      });

      if (!changed) {
        return;
      }

      setWatchlistSymbols(nextWatchlist);

      const updatedItem = nextWatchlist.find((item) => item.symbol === symbolToUpdate);
      const normalizedVenue = updatedItem ? normalizeVenueForSymbol(updatedItem, updatedItem.venue) : undefined;
      const venueQuery = normalizedVenue ? `&venue=${encodeURIComponent(normalizedVenue)}` : '';
      void (async () => {
        try {
          const response = await fetch(
            `${apiBase}/api/quote?symbol=${encodeURIComponent(symbolToUpdate)}${venueQuery}`,
          );
          if (!response.ok) {
            return;
          }
          const quote = (await response.json()) as Quote;
          const quoteSymbol = symbolToUpdate.toUpperCase();
          setQuotes((prev) => ({ ...prev, [quoteSymbol]: quote }));
        } catch {
          // ignore: periodic quote poll will retry
        }
      })();

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

  const persistPineWorkspaceState = useCallback((nextWorkspace: PineWorkspaceState, successText?: string) => {
    const writeResult = writePineWorkspace(nextWorkspace);
    setPineWorkspace(writeResult.state);

    if (writeResult.error) {
      setPineStatusMessage({
        tone: 'error',
        text: writeResult.error,
      });
    } else if (successText) {
      setPineStatusMessage({
        tone: 'info',
        text: successText,
      });
    }

    return writeResult.state;
  }, []);

  const handleOpenPineScript = useCallback(
    (scriptId: string) => {
      const nextWorkspace = setActivePineScript(pineWorkspace, scriptId);
      const persisted = persistPineWorkspaceState(nextWorkspace, '스크립트를 불러왔습니다.');
      const nextActiveScript =
        persisted.activeScriptId !== null
          ? persisted.scripts.find((script) => script.id === persisted.activeScriptId) ?? null
          : null;
      if (!nextActiveScript) return;

      setPineEditorScriptId(nextActiveScript.id);
      setPineEditorName(nextActiveScript.name);
      setPineEditorSource(nextActiveScript.source);
    },
    [persistPineWorkspaceState, pineWorkspace],
  );

  const handleRenamePineScript = useCallback(() => {
    if (!pineEditorScriptId) {
      setPineStatusMessage({
        tone: 'error',
        text: '이름을 변경할 저장 스크립트를 먼저 선택해주세요.',
      });
      return;
    }

    const trimmedName = clampPineScriptName(pineEditorName);
    if (!trimmedName) {
      setPineStatusMessage({
        tone: 'error',
        text: '스크립트 이름을 입력해주세요.',
      });
      return;
    }

    const normalizedSource = clampPineScriptSource(pineEditorSource);
    const now = Date.now();
    const nextWorkspace = renamePineScript(pineWorkspace, pineEditorScriptId, trimmedName, {
      now,
      sourceOverride: normalizedSource,
    });
    const persisted = persistPineWorkspaceState(nextWorkspace, `스크립트 이름 변경: ${trimmedName}`);
    const nextActiveScript =
      persisted.activeScriptId !== null
        ? persisted.scripts.find((script) => script.id === persisted.activeScriptId) ?? null
        : null;
    if (!nextActiveScript) return;

    setPineEditorScriptId(nextActiveScript.id);
    setPineEditorName(nextActiveScript.name);
    setPineEditorSource(nextActiveScript.source);
  }, [persistPineWorkspaceState, pineEditorName, pineEditorScriptId, pineEditorSource, pineWorkspace]);

  const handleDuplicatePineScript = useCallback(() => {
    const sourceScriptId = pineEditorScriptId ?? pineWorkspace.activeScriptId;
    if (!sourceScriptId) {
      setPineStatusMessage({
        tone: 'error',
        text: '복제할 스크립트를 먼저 선택해주세요.',
      });
      return;
    }

    const sourceScript = pineWorkspace.scripts.find((script) => script.id === sourceScriptId);
    if (!sourceScript) {
      setPineStatusMessage({
        tone: 'error',
        text: '복제할 스크립트를 찾지 못했습니다.',
      });
      return;
    }

    const now = Date.now();
    const sourceName = sourceScriptId === pineEditorScriptId ? pineEditorName : sourceScript.name;
    const sourceCode = sourceScriptId === pineEditorScriptId ? pineEditorSource : sourceScript.source;
    const nextWorkspace = duplicatePineScript(pineWorkspace, sourceScriptId, {
      now,
      nameBase: clampPineScriptName(sourceName),
      sourceOverride: clampPineScriptSource(sourceCode),
    });
    const persisted = persistPineWorkspaceState(nextWorkspace, '스크립트를 복제했습니다.');
    const nextActiveScript =
      persisted.activeScriptId !== null
        ? persisted.scripts.find((script) => script.id === persisted.activeScriptId) ?? null
        : null;
    if (!nextActiveScript) return;

    setPineEditorScriptId(nextActiveScript.id);
    setPineEditorName(nextActiveScript.name);
    setPineEditorSource(nextActiveScript.source);
  }, [persistPineWorkspaceState, pineEditorName, pineEditorScriptId, pineEditorSource, pineWorkspace]);

  const handleCreateNewPineScript = useCallback(() => {
    const nextName = createUniquePineScriptName('New Script', pineWorkspace.scripts);
    setPineEditorScriptId(null);
    setPineEditorName(nextName);
    setPineEditorSource(DEFAULT_PINE_SCRIPT_SOURCE);
    setPineStatusMessage({
      tone: 'info',
      text: '새 스크립트를 작성 중입니다.',
    });
  }, [pineWorkspace.scripts]);

  const handleSavePineScript = useCallback(
    (mode: 'save' | 'saveAs') => {
      const now = Date.now();
      const trimmedName = clampPineScriptName(pineEditorName);
      if (!trimmedName) {
        setPineStatusMessage({
          tone: 'error',
          text: '스크립트 이름을 입력해주세요.',
        });
        return;
      }

      const isSaveAs = mode === 'saveAs';
      const existingScript = pineEditorScriptId
        ? pineWorkspace.scripts.find((script) => script.id === pineEditorScriptId) ?? null
        : null;
      const nextId = isSaveAs || !pineEditorScriptId ? createPineScriptId(now) : pineEditorScriptId;
      const nameReservedByOthers = pineWorkspace.scripts.filter((script) => script.id !== nextId);
      const nextName = createUniquePineScriptName(trimmedName, nameReservedByOthers);
      const nextScript: PineScript = {
        id: nextId,
        name: nextName,
        source: clampPineScriptSource(pineEditorSource),
        createdAt: existingScript && !isSaveAs ? existingScript.createdAt : now,
        updatedAt: now,
        revision: existingScript && !isSaveAs ? existingScript.revision : 1,
      };

      const nextWorkspace = upsertPineScript(pineWorkspace, nextScript, now);
      const persisted = persistPineWorkspaceState(nextWorkspace, `저장됨: ${new Date(now).toLocaleString('ko-KR')}`);
      const savedScript =
        persisted.activeScriptId !== null
          ? persisted.scripts.find((script) => script.id === persisted.activeScriptId) ?? null
          : null;
      if (!savedScript) return;

      setPineEditorScriptId(savedScript.id);
      setPineEditorName(savedScript.name);
      setPineEditorSource(savedScript.source);
    },
    [persistPineWorkspaceState, pineEditorName, pineEditorScriptId, pineEditorSource, pineWorkspace],
  );

  const handleDeletePineScript = useCallback(() => {
    if (!pineEditorScriptId) {
      setPineStatusMessage({
        tone: 'error',
        text: '삭제할 저장 스크립트를 먼저 선택해주세요.',
      });
      return;
    }

    const deletedName = pineActiveScriptName || pineEditorName.trim();
    const nextWorkspace = deletePineScript(pineWorkspace, pineEditorScriptId);
    const persisted = persistPineWorkspaceState(
      nextWorkspace,
      `${deletedName ? `"${deletedName}" ` : ''}스크립트를 삭제했습니다.`,
    );
    const nextActiveScript =
      persisted.activeScriptId !== null
        ? persisted.scripts.find((script) => script.id === persisted.activeScriptId) ?? null
        : null;

    if (nextActiveScript) {
      setPineEditorScriptId(nextActiveScript.id);
      setPineEditorName(nextActiveScript.name);
      setPineEditorSource(nextActiveScript.source);
      return;
    }

    setPineEditorScriptId(null);
    setPineEditorName(createUniquePineScriptName('New Script', persisted.scripts));
    setPineEditorSource(DEFAULT_PINE_SCRIPT_SOURCE);
  }, [persistPineWorkspaceState, pineActiveScriptName, pineEditorName, pineEditorScriptId, pineWorkspace]);

  const handleBridgePineToStrategyTester = useCallback(() => {
    if (!pineActiveScript) {
      setPineStatusMessage({
        tone: 'error',
        text: '전략 테스터로 보내려면 저장된 스크립트를 먼저 선택해주세요.',
      });
      return;
    }

    const normalizedSource = clampPineScriptSource(pineEditorSource);
    const directiveResult = parsePineStrategyTesterDirectivesWithMeta(normalizedSource);
    const directives = directiveResult.directives;
    const guardrailWarningCount = getPineEditorGuardrailWarnings(pineEditorName, pineEditorSource).length;
    const linkedWarningCount = guardrailWarningCount + directiveResult.invalidDirectiveCount;
    const linkedScript: StrategyTesterLinkedScript = {
      scriptId: pineActiveScript.id,
      scriptName: pineActiveScript.name,
      revision: pineActiveScript.revision,
      ...(linkedWarningCount > 0 ? { warningCount: linkedWarningCount } : {}),
    };
    const hasDirectiveMapping =
      typeof directives.fastPeriod === 'number' ||
      typeof directives.slowPeriod === 'number' ||
      typeof directives.initialCapital === 'number' ||
      typeof directives.feeBps === 'number';

    setStrategyError(null);
    setStrategyRecovery(null);
    setStrategyForm((previous) => {
      const next: StrategyTesterFormState = {
        ...previous,
        linkedScript,
      };

      if (typeof directives.fastPeriod === 'number') {
        next.fastPeriod = String(directives.fastPeriod);
      }

      if (typeof directives.slowPeriod === 'number') {
        next.slowPeriod = String(directives.slowPeriod);
      }

      if (typeof directives.initialCapital === 'number') {
        next.initialCapital = formatStrategyDirectiveValue(directives.initialCapital);
      }

      if (typeof directives.feeBps === 'number') {
        next.feeUnit = 'bps';
        next.feeValue = formatStrategyDirectiveValue(directives.feeBps);
      }

      return next;
    });
    setBottomTab('strategy');
    setPineStatusMessage({
      tone: 'info',
      text:
        hasDirectiveMapping && linkedWarningCount > 0
          ? '전략 테스터로 연결하고 ts 지시어를 반영했습니다. 일부 지시어는 무시되었습니다.'
          : hasDirectiveMapping
            ? '전략 테스터로 연결하고 ts 지시어 파라미터를 반영했습니다.'
            : linkedWarningCount > 0
              ? '전략 테스터로 연결했습니다. 일부 지시어/입력 제한이 감지되었습니다.'
              : '전략 테스터로 연결했습니다.',
    });
  }, [pineActiveScript, pineEditorName, pineEditorSource]);

  const handleUnlinkStrategyLinkedScript = useCallback(() => {
    setStrategyForm((previous) => {
      if (!previous.linkedScript) return previous;
      return {
        ...previous,
        linkedScript: null,
      };
    });
  }, []);

  const updateStrategyField = useCallback((field: StrategyFormField, value: string) => {
    setStrategyError(null);
    setStrategyForm((previous) => {
      if (field === 'symbol' || field === 'interval') {
        return {
          ...previous,
          [field]: value.toUpperCase(),
        };
      }

      if (field === 'feeUnit') {
        return {
          ...previous,
          feeUnit: value === 'percent' ? 'percent' : 'bps',
        };
      }

      if (field === 'slippageMode') {
        return {
          ...previous,
          slippageMode: value === 'tick' ? 'tick' : 'percent',
        };
      }

      if (field === 'positionSizeMode') {
        return {
          ...previous,
          positionSizeMode: value === 'fixed-qty' ? 'fixed-qty' : 'fixed-percent',
        };
      }

      return {
        ...previous,
        [field]: value,
      };
    });
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
    const feeUnit = strategyForm.feeUnit;
    const feeValue = Number(strategyForm.feeValue);
    const slippageMode = strategyForm.slippageMode;
    const slippageValue = Number(strategyForm.slippageValue);
    const positionSizeMode = strategyForm.positionSizeMode;
    const fixedPercent = Number(strategyForm.fixedPercent);
    const fixedQty = Number(strategyForm.fixedQty);
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
    if (!Number.isFinite(feeValue) || feeValue < 0) {
      setStrategyError('수수료는 0 이상 숫자여야 합니다.');
      return false;
    }
    if (
      (feeUnit === 'bps' && feeValue > STRATEGY_MAX_FEE_BPS) ||
      (feeUnit === 'percent' && feeValue > STRATEGY_MAX_FEE_PERCENT)
    ) {
      setStrategyError(
        feeUnit === 'bps'
          ? `수수료(bps)는 0~${STRATEGY_MAX_FEE_BPS} 범위여야 합니다.`
          : `수수료(%)는 0~${STRATEGY_MAX_FEE_PERCENT}% 범위여야 합니다.`,
      );
      return false;
    }
    if (!Number.isFinite(slippageValue) || slippageValue < 0) {
      setStrategyError('슬리피지는 0 이상 숫자여야 합니다.');
      return false;
    }
    if (
      (slippageMode === 'tick' && slippageValue > STRATEGY_MAX_SLIPPAGE_TICK) ||
      (slippageMode === 'percent' && slippageValue > STRATEGY_MAX_SLIPPAGE_PERCENT)
    ) {
      setStrategyError(
        slippageMode === 'tick'
          ? `슬리피지(tick)는 0~${STRATEGY_MAX_SLIPPAGE_TICK} 범위여야 합니다.`
          : `슬리피지(%)는 0~${STRATEGY_MAX_SLIPPAGE_PERCENT}% 범위여야 합니다.`,
      );
      return false;
    }
    if (positionSizeMode === 'fixed-percent' && (!Number.isFinite(fixedPercent) || fixedPercent <= 0 || fixedPercent > 100)) {
      setStrategyError('포지션 크기(%)는 0 초과 100 이하로 입력해주세요.');
      return false;
    }
    if (positionSizeMode === 'fixed-qty' && (!Number.isFinite(fixedQty) || fixedQty <= 0 || fixedQty > STRATEGY_MAX_FIXED_QTY)) {
      setStrategyError(`고정 수량은 0 초과 ${STRATEGY_MAX_FIXED_QTY.toLocaleString('en-US')} 이하로 입력해주세요.`);
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
      const paramsPayload = {
        initialCapital,
        fee: {
          unit: feeUnit,
          value: feeValue,
        },
        slippage: {
          mode: slippageMode,
          value: slippageValue,
        },
        positionSizeMode,
        ...(positionSizeMode === 'fixed-qty' ? { fixedQty } : { fixedPercent }),
        ...(feeUnit === 'bps' ? { feeBps: feeValue } : {}),
      };

      const response = await fetch(`${apiBase}/api/strategy/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          limit,
          params: paramsPayload,
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

      const orderType = tradingOrderForm.orderType;
      const qtyInput = tradingOrderForm.qty.trim();
      const qty = Number(qtyInput);
      if (!Number.isFinite(qty) || qty <= 0) {
        setTradingFormError('수량은 0보다 큰 숫자여야 합니다.');
        return;
      }

      const limitPrice = Number(tradingOrderForm.limitPrice.trim());
      if (orderType === 'LIMIT' && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
        setTradingFormError('지정가 주문에는 0보다 큰 지정가가 필요합니다.');
        return;
      }

      const triggerPrice = Number(tradingOrderForm.triggerPrice.trim());
      if (orderType === 'STOP' && (!Number.isFinite(triggerPrice) || triggerPrice <= 0)) {
        setTradingFormError('스탑 주문에는 0보다 큰 트리거 가격이 필요합니다.');
        return;
      }

      let takeProfitPrice: number | null = null;
      let stopLossPrice: number | null = null;

      if (tradingOrderForm.useBracket) {
        const takeProfitInput = tradingOrderForm.takeProfitPrice.trim();
        const stopLossInput = tradingOrderForm.stopLossPrice.trim();
        takeProfitPrice = takeProfitInput.length > 0 ? Number(takeProfitInput) : null;
        stopLossPrice = stopLossInput.length > 0 ? Number(stopLossInput) : null;

        if (takeProfitPrice === null && stopLossPrice === null) {
          setTradingFormError('브래킷 사용 시 TP 또는 SL 중 하나 이상을 입력해주세요.');
          return;
        }

        if (takeProfitPrice !== null && (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0)) {
          setTradingFormError('TP 가격은 0보다 큰 숫자여야 합니다.');
          return;
        }

        if (stopLossPrice !== null && (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0)) {
          setTradingFormError('SL 가격은 0보다 큰 숫자여야 합니다.');
          return;
        }

        const referencePrice =
          orderType === 'MARKET' ? selectedQuote?.lastPrice ?? null : orderType === 'LIMIT' ? limitPrice : triggerPrice;

        if (tradingOrderForm.side === 'BUY' && referencePrice && Number.isFinite(referencePrice) && referencePrice > 0) {
          if (takeProfitPrice !== null && takeProfitPrice <= referencePrice) {
            setTradingFormError('BUY 주문의 TP는 진입가보다 커야 합니다.');
            return;
          }

          if (stopLossPrice !== null && stopLossPrice >= referencePrice) {
            setTradingFormError('BUY 주문의 SL은 진입가보다 작아야 합니다.');
            return;
          }
        }

        if (
          takeProfitPrice !== null &&
          stopLossPrice !== null &&
          stopLossPrice >= takeProfitPrice
        ) {
          setTradingFormError('SL은 TP보다 작아야 합니다.');
          return;
        }
      }

      if (tradingOrderForm.side !== 'BUY' && tradingOrderForm.useBracket) {
        setTradingFormError('현재 브래킷 TP/SL은 BUY 주문에서만 지원됩니다.');
        return;
      }

      setTradingSubmitting(true);
      setTradingFormError(null);
      setTradingRecovery(null);

      try {
        const payload: {
          symbol: string;
          side: TradingOrderSide;
          orderType: 'market' | 'limit' | 'stop';
          qty: number;
          limitPrice?: number;
          triggerPrice?: number;
          takeProfitPrice?: number;
          stopLossPrice?: number;
        } = {
          symbol: selectedSymbol,
          side: tradingOrderForm.side,
          orderType: orderType.toLowerCase() as 'market' | 'limit' | 'stop',
          qty,
        };

        if (orderType === 'LIMIT') {
          payload.limitPrice = limitPrice;
        }

        if (orderType === 'STOP') {
          payload.triggerPrice = triggerPrice;
        }

        if (takeProfitPrice !== null) {
          payload.takeProfitPrice = takeProfitPrice;
        }

        if (stopLossPrice !== null) {
          payload.stopLossPrice = stopLossPrice;
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
          ...(orderType === 'LIMIT' ? {} : { limitPrice: '' }),
          ...(orderType === 'STOP' ? {} : { triggerPrice: '' }),
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
            orderType,
            retryable: normalized.retryable,
            ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
          },
        });
      } finally {
        setTradingSubmitting(false);
      }
    },
    [loadTradingState, reportOpsError, selectedQuote?.lastPrice, selectedSymbol, tradingOrderForm],
  );

  const handleCreateAlertRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlertsRecovery(null);
    const normalizedAlertVenue = selectedSymbolVenueSupported
      ? normalizeVenueForSymbol({ symbol: selectedSymbol, market: selectedMarket }, alertVenuePreference)
      : undefined;

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
          ...(normalizedAlertVenue ? { venue: normalizedAlertVenue } : {}),
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
        venue?: KrVenue;
        values?: { symbol: string; lastPrice: number; changePercent: number };
        indicatorAwareOnly?: boolean;
      } = {
        symbol: selectedSymbol,
      };

      const normalizedAlertVenue = selectedSymbolVenueSupported
        ? normalizeVenueForSymbol({ symbol: selectedSymbol, market: selectedMarket }, alertVenuePreference)
        : undefined;
      if (normalizedAlertVenue) {
        body.venue = normalizedAlertVenue;
      }

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
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return {
      x,
      y,
    };
  }, []);

  const toTimePriceFromCoordinates = useCallback((x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return null;

    let rawTime: unknown;
    let rawPrice: unknown;
    try {
      rawTime = chart.timeScale().coordinateToTime(x);
      rawPrice = series.coordinateToPrice(y);
    } catch {
      return null;
    }

    if (typeof rawTime !== 'number' || !Number.isFinite(rawTime)) return null;
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice)) return null;

    return {
      time: toTimestampValue(rawTime),
      price: normalizeLinePrice(rawPrice),
    };
  }, []);

  const toMagnetSnappedPoint = useCallback(
    (time: number, price: number) => toNormalizedMagnetPoint(time, price, magnetEnabled, activeCandles),
    [activeCandles, magnetEnabled],
  );

  const findDrawingAtPoint = useCallback(
    (x: number, y: number): DrawingHit | null => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      if (!chart || !series) return null;
      const chartArea = chartAreaRef.current;
      const coordinateAbsLimit =
        Math.max(chartArea?.clientWidth ?? 0, chartArea?.clientHeight ?? 0, 1) * 4;
      const clampCoordinate = (value: number) =>
        Math.min(coordinateAbsLimit, Math.max(-coordinateAbsLimit, value));

      let best: DrawingHit | null = null;
      const upsertHit = (id: string, kind: DrawingKind, distance: number) => {
        if (!Number.isFinite(distance) || distance > DRAWING_HIT_TOLERANCE_PX) return;
        const score = distance + (id === selectedDrawingId ? -0.75 : 0);

        if (!best || score < best.score) {
          best = { id, kind, distance, score };
        }
      };

      for (const line of horizontalLinesRef.current) {
        if (!line.visible) continue;
        let yCoord: unknown;
        try {
          yCoord = series.priceToCoordinate(line.price);
        } catch {
          continue;
        }
        if (yCoord === null || !Number.isFinite(yCoord)) continue;
        upsertHit(line.id, 'horizontal', Math.abs(y - clampCoordinate(Number(yCoord))));
      }

      for (const line of verticalLinesRef.current) {
        if (!line.visible) continue;
        let xCoord: unknown;
        try {
          xCoord = chart.timeScale().timeToCoordinate(line.time as Time);
        } catch {
          continue;
        }
        if (xCoord === null || !Number.isFinite(xCoord)) continue;
        upsertHit(line.id, 'vertical', Math.abs(x - clampCoordinate(Number(xCoord))));
      }

      const toCoordinate = (time: UTCTimestamp, price: number) => {
        if (!Number.isFinite(Number(time)) || !Number.isFinite(price)) return null;

        let xCoord: unknown;
        let yCoord: unknown;
        try {
          xCoord = chart.timeScale().timeToCoordinate(time as Time);
          yCoord = series.priceToCoordinate(price);
        } catch {
          return null;
        }

        if (xCoord === null || yCoord === null) return null;
        if (!Number.isFinite(xCoord) || !Number.isFinite(yCoord)) return null;
        return { x: clampCoordinate(Number(xCoord)), y: clampCoordinate(Number(yCoord)) };
      };

      for (const line of trendlinesRef.current) {
        if (!line.visible) continue;
        const start = toCoordinate(line.startTime, line.startPrice);
        const end = toCoordinate(line.endTime, line.endPrice);
        if (!start || !end) continue;

        upsertHit(line.id, 'trendline', distanceToSegment(x, y, start.x, start.y, end.x, end.y));
      }

      for (const line of raysRef.current) {
        if (!line.visible) continue;
        const start = toCoordinate(line.startTime, line.startPrice);
        const end = toCoordinate(line.endTime, line.endPrice);
        if (!start || !end) continue;

        upsertHit(line.id, 'ray', distanceToRay(x, y, start.x, start.y, end.x, end.y));
      }

      for (const shape of rectanglesRef.current) {
        if (!shape.visible) continue;
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
        if (!note.visible) continue;
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

  const isDrawingLocked = useCallback((id: string) => {
    const horizontal = horizontalLinesRef.current.find((item) => item.id === id);
    if (horizontal) return horizontal.locked;

    const vertical = verticalLinesRef.current.find((item) => item.id === id);
    if (vertical) return vertical.locked;

    const trendline = trendlinesRef.current.find((item) => item.id === id);
    if (trendline) return trendline.locked;

    const ray = raysRef.current.find((item) => item.id === id);
    if (ray) return ray.locked;

    const rectangle = rectanglesRef.current.find((item) => item.id === id);
    if (rectangle) return rectangle.locked;

    const note = notesRef.current.find((item) => item.id === id);
    if (note) return note.locked;

    return false;
  }, []);

  const updateDrawingFlagsById = useCallback(
    (id: string, updater: (current: DrawingFlagState) => DrawingFlagState) => {
      const beforeSnapshot = captureChartHistorySnapshot();
      let updated = false;

      function applyFlags<T extends { id: string; visible: boolean; locked: boolean }>(item: T): T {
        if (item.id !== id) return item;
        const nextFlags = updater({ visible: item.visible, locked: item.locked });
        if (nextFlags.visible === item.visible && nextFlags.locked === item.locked) return item;
        updated = true;
        return { ...item, ...nextFlags };
      }

      const nextHorizontalLines = snapshotHorizontalLines().map((item) => applyFlags(item));
      const nextVerticalLines = snapshotVerticalLines().map((item) => applyFlags(item));
      const nextTrendlines = snapshotTrendlines().map((item) => applyFlags(item));
      const nextRays = snapshotRays().map((item) => applyFlags(item));
      const nextRectangles = snapshotRectangles().map((item) => applyFlags(item));
      const nextNotes = snapshotNotes().map((item) => applyFlags(item));

      if (!updated) return false;

      renderHorizontalLines(nextHorizontalLines);
      renderVerticalLines(nextVerticalLines);
      renderTrendlines(nextTrendlines);
      renderRays(nextRays);
      renderRectangles(nextRectangles);
      renderNotes(nextNotes);
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
      return true;
    },
    [
      captureChartHistorySnapshot,
      persistDrawings,
      recordHistoryTransition,
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

  const toggleDrawingLockedById = useCallback(
    (id: string) => {
      updateDrawingFlagsById(id, (current) => ({
        ...current,
        locked: !current.locked,
      }));
    },
    [updateDrawingFlagsById],
  );

  const toggleDrawingVisibilityById = useCallback(
    (id: string) => {
      updateDrawingFlagsById(id, (current) => ({
        ...current,
        visible: !current.visible,
      }));
    },
    [updateDrawingFlagsById],
  );

  const resetDragInteraction = useCallback((target?: HTMLDivElement | null) => {
    const activeDrag = dragStateRef.current;
    if (activeDrag && target && target.hasPointerCapture(activeDrag.pointerId)) {
      target.releasePointerCapture(activeDrag.pointerId);
    }

    dragStateRef.current = null;
    dragHistoryStartRef.current = null;
    setIsDraggingDrawing(false);
  }, []);

  const handleChartPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activeToolRef.current !== 'cursor') {
        resetDragInteraction(event.currentTarget);
        return;
      }
      if (event.button !== 0) return;

      const point = getLocalChartPoint(event);
      if (!point) {
        resetDragInteraction(event.currentTarget);
        return;
      }

      const hit = findDrawingAtPoint(point.x, point.y);
      if (!hit) {
        resetDragInteraction(event.currentTarget);
        setSelectedDrawingId(null);
        return;
      }

      setSelectedDrawingId(hit.id);
      if (isDrawingLocked(hit.id)) {
        resetDragInteraction(event.currentTarget);
        return;
      }

      const mapped = toTimePriceFromCoordinates(point.x, point.y);
      if (!mapped) {
        resetDragInteraction(event.currentTarget);
        return;
      }

      const dragState = startDragState(hit, event.pointerId, mapped.time, mapped.price);
      if (!dragState) {
        resetDragInteraction(event.currentTarget);
        return;
      }

      resetDragInteraction(event.currentTarget);
      dragStateRef.current = dragState;
      dragHistoryStartRef.current = captureChartHistorySnapshot();
      setIsDraggingDrawing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [
      captureChartHistorySnapshot,
      findDrawingAtPoint,
      getLocalChartPoint,
      isDrawingLocked,
      resetDragInteraction,
      startDragState,
      toTimePriceFromCoordinates,
    ],
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
        const rawPrice = dragState.originPrice + (mapped.price - dragState.startPrice);
        const nextPrice = toMagnetSnappedPoint(mapped.time, rawPrice).price;
        const nextLines = horizontalLinesRef.current.map((line) =>
          line.id === dragState.id
            ? { id: line.id, price: nextPrice, visible: line.visible, locked: line.locked }
            : { id: line.id, price: line.price, visible: line.visible, locked: line.locked },
        );
        moved = nextLines.some((line, index) => Math.abs(line.price - horizontalLinesRef.current[index].price) > 0.0001);
        if (moved) {
          renderHorizontalLines(nextLines);
        }
      }

      if (dragState.kind === 'vertical') {
        const deltaTime = Number(mapped.time) - Number(dragState.startTime);
        const rawTime = Number(dragState.originTime) + deltaTime;
        const nextTime = toMagnetSnappedPoint(rawTime, mapped.price).time;
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
        const rawStartTime = Number(dragState.origin.startTime) + deltaTime;
        const rawEndTime = Number(dragState.origin.endTime) + deltaTime;
        const rawStartPrice = dragState.origin.startPrice + deltaPrice;
        const rawEndPrice = dragState.origin.endPrice + deltaPrice;
        const snappedStart = toMagnetSnappedPoint(rawStartTime, rawStartPrice);
        const snappedEnd = toMagnetSnappedPoint(rawEndTime, rawEndPrice);
        const nextTrendlines = trendlinesRef.current.map((line) =>
          line.id === dragState.id
            ? {
                ...line,
                startTime: snappedStart.time,
                endTime: snappedEnd.time,
                startPrice: snappedStart.price,
                endPrice: snappedEnd.price,
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
        const rawStartTime = Number(dragState.origin.startTime) + deltaTime;
        const rawEndTime = Number(dragState.origin.endTime) + deltaTime;
        const rawStartPrice = dragState.origin.startPrice + deltaPrice;
        const rawEndPrice = dragState.origin.endPrice + deltaPrice;
        const snappedStart = toMagnetSnappedPoint(rawStartTime, rawStartPrice);
        const snappedEnd = toMagnetSnappedPoint(rawEndTime, rawEndPrice);
        const nextRays = raysRef.current.map((line) =>
          line.id === dragState.id
            ? {
                ...line,
                startTime: snappedStart.time,
                endTime: snappedEnd.time,
                startPrice: snappedStart.price,
                endPrice: snappedEnd.price,
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
        const rawStartTime = Number(dragState.origin.startTime) + deltaTime;
        const rawEndTime = Number(dragState.origin.endTime) + deltaTime;
        const rawStartPrice = dragState.origin.startPrice + deltaPrice;
        const rawEndPrice = dragState.origin.endPrice + deltaPrice;
        const snappedStart = toMagnetSnappedPoint(rawStartTime, rawStartPrice);
        const snappedEnd = toMagnetSnappedPoint(rawEndTime, rawEndPrice);
        const nextRectangles = rectanglesRef.current.map((shape) =>
          shape.id === dragState.id
            ? {
                ...shape,
                startTime: snappedStart.time,
                endTime: snappedEnd.time,
                startPrice: snappedStart.price,
                endPrice: snappedEnd.price,
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
        const rawTime = Number(dragState.origin.time) + deltaTime;
        const rawPrice = dragState.origin.price + deltaPrice;
        const snapped = toMagnetSnappedPoint(rawTime, rawPrice);
        const nextNotes = notesRef.current.map((note) =>
          note.id === dragState.id
            ? {
                ...note,
                time: snapped.time,
                price: snapped.price,
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
      toMagnetSnappedPoint,
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

  const deleteDrawingById = useCallback((id: string, options?: { allowLocked?: boolean }) => {
    if (!options?.allowLocked && isDrawingLocked(id)) {
      return false;
    }

    if (horizontalLinesRef.current.some((item) => item.id === id)) {
      removeHorizontalLine(id);
      return true;
    }
    if (verticalLinesRef.current.some((item) => item.id === id)) {
      removeVerticalLine(id);
      return true;
    }
    if (trendlinesRef.current.some((item) => item.id === id)) {
      removeTrendline(id);
      return true;
    }
    if (raysRef.current.some((item) => item.id === id)) {
      removeRay(id);
      return true;
    }
    if (rectanglesRef.current.some((item) => item.id === id)) {
      removeRectangle(id);
      return true;
    }
    if (notesRef.current.some((item) => item.id === id)) {
      removeNote(id);
      return true;
    }
    return false;
  }, [isDrawingLocked, removeHorizontalLine, removeNote, removeRay, removeRectangle, removeTrendline, removeVerticalLine]);

  const deleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return false;
    if (isDrawingLocked(selectedDrawingId)) {
      setTopActionFeedback('잠금된 도형은 삭제할 수 없습니다.');
      return false;
    }
    return deleteDrawingById(selectedDrawingId);
  }, [deleteDrawingById, isDrawingLocked, selectedDrawingId]);

  const deleteDrawingFromObjectsPanel = useCallback(
    (id: string) => {
      setSelectedDrawingId(id);
      if (isDrawingLocked(id)) {
        setTopActionFeedback('잠금된 도형은 삭제할 수 없습니다.');
        return;
      }

      deleteDrawingById(id);
    },
    [deleteDrawingById, isDrawingLocked],
  );

  const switchInterval = useCallback((interval: string) => {
    setSelectedInterval((previous) => (previous === interval ? previous : interval));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTypingInputTarget(event.target)) return;

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

      const intervalHotkeyIndex = getFavoriteIntervalHotkeyIndex(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          target: event.target,
        },
        intervals.length,
      );

      if (intervalHotkeyIndex !== null) {
        const nextInterval = intervals[intervalHotkeyIndex];
        if (!nextInterval) return;
        event.preventDefault();
        switchInterval(nextInterval);
        return;
      }

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

      if (key === 'm') {
        event.preventDefault();
        setMagnetEnabled((previous) => !previous);
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
  }, [deleteSelectedDrawing, redoHistory, selectedDrawingId, switchInterval, undoHistory]);

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

  const updateCompareOverlaySymbol = useCallback(
    (slotIndex: number, nextSymbol: string) => {
      if (slotIndex < 0 || slotIndex >= MAX_COMPARE_SYMBOLS) return;

      const current = compareOverlays[slotIndex];
      if (!current) return;

      const normalizedSymbol = nextSymbol.trim();

      if (
        normalizedSymbol &&
        compareOverlays.some((overlay, index) => index !== slotIndex && overlay.symbol === normalizedSymbol)
      ) {
        setCompareOverlays((prev) =>
          prev.map((overlay, index) =>
            index === slotIndex
              ? {
                  ...overlay,
                  candles: [],
                  loading: false,
                  error: DUPLICATE_COMPARE_SYMBOL_ERROR,
                }
              : overlay,
          ),
        );
        return;
      }

      if (normalizedSymbol === current.symbol) {
        return;
      }

      const beforeSnapshot = captureChartHistorySnapshot();
      const nextCompareOverlays = compareOverlays.map((overlay, index) => {
        if (index !== slotIndex) return overlay;
        if (!normalizedSymbol) return createEmptyCompareOverlaySlot<Candle>();
        return {
          symbol: normalizedSymbol,
          visible: overlay.visible,
          candles: [],
          loading: false,
          error: null,
        };
      });
      setCompareOverlays(nextCompareOverlays);
      recordHistoryTransition(
        beforeSnapshot,
        captureChartHistorySnapshot({
          compareOverlays: toCompareOverlayConfigs(nextCompareOverlays),
        }),
      );
    },
    [captureChartHistorySnapshot, compareOverlays, recordHistoryTransition],
  );

  const updateCompareOverlayVisibility = useCallback(
    (slotIndex: number, visible: boolean) => {
      if (slotIndex < 0 || slotIndex >= MAX_COMPARE_SYMBOLS) return;

      const target = compareOverlays[slotIndex];
      if (!target?.symbol) return;
      if (target.visible === visible) return;

      const beforeSnapshot = captureChartHistorySnapshot();
      const nextCompareOverlays = compareOverlays.map((overlay, index) =>
        index === slotIndex
          ? {
              ...overlay,
              visible,
            }
          : overlay,
      );

      setCompareOverlays(nextCompareOverlays);
      recordHistoryTransition(
        beforeSnapshot,
        captureChartHistorySnapshot({
          compareOverlays: toCompareOverlayConfigs(nextCompareOverlays),
        }),
      );
    },
    [captureChartHistorySnapshot, compareOverlays, recordHistoryTransition],
  );

  const clearCompareOverlay = useCallback(
    (slotIndex: number) => {
      updateCompareOverlaySymbol(slotIndex, '');
    },
    [updateCompareOverlaySymbol],
  );

  const clearAllCompareOverlays = useCallback(() => {
    if (!compareOverlays.some((overlay) => overlay.symbol)) {
      return;
    }

    const beforeSnapshot = captureChartHistorySnapshot();
    const nextCompareOverlays = createInitialCompareOverlaySlots<Candle>();
    setCompareOverlays(nextCompareOverlays);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        compareOverlays: toCompareOverlayConfigs(nextCompareOverlays),
      }),
    );
  }, [captureChartHistorySnapshot, compareOverlays, recordHistoryTransition]);

  const updateCompareScaleMode = useCallback((mode: CompareScaleMode) => {
    if (mode === compareScaleMode) return;
    const beforeSnapshot = captureChartHistorySnapshot();
    setCompareScaleMode(mode);
    recordHistoryTransition(
      beforeSnapshot,
      captureChartHistorySnapshot({
        compareScaleMode: mode,
      }),
    );
  }, [captureChartHistorySnapshot, compareScaleMode, recordHistoryTransition]);

  const handleTopActionClick = useCallback((key: TopActionKey) => {
    if (key === 'indicator') {
      setIndicatorPanelOpen((prev) => !prev);
      return;
    }

    if (key === 'compare') {
      setComparisonPanelOpen((prev) => !prev);
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
  const drawingObjects = useMemo(
    () => [
      ...horizontalLines.map((line) => ({
        id: line.id,
        kind: 'horizontal' as const,
        anchor: `가격 ${formatPrice(line.price)}`,
        context: '기준점: 가격',
        visible: line.visible,
        locked: line.locked,
      })),
      ...verticalLines.map((line) => ({
        id: line.id,
        kind: 'vertical' as const,
        anchor: `시간 ${formatDrawingTime(line.time)}`,
        context: '기준점: 시간',
        visible: line.visible,
        locked: line.locked,
      })),
      ...trendlines.map((line) => ({
        id: line.id,
        kind: 'trendline' as const,
        anchor: `시작 ${formatDrawingTime(line.startTime)} · ${formatPrice(line.startPrice)}`,
        context: `끝 ${formatDrawingTime(line.endTime)} · ${formatPrice(line.endPrice)}`,
        visible: line.visible,
        locked: line.locked,
      })),
      ...rays.map((line) => ({
        id: line.id,
        kind: 'ray' as const,
        anchor: `시작 ${formatDrawingTime(line.startTime)} · ${formatPrice(line.startPrice)}`,
        context: `끝 ${formatDrawingTime(line.endTime)} · ${formatPrice(line.endPrice)}`,
        visible: line.visible,
        locked: line.locked,
      })),
      ...rectangles.map((line) => ({
        id: line.id,
        kind: 'rectangle' as const,
        anchor: `시작 ${formatDrawingTime(line.startTime)} · ${formatPrice(line.startPrice)}`,
        context: `끝 ${formatDrawingTime(line.endTime)} · ${formatPrice(line.endPrice)}`,
        visible: line.visible,
        locked: line.locked,
      })),
      ...notes.map((note) => ({
        id: note.id,
        kind: 'note' as const,
        anchor: `위치 ${formatDrawingTime(note.time)} · ${formatPrice(note.price)}`,
        context: `메모 ${summarizeNoteText(note.text)}`,
        visible: note.visible,
        locked: note.locked,
      })),
    ],
    [horizontalLines, notes, rays, rectangles, trendlines, verticalLines],
  );
  const drawingOverlayGeometry = useMemo(() => {
    void overlayTick;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;
    return buildDrawingOverlayGeometry({
      width: container?.clientWidth ?? 0,
      height: container?.clientHeight ?? 0,
      trendlines,
      rays,
      rectangles,
      notes,
      toCoordinate: (time, price) => {
        if (!chart || !series) return null;
        const x = chart.timeScale().timeToCoordinate(time as Time);
        const y = series.priceToCoordinate(price);
        if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }

        return { x: Number(x), y: Number(y) };
      },
    });
  }, [notes, overlayTick, rays, rectangles, trendlines]);
  const activeIndicatorConfigs = indicatorConfigs.filter((config) => enabledIndicators[config.key]);
  const activeIndicatorLegends = activeIndicatorConfigs.map((config) => ({
    ...config,
    legend: formatIndicatorLegend(config, indicatorSettings),
  }));
  const compareCandidates = watchlistSymbols;
  const hasAnyCompareCandidate = compareCandidates.some((item) => item.symbol !== selectedSymbol);
  const hasCompareOverlays = compareOverlays.some((overlay) => overlay.symbol);
  const compareSymbolMetaMap = useMemo(() => {
    const symbolMap = new Map<string, SymbolItem>();
    for (const item of watchlistSymbols) {
      symbolMap.set(item.symbol, item);
    }
    for (const item of searchResults) {
      if (!symbolMap.has(item.symbol)) {
        symbolMap.set(item.symbol, item);
      }
    }
    return symbolMap;
  }, [searchResults, watchlistSymbols]);
  const compareOptionsBySlot = useMemo(
    () =>
      compareOverlays.map((overlay, slotIndex) => {
        const selectedInOtherSlots = new Set(
          compareOverlays
            .filter((_, index) => index !== slotIndex)
            .map((item) => item.symbol)
            .filter((symbol): symbol is string => symbol.length > 0),
        );

        return compareCandidates.filter((item) => {
          if (item.symbol === overlay.symbol) return true;
          if (item.symbol === selectedSymbol) return false;
          return !selectedInOtherSlots.has(item.symbol);
        });
      }),
    [compareCandidates, compareOverlays, selectedSymbol],
  );
  const compareLegendItems = compareOverlays.flatMap((overlay, slotIndex) => {
    const symbol = overlay.symbol.trim();
    if (!symbol) return [];

    const computed = compareComputedOverlays[slotIndex];
    const symbolMeta = compareSymbolMetaMap.get(symbol) ?? null;
    const hasValue = !overlay.loading && !overlay.error && computed?.points.length > 0 && computed.lastValue !== null;
    const currentValueText = hasValue ? formatPrice(computed.lastValue as number) : null;
    const anchorText =
      compareScaleMode === 'normalized' && computed?.anchor
        ? `${formatCandleDateTime(computed.anchor.time)} · 기준 ${formatPrice(computed.anchor.baseClose)} / 비교 ${formatPrice(
            computed.anchor.compareClose,
          )}`
        : null;

    return [
      {
        slotIndex,
        symbol,
        symbolMeta,
        status: overlay.error
          ? overlay.error
          : overlay.loading
            ? '로딩중'
            : computed?.points.length === 0
              ? '공통구간 없음'
              : currentValueText,
        currentValueText,
        anchorText,
        visible: overlay.visible,
      },
    ];
  });
  const compareLegendItemBySlot = useMemo(
    () => new Map(compareLegendItems.map((item) => [item.slotIndex, item])),
    [compareLegendItems],
  );
  const compareScaleGuideText =
    compareScaleMode === 'normalized'
      ? '정규화 기준: 첫 공통 캔들의 종가를 기준값으로 고정합니다.'
      : '절대값 기준: 비교 심볼의 원본 종가를 그대로 표시합니다.';
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
  const handleBottomPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || bottomPanelResizing) return;
      event.preventDefault();

      bottomPanelResizeStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: bottomPanelHeight,
      };

      setBottomPanelResizing(true);
    },
    [bottomPanelHeight, bottomPanelResizing],
  );
  const stopBottomPanelResizing = useCallback(() => {
    bottomPanelResizeStateRef.current = null;
    setBottomPanelResizing(false);
  }, []);

  useEffect(() => {
    if (!bottomPanelResizing || typeof window === 'undefined') return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = bottomPanelResizeStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      const deltaY = dragState.startY - event.clientY;
      const nextHeight = clampBottomPanelHeight(dragState.startHeight + deltaY, window.innerHeight);
      setBottomPanelHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const dragState = bottomPanelResizeStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      stopBottomPanelResizing();
    };

    const handleWindowBlur = () => {
      stopBottomPanelResizing();
    };

    window.document.body.classList.add('bottom-panel-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.document.body.classList.remove('bottom-panel-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [bottomPanelResizing, stopBottomPanelResizing]);

  return (
    <div className="tv-app" style={appStyle}>
      <header className="tv-topbar">
        <div className="brand-wrap">
          <TradingServiceMark />
          <div className="brand">
            <span>TradingService</span>
            <span className="brand-tm">TM</span>
          </div>
        </div>

        <div className="top-controls">
          <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
            {watchlistSymbols.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {getOptionLabel(item)}
              </option>
            ))}
          </select>

          <div className="interval-tools">
            <div className="intervals">
              {intervals.map((interval, index) => (
                <button
                  key={interval}
                  type="button"
                  className={interval === selectedInterval ? 'active' : ''}
                  onClick={() => switchInterval(interval)}
                  title={`타임프레임 전환 · 숫자키 ${index + 1}`}
                >
                  {interval}
                </button>
              ))}
            </div>
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
              type="button"
              className={item.key === activeTool ? 'active' : ''}
              onClick={() => setActiveTool(item.key)}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
          <button
            type="button"
            className={magnetEnabled ? 'active magnet-toggle' : 'magnet-toggle'}
            onClick={() => setMagnetEnabled((previous) => !previous)}
            title={magnetEnabled ? '자석 스냅 ON' : '자석 스냅 OFF'}
            aria-pressed={magnetEnabled}
          >
            🧲
          </button>
        </aside>

        <section className="center-panel">
          <div className="chart-header">
            <div className="chart-title-block">
              <div className="chart-title-main-row">
                <strong className="chart-title-main">
                  {selectedCode} · {selectedName} · {selectedInterval}
                </strong>
                {selectedSymbolVenueSupported ? (
                  <label className="chart-venue-control">
                    <span>차트 Venue</span>
                    <select
                      value={selectedChartVenue ?? ''}
                      onChange={(event) => {
                        void handleUpdateWatchSymbolVenue(selectedSymbol, toVenuePreferenceValue(event.target.value));
                      }}
                    >
                      <option value="">기본(전체)</option>
                      <option value="KRX">KRX</option>
                      <option value="NXT">NXT</option>
                    </select>
                  </label>
                ) : null}
              </div>
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

              {activeIndicatorLegends.length > 0 || hasCompareOverlays ? (
                <div className="chart-legend-row">
                  {activeIndicatorLegends.map((config) => (
                    <span key={config.key} className="chart-legend-item">
                      <span className="legend-dot" style={{ backgroundColor: config.color }} />
                      {config.legend}
                    </span>
                  ))}
                  {compareLegendItems.map((item) => (
                    <span key={`compare-legend-${item.slotIndex}`} className="chart-legend-item">
                      <span className="legend-dot" style={{ backgroundColor: COMPARE_OVERLAY_COLORS[item.slotIndex] }} />
                      비교 {item.symbolMeta ? getDisplayCode(item.symbolMeta) : shortTicker(item.symbol)} ·{' '}
                      {compareScaleMode === 'normalized' ? '% 정규화' : '절대값'} · {item.status ?? '--'}
                      {item.visible ? '' : ' (숨김)'}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="chart-inspector" aria-live="polite">
                <div className="chart-inspector-head">
                  <strong>Data Window</strong>
                  <div className="chart-inspector-status">
                    <p className="chart-inspector-hint">{crosshairInspectorSnapshot.helperText}</p>
                    <span className={`chart-inspector-mode ${crosshairInspectorSnapshot.mode}`}>
                      {crosshairInspectorSnapshot.mode === 'crosshair'
                        ? 'Crosshair'
                        : crosshairInspectorSnapshot.mode === 'latest'
                          ? 'Latest'
                          : 'Empty'}
                    </span>
                  </div>
                </div>
                <div className="chart-inspector-grid">
                  <span>T {crosshairInspectorSnapshot.time ? formatCandleDateTime(crosshairInspectorSnapshot.time) : '--'}</span>
                  <span>O {crosshairInspectorCandle ? formatPrice(crosshairInspectorCandle.open) : '--'}</span>
                  <span>H {crosshairInspectorCandle ? formatPrice(crosshairInspectorCandle.high) : '--'}</span>
                  <span>L {crosshairInspectorCandle ? formatPrice(crosshairInspectorCandle.low) : '--'}</span>
                  <span>C {crosshairInspectorCandle ? formatPrice(crosshairInspectorCandle.close) : '--'}</span>
                  <span>Vol {crosshairInspectorCandle ? formatVolume(crosshairInspectorCandle.volume) : '--'}</span>
                </div>

                {crosshairInspectorSnapshot.indicators.length > 0 ? (
                  <div className="chart-inspector-extra">
                    {crosshairInspectorSnapshot.indicators.map((item) => (
                      <span key={`inspector-indicator-${item.key}`} className="chart-inspector-extra-item">
                        {item.label} {item.value === null ? '--' : formatPrice(item.value)}
                      </span>
                    ))}
                  </div>
                ) : null}

                {crosshairInspectorSnapshot.compares.length > 0 ? (
                  <div className="chart-inspector-extra">
                    {crosshairInspectorSnapshot.compares.map((item) => (
                      <span key={`inspector-compare-${item.slotIndex}`} className="chart-inspector-extra-item">
                        {item.symbol} ({crosshairInspectorCompareModeLabel}) {item.value === null ? '--' : formatPrice(item.value)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
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
                  <div className="compare-scale-controls">
                    <div className="compare-scale-buttons" role="group" aria-label="비교 스케일 모드">
                      {compareScaleModeOptions.map((mode) => (
                        <button
                          key={mode.key}
                          type="button"
                          className={compareScaleMode === mode.key ? 'active' : ''}
                          onClick={() => updateCompareScaleMode(mode.key)}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={clearAllCompareOverlays} disabled={!hasCompareOverlays}>
                      전체 해제
                    </button>
                  </div>

                  <div className="compare-slot-list">
                    {compareOverlays.map((overlay, slotIndex) => {
                      const slotOptions = compareOptionsBySlot[slotIndex] ?? [];
                      const legendItem = compareLegendItemBySlot.get(slotIndex);
                      const slotStatus = overlay.error
                        ? overlay.error
                        : overlay.loading
                          ? '비교 데이터를 불러오는 중...'
                          : overlay.symbol && legendItem && !legendItem.currentValueText
                            ? '비교 가능한 공통 구간이 없습니다.'
                            : legendItem?.currentValueText
                              ? `현재값: ${legendItem.currentValueText}${compareScaleMode === 'normalized' ? ' (정규화)' : ''}`
                              : overlay.symbol
                                ? '비교 데이터 대기중'
                                : null;

                      return (
                        <div key={`compare-slot-${slotIndex}`} className="compare-slot-card">
                          <div className="compare-controls">
                            <span className="legend-dot" style={{ backgroundColor: COMPARE_OVERLAY_COLORS[slotIndex] }} />
                            <select
                              value={overlay.symbol}
                              onChange={(event) => updateCompareOverlaySymbol(slotIndex, event.target.value)}
                            >
                              <option value="">비교 심볼 선택 ({slotIndex + 1}/{MAX_COMPARE_SYMBOLS})</option>
                              {slotOptions.map((item) => (
                                <option key={item.symbol} value={item.symbol}>
                                  {getOptionLabel(item)}
                                </option>
                              ))}
                            </select>
                            <label className="compare-visibility-toggle">
                              <input
                                type="checkbox"
                                checked={overlay.visible}
                                disabled={!overlay.symbol}
                                onChange={(event) => updateCompareOverlayVisibility(slotIndex, event.target.checked)}
                              />
                              표시
                            </label>
                            <button type="button" onClick={() => clearCompareOverlay(slotIndex)} disabled={!overlay.symbol}>
                              제거
                            </button>
                          </div>
                          {slotStatus ? <p className="control-feedback">{slotStatus}</p> : null}
                          {compareScaleMode === 'normalized' && legendItem?.anchorText ? (
                            <p className="control-feedback">기준: {legendItem.anchorText}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {!hasAnyCompareCandidate ? (
                    <p className="control-feedback">관심종목에 비교 가능한 심볼이 없습니다.</p>
                  ) : null}
                  <p className="control-feedback">{compareScaleGuideText}</p>
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
              <div className="chart-area chart-area-secondary" onMouseLeave={clearHoveredCandle}>
                <div className="chart-canvas" ref={secondaryContainerRef} />
                <div className="secondary-chart-badge">보조 차트 · 범위 동기화</div>
              </div>
            ) : null}
          </div>

          <div className="status-row">
            <span>{loading ? '데이터를 불러오는 중...' : '실시간 UI 프로토타입'}</span>
            {topActionFeedback ? <span className="status-chip">{topActionFeedback}</span> : null}
            {activeToolDescription ? <span className="status-chip">{activeToolDescription}</span> : null}
            <span className={`status-chip magnet-status-chip ${magnetEnabled ? 'on' : 'off'}`}>
              Magnet {magnetEnabled ? 'ON' : 'OFF'}
            </span>
            {replayStatusText ? <span className="status-chip replay-status-chip">{replayStatusText}</span> : null}
            <span className="status-chip">단축키 H/V/T/Y/R/N/M · Esc · Delete/Backspace · Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z</span>
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
                    <label className="watch-venue-pref">
                      <span>KR Venue</span>
                      <select
                        value={watchlistAddVenuePreference}
                        onChange={(event) => setWatchlistAddVenuePreference(toVenuePreferenceValue(event.target.value))}
                      >
                        <option value="">기본(전체)</option>
                        <option value="KRX">KRX</option>
                        <option value="NXT">NXT</option>
                      </select>
                    </label>
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
                      const venueSupported = normalizeVenueForSymbol(item, 'KRX') === 'KRX';
                      const watchVenueValue = venueSupported ? toVenuePreferenceValue(item.venue) : '';

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
                              {item.venue ? <span className="watch-venue-tag">{item.venue}</span> : null}
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
                          {venueSupported ? (
                            <label
                              className="watch-venue-control"
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            >
                              <span>Venue</span>
                              <select
                                value={watchVenueValue}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  void handleUpdateWatchSymbolVenue(item.symbol, toVenuePreferenceValue(event.target.value));
                                }}
                              >
                                <option value="">기본</option>
                                <option value="KRX">KRX</option>
                                <option value="NXT">NXT</option>
                              </select>
                            </label>
                          ) : null}
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
                  {selectedKrxNxtComparison ? (
                    <div className="detail-venue-section">
                      <div className="detail-venue-section-head">
                        <h5>KRX vs NXT</h5>
                        <div className="detail-venue-session-list">
                          {selectedVenueSessionBadges.map((badge) => (
                            <span key={badge.venue} className={`detail-venue-session-badge ${badge.tone}`}>
                              {badge.venue} {badge.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      {selectedQuoteDisplayBasis ? (
                        <p className="detail-venue-basis">표시 기준: {selectedQuoteDisplayBasis}</p>
                      ) : null}
                      <div className="detail-venue-card-grid">
                        <div className="detail-venue-card">
                          <h6>KRX</h6>
                          <dl>
                            <div>
                              <dt>가격</dt>
                              <dd>
                                {selectedKrxNxtComparison.krx.price !== null
                                  ? formatPrice(selectedKrxNxtComparison.krx.price)
                                  : '--'}
                              </dd>
                            </div>
                            <div>
                              <dt>등락률</dt>
                              <dd
                                className={
                                  selectedKrxNxtComparison.krx.changePercent === null
                                    ? ''
                                    : selectedKrxNxtComparison.krx.changePercent >= 0
                                      ? 'up'
                                      : 'down'
                                }
                              >
                                {selectedKrxNxtComparison.krx.changePercent !== null
                                  ? `${selectedKrxNxtComparison.krx.changePercent >= 0 ? '+' : ''}${selectedKrxNxtComparison.krx.changePercent.toFixed(2)}%`
                                  : '--'}
                              </dd>
                            </div>
                            <div>
                              <dt>업데이트</dt>
                              <dd>{formatOptionalTimestamp(selectedKrxNxtComparison.krx.updatedAt)}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="detail-venue-card">
                          <h6>NXT</h6>
                          <dl>
                            <div>
                              <dt>가격</dt>
                              <dd>
                                {selectedKrxNxtComparison.nxt.price !== null
                                  ? formatPrice(selectedKrxNxtComparison.nxt.price)
                                  : '--'}
                              </dd>
                            </div>
                            <div>
                              <dt>등락률</dt>
                              <dd
                                className={
                                  selectedKrxNxtComparison.nxt.changePercent === null
                                    ? ''
                                    : selectedKrxNxtComparison.nxt.changePercent >= 0
                                      ? 'up'
                                      : 'down'
                                }
                              >
                                {selectedKrxNxtComparison.nxt.changePercent !== null
                                  ? `${selectedKrxNxtComparison.nxt.changePercent >= 0 ? '+' : ''}${selectedKrxNxtComparison.nxt.changePercent.toFixed(2)}%`
                                  : '--'}
                              </dd>
                            </div>
                            {selectedKrxNxtComparison.nxt.reason ? (
                              <div>
                                <dt>미가용 사유</dt>
                                <dd>{selectedKrxNxtComparison.nxt.reason}</dd>
                              </div>
                            ) : null}
                            <div>
                              <dt>업데이트</dt>
                              <dd>{formatOptionalTimestamp(selectedKrxNxtComparison.nxt.updatedAt)}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </div>
                  ) : null}
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

                    {selectedSymbolVenueSupported ? (
                      <div className="alert-venue-row">
                        <label className="alert-venue-select">
                          <span>KR Venue (선택)</span>
                          <select
                            value={alertVenuePreference}
                            onChange={(event) =>
                              setAlertVenuePreference(toVenuePreferenceValue(event.target.value))
                            }
                          >
                            <option value="">기본(전체)</option>
                            <option value="KRX">KRX</option>
                            <option value="NXT">NXT</option>
                          </select>
                        </label>
                      </div>
                    ) : null}

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

                  <div className="alert-center-state-grid">
                    <div className="alert-state-card">
                      <span>active</span>
                      <strong>{alertRuleStateSummary.active}</strong>
                    </div>
                    <div className="alert-state-card">
                      <span>triggered</span>
                      <strong>{alertRuleStateSummary.triggered}</strong>
                    </div>
                    <div className="alert-state-card">
                      <span>cooldown</span>
                      <strong>{alertRuleStateSummary.cooldown}</strong>
                    </div>
                    <div className="alert-state-card is-error">
                      <span>error</span>
                      <strong>{alertRuleStateSummary.error}</strong>
                    </div>
                  </div>

                  {alertErroredRules.length > 0 ? (
                    <div className="alert-error-center">
                      <div className="alert-triggered-title">실패 원인</div>
                      <ul className="alert-list">
                        {alertErroredRules.slice(0, 5).map((rule) => (
                          <li key={`error-${rule.id}`}>
                            <div className="alert-rule-row">
                              <strong>
                                {rule.symbol}
                                {rule.venue ? <span className="alert-venue-tag">{rule.venue}</span> : null}
                              </strong>
                              <span className="alert-state-tag error">error</span>
                            </div>
                            <div className="alert-rule-sub">
                              <span>{rule.lastError?.message ?? '평가 오류'}</span>
                              <span>
                                발생:{' '}
                                {rule.lastError?.failedAt
                                  ? new Date(rule.lastError.failedAt).toLocaleString('ko-KR')
                                  : '-'}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
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
                            <div className="alert-rule-actions">
                              <span className={`alert-state-tag ${formatAlertState(rule.state)}`}>{formatAlertState(rule.state)}</span>
                              <button type="button" onClick={() => handleDeleteAlertRule(rule.id)}>
                                삭제
                              </button>
                            </div>
                          </div>
                          <div className="alert-rule-sub">
                            <span>심볼: {rule.symbol}</span>
                            {rule.venue ? <span>Venue: {rule.venue}</span> : null}
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
                            <span>
                              상태 전이: {formatAlertTransitionReason(rule.lastStateTransition.reason)} ·{' '}
                              {new Date(rule.lastStateTransition.transitionedAt).toLocaleTimeString('ko-KR')}
                            </span>
                            {rule.lastError?.message ? <span>실패 사유: {rule.lastError.message}</span> : null}
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
                              <div className="alert-history-meta">
                                <span className={`alert-state-tag ${formatAlertState(eventItem.state)}`}>
                                  {formatAlertState(eventItem.state)}
                                </span>
                                {eventItem.venue ? <span className="alert-venue-tag">{eventItem.venue}</span> : null}
                                <span>{eventItem.symbol}</span>
                              </div>
                            </div>
                            <div className="alert-rule-sub">
                              {typeof eventItem.currentValue === 'number' ? (
                                <span>현재값: {formatAlertValue(eventItem.metric, eventItem.currentValue)}</span>
                              ) : null}
                              {formatAlertIndicatorSummary(eventItem.indicatorConditions) ? (
                                <span>지표: {formatAlertIndicatorSummary(eventItem.indicatorConditions)}</span>
                              ) : null}
                              {eventItem.transition ? (
                                <span>전이: {formatAlertTransitionReason(eventItem.transition.reason)}</span>
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
                      <div className="alert-triggered-title">알림센터</div>
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
                      <label>
                        <span>상태</span>
                        <select
                          value={alertHistoryStateFilter}
                          onChange={(event) => setAlertHistoryStateFilter(event.target.value as AlertHistoryStateFilter)}
                        >
                          <option value="all">all</option>
                          <option value="active">active</option>
                          <option value="triggered">triggered</option>
                          <option value="cooldown">cooldown</option>
                          <option value="error">error</option>
                        </select>
                      </label>
                      <label>
                        <span>타입</span>
                        <select
                          value={alertHistoryTypeFilter}
                          onChange={(event) => setAlertHistoryTypeFilter(event.target.value as AlertHistoryTypeFilter)}
                        >
                          <option value="all">all</option>
                          <option value="triggered">triggered</option>
                          <option value="error">error</option>
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
                    ) : alertCenterEvents.length === 0 ? (
                      <p className="alert-empty">필터에 맞는 알림 이벤트가 없습니다.</p>
                    ) : (
                      <ul className="alert-list">
                        {alertCenterEvents.map((eventItem, index) => (
                          <li key={`${eventItem.ruleId}-${eventItem.triggeredAt}-${index}`}>
                            <div className="alert-rule-row">
                              <strong>
                                {formatAlertMetric(eventItem.metric)} {eventItem.operator}{' '}
                                {formatAlertValue(eventItem.metric, eventItem.threshold)}
                              </strong>
                              <div className="alert-history-meta">
                                <span className={`alert-source-tag ${formatAlertEventType(eventItem.eventType)}`}>
                                  {formatAlertEventType(eventItem.eventType)}
                                </span>
                                <span className={`alert-state-tag ${formatAlertState(eventItem.state)}`}>
                                  {formatAlertState(eventItem.state)}
                                </span>
                                {eventItem.source ? (
                                  <span className={`alert-source-tag ${eventItem.source}`}>{eventItem.source}</span>
                                ) : null}
                                {eventItem.venue ? <span className="alert-venue-tag">{eventItem.venue}</span> : null}
                                <span>{eventItem.symbol}</span>
                              </div>
                            </div>
                            <div className="alert-rule-sub">
                              {typeof eventItem.currentValue === 'number' ? (
                                <span>현재값: {formatAlertValue(eventItem.metric, eventItem.currentValue)}</span>
                              ) : null}
                              {formatAlertIndicatorSummary(eventItem.indicatorConditions) ? (
                                <span>지표: {formatAlertIndicatorSummary(eventItem.indicatorConditions)}</span>
                              ) : null}
                              {eventItem.errorMessage ? <span>실패 사유: {eventItem.errorMessage}</span> : null}
                              {eventItem.transition ? (
                                <span>전이: {formatAlertTransitionReason(eventItem.transition.reason)}</span>
                              ) : null}
                              {eventItem.sourceSymbol ? <span>요청 심볼: {eventItem.sourceSymbol}</span> : null}
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

      <footer className={`tv-bottom-panel${bottomPanelResizing ? ' resizing' : ''}`}>
        <div
          className="bottom-panel-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="하단 패널 높이 조절"
          onPointerDown={handleBottomPanelResizeStart}
        />
        <div className="bottom-tabs">
          {bottomTabs.map((tab) => (
            <button key={tab.id} className={bottomTab === tab.id ? 'active' : ''} onClick={() => setBottomTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bottom-content">
          {bottomTab === 'pine' ? (
            <div className="pine-editor-panel">
              <div className="pine-editor-main">
                <div className="pine-editor-toolbar">
                  <label className="pine-editor-name-field">
                    <span>스크립트 이름</span>
                    <input
                      type="text"
                      value={pineEditorName}
                      onChange={(event) => setPineEditorName(event.target.value)}
                      placeholder="예: My Script"
                    />
                  </label>
                  <div className="pine-editor-actions">
                    <button type="button" onClick={handleCreateNewPineScript}>
                      New
                    </button>
                    <button type="button" onClick={handleRenamePineScript} disabled={!pineEditorScriptId}>
                      Rename
                    </button>
                    <button type="button" onClick={handleDuplicatePineScript} disabled={pineWorkspace.scripts.length === 0}>
                      Duplicate
                    </button>
                    <button type="button" onClick={() => handleSavePineScript('save')}>
                      Save
                    </button>
                    <button type="button" onClick={() => handleSavePineScript('saveAs')}>
                      Save As
                    </button>
                    <button type="button" onClick={handleDeletePineScript} disabled={!pineEditorScriptId}>
                      Delete
                    </button>
                    <button
                      type="button"
                      className="pine-editor-bridge-btn"
                      onClick={handleBridgePineToStrategyTester}
                      disabled={!pineActiveScript}
                    >
                      전략 테스터로 보내기
                    </button>
                  </div>
                  {pineEditorDirty ? <span className="pine-editor-dirty-indicator">저장하지 않은 변경사항이 있습니다.</span> : null}
                </div>

                <div className="pine-editor-textarea-wrap">
                  <textarea
                    className="pine-editor-textarea"
                    value={pineEditorSource}
                    onChange={(event) => setPineEditorSource(event.target.value)}
                    spellCheck={false}
                  />
                </div>

                <div className="pine-editor-status">
                  <div className="pine-editor-status-main">
                    <span className={`pine-editor-status-text ${pineStatusMessage?.tone === 'error' ? 'error' : 'info'}`}>
                      {pineStatusMessage?.text ?? (pineEditorDirty ? '편집 중입니다.' : '저장 상태 최신입니다.')}
                    </span>
                    {pineEditorGuardrailWarnings.length > 0 ? (
                      <span className="pine-editor-status-text warning">{pineEditorGuardrailWarnings.join(' ')}</span>
                    ) : null}
                  </div>
                  <span className="pine-editor-status-meta">
                    {pineActiveScript
                      ? `rev ${pineActiveScript.revision} · 마지막 저장: ${formatOptionalTimestamp(pineActiveScript.updatedAt)}`
                      : '저장되지 않은 새 스크립트'}
                  </span>
                </div>
              </div>

              <aside className="pine-library-panel">
                <div className="pine-library-head">
                  <strong>스크립트 라이브러리</strong>
                  <span>
                    {pineLibraryQuery.trim().length > 0
                      ? `${pineLibraryScripts.length}/${pineWorkspace.scripts.length}개`
                      : `${pineWorkspace.scripts.length}개`}
                  </span>
                </div>

                {pineWorkspace.scripts.length === 0 ? (
                  <p className="pine-library-empty">저장된 스크립트가 없습니다.</p>
                ) : (
                  <>
                    <label className="pine-library-search">
                      <span>검색</span>
                      <input
                        type="text"
                        value={pineLibraryQuery}
                        onChange={(event) => setPineLibraryQuery(event.target.value)}
                        placeholder="스크립트 이름으로 필터"
                      />
                    </label>
                    {pineLibraryScripts.length === 0 ? (
                      <p className="pine-library-empty">검색 결과가 없습니다.</p>
                    ) : (
                      <ul className="pine-library-list">
                        {pineLibraryScripts.map((script) => (
                          <li key={script.id}>
                            <button
                              type="button"
                              className={script.id === pineEditorScriptId ? 'active' : ''}
                              onClick={() => handleOpenPineScript(script.id)}
                            >
                              <strong>{renderMatchedText(script.name, pineLibraryQuery)}</strong>
                              <span>rev {script.revision}</span>
                              <span>{formatOptionalTimestamp(script.updatedAt)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </aside>
            </div>
          ) : null}

          {bottomTab === 'strategy' ? (
            <div className="strategy-tester-panel">
              <div className={`strategy-link-banner ${strategyForm.linkedScript ? 'linked' : 'standalone'}`}>
                {strategyForm.linkedScript ? (
                  <>
                    <div className="strategy-link-meta">
                      <span className="strategy-link-badge">Pine 연결됨</span>
                      {typeof strategyForm.linkedScript.warningCount === 'number' && strategyForm.linkedScript.warningCount > 0 ? (
                        <span className="strategy-link-badge warning">경고 {strategyForm.linkedScript.warningCount}</span>
                      ) : null}
                      <strong>{strategyForm.linkedScript.scriptName}</strong>
                      <span>
                        rev {strategyForm.linkedScript.revision} · {strategyForm.linkedScript.scriptId}
                      </span>
                    </div>
                    <button type="button" onClick={handleUnlinkStrategyLinkedScript} disabled={strategyLoading}>
                      연결 해제
                    </button>
                  </>
                ) : (
                  <div className="strategy-link-meta">
                    <span className="strategy-link-badge standalone">독립 실행</span>
                    <span>Pine 스크립트 연결 없이 백테스트를 실행합니다.</span>
                  </div>
                )}
              </div>

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
                    <span>수수료 단위</span>
                    <select
                      value={strategyForm.feeUnit}
                      onChange={(event) => updateStrategyField('feeUnit', event.target.value)}
                    >
                      <option value="bps">bps</option>
                      <option value="percent">%</option>
                    </select>
                  </label>
                  <label>
                    <span>수수료 값</span>
                    <input
                      type="number"
                      min={0}
                      max={strategyForm.feeUnit === 'bps' ? STRATEGY_MAX_FEE_BPS : STRATEGY_MAX_FEE_PERCENT}
                      step={strategyForm.feeUnit === 'bps' ? '0.1' : '0.01'}
                      value={strategyForm.feeValue}
                      onChange={(event) => updateStrategyField('feeValue', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>슬리피지 단위</span>
                    <select
                      value={strategyForm.slippageMode}
                      onChange={(event) => updateStrategyField('slippageMode', event.target.value)}
                    >
                      <option value="percent">%</option>
                      <option value="tick">tick</option>
                    </select>
                  </label>
                  <label>
                    <span>슬리피지 값</span>
                    <input
                      type="number"
                      min={0}
                      max={strategyForm.slippageMode === 'tick' ? STRATEGY_MAX_SLIPPAGE_TICK : STRATEGY_MAX_SLIPPAGE_PERCENT}
                      step={strategyForm.slippageMode === 'tick' ? '0.01' : '0.001'}
                      value={strategyForm.slippageValue}
                      onChange={(event) => updateStrategyField('slippageValue', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>포지션 사이징</span>
                    <select
                      value={strategyForm.positionSizeMode}
                      onChange={(event) => updateStrategyField('positionSizeMode', event.target.value)}
                    >
                      <option value="fixed-percent">자본 비율(%)</option>
                      <option value="fixed-qty">고정 수량</option>
                    </select>
                  </label>
                  <label>
                    <span>{strategyForm.positionSizeMode === 'fixed-qty' ? '고정 수량' : '포지션 크기 (%)'}</span>
                    <input
                      type="number"
                      min={strategyForm.positionSizeMode === 'fixed-qty' ? 0.000001 : 0.1}
                      max={strategyForm.positionSizeMode === 'fixed-qty' ? STRATEGY_MAX_FIXED_QTY : 100}
                      step={strategyForm.positionSizeMode === 'fixed-qty' ? '0.000001' : '0.1'}
                      value={strategyForm.positionSizeMode === 'fixed-qty' ? strategyForm.fixedQty : strategyForm.fixedPercent}
                      onChange={(event) =>
                        updateStrategyField(
                          strategyForm.positionSizeMode === 'fixed-qty' ? 'fixedQty' : 'fixedPercent',
                          event.target.value,
                        )
                      }
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
                      <span>순손익 (Net)</span>
                      <strong className={strategyResult.summary.netPnl >= 0 ? 'up' : 'down'}>
                        {formatSignedCurrency(strategyResult.summary.netPnl)}
                      </strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>총손익 (Gross)</span>
                      <strong
                        className={
                          (strategyResult.summary.grossPnl ?? strategyResult.summary.netPnl) >= 0 ? 'up' : 'down'
                        }
                      >
                        {formatSignedCurrency(strategyResult.summary.grossPnl ?? strategyResult.summary.netPnl)}
                      </strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>순수익률 (Net)</span>
                      <strong className={strategyResult.summary.returnPct >= 0 ? 'up' : 'down'}>
                        {formatSigned(strategyResult.summary.returnPct, 2)}%
                      </strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>총수익률 (Gross)</span>
                      <strong
                        className={
                          (strategyResult.summary.grossReturnPct ?? strategyResult.summary.returnPct) >= 0 ? 'up' : 'down'
                        }
                      >
                        {formatSigned(strategyResult.summary.grossReturnPct ?? strategyResult.summary.returnPct, 2)}%
                      </strong>
                    </div>
                    <div className="strategy-summary-card">
                      <span>총비용 (Fee+Slippage)</span>
                      <strong>
                        {formatPrice(
                          strategyResult.summary.totalCosts ??
                            (strategyResult.summary.totalFees ?? 0) + (strategyResult.summary.totalSlippage ?? 0),
                        )}
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
                              ...(event.target.value === 'BUY' ? {} : { useBracket: false }),
                            }))
                          }
                          disabled={tradingSubmitting}
                        >
                          <option value="BUY">BUY</option>
                          <option value="SELL">SELL</option>
                        </select>
                      </label>
                      <label>
                        <span>주문 유형</span>
                        <select
                          value={tradingOrderForm.orderType}
                          onChange={(event) =>
                            setTradingOrderForm((previous) => ({
                              ...previous,
                              orderType: event.target.value as TradingOrderType,
                              ...(event.target.value === 'LIMIT' ? {} : { limitPrice: '' }),
                              ...(event.target.value === 'STOP' ? {} : { triggerPrice: '' }),
                            }))
                          }
                          disabled={tradingSubmitting}
                        >
                          <option value="MARKET">시장가</option>
                          <option value="LIMIT">지정가</option>
                          <option value="STOP">스탑</option>
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
                      {tradingOrderForm.orderType === 'LIMIT' ? (
                        <label>
                          <span>지정가</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={tradingOrderForm.limitPrice}
                            onChange={(event) =>
                              setTradingOrderForm((previous) => ({
                                ...previous,
                                limitPrice: event.target.value,
                              }))
                            }
                            placeholder="예: 98000"
                            disabled={tradingSubmitting}
                          />
                        </label>
                      ) : null}
                      {tradingOrderForm.orderType === 'STOP' ? (
                        <label>
                          <span>스탑 트리거</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={tradingOrderForm.triggerPrice}
                            onChange={(event) =>
                              setTradingOrderForm((previous) => ({
                                ...previous,
                                triggerPrice: event.target.value,
                              }))
                            }
                            placeholder="예: 102000"
                            disabled={tradingSubmitting}
                          />
                        </label>
                      ) : null}
                    </div>

                    <div className="trading-order-bracket">
                      <label className="trading-order-toggle">
                        <input
                          type="checkbox"
                          checked={tradingOrderForm.useBracket}
                          onChange={(event) =>
                            setTradingOrderForm((previous) => ({
                              ...previous,
                              useBracket: event.target.checked,
                            }))
                          }
                          disabled={tradingSubmitting || tradingOrderForm.side !== 'BUY'}
                        />
                        <span>브래킷 TP/SL</span>
                      </label>
                      {tradingOrderForm.side !== 'BUY' ? (
                        <span className="muted">v1에서는 BUY 주문에만 브래킷을 지원합니다.</span>
                      ) : null}

                      {tradingOrderForm.useBracket ? (
                        <div className="trading-order-grid trading-order-grid-bracket">
                          <label>
                            <span>TP (익절)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={tradingOrderForm.takeProfitPrice}
                              onChange={(event) =>
                                setTradingOrderForm((previous) => ({
                                  ...previous,
                                  takeProfitPrice: event.target.value,
                                }))
                              }
                              placeholder="선택 입력"
                              disabled={tradingSubmitting}
                            />
                          </label>
                          <label>
                            <span>SL (손절)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={tradingOrderForm.stopLossPrice}
                              onChange={(event) =>
                                setTradingOrderForm((previous) => ({
                                  ...previous,
                                  stopLossPrice: event.target.value,
                                }))
                              }
                              placeholder="선택 입력"
                              disabled={tradingSubmitting}
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>

                    <div className="trading-order-meta">
                      <span>주문유형: {formatTradingOrderType(tradingOrderForm.orderType)}</span>
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
                        {tradingSubmitting
                          ? '주문 전송 중...'
                          : tradingOrderForm.orderType === 'MARKET'
                            ? '시장가 주문'
                            : tradingOrderForm.orderType === 'LIMIT'
                              ? '지정가 주문'
                              : '스탑 주문'}
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
                                <th>유형</th>
                                <th>방향</th>
                                <th>수량</th>
                                <th>조건</th>
                                <th>체결가</th>
                                <th>링크</th>
                                <th>상태</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tradingState.orders.slice(0, 30).map((order) => (
                                <tr key={order.id}>
                                  <td>{new Date(order.createdAt).toLocaleString('ko-KR')}</td>
                                  <td>{order.symbol}</td>
                                  <td>{formatTradingOrderType(order.type)}</td>
                                  <td className={order.side === 'BUY' ? 'trading-side-buy' : 'trading-side-sell'}>
                                    {order.side}
                                  </td>
                                  <td>{formatQty(order.qty)}</td>
                                  <td>{formatTradingOrderCondition(order)}</td>
                                  <td>{typeof order.fillPrice === 'number' ? formatPrice(order.fillPrice) : '--'}</td>
                                  <td className="trading-link-cell">{formatTradingOrderLink(order)}</td>
                                  <td>
                                    <span className={`trading-order-status trading-order-status-${order.status.toLowerCase()}`}>
                                      {order.status}
                                    </span>
                                    {order.canceledByOrderId ? (
                                      <span className="trading-order-substatus">by {shortenTradingOrderId(order.canceledByOrderId)}</span>
                                    ) : null}
                                  </td>
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

          {bottomTab === 'objects' ? (
            <div className="bottom-side-panel">
              <div className="drawing-objects-panel">
                <div className="drawing-objects-head">
                  <strong>도형 오브젝트</strong>
                  <span>{drawingObjects.length}</span>
                </div>
                {drawingObjects.length === 0 ? (
                  <p className="drawing-objects-empty">저장된 도형이 없습니다.</p>
                ) : (
                  <ul className="drawing-objects-list" aria-label="드로잉 오브젝트 목록">
                    {drawingObjects.map((drawing) => (
                      <li key={drawing.id} className={selectedDrawingId === drawing.id ? 'selected' : ''}>
                        <button
                          type="button"
                          className={`drawing-objects-row${selectedDrawingId === drawing.id ? ' selected' : ''}`}
                          onClick={() => setSelectedDrawingId(drawing.id)}
                        >
                          <span className="drawing-objects-type">{formatDrawingKindLabel(drawing.kind)}</span>
                          <span className="drawing-objects-id">{drawing.id}</span>
                          <span className="drawing-objects-anchor">{drawing.anchor}</span>
                          {drawing.context ? <span className="drawing-objects-context">{drawing.context}</span> : null}
                        </button>
                        <div className="drawing-objects-actions">
                          <button
                            type="button"
                            className={drawing.locked ? 'active' : ''}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDrawingId(drawing.id);
                              toggleDrawingLockedById(drawing.id);
                            }}
                          >
                            잠금
                          </button>
                          <button
                            type="button"
                            className={drawing.visible ? 'active' : ''}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDrawingId(drawing.id);
                              toggleDrawingVisibilityById(drawing.id);
                            }}
                          >
                            표시
                          </button>
                          <button
                            type="button"
                            className="delete"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteDrawingFromObjectsPanel(drawing.id);
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {bottomTab === 'ops' ? (
            <div className="bottom-side-panel">
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
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

export default App;
