import { describe, expect, it } from 'vitest';
import { sampleSeries, sampleSeriesSmooth, type LapSeries } from '../src/core';

/** 0.1 秒刻みで、東へ進みながら南北に交互に 1e-6 度ずつ揺れる(GPS のカクつきの代わり)走行 */
function zigzag(): LapSeries {
  const n = 101;
  const t = new Float64Array(n), lat = new Float64Array(n), lon = new Float64Array(n), speed = new Float64Array(n), dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i * 0.1;
    lat[i] = 35 + (i % 2 ? 1e-6 : -1e-6);
    lon[i] = 139 + i * 1e-5;
    speed[i] = 100 + (i % 2 ? 5 : -5);
    dist[i] = i * 2.7;
  }
  return { t, lat, lon, speed, dist, duration: t[n - 1], distance: dist[n - 1] };
}

describe('走行アニメのなめらか化(加重移動平均)', () => {
  const s = zigzag();

  it('位置の揺れが小さくなり、速度と距離は元の値のまま', () => {
    const raw = sampleSeries(s, 5.1), sm = sampleSeriesSmooth(s, 5.1);
    expect(Math.abs(sm.lat - 35)).toBeLessThan(Math.abs(raw.lat - 35));
    expect(sm.speed).toBe(raw.speed);
    expect(sm.dist).toBe(raw.dist);
  });

  it('向き: 揺れていても、進行方向(東 = 約 90 度)に近づく', () => {
    const raw = sampleSeries(s, 5.0), sm = sampleSeriesSmooth(s, 5.0);
    expect(Math.abs(sm.heading - 90)).toBeLessThan(Math.abs(raw.heading - 90));
    expect(Math.abs(sm.heading - 90)).toBeLessThan(15);
  });

  it('直線をまっすぐ進むときは、位置が変わらない(ずれない)', () => {
    const n = 51;
    const t = new Float64Array(n).map((_, i) => i * 0.1);
    const lon = new Float64Array(n).map((_, i) => 139 + i * 1e-5);
    const line: LapSeries = { t, lat: new Float64Array(n).fill(35), lon, speed: new Float64Array(n).fill(100), dist: t.map((x) => x * 27), duration: 5, distance: 135 };
    const raw = sampleSeries(line, 2.5), sm = sampleSeriesSmooth(line, 2.5);
    expect(sm.lon).toBeCloseTo(raw.lon, 9);
    expect(sm.lat).toBeCloseTo(raw.lat, 9);
  });

  it('端(0 秒・終わり)でも、数値が壊れない', () => {
    for (const x of [-1, 0, s.duration, s.duration + 1]) {
      const sm = sampleSeriesSmooth(s, x);
      expect(Number.isFinite(sm.lat) && Number.isFinite(sm.lon) && Number.isFinite(sm.heading)).toBe(true);
    }
  });

  it('窓が 0 のときは、元の値と同じ', () => {
    expect(sampleSeriesSmooth(s, 3.33, 0)).toEqual(sampleSeries(s, 3.33));
  });
});
