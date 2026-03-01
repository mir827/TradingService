import type { MarketType } from './symbol';

export type NxtQuoteStatus = 'available' | 'unavailable';

export type NxtQuoteInfo = {
  supported: boolean;
  available: boolean;
  status: NxtQuoteStatus;
  reason?: string;
  price?: number;
  changePercent?: number;
  updatedAt?: number;
};

type QuoteRequestedVenue = 'KRX' | 'NXT' | 'COMBINED';
type QuoteEffectiveVenue = 'KRX' | 'NXT';

type QuoteWithOptionalNxt = {
  lastPrice?: number;
  changePercent?: number;
  requestedVenue?: QuoteRequestedVenue;
  effectiveVenue?: QuoteEffectiveVenue;
  venueFallback?: string;
  nxt?: NxtQuoteInfo;
};

export type NxtDetailInfo = {
  supported: boolean;
  supportLabel: '지원' | '미지원';
  status: NxtQuoteStatus;
  reason: string | null;
  price: number | null;
  changePercent: number | null;
  updatedAt: number | null;
};

export type VenueCheckedAt = {
  krx?: number | null;
  nxt?: number | null;
};

export type KrxNxtComparisonInfo = {
  krx: {
    venue: 'KRX';
    available: boolean;
    price: number | null;
    changePercent: number | null;
    updatedAt: number | null;
  };
  nxt: {
    venue: 'NXT';
    available: boolean;
    price: number | null;
    changePercent: number | null;
    updatedAt: number | null;
    reason: string | null;
  };
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatNxtUnavailableReason(reason?: string) {
  if (reason === 'NXT_FEED_NOT_CONFIGURED') return 'NXT 시세 연동 전';
  if (reason === 'NXT_SYMBOL_NOT_SUPPORTED') return 'NXT 미지원 종목';
  if (reason === 'NXT_UPSTREAM_ERROR') return 'NXT 시세 연동 오류';
  if (reason === 'NXT_QUOTE_MISSING') return 'NXT 시세 미제공';
  return reason?.trim() || 'NXT 시세 미제공';
}

export function normalizeNxtDetailInfo(market: MarketType, quote?: QuoteWithOptionalNxt): NxtDetailInfo | null {
  if (market !== 'KOSPI' && market !== 'KOSDAQ') return null;

  const nxt = quote?.nxt;
  const supported = nxt?.supported === true;
  const isAvailable = nxt?.available === true && nxt?.status === 'available';
  const status: NxtQuoteStatus = isAvailable ? 'available' : 'unavailable';

  return {
    supported,
    supportLabel: supported ? '지원' : '미지원',
    status,
    reason: status === 'unavailable' ? formatNxtUnavailableReason(nxt?.reason) : null,
    price: isFiniteNumber(nxt?.price) ? nxt.price : null,
    changePercent: isFiniteNumber(nxt?.changePercent) ? nxt.changePercent : null,
    updatedAt: isFiniteNumber(nxt?.updatedAt) ? nxt.updatedAt : null,
  };
}

export function normalizeQuoteDisplayBasis(market: MarketType, quote?: QuoteWithOptionalNxt) {
  if (market !== 'KOSPI' && market !== 'KOSDAQ') return null;

  const requestedVenue = quote?.requestedVenue;
  const effectiveVenue = quote?.effectiveVenue;

  if (requestedVenue === 'NXT' && effectiveVenue !== 'NXT') {
    return 'NXT 요청 → KRX 대체';
  }

  if (effectiveVenue === 'NXT') {
    return 'NXT';
  }

  if (effectiveVenue === 'KRX') {
    return 'KRX';
  }

  if (requestedVenue === 'NXT') {
    return 'NXT 요청 → KRX 대체';
  }

  if (requestedVenue === 'KRX') {
    return 'KRX';
  }

  return 'KRX';
}

export function normalizeKrxNxtComparisonInfo(
  market: MarketType,
  quote?: QuoteWithOptionalNxt,
  venueCheckedAt?: VenueCheckedAt,
): KrxNxtComparisonInfo | null {
  if (market !== 'KOSPI' && market !== 'KOSDAQ') return null;

  const normalizedNxt = normalizeNxtDetailInfo(market, quote);
  const krxPrice = isFiniteNumber(quote?.lastPrice) ? quote.lastPrice : null;
  const krxChangePercent = isFiniteNumber(quote?.changePercent) ? quote.changePercent : null;
  const krxUpdatedAt = isFiniteNumber(venueCheckedAt?.krx) ? venueCheckedAt.krx : null;
  const nxtVenueUpdatedAt = isFiniteNumber(venueCheckedAt?.nxt) ? venueCheckedAt.nxt : null;

  return {
    krx: {
      venue: 'KRX',
      available: krxPrice !== null && krxChangePercent !== null,
      price: krxPrice,
      changePercent: krxChangePercent,
      updatedAt: krxUpdatedAt,
    },
    nxt: {
      venue: 'NXT',
      available: normalizedNxt?.status === 'available',
      price: normalizedNxt?.price ?? null,
      changePercent: normalizedNxt?.changePercent ?? null,
      updatedAt: normalizedNxt?.updatedAt ?? nxtVenueUpdatedAt,
      reason: normalizedNxt?.status === 'unavailable' ? normalizedNxt.reason : null,
    },
  };
}
