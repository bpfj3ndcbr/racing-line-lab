import type { TrackLog } from './types';

/**
 * 走行ログの取り込み範囲(案件 59)。読み込むときに、止まっている時間が長い区間などを取り込まないようにする。
 * - 区間は、元のログ(解析した直後)の時刻(先頭 = 0 の秒)で表す。ファイルごとに保存し、読み込むたびに当てはめる
 * - 取り込んだログは、残した先頭を 0 に置き直し、そのぶん startEpochMs をずらす(表示する時刻は変わらない)
 * - 消した区間をまたぐサンプルのつなぎ目は TrackLog.gaps に覚え、計測ラインの通過には数えない
 * - 走っている部分は値を丸めたり間引いたりしない(計測ラインを変えても、ラップを作り直せるように)
 */

/** 取り込まない区間(元のログの先頭からの秒。from〜to を含む) */
export interface TrimCut { from: number; to: number }
/** 停止の候補。head = ログの先頭側、tail = 末尾側、middle = 途中 */
export interface StopCandidate extends TrimCut { kind: 'head' | 'tail' | 'middle' }

/** 候補にする停止の長さ(秒)の下限 */
export const STOP_MIN_SEC = 300;
/** 停止の前後に残す秒 */
export const STOP_MARGIN_SEC = 30;
/** この速度(km/h)を超えていれば走っている */
export const STOP_MOVING_KMH = 3;
/** 候補の間に残す秒の下限(区間どうしが近づきすぎないように) */
export const CUT_MIN_KEEP_SEC = 30;
/** 区間の長さの下限(秒) */
export const CUT_MIN_SEC = 30;
/** 区間を 2 つに分けるときに、間に残す秒 */
export const SPLIT_KEEP_SEC = 60;

/**
 * 止まっている時間が長い区間を、取り込まない区間の候補として返す(時刻の順)。
 * 先頭側(最初に走り出すまで)と末尾側(最後に止まってから)は、CUT_MIN_SEC 以上あれば候補にする。
 * 途中は STOP_MIN_SEC 以上の停止を候補にする。どれも、走っている部分の前後 STOP_MARGIN_SEC は残す。
 * 一度も走っていないログでは、候補を出さない
 */
export function stopCandidates(log: TrackLog): StopCandidate[] {
  const { t, speed } = log;
  const n = t.length;
  const moving = (i: number) => speed[i] > STOP_MOVING_KMH;
  let first = -1, last = -1;
  for (let i = 0; i < n; i++) if (moving(i)) { if (first < 0) first = i; last = i; }
  if (first < 0) return [];
  const T = t[n - 1], out: StopCandidate[] = [];
  const head = t[first] - STOP_MARGIN_SEC;
  if (head >= CUT_MIN_SEC) out.push({ kind: 'head', from: 0, to: head });
  let s = -1;
  for (let i = first; i <= last; i++) {
    if (!moving(i)) { if (s < 0) s = i; continue; }
    if (s >= 0 && t[i - 1] - t[s] >= STOP_MIN_SEC) out.push({ kind: 'middle', from: t[s] + STOP_MARGIN_SEC, to: t[i - 1] - STOP_MARGIN_SEC });
    s = -1;
  }
  const tail = t[last] + STOP_MARGIN_SEC;
  if (T - tail >= CUT_MIN_SEC) out.push({ kind: 'tail', from: tail, to: T });
  return out;
}

/** 区間を時刻の順に並べ、ログの範囲に収め、重なるものはまとめる(長さが 0 以下のものは除く) */
export function normalizeCuts(cuts: readonly TrimCut[], duration: number): TrimCut[] {
  const list = cuts
    .map((c) => ({ from: Math.max(0, Math.min(c.from, c.to)), to: Math.min(duration, Math.max(c.from, c.to)) }))
    .filter((c) => Number.isFinite(c.from) && Number.isFinite(c.to) && c.to > c.from)
    .sort((a, b) => a.from - b.from);
  const out: TrimCut[] = [];
  for (const c of list) {
    const p = out[out.length - 1];
    if (p && c.from <= p.to) p.to = Math.max(p.to, c.to); else out.push({ ...c });
  }
  return out;
}

/**
 * 区間を取り込まないログを返す(元のログは変えない)。区間が無ければ、元のログをそのまま返す。
 * 残るサンプルが 2 つ未満になるときはエラー
 */
export function applyCuts(log: TrackLog, cuts: readonly TrimCut[]): TrackLog {
  const n = log.t.length;
  const list = normalizeCuts(cuts, log.t[n - 1]);
  if (!list.length) return log;
  const keep: number[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const ti = log.t[i];
    while (c < list.length && list[c].to < ti) c++;
    if (c < list.length && ti >= list[c].from && ti <= list[c].to) continue;
    keep.push(i);
  }
  if (keep.length === n) return log;
  if (keep.length < 2) throw new Error('取り込む範囲にデータがありません');
  const pick = (a: Float64Array) => Float64Array.from(keep, (i) => a[i]);
  const opt = (a: Float64Array | undefined) => (a ? pick(a) : undefined);
  const t0 = log.t[keep[0]];
  const gaps: number[] = [];
  for (let j = 1; j < keep.length; j++) if (keep[j] !== keep[j - 1] + 1) gaps.push(j);
  const out: TrackLog = {
    ...log,
    startEpochMs: log.startEpochMs === null ? null : log.startEpochMs + t0 * 1000,
    t: Float64Array.from(keep, (i) => log.t[i] - t0), lat: pick(log.lat), lon: pick(log.lon), speed: pick(log.speed),
    heading: opt(log.heading), height: opt(log.height), longAcc: opt(log.longAcc), latAcc: opt(log.latAcc),
  };
  for (const k of ['heading', 'height', 'longAcc', 'latAcc'] as const) if (!out[k]) delete out[k];
  if (gaps.length) out.gaps = gaps; else delete out.gaps;
  return out;
}
