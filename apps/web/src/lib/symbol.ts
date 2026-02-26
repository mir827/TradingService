export type MarketType = 'CRYPTO' | 'KOSPI' | 'KOSDAQ';

export type SymbolLike = {
  symbol: string;
  code?: string;
  name: string;
  market: MarketType;
};

export function shortTicker(symbol: string) {
  return symbol.replace(/\.K[QS]$/i, '');
}

export function getDisplayCode(item: Pick<SymbolLike, 'symbol' | 'code'>) {
  return item.code ?? shortTicker(item.symbol);
}

export function getOptionLabel(item: SymbolLike) {
  return `${getDisplayCode(item)} · ${item.name} (${item.market})`;
}

export function marketExchangeText(market: MarketType) {
  if (market === 'CRYPTO') return 'BINANCE';
  return 'KRX';
}

export function formatSigned(value: number, digits = 2) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}
