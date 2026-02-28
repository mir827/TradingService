export type StrategyBacktestCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StrategyBacktestPositionSizing =
  | {
      mode: 'fixed-percent';
      fixedPercent: number;
    }
  | {
      mode: 'fixed-qty';
      fixedQty: number;
    };

export type StrategyBacktestSlippage = {
  mode: 'tick' | 'percent';
  value: number;
};

export type StrategyBacktestParams = {
  initialCapital: number;
  feeRate: number;
  slippage: StrategyBacktestSlippage;
  positionSizing: StrategyBacktestPositionSizing;
};

export type MaCrossoverStrategyConfig = {
  fastPeriod: number;
  slowPeriod: number;
};

export type StrategyBacktestSummary = {
  grossPnl: number;
  netPnl: number;
  grossReturnPct: number;
  returnPct: number;
  totalFees: number;
  totalSlippage: number;
  totalCosts: number;
  maxDrawdownPct: number;
  winRate: number;
  tradeCount: number;
};

export type StrategyBacktestPoint = {
  time: number;
  value: number;
};

export type StrategyBacktestTrade = {
  entryTime: number;
  exitTime: number;
  side: 'LONG';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  signalEntryPrice: number;
  signalExitPrice: number;
  grossPnl: number;
  netPnl: number;
  feePaid: number;
  slippageCost: number;
  pnl: number;
};

export type StrategyBacktestResult = {
  summary: StrategyBacktestSummary;
  equityCurve: StrategyBacktestPoint[];
  drawdownCurve: StrategyBacktestPoint[];
  trades: StrategyBacktestTrade[];
};

type OpenTrade = {
  entryTime: number;
  signalEntryPrice: number;
  entryPrice: number;
  qty: number;
  entryFee: number;
  entrySlippageCost: number;
};

function roundTo(value: number, digits = 6) {
  if (!Number.isFinite(value)) return 0;
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function isFiniteNumber(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value);
}

function calculateSma(values: number[], period: number) {
  const result = Array<number | null>(values.length).fill(null);

  if (!Number.isInteger(period) || period <= 0 || values.length < period) {
    return result;
  }

  let rollingSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      return Array<number | null>(values.length).fill(null);
    }

    rollingSum += value;

    if (index >= period) {
      rollingSum -= values[index - period];
    }

    if (index >= period - 1) {
      result[index] = rollingSum / period;
    }
  }

  return result;
}

function pushCurvePoint(curve: StrategyBacktestPoint[], time: number, value: number) {
  curve.push({
    time,
    value: roundTo(value),
  });
}

const MIN_EXECUTION_PRICE = 0.00000001;

export function applySlippageToPrice(price: number, slippage: StrategyBacktestSlippage, side: 'entry' | 'exit') {
  if (!Number.isFinite(price) || price <= 0) {
    return MIN_EXECUTION_PRICE;
  }

  const slippageValue = Number.isFinite(slippage.value) ? Math.max(0, slippage.value) : 0;
  if (slippageValue === 0) {
    return price;
  }

  if (slippage.mode === 'tick') {
    const adjusted = side === 'entry' ? price + slippageValue : price - slippageValue;
    return Math.max(MIN_EXECUTION_PRICE, adjusted);
  }

  const slippageRatio = slippageValue / 100;
  const multiplier = side === 'entry' ? 1 + slippageRatio : 1 - slippageRatio;
  return Math.max(MIN_EXECUTION_PRICE, price * multiplier);
}

export function calculateEntryQuantity({
  cash,
  entryPrice,
  feeRate,
  positionSizing,
}: {
  cash: number;
  entryPrice: number;
  feeRate: number;
  positionSizing: StrategyBacktestPositionSizing;
}) {
  if (!Number.isFinite(cash) || cash <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return 0;
  }

  const feeMultiplier = 1 + Math.max(0, feeRate);
  if (!Number.isFinite(feeMultiplier) || feeMultiplier <= 0) {
    return 0;
  }

  const maxAffordableQty = cash / (entryPrice * feeMultiplier);
  if (!Number.isFinite(maxAffordableQty) || maxAffordableQty <= 0) {
    return 0;
  }

  if (positionSizing.mode === 'fixed-percent') {
    const sizeRatio = positionSizing.fixedPercent / 100;
    const desiredNotional = cash * sizeRatio;
    if (!Number.isFinite(desiredNotional) || desiredNotional <= 0) {
      return 0;
    }

    const desiredQty = desiredNotional / entryPrice;
    if (!Number.isFinite(desiredQty) || desiredQty <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(desiredQty, maxAffordableQty));
  }

  if (!Number.isFinite(positionSizing.fixedQty) || positionSizing.fixedQty <= 0) {
    return 0;
  }

  return positionSizing.fixedQty <= maxAffordableQty ? positionSizing.fixedQty : 0;
}

