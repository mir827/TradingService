import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  HistogramSeries,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from 'lightweight-charts';
import './App.css';

type SymbolItem = {
  symbol: string;
  name: string;
  market: 'CRYPTO' | 'STOCK';
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

const intervals = ['1', '5', '15', '60', '240', '1D', '1W'];
const toolbarItems = ['↖', '＋', '✏️', '📐', '📎', '😊', '⚡', '🧲'];
const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';

function formatPrice(value: number) {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState('60');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/symbols`)
      .then((res) => res.json())
      .then((data: { symbols: SymbolItem[] }) => setSymbols(data.symbols ?? []))
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const observer = new ResizeObserver(() => chart.timeScale().fitContent());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
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

  useEffect(() => {
    if (!symbols.length) return;

    let canceled = false;

    const pullQuotes = async () => {
      try {
        const entries = await Promise.all(
          symbols.map(async (item) => {
            const res = await fetch(`${apiBase}/api/quote?symbol=${item.symbol}`);
            if (!res.ok) throw new Error(item.symbol);
            const quote = (await res.json()) as Quote;
            return [item.symbol, quote] as const;
          }),
        );

        if (!canceled) {
          setQuotes(Object.fromEntries(entries));
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
  }, [symbols]);

  useEffect(() => {
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

  const watchlist = useMemo(
    () =>
      symbols.map((item) => {
        const quote = quotes[item.symbol];
        return {
          ...item,
          lastPrice: quote?.lastPrice,
          changePercent: quote?.changePercent,
        };
      }),
    [symbols, quotes],
  );

  return (
    <div className="tv-app">
      <header className="tv-topbar">
        <div className="brand">TradingService</div>
        <div className="top-controls">
          <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
            {symbols.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {item.symbol}
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
        </div>
      </header>

      <main className="tv-main">
        <aside className="left-toolbar">
          {toolbarItems.map((item) => (
            <button key={item}>{item}</button>
          ))}
        </aside>

        <section className="center-panel">
          <div className="chart-header">
            <div className="chart-title">{selectedSymbol} · {selectedInterval}</div>
            <div className="chart-meta">
              <span>오픈 {selectedQuote ? formatPrice(selectedQuote.lastPrice) : '--'}</span>
              <span>고가 {selectedQuote ? formatPrice(selectedQuote.highPrice) : '--'}</span>
              <span>저가 {selectedQuote ? formatPrice(selectedQuote.lowPrice) : '--'}</span>
              <span>거래량 {selectedQuote ? selectedQuote.volume.toLocaleString('en-US') : '--'}</span>
            </div>
          </div>

          <div className="chart-area" ref={containerRef} />

          <div className="status-row">
            {loading ? '데이터를 불러오는 중...' : '실시간 UI 프로토타입'}
            {error ? <span className="error"> · {error}</span> : null}
          </div>
        </section>

        <aside className="right-panel">
          <h3>관심종목</h3>
          <ul>
            {watchlist.map((item) => (
              <li
                key={item.symbol}
                className={item.symbol === selectedSymbol ? 'selected' : ''}
                onClick={() => setSelectedSymbol(item.symbol)}
              >
                <div>
                  <strong>{item.symbol}</strong>
                  <small>{item.name}</small>
                </div>
                <div className="watch-value">
                  <span>{item.lastPrice ? formatPrice(item.lastPrice) : '--'}</span>
                  <span className={item.changePercent && item.changePercent >= 0 ? 'up' : 'down'}>
                    {item.changePercent ? `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%` : '--'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <footer className="tv-bottom-panel">
        <button>Pine Editor</button>
        <button>전략 테스터</button>
        <button>트레이딩 패널</button>
        <div className="phase-note">Phase 1 목표: TradingView 스타일 UI + 차트 상호작용 구현</div>
      </footer>
    </div>
  );
}

export default App;
