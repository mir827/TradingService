export type AlertLifecycleState = 'active' | 'triggered' | 'cooldown' | 'error';
export type AlertCenterEventType = 'triggered' | 'error';

export type AlertCenterRuleLike = {
  state?: AlertLifecycleState | null;
};

export type AlertCenterEventLike = {
  symbol: string;
  state?: AlertLifecycleState | null;
  eventType?: AlertCenterEventType | null;
};

export type AlertCenterEventFilters = {
  symbolQuery: string;
  state: AlertLifecycleState | 'all';
  type: AlertCenterEventType | 'all';
};

export type AlertCenterStateSummary = {
  total: number;
  active: number;
  triggered: number;
  cooldown: number;
  error: number;
};

export function normalizeAlertLifecycleState(state?: string | null): AlertLifecycleState {
  if (state === 'active' || state === 'triggered' || state === 'cooldown' || state === 'error') {
    return state;
  }
  return 'active';
}

export function normalizeAlertCenterEventType(type?: string | null): AlertCenterEventType {
  if (type === 'triggered' || type === 'error') {
    return type;
  }
  return 'triggered';
}

export function summarizeAlertRuleStates(rules: readonly AlertCenterRuleLike[]): AlertCenterStateSummary {
  const summary: AlertCenterStateSummary = {
    total: rules.length,
    active: 0,
    triggered: 0,
    cooldown: 0,
    error: 0,
  };

  for (const rule of rules) {
    const state = normalizeAlertLifecycleState(rule.state);
    summary[state] += 1;
  }

  return summary;
}

export function filterAlertCenterEvents<T extends AlertCenterEventLike>(
  events: readonly T[],
  filters: AlertCenterEventFilters,
): T[] {
  const normalizedSymbol = filters.symbolQuery.trim().toUpperCase();

  return events.filter((eventItem) => {
    if (normalizedSymbol && !eventItem.symbol.toUpperCase().includes(normalizedSymbol)) {
      return false;
    }

    if (filters.state !== 'all' && normalizeAlertLifecycleState(eventItem.state) !== filters.state) {
      return false;
    }

    if (filters.type !== 'all' && normalizeAlertCenterEventType(eventItem.eventType) !== filters.type) {
      return false;
    }

    return true;
  });
}
