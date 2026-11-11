import { detectLaps } from './laps';
import { type GeoLine, type Offset, metersPerDegree } from './geo';
import type { TrackLog } from './types';

/**
 * 読み込みの確認画面のプレビューに描く走行ライン(案件 3)。offset はそのログの位置補正量(m)。
 */

/** 計測ラインの中心から radiusM 以内の走行ライン(とぎれごとに別の線。最大 maxRuns 本・1 本 maxPts 点まで間引く) */
export function trackNear(log: TrackLog, offset: Offset, center: { lat: number; lon: number }, radiusM = 400, maxRuns = 6, maxPts = 400): [number, number][][] {
  const m = metersPerDegree(center.lat);
  const dLat = radiusM / m.lat, dLon = radiusM / m.lon;
  const n = log.loop?.n ?? log.t.length;
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  const { lat, lon } = log;
  const off = { lat: offset.north / m.lat, lon: offset.east / m.lon };
  for (let i = 0; i < n && runs.length < maxRuns; i++) {
    const y = lat[i] + off.lat, x = lon[i] + off.lon;
    if (Math.abs(y - center.lat) <= dLat && Math.abs(x - center.lon) <= dLon) cur.push([y, x]);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length && runs.length < maxRuns) runs.push(cur);
  return runs.map((r) => (r.length <= maxPts ? r : r.filter((_, k) => k % Math.ceil(r.length / maxPts) === 0)));
}

/** プレビューの「セクター」で描く走行ライン: 線 line で区切った最初の完了ラップ(無ければログ全体)を、maxPts 点まで間引く */
export function lapTrack(log: TrackLog, offset: Offset, line: GeoLine, maxPts = 1500): [number, number][] {
  const lap = detectLaps(log, line, [], { offset, partial: 'never' }).find((x) => x.complete);
  const from = lap?.startIndex ?? 0, to = lap?.endIndex ?? (log.loop?.n ?? log.t.length) - 1;
  const m = metersPerDegree(log.lat[from]);
  const off = { lat: offset.north / m.lat, lon: offset.east / m.lon };
  const step = Math.max(1, Math.ceil((to - from + 1) / maxPts));
  const pts: [number, number][] = [];
  for (let i = from; i <= to; i += step) pts.push([log.lat[i] + off.lat, log.lon[i] + off.lon]);
  return pts;
}
