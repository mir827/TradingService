export type MarketType = 'CRYPTO' | 'KOSPI' | 'KOSDAQ';
export type KrVenue = 'KRX' | 'NXT';

export type SymbolLike = {
  symbol: string;
  code?: string;
  name: string;
  market: MarketType;
};

export function isKrMarket(market: MarketType) {
  return market === 'KOSPI' || market === 'KOSDAQ';
}

export function isKrSymbol(symbol: string) {
  return /\.K[QS]$/i.test(symbol);
}

export function normalizeVenuePreference(venue?: string | null): KrVenue | undefined {
  if (venue === 'KRX' || venue === 'NXT') {
    return venue;
  }

  if (typeof venue === 'string') {
    const normalized = venue.trim().toUpperCase();
    if (normalized === 'KRX' || normalized === 'NXT') {
      return normalized;
    }
  }

  return undefined;
}

export function normalizeVenueForSymbol(input: Pick<SymbolLike, 'symbol' | 'market'>, venue?: string | null) {
  if (!isKrMarket(input.market) || !isKrSymbol(input.symbol)) {
    return undefined;
  }

  return normalizeVenuePreference(venue);
}

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
