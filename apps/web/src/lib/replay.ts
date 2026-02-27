export const replaySpeedOptions = [1, 2, 4] as const;

export type ReplaySpeed = (typeof replaySpeedOptions)[number];

export const REPLAY_TICK_MS_BY_SPEED: Record<ReplaySpeed, number> = {
  1: 1000,
  2: 500,
  4: 250,
};

const DEFAULT_REPLAY_START_RATIO = 0.7;
const DEFAULT_REPLAY_MIN_START_BARS = 30;

function normalizeCount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function clampReplayVisibleCount(totalCandles: number, visibleCount: number): number {
  const normalizedTotal = normalizeCount(totalCandles);
  const normalizedVisible = normalizeCount(visibleCount);
  return Math.min(normalizedVisible, normalizedTotal);
}

export function getReplayStartVisibleCount(
  totalCandles: number,
  minStartBars = DEFAULT_REPLAY_MIN_START_BARS,
  startRatio = DEFAULT_REPLAY_START_RATIO,
): number {
  const normalizedTotal = normalizeCount(totalCandles);
  if (normalizedTotal <= 1) return normalizedTotal;

  const normalizedMin = Math.max(1, normalizeCount(minStartBars));
  const normalizedRatio = Number.isFinite(startRatio) ? Math.max(0, startRatio) : DEFAULT_REPLAY_START_RATIO;
  const ratioBased = Math.floor(normalizedTotal * normalizedRatio);
  const initial = Math.max(normalizedMin, ratioBased);

  return Math.min(initial, normalizedTotal - 1);
}

export function stepReplayVisibleCount(currentVisible: number, totalCandles: number, step: number): number {
  const normalizedTotal = normalizeCount(totalCandles);
  if (normalizedTotal === 0) return 0;

  const boundedCurrent = clampReplayVisibleCount(normalizedTotal, currentVisible);
  const boundedStep = Math.max(0, normalizeCount(step));

  return clampReplayVisibleCount(normalizedTotal, boundedCurrent + boundedStep);
}

export type ReplayProgress = {
  totalBars: number;
  startBars: number;
  visibleBars: number;
  completedSteps: number;
  totalSteps: number;
  remainingSteps: number;
  isAtEnd: boolean;
};

export function getReplayProgress(totalCandles: number, replayStartBars: number, replayVisibleBars: number): ReplayProgress {
  const totalBars = normalizeCount(totalCandles);
  const startBars = clampReplayVisibleCount(totalBars, replayStartBars);
  const visibleBars = clampReplayVisibleCount(totalBars, replayVisibleBars);
  const totalSteps = Math.max(0, totalBars - startBars);
  const completedSteps = Math.min(totalSteps, Math.max(0, visibleBars - startBars));
  const remainingSteps = totalSteps - completedSteps;

  return {
    totalBars,
    startBars,
    visibleBars,
    completedSteps,
    totalSteps,
    remainingSteps,
    isAtEnd: remainingSteps === 0,
  };
}
