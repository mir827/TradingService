export const chartLayoutModes = ['single', 'split'] as const;
export type ChartLayoutMode = (typeof chartLayoutModes)[number];

export type LogicalRangeLike = {
  from: number;
  to: number;
} | null;

export type ChartSyncSource = 'primary' | 'secondary';

type NormalizedLogicalRange = {
  from: number;
  to: number;
};

const DEFAULT_RANGE_EPSILON = 0.01;

export type ChartRangeSyncState = {
  suppressNextBySource: Record<ChartSyncSource, NormalizedLogicalRange | null>;
};

export function normalizeChartLayoutMode(value: unknown): ChartLayoutMode {
  return value === 'split' ? 'split' : 'single';
}

export function normalizeLogicalRange(range: LogicalRangeLike): NormalizedLogicalRange | null {
  if (!range) return null;

  const from = Number(range.from);
  const to = Number(range.to);

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  if (from <= to) {
    return { from, to };
  }

  return { from: to, to: from };
}

export function areLogicalRangesClose(
  left: LogicalRangeLike,
  right: LogicalRangeLike,
  epsilon = DEFAULT_RANGE_EPSILON,
): boolean {
  const normalizedLeft = normalizeLogicalRange(left);
  const normalizedRight = normalizeLogicalRange(right);

  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft === normalizedRight;
  }

  return (
    Math.abs(normalizedLeft.from - normalizedRight.from) <= epsilon &&
    Math.abs(normalizedLeft.to - normalizedRight.to) <= epsilon
  );
}

export function createChartRangeSyncState(): ChartRangeSyncState {
  return {
    suppressNextBySource: {
      primary: null,
      secondary: null,
    },
  };
}

function getTargetSource(source: ChartSyncSource): ChartSyncSource {
  return source === 'primary' ? 'secondary' : 'primary';
}

export function shouldSkipSyncedRangeEvent(
  state: ChartRangeSyncState,
  source: ChartSyncSource,
  incomingRange: LogicalRangeLike,
  epsilon = DEFAULT_RANGE_EPSILON,
): boolean {
  const suppressed = state.suppressNextBySource[source];
  if (!suppressed) return false;
  if (!areLogicalRangesClose(suppressed, incomingRange, epsilon)) return false;

  state.suppressNextBySource[source] = null;
  return true;
}

export function applyLogicalRangeSync({
  state,
  source,
  sourceRange,
  getTargetRange,
  setTargetRange,
  epsilon = DEFAULT_RANGE_EPSILON,
}: {
  state: ChartRangeSyncState;
  source: ChartSyncSource;
  sourceRange: LogicalRangeLike;
  getTargetRange: () => LogicalRangeLike;
  setTargetRange: (range: { from: number; to: number }) => void;
  epsilon?: number;
}): boolean {
  const normalizedSourceRange = normalizeLogicalRange(sourceRange);
  if (!normalizedSourceRange) return false;
  if (areLogicalRangesClose(normalizedSourceRange, getTargetRange(), epsilon)) return false;

  const targetSource = getTargetSource(source);
  const syncedRange = { ...normalizedSourceRange };
  state.suppressNextBySource[targetSource] = syncedRange;
  setTargetRange(syncedRange);
  return true;
}
