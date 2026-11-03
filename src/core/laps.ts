import type { Lap, TrackLog } from './types';
import { type GeoLine, type Offset, segIntersect, shiftLine } from './geo';

export interface Crossing {
  /** 通過時刻(秒、サンプル間を線形補間) */
  time: number;
  /** 通過直前のサンプル番号 */
  index: number;
  dir: 1 | -1;
}

export interface CrossingOptions {
  /** 位置補正量。ログ側ではなくライン側を逆方向にずらして判定する(等価) */
  offset?: Offset;
  /** この速度(km/h)未満での通過は無視(停止中の GPS ゆらぎ対策) */
  minSpeedKmh?: number;
}

/** ライン通過を全て探す。向きが多数派でない通過は除く。 */
export function findCrossings(log: TrackLog, line: GeoLine, opts: CrossingOptions = {}): Crossing[] {
  const L = opts.offset ? shiftLine(line, -opts.offset.east, -opts.offset.north) : line;
  const minSp = opts.minSpeedKmh ?? 5;
  const pad = 0.0005;
  const minLat = Math.min(L.a.lat, L.b.lat) - pad, maxLat = Math.max(L.a.lat, L.b.lat) + pad;
  const minLon = Math.min(L.a.lon, L.b.lon) - pad, maxLon = Math.max(L.a.lon, L.b.lon) + pad;
  const { lat, lon, t, speed } = log;
  const all: Crossing[] = [];

  for (let k = 0; k < lat.length - 1; k++) {
    const y0 = lat[k], y1 = lat[k + 1], x0 = lon[k], x1 = lon[k + 1];
    if ((y0 > maxLat && y1 > maxLat) || (y0 < minLat && y1 < minLat)) continue;
    if ((x0 > maxLon && x1 > maxLon) || (x0 < minLon && x1 < minLon)) continue;
    const hit = segIntersect(x0, y0, x1, y1, L.a.lon, L.a.lat, L.b.lon, L.b.lat);
    if (!hit) continue;
    const sp = speed[k] + hit.t * (speed[k + 1] - speed[k]);
    if (sp < minSp) continue;
    all.push({ time: t[k] + hit.t * (t[k + 1] - t[k]), index: k, dir: hit.dir });
  }

  const plus = all.filter((c) => c.dir === 1).length;
  const keep: 1 | -1 = plus >= all.length - plus ? 1 : -1;
  return all.filter((c) => c.dir === keep);
}

export interface LapOptions extends CrossingOptions {
  /**
   * 通過で区切れない端の区間(ログ先頭〜最初の通過、最後の通過〜ログ末尾)の扱い。
   * 'auto'(既定): 完了ラップが1つも無いときだけ、最後の通過〜末尾を参考ラップとして1つ作る
   */
  partial?: 'auto' | 'never';
}

/** 時刻 time 以前の最後のサンプル番号 */
export function indexAt(t: Float64Array, time: number): number {
  let lo = 0, hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= time) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function detectLaps(
  log: TrackLog,
  control: GeoLine,
  sectors: GeoLine[] = [],
  opts: LapOptions = {},
): Lap[] {
  const cross = findCrossings(log, control, opts);
  const end = log.t[log.t.length - 1];
  const laps: Lap[] = [];

  for (let i = 0; i + 1 < cross.length; i++) {
    laps.push(makeLap(log, i + 1, cross[i].time, cross[i + 1].time, true));
  }
  if (laps.length === 0 && (opts.partial ?? 'auto') === 'auto') {
    const start = cross.length ? cross[cross.length - 1].time : 0;
    if (end - start > 1) laps.push(makeLap(log, 1, start, end, false));
  }

  const sectorCross = sectors.map((s) => findCrossings(log, s, opts));
  for (const lap of laps) lap.sectorTimes = computeSectorTimes(lap, sectorCross);
  return laps;
}

function makeLap(log: TrackLog, number: number, startTime: number, endTime: number, complete: boolean): Lap {
  return {
    number, startTime, endTime, duration: endTime - startTime, complete,
    startIndex: indexAt(log.t, startTime), endIndex: indexAt(log.t, endTime),
    sectorTimes: [],
  };
}

/**
 * 各セクターラインの通過時刻(ラップ開始からの秒)。
 * 前のセクターより後の最初の通過を採用する。S1 がコントロールライン付近にある場合に備え、
 * ラップ開始の 1 秒前までは許容する。
 */
export function computeSectorTimes(lap: Lap, perLine: Crossing[][]): (number | null)[] {
  const out: (number | null)[] = [];
  let after = lap.startTime - 1;
  for (const list of perLine) {
    const hit = list.find((c) => c.time >= after && c.time < lap.endTime);
    if (hit) { out.push(hit.time - lap.startTime); after = hit.time; }
    else out.push(null);
  }
  return out;
}

/** 秒 → "2:26.5" */
export function formatLapTime(sec: number): string {
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
