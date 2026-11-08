import { metersPerDegree } from './geo';
import type { LapSeries } from './series';

/**
 * 距離の横軸を、コース上の位置でそろえる(案件 20)。
 *
 * 走行距離(`LapSeries.dist`)は速度 × 時間の積み上げなので、走行ラインや速度の記録の誤差で、
 * 同じ距離でもコース上の位置が車ごとにずれる(ラップの後半ほど大きい)。
 * そこで、物差しにする 1 台の走行ラインを決め、ほかの車の各点を、物差しのラインで最も近い位置に置き換えて、
 * その位置での物差しの走行距離を、その車の距離とする。コース上の同じ断面にいれば、同じ距離になる。
 */

/** 前の点の位置より手前を探す幅(m)。GPS のゆらぎの分 */
export const ALIGN_BACK_M = 10;
/** 前の点の位置から先を探す幅(m)。これに、その点までの自分の走行距離の 2 倍を足す(記録の間隔に左右されないように) */
export const ALIGN_AHEAD_M = 50;
/** 最初の点を探す範囲(m)。ラップは計測ラインから始まるので、物差しの始めの部分だけを探す(終わりの部分に当たらないように) */
export const ALIGN_START_M = 300;
/** 物差しのラインからこれより離れた点(ピットロードなど)は投影しない(距離は、ラインに戻るまで進めない) */
export const ALIGN_MAX_OFF_M = 30;

/** 記録の間隔(秒)の中央値 */
export function sampleInterval(s: LapSeries): number {
  const d: number[] = [];
  for (let i = 1; i < s.t.length; i++) d.push(s.t[i] - s.t[i - 1]);
  if (!d.length) return Infinity;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/**
 * 物差しにする車を選ぶ: 記録の間隔がいちばん細かい車(1Hz のログより 10Hz・20Hz を使う)。
 * 1 周を走り切ったラップ(complete)を優先し、同じなら先の車(基準車)。
 */
export function pickRuler(items: { series: LapSeries; complete: boolean }[]): number {
  let best = -1, bestDt = Infinity, bestComplete = false;
  items.forEach((it, i) => {
    const dt = sampleInterval(it.series);
    const better = best < 0
      || (it.complete && !bestComplete)
      || (it.complete === bestComplete && dt < bestDt * 0.9);   // ほぼ同じ間隔なら、先の車のまま
    if (better) { best = i; bestDt = dt; bestComplete = it.complete; }
  });
  return best;
}

/**
 * 走行 s の各点を、物差し ruler のラインに投影した距離(物差しの走行距離、m)。単調に増える。
 * どちらも 1 周を走り切ったラップなら、最後の点は物差しの 1 周の距離にそろえる(どちらも計測ラインで終わるため)。
 */
export function projectDistances(ruler: LapSeries, s: LapSeries, bothComplete = true): Float64Array {
  const n = s.t.length, rn = ruler.t.length;
  const out = new Float64Array(n);
  if (!n || rn < 2) return Float64Array.from(s.dist);
  const m = metersPerDegree(ruler.lat[0]);
  const lat0 = ruler.lat[0], lon0 = ruler.lon[0];
  const rx = Float64Array.from(ruler.lon, (v) => (v - lon0) * m.lon);
  const ry = Float64Array.from(ruler.lat, (v) => (v - lat0) * m.lat);
  const rd = ruler.dist, total = ruler.distance;
  /** 物差しの距離 d を含む区間の番号(rd[j] <= d < rd[j+1]) */
  const segAt = (d: number) => {
    let lo = 0, hi = rn - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rd[mid] <= d) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  // prev: 直前に決めた距離。acc: 最後にラインの近くで位置が決まってから、自分が走った距離。
  // ラインから離れている間(ピットロードなど)は、距離を進めずに待ち、ラインに戻ったところで、走った分の範囲から探し直す
  let prev = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    acc += i ? Math.max(0, s.dist[i] - s.dist[i - 1]) : 0;
    const lo = i ? prev - ALIGN_BACK_M : 0;
    const hi = Math.max(i ? 0 : ALIGN_START_M, prev + acc * 2 + ALIGN_AHEAD_M);
    const px = (s.lon[i] - lon0) * m.lon, py = (s.lat[i] - lat0) * m.lat;
    let bestD2 = Infinity, bestDist = prev;
    for (let j = segAt(Math.max(0, lo)), last = segAt(Math.min(total, hi)); j <= last; j++) {
      const ax = rx[j], ay = ry[j], bx = rx[j + 1] - ax, by = ry[j + 1] - ay;
      const len2 = bx * bx + by * by;
      const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * bx + (py - ay) * by) / len2)) : 0;
      const dx = px - (ax + u * bx), dy = py - (ay + u * by);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestDist = rd[j] + u * (rd[j + 1] - rd[j]); }
    }
    if (bestD2 <= ALIGN_MAX_OFF_M * ALIGN_MAX_OFF_M) {
      prev = Math.min(total, Math.max(prev, bestDist));
      acc = 0;
    }
    out[i] = prev;
  }
  if (bothComplete) out[n - 1] = total;
  return out;
}

/** 走行 s の距離を、物差しに投影した距離に置き換えたもの(座標・速度・時刻はそのまま) */
export function alignedSeries(ruler: LapSeries, s: LapSeries, bothComplete = true): LapSeries {
  if (ruler === s) return s;
  const dist = projectDistances(ruler, s, bothComplete);
  return { ...s, dist, distance: dist[dist.length - 1] };
}
