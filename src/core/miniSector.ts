import type { Lap } from './types';
import { type LapSeries, sampleSeries, timeAtDistance } from './series';

/**
 * ミニセクター: 1 つのセクターを、走行距離で等しく n 個に分けた区間。
 * 区間ごとの平均速度(km/h)= 区間の距離 ÷ 区間の時間。計算のたびに 1 ラップの時系列から求める(保存しない)。
 */

/** 1 セクターを分ける数(5 等分) */
export const MINI_COUNT = 5;

/**
 * セクター k の区間(ラップ開始からの秒)。
 * セクター k は k 番目のラインの通過から、次のラインの通過まで。最後のセクターはラップの終わりまで。
 * 通過が欠けている、または長さが 0 以下なら null。
 */
export function sectorRange(lap: Lap, k: number): { a: number; b: number } | null {
  const st = lap.sectorTimes;
  const a = st[k];
  if (a === null || a === undefined) return null;
  const b = k < st.length - 1 ? st[k + 1] : lap.duration;
  if (b === null || b === undefined || !(b > a)) return null;
  return { a, b };
}

/**
 * 区間 j(0〜n)の時間の範囲(ラップ開始からの秒)。ラインが n 本のとき、区間は n+1 個(案件 84)。
 * 区間 0 はスタートから最初のラインまで、区間 j はライン j から次のラインまで、区間 n は最後のラインからエンド(ラップの終わり)まで。
 * ラインが 0 本のときは、区間 0 が 1 周全体。通過が欠けている、または長さが 0 以下なら null。
 */
export function segmentRange(lap: Lap, j: number, n: number): { a: number; b: number } | null {
  const a = j === 0 ? 0 : lap.sectorTimes[j - 1];
  const b = j < n ? lap.sectorTimes[j] : lap.duration;
  if (a === null || a === undefined || b === null || b === undefined || !(b > a)) return null;
  return { a, b };
}

/**
 * 時間の区間 [a, b](ラップ開始からの秒)を、走行距離で n 等分したときの、区間ごとの平均速度(km/h)。
 * 区間の時間が 0 のとき(止まっている・サンプルが無い)は null。
 */
export function miniSpeeds(s: LapSeries, a: number, b: number, n = MINI_COUNT): (number | null)[] {
  const da = sampleSeries(s, a).dist;
  const db = sampleSeries(s, b).dist;
  const cuts: { d: number; t: number }[] = [];
  for (let j = 0; j <= n; j++) {
    const d = da + ((db - da) * j) / n;
    cuts.push({ d, t: timeAtDistance(s, d) });
  }
  const out: (number | null)[] = [];
  for (let j = 0; j < n; j++) {
    const dt = cuts[j + 1].t - cuts[j].t;
    const dd = cuts[j + 1].d - cuts[j].d;
    out.push(dt > 0 ? (dd / dt) * 3.6 : null);
  }
  return out;
}

/**
 * 時刻 t(ラップ開始からの秒)が、時間の区間 [a, b] を距離で n 等分した、何番目の区間にあるか(0 始まり)。
 * 区間の外(まだ入っていない・もう過ぎた)は -1。b ちょうどは最後の区間。
 */
export function miniIndexAt(s: LapSeries, a: number, b: number, t: number, n = MINI_COUNT): number {
  if (t < a || t > b) return -1;
  const da = sampleSeries(s, a).dist;
  const db = sampleSeries(s, b).dist;
  if (!(db > da)) return 0;
  const f = (sampleSeries(s, t).dist - da) / (db - da);
  return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
}

/** 完了ラップ(ゴールまで通ったもの)のうち、ラップタイムが最も速いもの。無ければ null */
export function fastestLap(laps: Lap[]): Lap | null {
  let best: Lap | null = null;
  for (const l of laps) {
    if (!l.complete) continue;
    if (best === null || l.duration < best.duration) best = l;
  }
  return best;
}

/**
 * 色分けの種類。
 * - 'pb': 自己ベスト(同じ走行データの最速ラップ)のその区間より速い → 紫(案件 6)
 * - 'faster': 基準の車のその区間より速い → 緑
 * - 'slower': 基準の車のその区間より遅い → 黄
 * - 'none': 比べられない(基準の値が無い、区間が無い)
 */
export type MiniTone = 'pb' | 'faster' | 'slower' | 'none';

/**
 * 1 つの区間の速度を、基準の車と自己ベストの区間の速度と比べて色分けの種類を決める。
 * 自己ベストより速ければ紫を優先する(緑・黄より上)。
 */
export function miniTone(v: number | null, ref: number | null, pb: number | null): MiniTone {
  if (v === null) return 'none';
  if (pb !== null && v > pb) return 'pb';
  if (ref === null) return 'none';
  return v >= ref ? 'faster' : 'slower';
}

/**
 * セクターの通過時刻(ラップ開始からの秒、ラインの順)が、通った順になっているか。
 * 順番がずれていると、隣り合うセクターの区間が成り立たない(案件 83)。通過の無い所(null)は比べない。
 */
export function isInPassOrder(times: (number | null)[]): boolean {
  let prev: number | null = null;
  for (const t of times) {
    if (t === null) continue;
    if (prev !== null && t < prev) return false;
    prev = t;
  }
  return true;
}
