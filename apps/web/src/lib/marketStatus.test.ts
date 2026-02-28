import { describe, expect, it } from 'vitest';
import {
  formatMarketStatusReason,
  normalizeVenueCheckedAt,
  normalizeVenueSessionBadges,
  type MarketStatusWithVenues,
} from './marketStatus';

function createBaseKrStatus(): MarketStatusWithVenues {
  return {
    market: 'KOSPI',
    status: 'OPEN',
    reason: 'SESSION_ACTIVE',
    checkedAt: 1_762_281_200_000,
    timezone: 'Asia/Seoul',
    session: {
      open: '09:00',
      close: '15:30',
      text: '09:00-15:30 KST',
    },
  };
}

describe('market status helpers', () => {
  it('returns empty venue badges for non-KR markets', () => {
    expect(normalizeVenueSessionBadges('CRYPTO', createBaseKrStatus())).toEqual([]);
  });

  it('uses venue phase metadata when available', () => {
    expect(
      normalizeVenueSessionBadges('KOSPI', {
        ...createBaseKrStatus(),
        venues: {
          krx: {
            venue: 'KRX',
            available: true,
            status: 'OPEN',
            reason: 'SESSION_ACTIVE',
            phase: 'OPEN',
          },
          nxt: {
            venue: 'NXT',
            available: false,
            status: 'CLOSED',
            reason: 'UNAVAILABLE',
            phase: 'UNAVAILABLE',
            unavailableReason: 'NXT_STATUS_NOT_INTEGRATED',
          },
        },
      }),
    ).toEqual([
      {
        venue: 'KRX',
        label: '장중',
        tone: 'open',
      },
      {
        venue: 'NXT',
        label: '미연동',
        tone: 'pending',
      },
    ]);
  });

  it('falls back gracefully when venue metadata is missing', () => {
    expect(
      normalizeVenueSessionBadges('KOSDAQ', {
        ...createBaseKrStatus(),
        market: 'KOSDAQ',
        venues: undefined,
      }),
    ).toEqual([
      {
        venue: 'KRX',
        label: '장중',
        tone: 'open',
      },
      {
        venue: 'NXT',
        label: '상태확인',
        tone: 'pending',
      },
    ]);
  });

  it('falls back to market-level status when KRX phase metadata is partial', () => {
    expect(
      normalizeVenueSessionBadges('KOSPI', {
        ...createBaseKrStatus(),
        status: 'CLOSED',
        reason: 'OUT_OF_SESSION',
        venues: {
          krx: {
            venue: 'KRX',
            available: true,
          },
          nxt: {
            venue: 'NXT',
            available: false,
          },
        },
      }),
    ).toEqual([
      {
        venue: 'KRX',
        label: '장외',
        tone: 'closed',
      },
      {
        venue: 'NXT',
        label: '미연동',
        tone: 'pending',
      },
    ]);
  });

  it('normalizes optional venue checkedAt values', () => {
    expect(
      normalizeVenueCheckedAt({
        ...createBaseKrStatus(),
        venues: {
          krx: {
            checkedAt: 1_762_281_200_001,
          },
          nxt: {
            checkedAt: Number.NaN,
          },
        },
      }),
    ).toEqual({
      krx: 1_762_281_200_001,
      nxt: null,
    });

    expect(normalizeVenueCheckedAt()).toEqual({
      krx: null,
      nxt: null,
    });
  });

  it('maps known market status reasons', () => {
    expect(formatMarketStatusReason('WEEKEND')).toBe('주말');
    expect(formatMarketStatusReason('OUT_OF_SESSION')).toBe('장외 시간');
    expect(formatMarketStatusReason('SESSION_ACTIVE')).toBe('세션 진행중');
    expect(formatMarketStatusReason('UNAVAILABLE')).toBe('미연동');
    expect(formatMarketStatusReason('UNKNOWN')).toBe('상태 확인 중');
  });
});
