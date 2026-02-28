import { describe, expect, it } from 'vitest';
import { formatNxtUnavailableReason, normalizeKrxNxtComparisonInfo, normalizeNxtDetailInfo } from './nxt';

describe('nxt detail helpers', () => {
  it('returns null for non-KOSPI/KOSDAQ markets', () => {
    expect(normalizeNxtDetailInfo('CRYPTO')).toBeNull();
  });

  it('no-ops for non-KR markets even when NXT payload is provided', () => {
    expect(
      normalizeNxtDetailInfo('CRYPTO', {
        nxt: {
          supported: true,
          available: true,
          status: 'available',
          price: 60500,
          changePercent: 1.8,
        },
      }),
    ).toBeNull();

    expect(
      normalizeKrxNxtComparisonInfo('CRYPTO', {
        lastPrice: 60500,
        changePercent: 1.8,
        nxt: {
          supported: true,
          available: true,
          status: 'available',
          price: 60520,
          changePercent: 1.9,
        },
      }),
    ).toBeNull();
  });

  it('normalizes unavailable fallback metadata for KR markets', () => {
    expect(normalizeNxtDetailInfo('KOSPI')).toEqual({
      supported: false,
      supportLabel: '미지원',
      status: 'unavailable',
      reason: 'NXT 시세 미제공',
      price: null,
      changePercent: null,
      updatedAt: null,
    });
  });

  it('preserves available NXT quote fields when provided', () => {
    expect(
      normalizeNxtDetailInfo('KOSDAQ', {
        nxt: {
          supported: true,
          available: true,
          status: 'available',
          price: 12345,
          changePercent: 1.28,
          updatedAt: 1_762_281_200_000,
        },
      }),
    ).toEqual({
      supported: true,
      supportLabel: '지원',
      status: 'available',
      reason: null,
      price: 12345,
      changePercent: 1.28,
      updatedAt: 1_762_281_200_000,
    });
  });

  it('keeps unavailable NXT schema stable when detail fields are missing', () => {
    expect(
      normalizeNxtDetailInfo('KOSPI', {
        nxt: {
          supported: true,
          available: false,
          status: 'unavailable',
        },
      }),
    ).toEqual({
      supported: true,
      supportLabel: '지원',
      status: 'unavailable',
      reason: 'NXT 시세 미제공',
      price: null,
      changePercent: null,
      updatedAt: null,
    });
  });

  it('maps known unavailable reasons to readable labels', () => {
    expect(formatNxtUnavailableReason('NXT_FEED_NOT_CONFIGURED')).toBe('NXT 시세 연동 전');
    expect(formatNxtUnavailableReason('NXT_UPSTREAM_ERROR')).toBe('NXT 시세 연동 오류');
    expect(formatNxtUnavailableReason('')).toBe('NXT 시세 미제공');
  });

  it('normalizes KRX/NXT comparison values for KR detail rendering', () => {
    expect(
      normalizeKrxNxtComparisonInfo(
        'KOSPI',
        {
          lastPrice: 71000,
          changePercent: -0.42,
          nxt: {
            supported: true,
            available: true,
            status: 'available',
            price: 70980,
            changePercent: -0.45,
          },
        },
        {
          krx: 1_762_281_200_000,
          nxt: 1_762_281_260_000,
        },
      ),
    ).toEqual({
      krx: {
        venue: 'KRX',
        available: true,
        price: 71000,
        changePercent: -0.42,
        updatedAt: 1_762_281_200_000,
      },
      nxt: {
        venue: 'NXT',
        available: true,
        price: 70980,
        changePercent: -0.45,
        updatedAt: 1_762_281_260_000,
        reason: null,
      },
    });
  });

  it('uses graceful defaults when quote or venue metadata is missing', () => {
    expect(normalizeKrxNxtComparisonInfo('CRYPTO')).toBeNull();

    expect(normalizeKrxNxtComparisonInfo('KOSDAQ')).toEqual({
      krx: {
        venue: 'KRX',
        available: false,
        price: null,
        changePercent: null,
        updatedAt: null,
      },
      nxt: {
        venue: 'NXT',
        available: false,
        price: null,
        changePercent: null,
        updatedAt: null,
        reason: 'NXT 시세 미제공',
      },
    });
  });
});
