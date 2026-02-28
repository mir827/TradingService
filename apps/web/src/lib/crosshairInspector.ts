export type InspectorCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CrosshairInspectorIndicatorInput = {
  key: string;
  label: string;
  valuesByTime: ReadonlyMap<number, number>;
};

export type CrosshairInspectorCompareInput = {
  slotIndex: number;
  symbol: string;
  visible: boolean;
  valuesByTime: ReadonlyMap<number, number>;
};

export type CrosshairInspectorMode = 'crosshair' | 'latest' | 'empty';

export type CrosshairInspectorSnapshot = {
  mode: CrosshairInspectorMode;
  time: number | null;
  candle: InspectorCandle | null;
  indicators: Array<{
    key: string;
    label: string;
    value: number | null;
  }>;
  compares: Array<{
    slotIndex: number;
    symbol: string;
    visible: boolean;
    value: number | null;
  }>;
  helperText: string;
};

export type CrosshairInspectorSnapshotInput = {
  crosshairTime: number | null;
  latestCandle: InspectorCandle | null;
  candlesByTime: ReadonlyMap<number, InspectorCandle>;
  indicatorInputs: CrosshairInspectorIndicatorInput[];
  compareInputs: CrosshairInspectorCompareInput[];
};

export function toInspectorTimeValueMap(
  items: Array<{ time: number }>,
  values: Array<number | null | undefined>,
): Map<number, number> {
  const lookup = new Map<number, number>();
  const max = Math.min(items.length, values.length);

  for (let index = 0; index < max; index += 1) {
    const time = items[index]?.time;
    const value = values[index];

    if (typeof time !== 'number' || !Number.isFinite(time)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;

    lookup.set(time, value);
  }

  return lookup;
}

function readLookupValue(lookup: ReadonlyMap<number, number>, time: number | null): number | null {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;

  const value = lookup.get(time);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveInspectorTarget(input: CrosshairInspectorSnapshotInput): {
  mode: CrosshairInspectorMode;
  time: number | null;
  candle: InspectorCandle | null;
  helperText: string;
} {
  if (
    typeof input.crosshairTime === 'number' &&
    Number.isFinite(input.crosshairTime) &&
    input.candlesByTime.has(input.crosshairTime)
  ) {
    const candle = input.candlesByTime.get(input.crosshairTime) ?? null;
    return {
      mode: 'crosshair',
      time: input.crosshairTime,
      candle,
      helperText: '커서 위치 데이터',
    };
  }

  if (input.latestCandle) {
    return {
      mode: 'latest',
      time: input.latestCandle.time,
      candle: input.latestCandle,
      helperText: '커서 데이터 없음 · 최신 캔들 표시',
    };
  }

  return {
    mode: 'empty',
    time: null,
    candle: null,
    helperText: '표시할 캔들 데이터가 없습니다.',
  };
}

export function normalizeCrosshairInspectorSnapshot(
  input: CrosshairInspectorSnapshotInput,
): CrosshairInspectorSnapshot {
  const target = resolveInspectorTarget(input);

  return {
    mode: target.mode,
    time: target.time,
    candle: target.candle,
    indicators: input.indicatorInputs.map((item) => ({
      key: item.key,
      label: item.label,
      value: readLookupValue(item.valuesByTime, target.time),
    })),
    compares: input.compareInputs.map((item) => ({
      slotIndex: item.slotIndex,
      symbol: item.symbol,
      visible: item.visible,
      value: readLookupValue(item.valuesByTime, target.time),
    })),
    helperText: target.helperText,
  };
}
