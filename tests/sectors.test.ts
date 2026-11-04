import { describe, expect, it } from 'vitest';
import { bestPerColumn, isBest, sectorSplits } from '../src/core';
import type { Lap } from '../src/core';

const lap = (sectorTimes: (number | null)[], duration: number): Lap => ({
  number: 1, startTime: 0, endTime: duration, duration, complete: true, startIndex: 0, endIndex: 0, sectorTimes, baseDuration: duration, maxDuration: duration,
});

describe('区間タイム', () => {
  it('通過時刻の差と、最後はゴールまで', () => {
    const s = sectorSplits(lap([0.2, 28.5, 42.3, 54.3, 76.6, 102.1, 124.4], 147.2));
    [28.3, 13.8, 12.0, 22.3, 25.5, 22.3, 22.8].forEach((v, i) => expect(s[i]).toBeCloseTo(v, 1));
  });
  it('通過が欠けた区間は null', () => {
    expect(sectorSplits(lap([0.1, null, 40, 60], 100))).toEqual([null, null, 20, 40].map((v) => v));
  });
});

describe('列ごとの最速', () => {
  it('対象外の行と null は無視する', () => {
    const rows = [[10, 20], [9, null], [5, 15]];
    expect(bestPerColumn(rows, [true, true, false])).toEqual([9, 20]);
    expect(bestPerColumn([[null]], [true])).toEqual([null]);
  });
  it('表示上同じなら最速扱い', () => {
    expect(isBest(12.04, 12.0)).toBe(true);
    expect(isBest(12.2, 12.0)).toBe(false);
    expect(isBest(null, 12)).toBe(false);
  });
});
