import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import './App.css';
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

type WatchTab = 'watchlist' | 'detail' | 'alerts';
type BottomTab = 'pine' | 'strategy' | 'trading';
type WatchSortKey = 'symbol' | 'price' | 'changePercent';
type WatchSortDir = 'asc' | 'desc';
type WatchMarketFilter = 'ALL' | MarketType;

type WatchPrefs = {
  watchSortKey: WatchSortKey;
  watchSortDir: WatchSortDir;
  watchMarketFilter: WatchMarketFilter;
};

type HorizontalLine = {
  id: string;
  price: number;
  line: IPriceLine;
};

type HorizontalLineState = Pick<HorizontalLine, 'id' | 'price'>;

const intervals = ['1', '5', '15', '60', '240', '1D', '1W'];
const leftTools = [
  { key: 'cursor', icon: '↖', label: '커서' },
  { key: 'crosshair', icon: '＋', label: '크로스헤어' },
  { key: 'trend', icon: '／', label: '추세선' },
  { key: 'horizontal', icon: '―', label: '수평선' },
  { key: 'fib', icon: '📐', label: '피보나치' },
  { key: 'brush', icon: '✏️', label: '브러시' },
  { key: 'emoji', icon: '😊', label: '아이콘' },
  { key: 'magnet', icon: '🧲', label: '자석' },
];
const topActions = ['지표', '비교', '알림', '리플레이'];
const bottomTabs: Array<{ id: BottomTab; label: string }> = [
  { id: 'pine', label: 'Pine Editor' },
  { id: 'strategy', label: '전략 테스터' },
  { id: 'trading', label: '트레이딩 패널' },
];

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';
const WATCH_PREFS_STORAGE_KEY = 'tradingservice.watchprefs.v1';

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

