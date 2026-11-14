import type { TrackLog } from './types';
import { metersPerDegree } from './geo';

/**
 * 1 周分だけのログ(始点と終点がつながった「輪」)の扱い。
 *
 * 1 周ずつ切り分けて書き出されたログ(他のツールで変換した .vbo など)は、計測ラインがファイルの途中にあると、
 * 通過が 1 回だけになり、完了ラップが取れない。そこで、輪と判断できるログは、読み込み時に
 * 「元のログ + 同じ 1 周を 2 回」をつないだログにしておく(TrackLog.loop)。
 * ラップの検出(detectLaps)は、元のログの中で通過が 1 回以下のときだけ、つないだ部分まで使って 1 周分のラップを作る。
 * Lap は今までどおり「ログの時刻・サンプル番号の区間」なので、あとの処理(グラフ・再生・セクター)はそのまま使える。
 */

/** 始点と終点の距離の上限(m) */
export const LOOP_MAX_GAP_M = 10;
/** 始点と終点の速度の下限(km/h)。ピットで止まった状態で始まって終わるログを除く */
export const LOOP_MIN_SPEED_KMH = 30;
/** 始点と終点の進む向きの差の上限(度) */
export const LOOP_MAX_TURN_DEG = 30;
/** 進む向きを求めるときに使う区間の長さ(m) */
const DIR_SPAN_M = 5;

export interface LoopCheck {
  /** 始点と終点の距離(m) */
  gapM: number;
  /** 終点から始点までの、進む向きに沿った距離(m)。負なら終点が始点を通り越している */
  alongM: number;
  startKmh: number;
  endKmh: number;
  /** 始点と終点の進む向きの差(度) */
  turnDeg: number;
  /** 上の条件をすべて満たすか */
  closed: boolean;
}

/** 始点・終点の様子を調べる。点が少なすぎるときは null */
export function checkLoop(log: TrackLog): LoopCheck | null {
  const n = log.t.length;
  if (n < 10) return null;
  const m = metersPerDegree(log.lat[0]);
  const xy = (i: number) => ({ x: (log.lon[i] - log.lon[0]) * m.lon, y: (log.lat[i] - log.lat[0]) * m.lat });
  const p0 = xy(0), p1 = xy(n - 1);
  // 始点から DIR_SPAN_M 進んだ点、終点の DIR_SPAN_M 手前の点で、進む向きを求める
  let a = 1;
  while (a < n - 1 && Math.hypot(xy(a).x - p0.x, xy(a).y - p0.y) < DIR_SPAN_M) a++;
  let b = n - 2;
  while (b > 0 && Math.hypot(xy(b).x - p1.x, xy(b).y - p1.y) < DIR_SPAN_M) b--;
  const ds = { x: xy(a).x - p0.x, y: xy(a).y - p0.y };
  const de = { x: p1.x - xy(b).x, y: p1.y - xy(b).y };
  const ls = Math.hypot(ds.x, ds.y), le = Math.hypot(de.x, de.y);
  if (ls === 0 || le === 0) return null;
  const cos = (ds.x * de.x + ds.y * de.y) / (ls * le);
  const turnDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  const gap = { x: p0.x - p1.x, y: p0.y - p1.y };
  const gapM = Math.hypot(gap.x, gap.y);
  const alongM = (gap.x * de.x + gap.y * de.y) / le;
  const startKmh = log.speed[0], endKmh = log.speed[n - 1];
  const closed = gapM <= LOOP_MAX_GAP_M && startKmh >= LOOP_MIN_SPEED_KMH && endKmh >= LOOP_MIN_SPEED_KMH
    && turnDeg <= LOOP_MAX_TURN_DEG;
  return { gapM, alongM, startKmh, endKmh, turnDeg, closed };
}

/**
 * 輪と判断できるログなら、元のログのあとに同じ 1 周(2 点目から)を 2 回つないだログを返す。そうでなければそのまま返す。
 * 2 回つなぐのは、計測ラインがつなぎ目(元のログの終点と始点のあいだ)にあるとき(1 周分のログの始点と終点から
 * 計算した計測ラインなど)、1 回目のつなぎ目の通過から 2 回目のつなぎ目の通過までを 1 周にするため。
 * つなぎ目の時間は、終点から始点までの距離を、その速度で進む時間とする(1 周のタイム = 記録時間 + その時間)。
 */
export function closeLoop(log: TrackLog): TrackLog {
  if (log.loop || log.gaps?.length) return log;      // 途中を取り込まなかったログ(案件 59)は、つながった 1 周ではない
  const c = checkLoop(log);
  if (!c?.closed) return log;
  const n = log.t.length;
  const v = ((c.startKmh + c.endKmh) / 2) / 3.6;
  // つなぎ目: 終点 → 始点(=1 周後の 0 点目)にかかる時間。時刻が戻らないよう、下限を設ける
  const seam = Math.max(c.alongM / v, -(log.t[1] - log.t[0]) / 2);
  const period = log.t[n - 1] - log.t[0] + seam;
  const len = 3 * n - 2;
  const ext = (a: Float64Array, shift = 0): Float64Array => {
    const out = new Float64Array(len);
    out.set(a);
    for (let k = 1; k <= 2; k++) for (let i = 1; i < n; i++) out[k * (n - 1) + i] = a[i] + k * shift;
    return out;
  };
  const opt = (a: Float64Array | undefined) => (a ? ext(a) : undefined);
  return {
    ...log,
    t: ext(log.t, period), lat: ext(log.lat), lon: ext(log.lon), speed: ext(log.speed),
    heading: opt(log.heading), height: opt(log.height), longAcc: opt(log.longAcc), latAcc: opt(log.latAcc),
    loop: { n, period },
  };
}
