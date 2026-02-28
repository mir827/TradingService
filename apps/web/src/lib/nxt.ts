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

type QuoteWithOptionalNxt = {
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
