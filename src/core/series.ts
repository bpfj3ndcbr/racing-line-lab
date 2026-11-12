import type { Lap, TrackLog } from './types';
import { type Offset, metersPerDegree } from './geo';
import { indexAt } from './laps';

/**
 * 1ラップ分の時系列。時刻はラップ開始を 0 とした秒。ラップの開始・終了の瞬間は
 * 前後のサンプルから補間した点を足してあり、t[0] = 0、末尾 = duration になる。
 * 位置補正(offset)は座標に反映済み。
 */
export interface LapSeries {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** km/h */
  speed: Float64Array;
  /** ラップ開始からの走行距離(m)。速度の積分で求めるので GPS のゆらぎで増えない */
  dist: Float64Array;
  duration: number;
  distance: number;
}

export interface SeriesSample {
  lat: number; lon: number; speed: number; dist: number;
  /** 進行方向(度、北=0、時計回り) */
  heading: number;
}

function interp(log: TrackLog, time: number) {
  const { t, lat, lon, speed } = log;
  const i = indexAt(t, time);
  if (i >= t.length - 1) return { lat: lat[i], lon: lon[i], speed: speed[i] };
  const f = (time - t[i]) / (t[i + 1] - t[i]);
  return {
    lat: lat[i] + f * (lat[i + 1] - lat[i]),
    lon: lon[i] + f * (lon[i + 1] - lon[i]),
    speed: speed[i] + f * (speed[i + 1] - speed[i]),
  };
}

export function buildLapSeries(log: TrackLog, lap: Lap, offset: Offset = { east: 0, north: 0 }): LapSeries {
  const T: number[] = [], LA: number[] = [], LO: number[] = [], SP: number[] = [];
  const push = (time: number, p: { lat: number; lon: number; speed: number }) => {
    const rel = time - lap.startTime;
    if (T.length && rel <= T[T.length - 1] + 1e-9) return;
    T.push(rel); LA.push(p.lat); LO.push(p.lon); SP.push(p.speed);
  };
  push(lap.startTime, interp(log, lap.startTime));
  for (let i = lap.startIndex + 1; i <= lap.endIndex; i++) {
    push(log.t[i], { lat: log.lat[i], lon: log.lon[i], speed: log.speed[i] });
  }
  push(lap.endTime, interp(log, lap.endTime));

  const m = metersPerDegree(LA[0]);
  const dLat = offset.north / m.lat, dLon = offset.east / m.lon;
  const n = T.length;
  const dist = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    dist[i] = dist[i - 1] + ((SP[i] + SP[i - 1]) / 2 / 3.6) * (T[i] - T[i - 1]);
  }
  return {
    t: Float64Array.from(T),
    lat: Float64Array.from(LA, (v) => v + dLat),
    lon: Float64Array.from(LO, (v) => v + dLon),
    speed: Float64Array.from(SP),
    dist,
    duration: T[n - 1],
    distance: dist[n - 1],
  };
}

/** 時刻 tau(秒)での状態。範囲外は端に張り付く。 */
export function sampleSeries(s: LapSeries, tau: number): SeriesSample {
  const n = s.t.length;
  const x = Math.min(Math.max(tau, 0), s.duration);
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.t[mid] <= x) lo = mid; else hi = mid - 1;
  }
  const i = Math.min(lo, n - 2);
  const span = s.t[i + 1] - s.t[i];
  const f = span > 0 ? (x - s.t[i]) / span : 0;
  const lerp = (a: Float64Array) => a[i] + f * (a[i + 1] - a[i]);
  const lat = lerp(s.lat);
  const dy = s.lat[i + 1] - s.lat[i];
  const dx = (s.lon[i + 1] - s.lon[i]) * Math.cos((lat * Math.PI) / 180);
  const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { lat, lon: lerp(s.lon), speed: lerp(s.speed), dist: lerp(s.dist), heading };
}

/** アニメーションをなめらかにする窓の片側(秒)。固定(案件 48) */
export const SMOOTH_HALF_SEC = 0.4;
const SMOOTH_TAPS = 4;   // 片側のサンプル数。重みは中心が最大の三角形(加重移動平均)

/**
 * 時刻 tau での状態のうち、見た目(位置と向き)だけを、前後 halfSec 秒の加重移動平均でなめらかにしたもの。
 * 速度と距離は sampleSeries の値のまま(ログの値と食い違わせない)。計算や描画のラインには使わない。
 */
export function sampleSeriesSmooth(s: LapSeries, tau: number, halfSec = SMOOTH_HALF_SEC): SeriesSample {
  const base = sampleSeries(s, tau);
  if (!(halfSec > 0) || s.duration <= 0) return base;
  const avg = (x: number) => {
    let la = 0, lo = 0, w = 0;
    for (let k = -SMOOTH_TAPS; k <= SMOOTH_TAPS; k++) {
      const p = sampleSeries(s, x + (k * halfSec) / SMOOTH_TAPS);   // 範囲外は端に張り付く
      const wk = SMOOTH_TAPS + 1 - Math.abs(k);
      la += p.lat * wk; lo += p.lon * wk; w += wk;
    }
    return { lat: la / w, lon: lo / w };
  };
  const c = avg(tau);
  // 向きは、なめらかにした位置の前後の差から求める(ほとんど動かないときは、元の向きのまま)
  const a = avg(tau - halfSec / 2), b = avg(tau + halfSec / 2);
  const dy = b.lat - a.lat;
  const dx = (b.lon - a.lon) * Math.cos((c.lat * Math.PI) / 180);
  const heading = Math.hypot(dx, dy) < 1e-9 ? base.heading : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { ...base, lat: c.lat, lon: c.lon, heading };
}

/** 走行距離 d(m)に達する時刻(秒)。範囲外は端。距離は単調増加なので二分探索できる。 */
export function timeAtDistance(s: LapSeries, d: number): number {
  if (d <= 0) return 0;
  if (d >= s.distance) return s.duration;
  let lo = 0, hi = s.dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.dist[mid] >= d) hi = mid; else lo = mid + 1;
  }
  const span = s.dist[lo] - s.dist[lo - 1];
  const f = span > 0 ? (d - s.dist[lo - 1]) / span : 0;
  return s.t[lo - 1] + f * (s.t[lo] - s.t[lo - 1]);
}