function normalizeLinePrice(price: number) {
  return Number(price.toFixed(Math.abs(price) < 10 ? 4 : 2));
}

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const activeToolRef = useRef('cursor');
  const horizontalLinesRef = useRef<HorizontalLine[]>([]);
  const selectedSymbolRef = useRef('BTCUSDT');
  const selectedIntervalRef = useRef('60');

  const [watchlistSymbols, setWatchlistSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('60');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [marketStatusError, setMarketStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState('cursor');
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
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [horizontalLines, setHorizontalLines] = useState<HorizontalLineState[]>([]);
  const [chartReady, setChartReady] = useState(false);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsSubmitting, setAlertsSubmitting] = useState(false);
  const [alertsChecking, setAlertsChecking] = useState(false);
  const [alertMetric, setAlertMetric] = useState<AlertMetric>('price');
  const [alertOperator, setAlertOperator] = useState<AlertOperator>('>=');
  const [alertThresholdInput, setAlertThresholdInput] = useState('');
  const [alertCooldownInput, setAlertCooldownInput] = useState('60');
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertTriggeredEvents, setAlertTriggeredEvents] = useState<AlertCheckEvent[]>([]);
  const [alertLastCheckedAt, setAlertLastCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    selectedIntervalRef.current = selectedInterval;
  }, [selectedInterval]);

  const toHorizontalLineState = useCallback((line: { id?: string; price: number }) => {
    const normalizedPrice = Number(line.price);
    if (!Number.isFinite(normalizedPrice)) return null;

    return {
      id: line.id?.trim() || createHorizontalLineId(),
      price: normalizeLinePrice(normalizedPrice),
    };
  }, []);

  const snapshotHorizontalLines = useCallback((): HorizontalLineState[] => {
    return horizontalLinesRef.current.map((item) => ({
      id: item.id,
      price: item.price,
    }));
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
  }, []);

  const persistHorizontalLines = useCallback(async (symbol: string, interval: string, lines: HorizontalLineState[]) => {
    try {
      const response = await fetch(`${apiBase}/api/drawings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          lines,
        }),
      });

      if (!response.ok) {
        throw new Error('persist drawings failed');
      }
    } catch {
      setError((prev) => prev ?? '수평선 저장에 실패했습니다.');
    }
  }, []);

  const loadHorizontalLines = useCallback(
    async (symbol: string, interval: string): Promise<HorizontalLineState[]> => {
      try {
        const response = await fetch(
          `${apiBase}/api/drawings?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,
        );

        if (!response.ok) {
          throw new Error('load drawings failed');
        }

        const data = (await response.json()) as {
          lines?: Array<{ id?: string; price: number }>;
        };

        return (data.lines ?? [])
          .map((line) => toHorizontalLineState(line))
          .filter((line): line is HorizontalLineState => Boolean(line));
      } catch {
        setError((prev) => prev ?? '수평선을 불러오지 못했습니다.');
        return [];
      }
    },
    [toHorizontalLineState],
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
    fetch(`${apiBase}/api/symbols`)
      .then((res) => res.json())
      .then((data: { symbols: SymbolItem[] }) => {
        const nextSymbols = data.symbols ?? [];
        setWatchlistSymbols(nextSymbols);
        setSelectedSymbol((prev) => {
          if (nextSymbols.some((item) => item.symbol === prev)) {
            return prev;
          }

          return nextSymbols[0]?.symbol ?? prev;
        });
      })
      .catch(() => {
        setError('심볼 목록을 불러오지 못했습니다. API 상태를 확인해주세요.');
      });
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

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const rawTime = param.time;
      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;

      if (typeof rawTime !== 'number' || !bar) {
        setHoveredCandle(null);
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
    };

    const onChartClick = (param: MouseEventParams<Time>) => {
      if (activeToolRef.current !== 'horizontal') return;
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

      const nextLines = snapshotHorizontalLines();
      setHorizontalLines(nextLines);
      void persistHorizontalLines(selectedSymbolRef.current, selectedIntervalRef.current, nextLines);
    };

    chart.subscribeCrosshairMove(onCrosshairMove);
    chart.subscribeClick(onChartClick);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    setChartReady(true);

    const observer = new ResizeObserver(() => chart.timeScale().fitContent());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.unsubscribeClick(onChartClick);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      horizontalLinesRef.current = [];
      setHorizontalLines([]);
      setChartReady(false);
    };
  }, [persistHorizontalLines, snapshotHorizontalLines]);

  useEffect(() => {
    if (!chartReady) return;

    let canceled = false;

    const loadPersistedLines = async () => {
      const loadedLines = await loadHorizontalLines(selectedSymbol, selectedInterval);
      if (canceled) return;
      renderHorizontalLines(loadedLines);
    };

    void loadPersistedLines();

    return () => {
      canceled = true;
    };
  }, [chartReady, loadHorizontalLines, renderHorizontalLines, selectedInterval, selectedSymbol]);

  useEffect(() => {
    let canceled = false;

    const loadCandles = async () => {
      setLoading(true);
      setError(null);

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
          setHoveredCandle(null);
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
  }, [selectedSymbol, selectedInterval]);

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

  useEffect(() => {
    setAlertTriggeredEvents([]);
    setAlertLastCheckedAt(null);
    setAlertMessage(null);
    void loadAlertRules(selectedSymbol);
  }, [loadAlertRules, selectedSymbol]);

  useEffect(() => {
    candleMapRef.current = new Map(candles.map((candle) => [candle.time, candle]));

    if (!candles.length || !candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;

    const candleData: CandlestickData[] = candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const volumeData: HistogramData[] = candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? '#26A69A66' : '#EF535066',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  const selectedQuote = quotes[selectedSymbol];
  const latestCandle = candles.at(-1) ?? null;
  const displayCandle = hoveredCandle ?? latestCandle;

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

  const toggleWatchSort = (key: WatchSortKey) => {
    if (watchSortKey === key) {
      setWatchSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setWatchSortKey(key);
    setWatchSortDir(key === 'symbol' ? 'asc' : 'desc');
  };

  const handlePickSymbol = (item: SymbolItem) => {
    setWatchlistSymbols((prev) => {
      if (prev.some((saved) => saved.symbol === item.symbol)) {
        return prev;
      }

      return [item, ...prev].slice(0, 40);
    });

    setSelectedSymbol(item.symbol);
    setWatchQuery('');
    setSearchResults([]);
    setActiveSearchIndex(0);
  };

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

      setAlertTriggeredEvents(data.triggered ?? []);
      setAlertLastCheckedAt(data.evaluatedAt ?? Date.now());
      setAlertMessage(
        `체크 완료: ${data.checkedRuleCount}개 규칙, ${data.triggeredCount}개 트리거, 쿨다운 억제 ${data.suppressedByCooldown}개`,
      );
      await loadAlertRules(selectedSymbol);
    } catch {
      setAlertMessage('알림 체크에 실패했습니다.');
    } finally {
      setAlertsChecking(false);
    }
  };

  const removeHorizontalLine = useCallback((id: string) => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const targetIndex = horizontalLinesRef.current.findIndex((item) => item.id === id);
    if (targetIndex < 0) return;

    const [target] = horizontalLinesRef.current.splice(targetIndex, 1);
    series.removePriceLine(target.line);
    const nextLines = snapshotHorizontalLines();
    setHorizontalLines(nextLines);
    void persistHorizontalLines(selectedSymbolRef.current, selectedIntervalRef.current, nextLines);
  }, [persistHorizontalLines, snapshotHorizontalLines]);

  const clearHorizontalLines = useCallback(() => {
    const series = candleSeriesRef.current;
    if (series) {
      for (const item of horizontalLinesRef.current) {
        series.removePriceLine(item.line);
      }
    }

    horizontalLinesRef.current = [];
    setHorizontalLines([]);
    void persistHorizontalLines(selectedSymbolRef.current, selectedIntervalRef.current, []);
  }, [persistHorizontalLines]);

  const selectedCode = selectedSymbolMeta ? getDisplayCode(selectedSymbolMeta) : shortTicker(selectedSymbol);
  const selectedName = selectedSymbolMeta?.name ?? shortTicker(selectedSymbol);
  const exchangeText = marketExchangeText(selectedMarket);

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
              <button key={action}>{action}</button>
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
          </div>

          <div className="chart-area" ref={containerRef} />

          <div className="status-row">
            <span>{loading ? '데이터를 불러오는 중...' : '실시간 UI 프로토타입'}</span>

            {activeTool === 'horizontal' ? (
              <div className="status-actions">
                <span className="status-chip">수평선 툴 활성화 · 차트 클릭으로 추가 ({horizontalLines.length})</span>
                {horizontalLines.length > 0 ? (
                  <button className="status-button" onClick={clearHorizontalLines}>
                    수평선 전체 삭제
                  </button>
                ) : null}
              </div>
            ) : null}

            {activeTool === 'horizontal' && horizontalLines.length > 0 ? (
              <div className="line-tags" aria-label="수평선 목록">
                {horizontalLines.slice(-4).map((line) => (
                  <button key={line.id} className="line-tag" onClick={() => removeHorizontalLine(line.id)}>
                    {formatPrice(line.price)} ×
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
                          className={item.symbol === selectedSymbol ? 'selected' : ''}
                          onClick={() => setSelectedSymbol(item.symbol)}
                        >
                          <div>
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
                    </div>
                  </form>

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
