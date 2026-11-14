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
  const gaps = log.gaps?.length ? new Set(log.gaps) : null;   // 取り込まなかった区間をまたぐつなぎ目(案件 59)

  for (let k = 0; k < lat.length - 1; k++) {
    if (gaps?.has(k + 1)) continue;
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
   * 'auto'(既定): 最後の通過〜末尾を、終点無しのラップ(参考値)として作る。完了ラップがあるときは、走行中の時間が
   * EDGE_MIN_MOVING_SEC 以上のときだけ作る。完了ラップが 1 つも無く、通過も無いときは、ログ全体を参考値のラップにする
   */
  partial?: 'auto' | 'never';
  /** ラップ番号 → 終端(ラップ開始からの秒)。利用者が「終端の調整」で決めた値 */
  ends?: Record<number, number>;
}

/** 端の区間を出す下限(走行中の秒)。RaceChrono のラップ書き出しの前後に付く数秒を除く */
export const EDGE_MIN_MOVING_SEC = 30;
/** 端の区間で「走行中」とみなす速度(km/h) */
export const EDGE_MOVING_KMH = 30;
/** 終点無しのラップを自動で切る「止まった」状態: この速度(km/h)未満が */
export const STOP_KMH = 5;
/** この秒数以上続いたら、止まり始めた時点で切る */
export const STOP_SEC = 30;
/** 終点無しのラップの終端を、調整で延ばせる上限(秒) */
export const TAIL_MAX_SEC = 30 * 60;

export interface LapRun {
  laps: Lap[];
  /** 最初の通過より前に、走行中の区間がある(一覧に「始点が無いので非表示」と出す) */
  hasHead: boolean;
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
  return detectLapRun(log, control, sectors, opts).laps;
}

/** ラップと、最初の通過より前の走行の有無 */
export function detectLapRun(
  log: TrackLog,
  control: GeoLine,
  sectors: GeoLine[] = [],
  opts: LapOptions = {},
): LapRun {
  const all = findCrossings(log, control, opts);
  // 輪をつないだログ(closeLoop)では、0〜n-1 番が元のログ。ふだんは元のログの中だけでラップを作る(今までと同じ結果)
  const n = log.loop?.n ?? log.t.length;
  const cross = all.filter((c) => c.index < n - 1);
  const end = log.t[n - 1];
  const laps: Lap[] = [];
  let hasHead = false;

  // 元のログでは完了ラップが取れない(通過が 1 回以下)とき、つないだ部分まで使って、最初の通過から次の通過までを
  // 1 周分のラップにする(1 つだけ)。計測ラインが始点やつなぎ目に重なっていても、同じ場所の通過を 2 回数えない
  const first = log.loop && cross.length <= 1 ? all[0] : undefined;
  if (first) {
    const next = all.find((c) => c.index > first.index);
    if (next) laps.push(makeLap(log, 1, first.time, next.time, true));
  } else {
    for (let i = 0; i + 1 < cross.length; i++) {
      laps.push(makeLap(log, i + 1, cross[i].time, cross[i + 1].time, true));
    }
    if ((opts.partial ?? 'auto') === 'auto') {
      const last = cross[cross.length - 1];
      if (!last) {
        if (end - log.t[0] > 1) laps.push(makeLap(log, 1, log.t[0], end, false));        // 通過が無い: 全体を参考値に
      } else if (laps.length === 0 || movingSec(log, last.index + 1, n - 1) >= EDGE_MIN_MOVING_SEC) {
        // 最後の通過〜: 最初に止まった時点(無ければ記録の終わり)まで
        const stop = firstStop(log, last.index + 1, n - 1) ?? end;
        if (stop - last.time > 1) {
          const lap = makeLap(log, laps.length + 1, last.time, stop, false);
          lap.maxDuration = Math.max(lap.duration, Math.min(TAIL_MAX_SEC, end - last.time));
          laps.push(lap);
        }
      }
      if (laps.some((l) => l.complete) && cross.length) hasHead = movingSec(log, 0, cross[0].index) >= EDGE_MIN_MOVING_SEC;
    }
  }

  for (const lap of laps) {
    const want = opts.ends?.[lap.number];
    if (want !== undefined) adjustEnd(log, lap, want);
  }
  const sectorCross = sectors.map((s) => findCrossings(log, s, opts));
  for (const lap of laps) lap.sectorTimes = computeSectorTimes(lap, sectorCross);
  return { laps, hasHead };
}

/** 終端をラップ開始から sec 秒にする。本来の終点より前なら参考値になる(本来の終点を指したときは、そのまま) */
function adjustEnd(log: TrackLog, lap: Lap, sec: number) {
  const d = Math.max(1, Math.min(sec, lap.maxDuration));
  if (lap.complete && d >= lap.baseDuration - 0.5) return;                    // 秒に丸めた値で、本来の終点を指したとき
  lap.endTime = lap.startTime + d;
  lap.duration = d;
  lap.endIndex = indexAt(log.t, lap.endTime);
  lap.complete = false;
}

/** i0〜i1 番の区間で、走行中(EDGE_MOVING_KMH 以上)だった秒数 */
function movingSec(log: TrackLog, i0: number, i1: number): number {
  let s = 0;
  for (let i = Math.max(0, i0); i < i1; i++) if (log.speed[i] >= EDGE_MOVING_KMH) s += log.t[i + 1] - log.t[i];
  return s;
}

/** i0〜i1 番の区間で、STOP_KMH 未満が STOP_SEC 以上続いた最初の区間の、止まり始めた時刻。無ければ null */
function firstStop(log: TrackLog, i0: number, i1: number): number | null {
  let from = -1;
  for (let i = Math.max(0, i0); i <= i1; i++) {
    if (log.speed[i] < STOP_KMH) {
      if (from < 0) from = i;
      if (log.t[i] - log.t[from] >= STOP_SEC) return log.t[from];
    } else from = -1;
  }
  return null;
}

function makeLap(log: TrackLog, number: number, startTime: number, endTime: number, complete: boolean): Lap {
  const duration = endTime - startTime;
  return {
    number, startTime, endTime, duration, complete,
    startIndex: indexAt(log.t, startTime), endIndex: indexAt(log.t, endTime),
    sectorTimes: [], baseDuration: duration, maxDuration: duration,
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
