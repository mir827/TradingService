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
import { calculateEMA, calculateSMA, normalizeCompareOverlay, toTimeValuePoints } from './lib/chartMath';
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

type AlertCheckEvent = {
  ruleId: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  currentValue: number;
  triggeredAt: number;
  cooldownSec: number;
};

type AlertHistorySource = 'manual' | 'watchlist';
type AlertHistorySourceFilter = 'all' | AlertHistorySource;

type AlertHistoryEvent = AlertCheckEvent & {
  source?: AlertHistorySource;
  sourceSymbol?: string;
};

type WatchTab = 'watchlist' | 'detail' | 'alerts';
type BottomTab = 'pine' | 'strategy' | 'trading';
type TopActionKey = 'indicator' | 'compare' | 'alerts' | 'replay';
type WatchSortKey = 'symbol' | 'price' | 'changePercent';
type WatchSortDir = 'asc' | 'desc';
type WatchMarketFilter = 'ALL' | MarketType;
type IndicatorKind = 'SMA' | 'EMA';
type IndicatorKey = 'sma20' | 'sma60' | 'ema20';
type IndicatorConfig = {
  key: IndicatorKey;
  label: string;
  kind: IndicatorKind;
  period: number;
  color: string;
  legend: string;
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

const intervals = ['1', '5', '15', '60', '240', '1D', '1W'];
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
  { key: 'sma20', label: 'SMA 20', kind: 'SMA', period: 20, color: '#f0b429', legend: 'SMA 20' },
  { key: 'sma60', label: 'SMA 60', kind: 'SMA', period: 60, color: '#4da4ff', legend: 'SMA 60' },
  { key: 'ema20', label: 'EMA 20', kind: 'EMA', period: 20, color: '#ff7f50', legend: 'EMA 20' },
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
const DEFAULT_WATCHLIST_NAME = 'default';
const ALERT_EVENT_DEDUP_WINDOW_MS = 10_000;
const ALERT_EVENT_MAX_ITEMS = 20;
const HOVER_TOOLTIP_WIDTH = 232;
const HOVER_TOOLTIP_HEIGHT = 174;
const HOVER_TOOLTIP_MARGIN = 14;
const DRAWING_HIT_TOLERANCE_PX = 8;
const NOTE_HIT_RADIUS_PX = 14;

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

function App() {
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const verticalOverlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRefs = useRef<Record<IndicatorKey, ISeriesApi<'Line'> | null>>({
    sma20: null,
    sma60: null,
    ema20: null,
  });
  const compareSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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
  const selectedSymbolRef = useRef('BTCUSDT');
  const selectedIntervalRef = useRef('60');
  const watchlistAlertCheckInFlightRef = useRef(false);
  const recentAlertEventByRuleRef = useRef<Map<string, number>>(new Map());

  const [watchlistSymbols, setWatchlistSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('60');
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
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [indicatorPanelOpen, setIndicatorPanelOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [enabledIndicators, setEnabledIndicators] = useState<Record<IndicatorKey, boolean>>({
    sma20: false,
    sma60: false,
    ema20: false,
  });
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
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertTriggeredEvents, setAlertTriggeredEvents] = useState<AlertCheckEvent[]>([]);
  const [alertLastCheckedAt, setAlertLastCheckedAt] = useState<number | null>(null);
  const [alertHistoryEvents, setAlertHistoryEvents] = useState<AlertHistoryEvent[]>([]);
  const [alertHistorySymbolFilter, setAlertHistorySymbolFilter] = useState('');
  const [alertHistorySourceFilter, setAlertHistorySourceFilter] = useState<AlertHistorySourceFilter>('all');
  const [alertsHistoryLoading, setAlertsHistoryLoading] = useState(false);
  const [alertsHistoryClearing, setAlertsHistoryClearing] = useState(false);

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
    selectedIntervalRef.current = selectedInterval;
  }, [selectedInterval]);

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
        top: 0.82,
        bottom: 0,
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
        return;
      }

      if (nextTool === 'vertical') {
        if (typeof param.time !== 'number') return;

        const timestamp = Math.floor(param.time) as UTCTimestamp;
        const duplicated = verticalLinesRef.current.some((item) => Number(item.time) === Number(timestamp));
        if (duplicated) return;

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
    };

    const onVisibleLogicalRangeChange = () => {
      syncVerticalLinePositions();
      refreshDrawingOverlay();
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
      indicatorSeriesRefs.current = { sma20: null, sma60: null, ema20: null };
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
    clearHoveredCandle,
    pendingShapeStart,
    persistDrawings,
    refreshDrawingOverlay,
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
    syncVerticalLinePositions,
  ]);

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

  const loadAlertRules = useCallback(
    async (symbol: string) => {
      setAlertsLoading(true);

      try {
        const response = await fetch(`${apiBase}/api/alerts/rules?symbol=${encodeURIComponent(symbol)}`);
        if (!response.ok) throw new Error('alert rules fetch failed');

        const data = (await response.json()) as { rules: AlertRule[] };
        setAlertRules(data.rules ?? []);
      } catch {
        setAlertRules([]);
        setAlertMessage('알림 규칙을 불러오지 못했습니다.');
      } finally {
        setAlertsLoading(false);
      }
    },
    [],
  );

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

      const response = await fetch(`${apiBase}/api/alerts/history?${params.toString()}`);
      if (!response.ok) throw new Error('alert history fetch failed');

      const data = (await response.json()) as { events?: AlertHistoryEvent[] };
      setAlertHistoryEvents(data.events ?? []);
    } catch {
      setAlertHistoryEvents([]);
      setAlertMessage((prev) => prev ?? '알림 히스토리를 불러오지 못했습니다.');
    } finally {
      setAlertsHistoryLoading(false);
    }
  }, [alertHistorySourceFilter, alertHistorySymbolFilter]);

  useEffect(() => {
    setAlertMessage(null);
    void loadAlertRules(selectedSymbol);
  }, [loadAlertRules, selectedSymbol]);

  useEffect(() => {
    if (watchTab !== 'alerts') return;
    void loadAlertHistory();
  }, [loadAlertHistory, watchTab]);

  useEffect(() => {
    candleMapRef.current = new Map(activeCandles.map((candle) => [candle.time, candle]));
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;

    if (!activeCandles.length) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
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

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
    syncVerticalLinePositions();
    refreshDrawingOverlay();
  }, [activeCandles, refreshDrawingOverlay, syncVerticalLinePositions]);

  useEffect(() => {
    const closeValues = activeCandles.map((candle) => candle.close);

    for (const config of indicatorConfigs) {
      const series = indicatorSeriesRefs.current[config.key];
      if (!series) continue;

      if (!enabledIndicators[config.key] || closeValues.length === 0) {
        series.setData([]);
        continue;
      }

      const values =
        config.kind === 'SMA'
          ? calculateSMA(closeValues, config.period)
          : calculateEMA(closeValues, config.period);

      const points: LineData[] = toTimeValuePoints(activeCandles, values).map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      }));

      series.setData(points);
    }
  }, [activeCandles, enabledIndicators]);

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
        return;
      }

      if (watchlistAlertCheckInFlightRef.current) return;

      watchlistAlertCheckInFlightRef.current = true;
      if (source === 'manual') {
        setAlertsWatchlistChecking(true);
      }

      try {
        const response = await fetch(`${apiBase}/api/alerts/check-watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols: watchlistAlertSymbols,
          }),
        });
        if (!response.ok) throw new Error('check watchlist alerts failed');

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
        await loadAlertRules(selectedSymbol);
        await loadAlertHistory();
      } catch {
        setAlertMessage(
          source === 'manual'
            ? '관심종목 알림 체크에 실패했습니다.'
            : '관심종목 자동 체크에 실패했습니다.',
        );
      } finally {
        if (source === 'manual') {
          setAlertsWatchlistChecking(false);
        }
        watchlistAlertCheckInFlightRef.current = false;
      }
    },
    [appendWatchlistAlertEvents, loadAlertHistory, loadAlertRules, selectedSymbol, watchlistAlertSymbols],
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

  const handleCreateAlertRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

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
        }),
      });

      if (!response.ok) throw new Error('create alert rule failed');

      setAlertThresholdInput('');
      setAlertMessage('알림 규칙이 추가되었습니다.');
      await loadAlertRules(selectedSymbol);
    } catch {
      setAlertMessage('알림 규칙 생성에 실패했습니다.');
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

    try {
      const body: {
        symbol: string;
        values?: { symbol: string; lastPrice: number; changePercent: number };
      } = {
        symbol: selectedSymbol,
      };

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

      if (!response.ok) throw new Error('check alerts failed');

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
      await loadAlertRules(selectedSymbol);
      await loadAlertHistory();
    } catch {
      setAlertMessage('알림 체크에 실패했습니다.');
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
        setSelectedDrawingId(null);
        return;
      }

      setSelectedDrawingId(hit.id);

      const mapped = toTimePriceFromCoordinates(point.x, point.y);
      if (!mapped) return;

      const dragState = startDragState(hit, event.pointerId, mapped.time, mapped.price);
      if (!dragState) return;

      dragStateRef.current = dragState;
      setIsDraggingDrawing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [findDrawingAtPoint, getLocalChartPoint, startDragState, toTimePriceFromCoordinates],
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

      dragStateRef.current = null;
      setIsDraggingDrawing(false);
      if (!dragState.moved) return;

      void persistDrawings(
        selectedSymbolRef.current,
        selectedIntervalRef.current,
        snapshotHorizontalLines(),
        snapshotVerticalLines(),
        snapshotTrendlines(),
        snapshotRays(),
        snapshotRectangles(),
        snapshotNotes(),
      );
    },
    [
      persistDrawings,
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
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [persistDrawings, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearHorizontalLines = useCallback(() => {
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
    setSelectedDrawingId((previous) =>
      previous && horizontalLinesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [persistDrawings, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const removeVerticalLine = useCallback((id: string) => {
    const nextVerticalLines = verticalLinesRef.current.filter((item) => item.id !== id);
    if (nextVerticalLines.length === verticalLinesRef.current.length) return;

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
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [persistDrawings, renderVerticalLines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines]);

  const clearVerticalLines = useCallback(() => {
    if (!verticalLinesRef.current.length) return;

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
    setSelectedDrawingId((previous) =>
      previous && verticalLinesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [persistDrawings, renderVerticalLines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotTrendlines]);

  const removeTrendline = useCallback((id: string) => {
    const nextTrendlines = trendlinesRef.current.filter((item) => item.id !== id);
    if (nextTrendlines.length === trendlinesRef.current.length) return;

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
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [persistDrawings, renderTrendlines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotVerticalLines]);

  const clearTrendlines = useCallback(() => {
    if (!trendlinesRef.current.length) return;

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
    setSelectedDrawingId((previous) =>
      previous && trendlinesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [persistDrawings, renderTrendlines, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotRectangles, snapshotVerticalLines]);

  const removeRay = useCallback((id: string) => {
    const nextRays = raysRef.current.filter((item) => item.id !== id);
    if (nextRays.length === raysRef.current.length) return;

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
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [persistDrawings, renderRays, snapshotHorizontalLines, snapshotNotes, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearRays = useCallback(() => {
    if (!raysRef.current.length) return;

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
    setSelectedDrawingId((previous) =>
      previous && raysRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [persistDrawings, renderRays, snapshotHorizontalLines, snapshotNotes, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const removeRectangle = useCallback((id: string) => {
    const nextRectangles = rectanglesRef.current.filter((item) => item.id !== id);
    if (nextRectangles.length === rectanglesRef.current.length) return;

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
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [persistDrawings, renderRectangles, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotTrendlines, snapshotVerticalLines]);

  const clearRectangles = useCallback(() => {
    if (!rectanglesRef.current.length) return;

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
    setSelectedDrawingId((previous) =>
      previous && rectanglesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [persistDrawings, renderRectangles, snapshotHorizontalLines, snapshotNotes, snapshotRays, snapshotTrendlines, snapshotVerticalLines]);

  const removeNote = useCallback((id: string) => {
    const nextNotes = notesRef.current.filter((item) => item.id !== id);
    if (nextNotes.length === notesRef.current.length) return;

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
    setSelectedDrawingId((previous) => (previous === id ? null : previous));
  }, [persistDrawings, renderNotes, snapshotHorizontalLines, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearNotes = useCallback(() => {
    if (!notesRef.current.length) return;

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
    setSelectedDrawingId((previous) =>
      previous && notesRef.current.some((item) => item.id === previous) ? previous : null,
    );
  }, [persistDrawings, renderNotes, snapshotHorizontalLines, snapshotRays, snapshotRectangles, snapshotTrendlines, snapshotVerticalLines]);

  const clearAllDrawings = useCallback(() => {
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
  }, [persistDrawings, renderVerticalLines]);

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
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextInputTarget(event.target)) return;

      const key = event.key.toLowerCase();
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
  }, [deleteSelectedDrawing, selectedDrawingId]);

  const toggleIndicator = useCallback((key: IndicatorKey) => {
    setEnabledIndicators((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

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
    setCompareSymbol('');
    setCompareCandles([]);
    setCompareError(null);
  }, []);

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

              {activeIndicatorConfigs.length > 0 || compareSymbol ? (
                <div className="chart-legend-row">
                  {activeIndicatorConfigs.map((config) => (
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
                      <label key={config.key}>
                        <input
                          type="checkbox"
                          checked={enabledIndicators[config.key]}
                          onChange={() => toggleIndicator(config.key)}
                        />
                        <span className="legend-dot" style={{ backgroundColor: config.color }} />
                        <span>{config.label}</span>
                      </label>
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
                      onChange={(event) => {
                        setCompareSymbol(event.target.value);
                        setCompareError(null);
                      }}
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

          <div
            ref={chartAreaRef}
            className={`chart-area${isDraggingDrawing ? ' is-dragging' : ''}`}
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

          <div className="status-row">
            <span>{loading ? '데이터를 불러오는 중...' : '실시간 UI 프로토타입'}</span>
            {topActionFeedback ? <span className="status-chip">{topActionFeedback}</span> : null}
            {activeToolDescription ? <span className="status-chip">{activeToolDescription}</span> : null}
            {replayStatusText ? <span className="status-chip replay-status-chip">{replayStatusText}</span> : null}
            <span className="status-chip">단축키 H/V/T/Y/R/N · Esc · Delete/Backspace</span>
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

                  {alertsLoading ? (
                    <p className="alert-empty">규칙을 불러오는 중...</p>
                  ) : alertRules.length === 0 ? (
                    <p className="alert-empty">현재 심볼의 알림 규칙이 없습니다.</p>
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
          {bottomTab === 'pine' ? 'Pine Script 편집기 연동 준비 중 (키워드 자동완성 / 저장소 연결 예정)' : null}
          {bottomTab === 'strategy' ? '전략 백테스트 레이아웃 구현 중 (체결/수익률 패널 추가 예정)' : null}
          {bottomTab === 'trading' ? '트레이딩 패널 구현 중 (주문창/포지션/체결내역 패널 예정)' : null}
        </div>
      </footer>
    </div>
  );
}

export default App;
