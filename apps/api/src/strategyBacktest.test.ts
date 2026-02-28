import { describe, expect, it } from 'vitest';
import { runMaCrossoverBacktest, type StrategyBacktestCandle } from './strategyBacktest.js';

function toCandles(closes: number[]): StrategyBacktestCandle[] {
  const startTime = 1_700_000_000;

  return closes.map((close, index) => {
    const open = index > 0 ? closes[index - 1] : close;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;

    return {
      time: startTime + index * 60,
      open,
      high,
      low,
      close,
      volume: 100,
    };
  });
}

describe('strategy backtest math', () => {
  it('computes deterministic PnL and drawdown on a crossover fixture', () => {
    const candles = toCandles([100, 100, 100, 110, 120, 115, 90, 95]);
    const result = runMaCrossoverBacktest(
      candles,
      {
        initialCapital: 1000,
        feeBps: 0,
        positionSizeMode: 'fixed-percent',
        fixedPercent: 100,
      },
      {
        fastPeriod: 2,
        slowPeriod: 3,
      },
    );

    expect(result.summary.tradeCount).toBe(1);
    expect(result.summary.netPnl).toBeCloseTo(-181.818182, 5);
    expect(result.summary.returnPct).toBeCloseTo(-18.181818, 5);
    expect(result.summary.maxDrawdownPct).toBeCloseTo(25, 6);
    expect(result.summary.winRate).toBe(0);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      side: 'LONG',
      entryPrice: 110,
      exitPrice: 90,
    });

    const minDrawdown = Math.min(...result.drawdownCurve.map((point) => point.value));
    expect(minDrawdown).toBeCloseTo(-25, 6);
  });

  it('applies fees and force-closes open positions on the last candle', () => {
    const candles = toCandles([100, 100, 100, 105, 110, 120]);
    const result = runMaCrossoverBacktest(
      candles,
      {
        initialCapital: 1000,
        feeBps: 10,
        positionSizeMode: 'fixed-percent',
        fixedPercent: 50,
      },
      {
        fastPeriod: 2,
        slowPeriod: 3,
      },
    );

    expect(result.summary.tradeCount).toBe(1);
    expect(result.summary.winRate).toBe(100);
    expect(result.summary.netPnl).toBeCloseTo(70.357143, 5);

    const trade = result.trades[0];
    expect(trade.entryTime).toBe(candles[3].time);
    expect(trade.exitTime).toBe(candles[candles.length - 1].time);
    expect(trade.pnl).toBeCloseTo(70.357143, 5);
  });
});
