import { describe, expect, it } from 'vitest';
import {
  formatSigned,
  getDisplayCode,
  getOptionLabel,
  isKrMarket,
  isKrSymbol,
  marketExchangeText,
  normalizeVenueForSymbol,
  normalizeVenuePreference,
  shortTicker,
} from './symbol';

describe('symbol helpers', () => {
  it('shortTicker removes KRX suffix', () => {
    expect(shortTicker('005930.KS')).toBe('005930');
    expect(shortTicker('247540.KQ')).toBe('247540');
    expect(shortTicker('BTCUSDT')).toBe('BTCUSDT');
  });

  it('prefers explicit code over symbol', () => {
    expect(getDisplayCode({ symbol: '005930.KS', code: '005930' })).toBe('005930');
    expect(getDisplayCode({ symbol: 'BTCUSDT' })).toBe('BTCUSDT');
  });

  it('builds option labels with code + name + market', () => {
    expect(
      getOptionLabel({
        symbol: '005930.KS',
        code: '005930',
        name: '삼성전자',
        market: 'KOSPI',
      }),
    ).toBe('005930 · 삼성전자 (KOSPI)');
  });

  it('maps exchange labels by market', () => {
    expect(marketExchangeText('CRYPTO')).toBe('BINANCE');
    expect(marketExchangeText('KOSPI')).toBe('KRX');
    expect(marketExchangeText('KOSDAQ')).toBe('KRX');
  });

  it('formats signed numbers consistently', () => {
    expect(formatSigned(1.239, 2)).toBe('+1.24');
    expect(formatSigned(-1.239, 2)).toBe('-1.24');
    expect(formatSigned(0, 2)).toBe('0.00');
  });

  it('normalizes optional KRX/NXT venue strings', () => {
    expect(normalizeVenuePreference('krx')).toBe('KRX');
    expect(normalizeVenuePreference(' NXT ')).toBe('NXT');
    expect(normalizeVenuePreference('')).toBeUndefined();
    expect(normalizeVenuePreference('NASDAQ')).toBeUndefined();
  });

  it('applies venue preference only for KR symbols', () => {
    expect(normalizeVenueForSymbol({ symbol: '005930.KS', market: 'KOSPI' }, 'nxt')).toBe('NXT');
    expect(normalizeVenueForSymbol({ symbol: '247540.KQ', market: 'KOSDAQ' }, 'KRX')).toBe('KRX');
    expect(normalizeVenueForSymbol({ symbol: 'BTCUSDT', market: 'CRYPTO' }, 'NXT')).toBeUndefined();
    expect(normalizeVenueForSymbol({ symbol: 'BTCUSDT', market: 'KOSPI' }, 'KRX')).toBeUndefined();
    expect(normalizeVenueForSymbol({ symbol: 'ETHUSDT', market: 'CRYPTO' }, ' KRX ')).toBeUndefined();
  });

  it('detects KR market and KR symbol helpers', () => {
    expect(isKrMarket('KOSPI')).toBe(true);
    expect(isKrMarket('KOSDAQ')).toBe(true);
    expect(isKrMarket('CRYPTO')).toBe(false);
    expect(isKrSymbol('005930.KS')).toBe(true);
    expect(isKrSymbol('247540.KQ')).toBe(true);
    expect(isKrSymbol('BTCUSDT')).toBe(false);
  });
});
