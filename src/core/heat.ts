import type { LapSeries } from './series';

/**
 * 加減速のヒートマップ用の計算。
 * 前後加速度は速度の時間微分で求める。.vbo の速度は 10Hz / 20Hz(間隔も不揃い)で細かく揺れるため、
 * 数サンプルを使った回帰直線の傾きにして、揺れを抑える。
 */

/** 各サンプルの前後加速度(m/s²)。+ 加速、- 減速。 */
export function accelSeries(s: LapSeries, windowSec = 0.6): Float64Array {
  const n = s.t.length;
  const out = new Float64Array(n);
  const half = windowSec / 2;
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (s.t[lo] < s.t[i] - half) lo++;
    while (hi + 1 < n && s.t[hi + 1] <= s.t[i] + half) hi++;
    const k = hi - lo + 1;
    if (k < 3) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1);
      out[i] = (s.speed[j1] - s.speed[j0]) / 3.6 / Math.max(1e-6, s.t[j1] - s.t[j0]);
      continue;
    }
    let tm = 0, vm = 0;
    for (let j = lo; j <= hi; j++) { tm += s.t[j]; vm += s.speed[j]; }
    tm /= k; vm /= k;
    let num = 0, den = 0;
    for (let j = lo; j <= hi; j++) { num += (s.t[j] - tm) * (s.speed[j] - vm); den += (s.t[j] - tm) ** 2; }
    out[i] = den > 0 ? num / den / 3.6 : 0;
  }
  return out;
}

/** |加速度| がこの値(m/s²)未満は「惰性」(色を付けない) */
export const COAST = 0.5;
/** この加速度で最も濃い緑 / 赤 */
export const ACCEL_FULL = 4;
export const BRAKE_FULL = 10;
/** 片側の色の段数 */
export const HEAT_STEPS = 8;

/** 加速度を段階に直す。0 = 惰性、1..8 = 加速(強さ)、-1..-8 = 減速(強さ) */
export function heatLevel(a: number): number {
  if (Math.abs(a) < COAST) return 0;
  const full = a > 0 ? ACCEL_FULL : BRAKE_FULL;
  const f = Math.min(1, (Math.abs(a) - COAST) / (full - COAST));
  const lvl = Math.max(1, Math.ceil(f * HEAT_STEPS));
  return a > 0 ? lvl : -lvl;
}

const NEUTRAL = [208, 214, 222];
const GREEN = [46, 204, 113];
const RED = [255, 59, 48];

export function heatColor(level: number): string {
  const f = Math.min(1, Math.abs(level) / HEAT_STEPS);
  const target = level > 0 ? GREEN : RED;
  const c = NEUTRAL.map((n, i) => Math.round(n + (target[i] - n) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export interface HeatRun { from: number; to: number; level: number }

/** 同じ段階が続くサンプルの範囲(from〜to は点の番号。隣の範囲と端の点を共有する) */
export function heatRuns(accel: Float64Array): HeatRun[] {
  const runs: HeatRun[] = [];
  if (accel.length < 2) return runs;
  let from = 0;
  let level = heatLevel((accel[0] + accel[1]) / 2);
  for (let i = 1; i < accel.length - 1; i++) {
    const l = heatLevel((accel[i] + accel[i + 1]) / 2);
    if (l !== level) { runs.push({ from, to: i, level }); from = i; level = l; }
  }
  runs.push({ from, to: accel.length - 1, level });
  return runs;
}

// ---------- 速度ヒートマップ ----------
/** 速度の色の段数。全車・全ラップで同じ色の並び(低速=紫 → 高速=黄)を使う */
export const SPEED_STEPS = 16;
const SPEED_STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];

/** 速度 v(km/h)を、lo〜hi の範囲で 0..SPEED_STEPS-1 の段階にする */
export function speedLevel(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  const f = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return Math.min(SPEED_STEPS - 1, Math.floor(f * SPEED_STEPS));
}

export function speedColor(level: number): string {
  const f = Math.min(1, Math.max(0, level / (SPEED_STEPS - 1))) * (SPEED_STOPS.length - 1);
  const i = Math.min(SPEED_STOPS.length - 2, Math.floor(f));
  const k = f - i;
  const c = SPEED_STOPS[i].map((a, j) => Math.round(a + (SPEED_STOPS[i + 1][j] - a) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** 速度の段階が続く範囲(heatRuns と同じ形) */
export function speedRuns(s: LapSeries, lo: number, hi: number): HeatRun[] {
  const n = s.speed.length;
  const runs: HeatRun[] = [];
  if (n < 2) return runs;
  const lv = (i: number) => speedLevel((s.speed[i] + s.speed[i + 1]) / 2, lo, hi);
  let from = 0, level = lv(0);
  for (let i = 1; i < n - 1; i++) {
    const l = lv(i);
    if (l !== level) { runs.push({ from, to: i, level }); from = i; level = l; }
  }
  runs.push({ from, to: n - 1, level });
  return runs;
}

/** 複数の走行をまとめた速度の範囲(10km/h 単位に丸める)。全車で同じ色の物差しにするため */
export function speedRange(list: LapSeries[]): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const s of list) for (const v of s.speed) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return { lo: 0, hi: 100 };
  return { lo: Math.floor(lo / 10) * 10, hi: Math.max(Math.ceil(hi / 10) * 10, Math.floor(lo / 10) * 10 + 10) };
}
