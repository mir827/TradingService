import { describe, expect, it } from 'vitest';
import {
  clampReplayVisibleCount,
  getReplayProgress,
  getReplayStartVisibleCount,
  stepReplayVisibleCount,
} from './replay';

describe('replay helpers', () => {
  it('returns bounded replay start size for empty/small datasets', () => {
    expect(getReplayStartVisibleCount(0)).toBe(0);
    expect(getReplayStartVisibleCount(1)).toBe(1);
    expect(getReplayStartVisibleCount(2)).toBe(1);
  });

  it('prefers ratio/min based seed while keeping at least one future bar', () => {
    expect(getReplayStartVisibleCount(100)).toBe(70);
    expect(getReplayStartVisibleCount(40)).toBe(30);
    expect(getReplayStartVisibleCount(12)).toBe(11);
  });

  it('clamps and advances replay visible bars safely', () => {
    expect(clampReplayVisibleCount(10, 14)).toBe(10);
    expect(clampReplayVisibleCount(10, -3)).toBe(0);
    expect(stepReplayVisibleCount(5, 10, 1)).toBe(6);
    expect(stepReplayVisibleCount(9, 10, 4)).toBe(10);
    expect(stepReplayVisibleCount(3, 10, -2)).toBe(3);
  });

  it('reports end-of-data progress deterministically', () => {
    expect(getReplayProgress(10, 7, 10)).toEqual({
      totalBars: 10,
      startBars: 7,
      visibleBars: 10,
      completedSteps: 3,
      totalSteps: 3,
      remainingSteps: 0,
      isAtEnd: true,
    });
  });

  it('handles invalid or out-of-bounds replay counts', () => {
    expect(getReplayProgress(0, 10, 5)).toEqual({
      totalBars: 0,
      startBars: 0,
      visibleBars: 0,
      completedSteps: 0,
      totalSteps: 0,
      remainingSteps: 0,
      isAtEnd: true,
    });

    expect(getReplayProgress(8, 20, 99)).toEqual({
      totalBars: 8,
      startBars: 8,
      visibleBars: 8,
      completedSteps: 0,
      totalSteps: 0,
      remainingSteps: 0,
      isAtEnd: true,
    });
  });
});