export function runMaCrossoverBacktest(
  candles: StrategyBacktestCandle[],
  params: StrategyBacktestParams,
  strategy: MaCrossoverStrategyConfig,
): StrategyBacktestResult {
  if (!candles.length) {
    return {
      summary: {
        grossPnl: 0,
        netPnl: 0,
        grossReturnPct: 0,
        returnPct: 0,
        totalFees: 0,
        totalSlippage: 0,
        totalCosts: 0,
        maxDrawdownPct: 0,
        winRate: 0,
        tradeCount: 0,
      },
      equityCurve: [],
      drawdownCurve: [],
      trades: [],
    };
  }

  const closeValues = candles.map((candle) => Number(candle.close));
  const fastSma = calculateSma(closeValues, strategy.fastPeriod);
  const slowSma = calculateSma(closeValues, strategy.slowPeriod);
  const feeRate = params.feeRate;
  const slippage = params.slippage;

  let cash = params.initialCapital;
  let openTrade: OpenTrade | null = null;
  let peakEquity = params.initialCapital;
  let maxDrawdownPct = 0;
  let totalGrossPnl = 0;
  let totalFees = 0;
  let totalSlippage = 0;

  const equityCurve: StrategyBacktestPoint[] = [];
  const drawdownCurve: StrategyBacktestPoint[] = [];
  const trades: StrategyBacktestTrade[] = [];

  const firstCandle = candles[0];
  pushCurvePoint(equityCurve, firstCandle.time, params.initialCapital);
  pushCurvePoint(drawdownCurve, firstCandle.time, 0);

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const closePrice = Number(candle.close);

    if (!Number.isFinite(closePrice) || closePrice <= 0) {
      continue;
    }

    const previousFast = fastSma[index - 1];
    const previousSlow = slowSma[index - 1];
    const currentFast = fastSma[index];
    const currentSlow = slowSma[index];

    const canEvaluateCross =
      isFiniteNumber(previousFast) &&
      isFiniteNumber(previousSlow) &&
      isFiniteNumber(currentFast) &&
      isFiniteNumber(currentSlow);

    let bullishCross = false;
    let bearishCross = false;

    if (canEvaluateCross) {
      const previousFastValue = previousFast as number;
      const previousSlowValue = previousSlow as number;
      const currentFastValue = currentFast as number;
      const currentSlowValue = currentSlow as number;

      bullishCross = previousFastValue <= previousSlowValue && currentFastValue > currentSlowValue;
      bearishCross = previousFastValue >= previousSlowValue && currentFastValue < currentSlowValue;
    }

    if (openTrade && (bearishCross || index === candles.length - 1)) {
      const signalExitPrice = closePrice;
      const exitPrice = applySlippageToPrice(signalExitPrice, slippage, 'exit');
      const exitNotional = openTrade.qty * exitPrice;
      const exitFee = exitNotional * feeRate;
      const exitSlippageCost = Math.max(0, (signalExitPrice - exitPrice) * openTrade.qty);
      const feePaid = openTrade.entryFee + exitFee;
      const slippageCost = openTrade.entrySlippageCost + exitSlippageCost;
      const grossPnl = (signalExitPrice - openTrade.signalEntryPrice) * openTrade.qty;
      const tradePnl = grossPnl - feePaid - slippageCost;

      cash += exitNotional - exitFee;
      totalGrossPnl += grossPnl;
      totalFees += feePaid;
      totalSlippage += slippageCost;

      trades.push({
        entryTime: openTrade.entryTime,
        exitTime: candle.time,
        side: 'LONG',
        qty: roundTo(openTrade.qty, 8),
        signalEntryPrice: roundTo(openTrade.signalEntryPrice),
        signalExitPrice: roundTo(signalExitPrice),
        entryPrice: roundTo(openTrade.entryPrice),
        exitPrice: roundTo(exitPrice),
        grossPnl: roundTo(grossPnl),
        netPnl: roundTo(tradePnl),
        feePaid: roundTo(feePaid),
        slippageCost: roundTo(slippageCost),
        pnl: roundTo(tradePnl),
      });

      openTrade = null;
    } else if (!openTrade && bullishCross && index < candles.length - 1) {
      const signalEntryPrice = closePrice;
      const entryPrice = applySlippageToPrice(signalEntryPrice, slippage, 'entry');
      const qty = calculateEntryQuantity({
        cash,
        entryPrice,
        feeRate,
        positionSizing: params.positionSizing,
      });

      if (qty > 0) {
        const entryNotional = qty * entryPrice;
        const entryFee = entryNotional * feeRate;
        const entryCost = entryNotional + entryFee;

        if (entryCost <= cash + 1e-9) {
          const entrySlippageCost = Math.max(0, (entryPrice - signalEntryPrice) * qty);
          cash -= entryCost;
          openTrade = {
            entryTime: candle.time,
            signalEntryPrice,
            entryPrice,
            qty,
            entryFee,
            entrySlippageCost,
          };
        }
      }
    }

    const equity = cash + (openTrade ? openTrade.qty * closePrice : 0);
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;

    maxDrawdownPct = Math.max(maxDrawdownPct, Math.abs(drawdownPct));

    pushCurvePoint(equityCurve, candle.time, equity);
    pushCurvePoint(drawdownCurve, candle.time, drawdownPct);
  }

  const finalEquity = cash + (openTrade ? openTrade.qty * closeValues[closeValues.length - 1] : 0);
  const netPnl = finalEquity - params.initialCapital;
  const totalCosts = totalFees + totalSlippage;
  const grossReturnPct = params.initialCapital > 0 ? (totalGrossPnl / params.initialCapital) * 100 : 0;
  const returnPct = params.initialCapital > 0 ? (netPnl / params.initialCapital) * 100 : 0;
  const winningTrades = trades.filter((trade) => trade.pnl > 0).length;
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  return {
    summary: {
      grossPnl: roundTo(totalGrossPnl),
      netPnl: roundTo(netPnl),
      grossReturnPct: roundTo(grossReturnPct),
      returnPct: roundTo(returnPct),
      totalFees: roundTo(totalFees),
      totalSlippage: roundTo(totalSlippage),
      totalCosts: roundTo(totalCosts),
      maxDrawdownPct: roundTo(maxDrawdownPct),
      winRate: roundTo(winRate),
      tradeCount: trades.length,
    },
    equityCurve,
    drawdownCurve,
    trades,
  };
}
