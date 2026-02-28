import type { MarketType } from './symbol';

export type MarketStatusState = 'OPEN' | 'CLOSED';
export type MarketStatusReason = 'WEEKEND' | 'OUT_OF_SESSION' | 'SESSION_ACTIVE';
export type MarketVenuePhase = 'PRE_MARKET' | 'OPEN' | 'POST_MARKET' | 'CLOSED' | 'UNAVAILABLE';
export type MarketVenueReason = MarketStatusReason | 'UNAVAILABLE';

export type MarketVenueStatus = {
  venue?: 'KRX' | 'NXT';
  available?: boolean;
  status?: MarketStatusState;
  reason?: MarketVenueReason | string;
  phase?: MarketVenuePhase | string;
  checkedAt?: number;
  timezone?: string;
  session?: {
    open?: string;
    close?: string;
    text?: string;
  };
  unavailableReason?: string;
};

export type MarketStatusWithVenues = {
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
  venues?: {
    krx?: MarketVenueStatus;
    nxt?: MarketVenueStatus;
  };
};

export type VenueBadgeTone = 'open' | 'closed' | 'pending';

export type VenueSessionBadge = {
  venue: 'KRX' | 'NXT';
  label: string;
  tone: VenueBadgeTone;
};

export type VenueCheckedAt = {
  krx: number | null;
  nxt: number | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isKrMarket(market: MarketType) {
  return market === 'KOSPI' || market === 'KOSDAQ';
}

export function formatMarketStatusReason(reason: MarketStatusReason | string) {
  if (reason === 'WEEKEND') return '주말';
  if (reason === 'OUT_OF_SESSION') return '장외 시간';
  if (reason === 'SESSION_ACTIVE') return '세션 진행중';
  if (reason === 'UNAVAILABLE') return '미연동';
  return '상태 확인 중';
}

function resolveVenueLabel(
  venue: 'KRX' | 'NXT',
  venueStatus: MarketVenueStatus | undefined,
  fallbackStatus?: MarketStatusState,
  fallbackReason?: MarketStatusReason,
) {
  const phase = venueStatus?.phase;
  if (phase === 'OPEN') return '장중';
  if (phase === 'PRE_MARKET') return '장전';
  if (phase === 'POST_MARKET') return '장후';
  if (phase === 'CLOSED') return venueStatus?.reason === 'WEEKEND' ? '휴장' : '장외';
  if (phase === 'UNAVAILABLE') return '미연동';

  if (venueStatus?.available === false) return '미연동';
  if (venueStatus?.status === 'OPEN') return '장중';
  if (venueStatus?.status === 'CLOSED') return venueStatus?.reason === 'WEEKEND' ? '휴장' : '장외';

  if (venue === 'KRX') {
    if (fallbackStatus === 'OPEN') return '장중';
    if (fallbackStatus === 'CLOSED') return fallbackReason === 'WEEKEND' ? '휴장' : '장외';
  }

  return '상태확인';
}

function resolveVenueTone(label: string): VenueBadgeTone {
  if (label === '장중') return 'open';
  if (label === '미연동' || label === '상태확인') return 'pending';
  return 'closed';
}

function normalizeCheckedAt(value: unknown) {
  return isFiniteNumber(value) ? value : null;
}

export function normalizeVenueCheckedAt(marketStatus?: MarketStatusWithVenues | null): VenueCheckedAt {
  return {
    krx: normalizeCheckedAt(marketStatus?.venues?.krx?.checkedAt),
    nxt: normalizeCheckedAt(marketStatus?.venues?.nxt?.checkedAt),
  };
}

export function normalizeVenueSessionBadges(
  market: MarketType,
  marketStatus?: MarketStatusWithVenues | null,
): VenueSessionBadge[] {
  if (!isKrMarket(market)) return [];

  const krxLabel = resolveVenueLabel('KRX', marketStatus?.venues?.krx, marketStatus?.status, marketStatus?.reason);
  const nxtLabel = resolveVenueLabel('NXT', marketStatus?.venues?.nxt);

  return [
    {
      venue: 'KRX',
      label: krxLabel,
      tone: resolveVenueTone(krxLabel),
    },
    {
      venue: 'NXT',
      label: nxtLabel,
      tone: resolveVenueTone(nxtLabel),
    },
  ];
}
