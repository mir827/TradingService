import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import './App.css';

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

type WatchTab = 'watchlist' | 'detail' | 'alerts';
type BottomTab = 'pine' | 'strategy' | 'trading';

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

function shortTicker(symbol: string) {
  return symbol.replace(/\.K[QS]$/i, '');
}

function getDisplayCode(item: Pick<SymbolItem, 'symbol' | 'code'>) {
  return item.code ?? shortTicker(item.symbol);
}

function getOptionLabel(item: SymbolItem) {
  return `${getDisplayCode(item)} · ${item.name} (${item.market})`;
}

function marketExchangeText(market: MarketType) {
  if (market === 'CRYPTO') return 'BINANCE';
  return 'KRX';
}

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());

  const [watchlistSymbols, setWatchlistSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('60');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState('cursor');
  const [watchTab, setWatchTab] = useState<WatchTab>('watchlist');
  const [watchQuery, setWatchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('pine');
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

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

    chart.subscribeCrosshairMove(onCrosshairMove);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const observer = new ResizeObserver(() => chart.timeScale().fitContent());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

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
        }
      } catch {
        if (!canceled) {
          setSearchResults([]);
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

  const watchlist = useMemo(
    () =>
      watchlistSymbols.map((item) => {
        const quote = quotes[item.symbol];
        return {
          ...item,
          lastPrice: quote?.lastPrice,
          changePercent: quote?.changePercent,
        };
      }),
    [watchlistSymbols, quotes],
  );

  const filteredWatchlist = useMemo(() => {
    const normalized = watchQuery.toLowerCase().trim();
    if (!normalized) return watchlist;

    return watchlist.filter((item) => {
      const haystack = `${item.symbol} ${item.name} ${item.code ?? ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [watchQuery, watchlist]);

  const filteredSearchResults = useMemo(
    () =>
      searchResults.filter(
        (item) => !watchlistSymbols.some((watchItem) => watchItem.symbol === item.symbol),
      ),
    [searchResults, watchlistSymbols],
  );

  const priceDiff = displayCandle ? displayCandle.close - displayCandle.open : 0;
  const priceDiffPercent =
    displayCandle && displayCandle.open !== 0 ? ((displayCandle.close - displayCandle.open) / displayCandle.open) * 100 : 0;

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
  };

  const selectedMarket = selectedSymbolMeta?.market ?? 'CRYPTO';
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
              <strong>
                {selectedCode} · {selectedName} · {selectedInterval}
              </strong>
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

            {watchTab === 'watchlist' ? (
              <>
                <div className="watch-search-wrap">
                  <input
                    value={watchQuery}
                    onChange={(e) => setWatchQuery(e.target.value)}
                    placeholder="종목 코드/종목명 검색 (예: 005930, 삼성전자, BTC)"
                  />
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
                            {hasChangePercent
                              ? `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`
                              : '--'}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {watchQuery.trim().length >= 2 ? (
                  <div className="search-section">
                    <div className="search-section-title">KOSPI/KOSDAQ 검색결과</div>
                    {searching ? <div className="search-state">검색 중...</div> : null}
                    {!searching && filteredSearchResults.length === 0 ? (
                      <div className="search-state">추가 가능한 결과가 없습니다.</div>
                    ) : null}
                    {!searching && filteredSearchResults.length ? (
                      <ul className="search-result-list">
                        {filteredSearchResults.map((item) => (
                          <li key={item.symbol} onClick={() => handlePickSymbol(item)}>
                            <div>
                              <strong>{getDisplayCode(item)}</strong>
                              <small>{item.name}</small>
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
              <div className="panel-content">
                <h4>가격 알림</h4>
                <p>알림 엔진 UI를 TradingView 스타일로 맞추는 단계입니다.</p>
                <ul className="alert-list">
                  <li>
                    <span>{selectedCode}</span>
                    <span>가격이 기준선 돌파 시 알림</span>
                  </li>
                  <li>
                    <span>{selectedCode}</span>
                    <span>변동률 임계치 도달 시 알림</span>
                  </li>
                </ul>
              </div>
            ) : null}
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
