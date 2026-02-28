import type { CompareScaleMode } from './chartMath';

export const MAX_COMPARE_SYMBOLS = 3;
export const COMPARE_OVERLAY_COLORS = ['#85d47b', '#f5c06f', '#4cc9f0'] as const;

export const SAME_SYMBOL_COMPARE_ERROR = '비교 심볼은 현재 심볼과 달라야 합니다.';
export const FETCH_COMPARE_ERROR = '비교 심볼 데이터를 불러오지 못했습니다.';

export type CompareOverlaySlot<TCandle> = {
  symbol: string;
  visible: boolean;
  candles: TCandle[];
  loading: boolean;
  error: string | null;
};

export type CompareSlotFetchResult<TCandle> =
  | {
      slotIndex: number;
      symbol: string;
      candles: TCandle[];
    }
  | {
      slotIndex: number;
      symbol: string;
      error: string;
    };

export function normalizeCompareScaleMode(value: unknown): CompareScaleMode {
  return value === 'absolute' ? 'absolute' : 'normalized';
}

export function createEmptyCompareOverlaySlot<TCandle>(): CompareOverlaySlot<TCandle> {
  return {
    symbol: '',
    visible: true,
    candles: [],
    loading: false,
    error: null,
  };
}

export function createInitialCompareOverlaySlots<TCandle>(count = MAX_COMPARE_SYMBOLS): CompareOverlaySlot<TCandle>[] {
  const safeCount = Number.isInteger(count) && count > 0 ? count : MAX_COMPARE_SYMBOLS;
  return Array.from({ length: safeCount }, () => createEmptyCompareOverlaySlot<TCandle>());
}

export function startCompareSlotFetch<TCandle>(
  slots: CompareOverlaySlot<TCandle>[],
  selectedSymbol: string,
  sameSymbolError = SAME_SYMBOL_COMPARE_ERROR,
): CompareOverlaySlot<TCandle>[] {
  return slots.map((slot) => {
    if (!slot.symbol) {
      return {
        ...slot,
        candles: [],
        loading: false,
        error: null,
      };
    }

    if (slot.symbol === selectedSymbol) {
      return {
        ...slot,
        candles: [],
        loading: false,
        error: sameSymbolError,
      };
    }

    return {
      ...slot,
      loading: true,
      error: null,
    };
  });
}

function isSuccessResult<TCandle>(
  result: CompareSlotFetchResult<TCandle>,
): result is { slotIndex: number; symbol: string; candles: TCandle[] } {
  return 'candles' in result;
}

export function finalizeCompareSlotFetch<TCandle>(input: {
  slots: CompareOverlaySlot<TCandle>[];
  selectedSymbol: string;
  results: CompareSlotFetchResult<TCandle>[];
  sameSymbolError?: string;
  fetchError?: string;
}): CompareOverlaySlot<TCandle>[] {
  const sameSymbolError = input.sameSymbolError ?? SAME_SYMBOL_COMPARE_ERROR;
  const fetchError = input.fetchError ?? FETCH_COMPARE_ERROR;
  const resultBySlotIndex = new Map<number, CompareSlotFetchResult<TCandle>>();
  input.results.forEach((result) => {
    resultBySlotIndex.set(result.slotIndex, result);
  });

  return input.slots.map((slot, slotIndex) => {
    if (!slot.symbol) {
      return {
        ...slot,
        candles: [],
        loading: false,
        error: null,
      };
    }

    if (slot.symbol === input.selectedSymbol) {
      return {
        ...slot,
        candles: [],
        loading: false,
        error: sameSymbolError,
      };
    }

    const resolved = resultBySlotIndex.get(slotIndex);
    if (!resolved) {
      return {
        ...slot,
        candles: [],
        loading: false,
        error: fetchError,
      };
    }

    if (isSuccessResult(resolved)) {
      return {
        ...slot,
        candles: resolved.candles,
        loading: false,
        error: null,
      };
    }

    return {
      ...slot,
      candles: [],
      loading: false,
      error: resolved.error || fetchError,
    };
  });
}
