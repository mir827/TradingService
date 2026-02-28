import { describe, expect, it } from 'vitest';
import { formatNxtUnavailableReason, normalizeNxtDetailInfo } from './nxt';

describe('nxt detail helpers', () => {
  it('returns null for non-KOSPI/KOSDAQ markets', () => {
    expect(normalizeNxtDetailInfo('CRYPTO')).toBeNull();
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

  it('maps known unavailable reasons to readable labels', () => {
    expect(formatNxtUnavailableReason('NXT_FEED_NOT_CONFIGURED')).toBe('NXT 시세 연동 전');
    expect(formatNxtUnavailableReason('NXT_UPSTREAM_ERROR')).toBe('NXT 시세 연동 오류');
    expect(formatNxtUnavailableReason('')).toBe('NXT 시세 미제공');
  });
});
