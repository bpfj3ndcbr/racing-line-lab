import type { TimingLine, TrackLog } from './types';
import { type GeoLine, type LatLon, metersPerDegree } from './geo';
import { detectLapRun, findCrossings } from './laps';
import { roundLine } from './lines';

/**
 * 計測ラインの候補(案件 3)。走行ログの内容から、計測ラインとセクターの「候補」を作る。
 * 候補は、利用者が登録画面で位置を確かめてから登録する(そのままでは使わない)。
 *
 * - 'laptiming': RaceChrono の [laptiming]。Start が計測ライン、Split がセクター
 * - 'loop': 1 周分だけのログ(輪)。始点と終点から計測ラインだけを計算する
 */
export interface LineCandidate {
  source: 'laptiming' | 'loop';
  /** サーキット名の初期値([session data] の name。無ければ空) */
  name: string;
  control: GeoLine;
  /** コース上で通る順(S1, S2, …)。通らないものは最後に、ファイルの順で */
  sectors: GeoLine[];
}

/** 候補の線の長さ(m) */
export const CANDIDATE_LINE_M = 36.8;
/** 輪のログで、始点と終点を結んだ線をそのまま計測ラインの向きにする、2 点の距離の下限(m) */
export const LOOP_JOIN_MIN_M = 5;
/** 輪のログで、進む向きを求める区間の長さ(m) */
export const LOOP_DIR_SPAN_M = 200;

interface XY { x: number; y: number }

/** 点 c を中心に、進む向き dir(東・北の成分)に直交する長さ len の線。a = 進む向きの左、b = 右 */
export function perpendicularLine(c: LatLon, dir: XY, len = CANDIDATE_LINE_M): GeoLine {
  const d = Math.hypot(dir.x, dir.y);
  const m = metersPerDegree(c.lat);
  const lx = -dir.y / d, ly = dir.x / d;            // 左 = 進む向きを反時計回りに 90°
  const h = len / 2;
  return {
    a: { lat: c.lat + (ly * h) / m.lat, lon: c.lon + (lx * h) / m.lon },
    b: { lat: c.lat - (ly * h) / m.lat, lon: c.lon - (lx * h) / m.lon },
  };
}

/** [laptiming] の 1 行から線を作る: p1 を通り、p2 → p1 の向きに直交する */
export function lineFromTiming(tl: TimingLine, len = CANDIDATE_LINE_M): GeoLine {
  const m = metersPerDegree(tl.p1.lat);
  const dir = { x: (tl.p1.lon - tl.p2.lon) * m.lon, y: (tl.p1.lat - tl.p2.lat) * m.lat };
  return perpendicularLine(tl.p1, dir, len);
}

/**
 * 1 周分だけのログ(輪)の計測ライン。中心は始点と終点の中間。
 * 向き: 2 点が LOOP_JOIN_MIN_M 以上離れていれば、2 点を結んだ線をそのまま使う(どちらも元の計測線の上の点のため)。
 * 近ければ、始点のあと・終点の前の約 LOOP_DIR_SPAN_M の進む向きの平均に直交させる。
 * log.loop(closeLoop でつないだログ)が無ければ null。
 */
export function loopControlLine(log: TrackLog, len = CANDIDATE_LINE_M): GeoLine | null {
  const n = log.loop?.n;
  if (!n || n < 3) return null;
  const m = metersPerDegree(log.lat[0]);
  const xy = (i: number): XY => ({ x: (log.lon[i] - log.lon[0]) * m.lon, y: (log.lat[i] - log.lat[0]) * m.lat });
  const s = xy(0), e = xy(n - 1);
  const c = { lat: (log.lat[0] + log.lat[n - 1]) / 2, lon: (log.lon[0] + log.lon[n - 1]) / 2 };
  // 始点のあと LOOP_DIR_SPAN_M 進んだ点 / 終点の LOOP_DIR_SPAN_M 手前の点(道のりで数える)
  let i = 0, dist = 0;
  while (i < n - 1 && dist < LOOP_DIR_SPAN_M) { const p = xy(i), q = xy(i + 1); dist += Math.hypot(q.x - p.x, q.y - p.y); i++; }
  let j = n - 1; dist = 0;
  while (j > 0 && dist < LOOP_DIR_SPAN_M) { const p = xy(j), q = xy(j - 1); dist += Math.hypot(q.x - p.x, q.y - p.y); j--; }
  const unit = (v: XY): XY => { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; };
  const after = unit({ x: xy(i).x - s.x, y: xy(i).y - s.y });
  const before = unit({ x: e.x - xy(j).x, y: e.y - xy(j).y });
  const travel = unit({ x: after.x + before.x, y: after.y + before.y });
  const gap = { x: s.x - e.x, y: s.y - e.y };
  if (Math.hypot(gap.x, gap.y) >= LOOP_JOIN_MIN_M) {
    // 2 点を結んだ線の向き(= 計測線の向き)。進む向きは、その線に直交する 2 方向のうち、実際の進む向きに近い方
    let dir = { x: gap.y, y: -gap.x };
    if (dir.x * travel.x + dir.y * travel.y < 0) dir = { x: -dir.x, y: -dir.y };
    return perpendicularLine(c, dir, len);
  }
  return perpendicularLine(c, travel, len);
}

/**
 * 各セクターを、計測ラインから始まる最初の完了ラップの中で通る時刻(通らなければ Infinity)。
 * 完了ラップが無ければ null
 */
export function sectorPassTimes(log: TrackLog, control: GeoLine, sectors: GeoLine[]): number[] | null {
  const lap = detectLapRun(log, control, [], { partial: 'never' }).laps.find((l) => l.complete);
  if (!lap) return null;
  return sectors.map((line) => findCrossings(log, line).find((c) => c.time >= lap.startTime - 1 && c.time < lap.endTime)?.time ?? Infinity);
}

/** セクターを、計測ラインから始まる最初の完了ラップの中で通る順に並べる。通らないものは最後に(元の順) */
export function orderSectors<T extends GeoLine>(log: TrackLog, control: GeoLine, sectors: T[]): T[] {
  const times = sectorPassTimes(log, control, sectors);
  if (!times) return sectors;
  return sectors.map((line, k) => ({ line, k, t: times[k] })).sort((p, q) => p.t - q.t || p.k - q.k).map((x) => x.line);
}

/** 走行ログから候補を作る。[laptiming] を優先し、無ければ輪のログから計算する。どちらも無ければ null */
export function lineCandidate(log: TrackLog): LineCandidate | null {
  const start = log.laptiming?.find((l) => l.kind === 'start');
  if (start) {
    const control = roundLine(lineFromTiming(start));
    const splits = (log.laptiming ?? []).filter((l) => l.kind === 'split').map((l) => roundLine(lineFromTiming(l)));
    return { source: 'laptiming', name: log.sessionName ?? '', control, sectors: orderSectors(log, control, splits) };
  }
  const loop = loopControlLine(log);
  if (loop) return { source: 'loop', name: log.sessionName ?? '', control: roundLine(loop), sectors: [] };
  return null;
}
