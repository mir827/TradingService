import { describe, expect, it } from 'vitest';
import {
  filterAlertCenterEvents,
  normalizeAlertCenterEventType,
  normalizeAlertLifecycleState,
  summarizeAlertRuleStates,
} from './alertCenter';

describe('alert center utilities', () => {
  it('normalizes lifecycle states and event types with safe defaults', () => {
    expect(normalizeAlertLifecycleState('active')).toBe('active');
    expect(normalizeAlertLifecycleState('cooldown')).toBe('cooldown');
    expect(normalizeAlertLifecycleState('unknown')).toBe('active');
    expect(normalizeAlertLifecycleState(undefined)).toBe('active');

    expect(normalizeAlertCenterEventType('triggered')).toBe('triggered');
    expect(normalizeAlertCenterEventType('error')).toBe('error');
    expect(normalizeAlertCenterEventType('')).toBe('triggered');
    expect(normalizeAlertCenterEventType(undefined)).toBe('triggered');
  });

  it('builds rule state summary counts from mixed inputs', () => {
    const summary = summarizeAlertRuleStates([
      { state: 'active' },
      { state: 'triggered' },
      { state: 'cooldown' },
      { state: 'error' },
      {},
    ]);

    expect(summary).toEqual({
      total: 5,
      active: 2,
      triggered: 1,
      cooldown: 1,
      error: 1,
    });
  });

  it('filters events by symbol, lifecycle state, and type', () => {
    const events = [
      { symbol: 'BTCUSDT', state: 'triggered', eventType: 'triggered' },
      { symbol: 'BTCUSDT', state: 'error', eventType: 'error' },
      { symbol: 'ETHUSDT', state: 'cooldown', eventType: 'triggered' },
      { symbol: 'SOLUSDT', state: 'active', eventType: 'triggered' },
    ] as const;

    expect(
      filterAlertCenterEvents(events, {
        symbolQuery: 'btc',
        state: 'all',
        type: 'all',
      }),
    ).toHaveLength(2);

    expect(
      filterAlertCenterEvents(events, {
        symbolQuery: '',
        state: 'error',
        type: 'error',
      }),
    ).toEqual([{ symbol: 'BTCUSDT', state: 'error', eventType: 'error' }]);

    expect(
      filterAlertCenterEvents(events, {
        symbolQuery: '',
        state: 'cooldown',
        type: 'triggered',
      }),
    ).toEqual([{ symbol: 'ETHUSDT', state: 'cooldown', eventType: 'triggered' }]);
  });
});
