import { describe, expect, it } from 'vitest';
import {
  applySlippageToPrice,
  calculateEntryQuantity,
  runMaCrossoverBacktest,
  type StrategyBacktestCandle,
} from './strategyBacktest.js';

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
        feeRate: 0,
        slippage: {
          mode: 'percent',
          value: 0,
        },
        positionSizing: {
          mode: 'fixed-percent',
          fixedPercent: 100,
        },
      },
      {
        fastPeriod: 2,
        slowPeriod: 3,
      },
    );

    expect(result.summary.tradeCount).toBe(1);
    expect(result.summary.grossPnl).toBeCloseTo(-181.818182, 5);
    expect(result.summary.netPnl).toBeCloseTo(-181.818182, 5);
    expect(result.summary.grossReturnPct).toBeCloseTo(-18.181818, 5);
    expect(result.summary.returnPct).toBeCloseTo(-18.181818, 5);
    expect(result.summary.maxDrawdownPct).toBeCloseTo(25, 6);
    expect(result.summary.winRate).toBe(0);
    expect(result.summary.totalFees).toBe(0);
    expect(result.summary.totalSlippage).toBe(0);
    expect(result.summary.totalCosts).toBe(0);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      side: 'LONG',
      signalEntryPrice: 110,
      signalExitPrice: 90,
      entryPrice: 110,
      exitPrice: 90,
      grossPnl: -181.818182,
      netPnl: -181.818182,
      feePaid: 0,
      slippageCost: 0,
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
        feeRate: 10 / 10_000,
        slippage: {
          mode: 'percent',
          value: 0,
        },
        positionSizing: {
          mode: 'fixed-percent',
          fixedPercent: 50,
        },
      },
      {
        fastPeriod: 2,
        slowPeriod: 3,
      },
    );

    expect(result.summary.tradeCount).toBe(1);
    expect(result.summary.winRate).toBe(100);
    expect(result.summary.grossPnl).toBeCloseTo(71.428571, 5);
    expect(result.summary.netPnl).toBeCloseTo(70.357143, 5);
    expect(result.summary.totalFees).toBeCloseTo(1.071429, 5);
    expect(result.summary.totalSlippage).toBe(0);
    expect(result.summary.totalCosts).toBeCloseTo(1.071429, 5);

    const trade = result.trades[0];
    expect(trade.entryTime).toBe(candles[3].time);
    expect(trade.exitTime).toBe(candles[candles.length - 1].time);
    expect(trade.feePaid).toBeCloseTo(1.071429, 5);
    expect(trade.grossPnl).toBeCloseTo(71.428571, 5);
    expect(trade.netPnl).toBeCloseTo(70.357143, 5);
    expect(trade.pnl).toBeCloseTo(70.357143, 5);
  });

  it('applies deterministic slippage math for tick and percent modes', () => {
    expect(applySlippageToPrice(100, { mode: 'tick', value: 2 }, 'entry')).toBe(102);
    expect(applySlippageToPrice(100, { mode: 'tick', value: 2 }, 'exit')).toBe(98);
    expect(applySlippageToPrice(100, { mode: 'percent', value: 1.5 }, 'entry')).toBeCloseTo(101.5, 8);
    expect(applySlippageToPrice(100, { mode: 'percent', value: 1.5 }, 'exit')).toBeCloseTo(98.5, 8);
  });

  it('computes entry quantity by sizing mode with affordability bounds', () => {
    const percentQty = calculateEntryQuantity({
      cash: 1000,
      entryPrice: 100,
      feeRate: 0.001,
      positionSizing: {
        mode: 'fixed-percent',
        fixedPercent: 50,
      },
    });
    expect(percentQty).toBeCloseTo(5, 8);

    const fixedQtyAffordable = calculateEntryQuantity({
      cash: 1000,
      entryPrice: 100,
      feeRate: 0.001,
      positionSizing: {
        mode: 'fixed-qty',
        fixedQty: 5,
      },
    });
    expect(fixedQtyAffordable).toBe(5);

    const fixedQtyTooLarge = calculateEntryQuantity({
      cash: 1000,
      entryPrice: 100,
      feeRate: 0.001,
      positionSizing: {
        mode: 'fixed-qty',
        fixedQty: 25,
      },
    });
    expect(fixedQtyTooLarge).toBe(0);
  });
});
