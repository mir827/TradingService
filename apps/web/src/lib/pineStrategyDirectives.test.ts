import { describe, expect, it } from 'vitest';
import {
  parsePineStrategyTesterDirectives,
  parsePineStrategyTesterDirectivesWithMeta,
} from './pineStrategyDirectives';

describe('pine strategy directive parser', () => {
  it('parses valid directives from source comments', () => {
    const source = [
      '//@version=5',
      '//@ts_fast=12',
      '//@ts_slow=26',
      '//@ts_capital=10000000',
      '//@ts_fee_bps=5',
      'plot(close)',
    ].join('\n');

    expect(parsePineStrategyTesterDirectives(source)).toEqual({
      fastPeriod: 12,
      slowPeriod: 26,
      initialCapital: 10000000,
      feeBps: 5,
    });
  });

  it('ignores invalid directives safely', () => {
    const source = [
      '//@ts_fast=1',
      '//@ts_slow=601',
      '//@ts_capital=0',
      '//@ts_fee_bps=-1',
      '//@ts_fast=abc',
      '//@ts_unknown=123',
      '//@ts_slow=3.5',
    ].join('\n');

    expect(parsePineStrategyTesterDirectives(source)).toEqual({});
  });

  it('reports invalid directive metadata while keeping parser output safe', () => {
    const source = [
      '//@ts_fast=12',
      '//@ts_unknown=123',
      '//@ts_fee_bps=-10',
      '//@ts_capital=50000',
      '//@ts_slow=26',
    ].join('\n');

    expect(parsePineStrategyTesterDirectivesWithMeta(source)).toEqual({
      directives: {
        fastPeriod: 12,
        slowPeriod: 26,
        initialCapital: 50000,
      },
      invalidDirectiveCount: 2,
    });
  });

  it('supports mixed directives and keeps last valid value by key', () => {
    const source = [
      '//@ts_fast=8',
      '//@ts_fast=9',
      '//@ts_slow=invalid',
      '//@ts_slow=21',
      '//@ts_capital=10000',
      '//@ts_fee_bps=4.5',
      '//@ts_fee_bps=oops',
    ].join('\n');

    expect(parsePineStrategyTesterDirectives(source)).toEqual({
      fastPeriod: 9,
      slowPeriod: 21,
      initialCapital: 10000,
      feeBps: 4.5,
    });
  });

  it('drops fast/slow directives when pair sanity check fails', () => {
    const source = [
      '//@ts_fast=30',
      '//@ts_slow=10',
      '//@ts_capital=20000',
      '//@ts_fee_bps=7',
    ].join('\n');

    expect(parsePineStrategyTesterDirectives(source)).toEqual({
      initialCapital: 20000,
      feeBps: 7,
    });
  });

  it('does not throw for malformed input shapes', () => {
    expect(parsePineStrategyTesterDirectivesWithMeta('//@ts_fast=12\n//@ts_slow = not-a-number')).toEqual({
      directives: {
        fastPeriod: 12,
      },
      invalidDirectiveCount: 1,
    });
  });
});
