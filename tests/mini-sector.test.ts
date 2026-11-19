import { describe, expect, it } from 'vitest';
import { MINI_COUNT, fastestLap, miniSpeeds, miniTone, sectorRange, segmentRange } from '../src/core/miniSector';
import type { LapSeries } from '../src/core/series';
import type { Lap } from '../src/core/types';

/** 時刻 t(秒)と速度 v(km/h)の列から、ラップの時系列を作る(距離は速度の積分) */
function seriesOf(t: number[], v: number[]): LapSeries {
  const dist = [0];
  for (let i = 1; i < t.length; i++) dist.push(dist[i - 1] + ((v[i] + v[i - 1]) / 2 / 3.6) * (t[i] - t[i - 1]));
  return {
    t: Float64Array.from(t),
    lat: new Float64Array(t.length),
    lon: new Float64Array(t.length),
    speed: Float64Array.from(v),
    dist: Float64Array.from(dist),
    duration: t[t.length - 1],
    distance: dist[dist.length - 1],
  };
}

function lapOf(over: Partial<Lap>): Lap {
  return {
    number: 1, startTime: 0, endTime: 10, duration: 10, complete: true,
    startIndex: 0, endIndex: 0, sectorTimes: [0, 4], baseDuration: 10, maxDuration: 10,
    ...over,
  };
}

describe('ミニセクターの平均速度(距離で 5 等分)', () => {
  it('一定の速度(36 km/h)なら、どの区間も 36 km/h', () => {
    const t = Array.from({ length: 11 }, (_, i) => i);
    const s = seriesOf(t, t.map(() => 36));
    const out = miniSpeeds(s, 2, 8);
    expect(out).toHaveLength(MINI_COUNT);
    for (const v of out) expect(v).toBeCloseTo(36, 6);
  });

  it('前半 72 km/h・後半 36 km/h なら、前の 2 区間が速く、後の 3 区間が遅い', () => {
    // 0〜5 秒は 72 km/h(20 m/s)、5〜10 秒は 36 km/h(10 m/s)。距離 0〜100 m、5 秒から 150 m
    const t = Array.from({ length: 11 }, (_, i) => i);
    const v = t.map((x) => (x <= 5 ? 72 : 36));
    const s = seriesOf(t, v);
    const out = miniSpeeds(s, 0, 10) as number[];
    // 距離の区切りは 30 m ごと(0〜150 m)。0〜90 m は 72 km/h、120〜150 m は 36 km/h。
    // 90〜120 m は速度が変わる所(5 秒〜6 秒)をまたぐので、その間の値になる
    expect(out[0]).toBeCloseTo(72, 6);
    expect(out[1]).toBeCloseTo(72, 6);
    expect(out[2]).toBeCloseTo(72, 6);
    expect(out[3]).toBeGreaterThan(36);
    expect(out[3]).toBeLessThan(72);
    expect(out[4]).toBeCloseTo(36, 6);
    expect(out[0]).toBeGreaterThan(out[3]);
  });

  it('区間の時間が 0 なら null', () => {
    const s = seriesOf([0, 1, 2], [36, 36, 36]);
    expect(miniSpeeds(s, 1, 1)).toEqual([null, null, null, null, null]);
  });
});

describe('セクターの区間', () => {
  it('途中のセクターは次の通過まで、最後のセクターはゴールまで', () => {
    const lap = lapOf({ sectorTimes: [0, 4, 7], duration: 10 });
    expect(sectorRange(lap, 0)).toEqual({ a: 0, b: 4 });
    expect(sectorRange(lap, 1)).toEqual({ a: 4, b: 7 });
    expect(sectorRange(lap, 2)).toEqual({ a: 7, b: 10 });
  });

  it('区間(案件 84): ライン n 本で n+1 個。スタート〜最初のライン、ライン間、最後のライン〜エンド', () => {
    const lap = lapOf({ sectorTimes: [3, 6, 9], duration: 12 });
    expect([0, 1, 2, 3].map((j) => segmentRange(lap, j, 3))).toEqual([
      { a: 0, b: 3 }, { a: 3, b: 6 }, { a: 6, b: 9 }, { a: 9, b: 12 },
    ]);
  });

  it('区間: ラインが無いときは、1 周全体の 1 区間', () => {
    expect(segmentRange(lapOf({ sectorTimes: [], duration: 12 }), 0, 0)).toEqual({ a: 0, b: 12 });
  });

  it('区間: 通過が欠けている・長さが 0 以下なら null(前後の区間も成り立たない)', () => {
    const lap = lapOf({ sectorTimes: [3, null, 9], duration: 12 });
    expect([0, 1, 2, 3].map((j) => segmentRange(lap, j, 3))).toEqual([{ a: 0, b: 3 }, null, null, { a: 9, b: 12 }]);
    expect(segmentRange(lapOf({ sectorTimes: [0, 5], duration: 10 }), 0, 2)).toBeNull();   // スタートとラインが同時
  });

  it('通過が欠けている・長さが 0 以下のセクターは null', () => {
    expect(sectorRange(lapOf({ sectorTimes: [0, null, 7] }), 1)).toBeNull();
    expect(sectorRange(lapOf({ sectorTimes: [0, 5, 5] }), 1)).toBeNull();
  });
});

describe('自己ベストの選び方と色分け', () => {
  it('完了ラップのうち、いちばん速いもの(完了していないラップは対象外)', () => {
    const laps = [
      lapOf({ number: 1, duration: 80, complete: true }),
      lapOf({ number: 2, duration: 70, complete: false }),
      lapOf({ number: 3, duration: 75, complete: true }),
    ];
    expect(fastestLap(laps)?.number).toBe(3);
    expect(fastestLap([lapOf({ complete: false })])).toBeNull();
  });

  it('自己ベストより速いと紫、基準より速いと緑、遅いと黄、比べられないと none', () => {
    expect(miniTone(40, 30, 35)).toBe('pb');     // 自己ベストより速い(紫が優先)
    expect(miniTone(33, 30, 35)).toBe('faster'); // 基準より速い、自己ベストより遅い
    expect(miniTone(28, 30, 35)).toBe('slower');
    expect(miniTone(28, null, 35)).toBe('none'); // 基準が無い
    expect(miniTone(null, 30, 35)).toBe('none');
  });
});
