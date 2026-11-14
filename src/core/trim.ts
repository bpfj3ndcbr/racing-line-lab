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
/** 取り込む範囲の長さの下限(秒) */
export const CUT_MIN_KEEP_SEC = 30;
/** 取り込む範囲どうしのあいだ(取り込まない区間)の長さの下限(秒) */
export const CUT_MIN_SEC = 30;
/** 範囲を 2 つに分けるときに、間に入れる取り込まない区間の秒 */
export const SPLIT_GAP_SEC = 60;
/** 範囲の外に足す範囲の長さ(秒。置けるところが狭ければ縮める) */
export const ADD_RANGE_SEC = 120;

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

// ---- 取り込み範囲の画面の、取り込む範囲の編集(画面に依存しない部分) ----

/**
 * 画面で編集する、取り込む範囲(元のログの先頭からの秒)。on = 取り込む(チェックあり)。
 * added = 「範囲を分ける」「範囲を追加」で足したもの。保存するのは、範囲の外(取り込まない区間)
 */
export interface KeepRange { from: number; to: number; on: boolean; added?: boolean }

/** 取り込まない区間の、ログ全体(0〜duration)に対する残り(取り込む範囲)。どれもチェックあり */
function rangesFromCuts(cuts: readonly TrimCut[], duration: number): KeepRange[] {
  const out: KeepRange[] = [];
  let at = 0;
  for (const c of normalizeCuts(cuts, duration)) {
    if (c.from > at) out.push({ from: at, to: c.from, on: true });
    at = Math.max(at, c.to);
  }
  if (duration > at) out.push({ from: at, to: duration, on: true });
  return out.length ? out : [{ from: 0, to: duration, on: true }];
}

/**
 * 画面の初めの範囲。保存した区間があれば(同じファイルを前に読み込んだとき)その残りを、
 * 無ければ停止の候補を除いた残りを、どれもチェックありで返す(停止の候補が無ければ、ログ全体の 1 つ)
 */
export function initialRanges(log: TrackLog, saved: readonly TrimCut[] = []): KeepRange[] {
  const T = log.t[log.t.length - 1];
  return rangesFromCuts(normalizeCuts(saved, T).length ? saved : stopCandidates(log), T);
}

/** 範囲の名前: 前から「範囲1」「範囲2」… */
export function rangeNames(ranges: readonly KeepRange[]): string[] {
  return ranges.map((_, i) => `範囲${i + 1}`);
}

/**
 * i 番目の範囲の端(from / to)を動かせる範囲。範囲の長さは CUT_MIN_KEEP_SEC 以上、
 * 隣の範囲とのあいだ(取り込まない区間)は CUT_MIN_SEC 以上。ログの端までは動かせる
 */
export function rangeBounds(ranges: readonly KeepRange[], i: number, which: 'from' | 'to', duration: number): [number, number] {
  const r = ranges[i], prev = ranges[i - 1], next = ranges[i + 1];
  if (which === 'from') return [prev ? prev.to + CUT_MIN_SEC : 0, r.to - CUT_MIN_KEEP_SEC];
  return [r.from + CUT_MIN_KEEP_SEC, next ? next.from - CUT_MIN_SEC : duration];
}

/** i 番目の範囲の端を sec に動かした並び(動かせる範囲に収める) */
export function moveRange(ranges: readonly KeepRange[], i: number, which: 'from' | 'to', sec: number, duration: number): KeepRange[] {
  const [lo, hi] = rangeBounds(ranges, i, which, duration);
  return ranges.map((r, k) => (k === i ? { ...r, [which]: Math.min(hi, Math.max(lo, sec)) } : r));
}

/** 分けられるか(間に SPLIT_GAP_SEC の取り込まない区間を入れて、両側が CUT_MIN_KEEP_SEC 以上になる長さ) */
export function canSplitRange(r: TrimCut): boolean { return r.to - r.from >= SPLIT_GAP_SEC + 2 * CUT_MIN_KEEP_SEC; }

/** 範囲を分ける位置(切れ目の中央)を置ける範囲。切れ目 SPLIT_GAP_SEC の両側が CUT_MIN_KEEP_SEC 以上残るところ */
export function splitBounds(r: TrimCut): [number, number] {
  const m = SPLIT_GAP_SEC / 2 + CUT_MIN_KEEP_SEC;
  return [r.from + m, r.to - m];
}

/**
 * i 番目の範囲を、at を中央に SPLIT_GAP_SEC の取り込まない区間を入れて 2 つに分けた並び
 * (at は splitBounds に収める。分けられなければそのまま)。後ろ側は「足したもの」
 */
export function splitRange(ranges: readonly KeepRange[], i: number, at: number): KeepRange[] {
  const r = ranges[i];
  if (!r || !canSplitRange(r)) return ranges.slice();
  const [lo, hi] = splitBounds(r);
  const mid = Math.min(hi, Math.max(lo, at));
  const front: KeepRange = { ...r, to: mid - SPLIT_GAP_SEC / 2 };
  const back: KeepRange = { from: mid + SPLIT_GAP_SEC / 2, to: r.to, on: r.on, added: true };
  return [...ranges.slice(0, i), front, back, ...ranges.slice(i + 1)];
}

/**
 * 範囲の外の sec に範囲を足すときに、足した範囲を置けるところ(隣の範囲とのあいだに CUT_MIN_SEC)。
 * sec が範囲の中か、置けるところが CUT_MIN_KEEP_SEC 未満なら null
 */
export function addBounds(ranges: readonly KeepRange[], sec: number, duration: number): [number, number] | null {
  if (sec < 0 || sec > duration || ranges.some((r) => sec >= r.from && sec <= r.to)) return null;
  const prev = ranges.filter((r) => r.to < sec).pop(), next = ranges.find((r) => r.from > sec);
  const lo = prev ? prev.to + CUT_MIN_SEC : 0, hi = next ? next.from - CUT_MIN_SEC : duration;
  return hi - lo >= CUT_MIN_KEEP_SEC ? [lo, hi] : null;
}

/** sec を中心に足す範囲(長さ ADD_RANGE_SEC。置けるところに収める)。足せなければ null */
export function newRangeAt(ranges: readonly KeepRange[], sec: number, duration: number): KeepRange | null {
  const b = addBounds(ranges, sec, duration);
  if (!b) return null;
  const [lo, hi] = b;
  let from = Math.max(lo, sec - ADD_RANGE_SEC / 2);
  const to = Math.min(hi, from + ADD_RANGE_SEC);
  from = Math.max(lo, to - ADD_RANGE_SEC);
  return { from, to, on: true, added: true };
}

/** sec を中心に範囲を足した並びと、足した範囲の番号(足せなければ、そのままの並びと -1) */
export function addRange(ranges: readonly KeepRange[], sec: number, duration: number): { ranges: KeepRange[]; index: number } {
  const r = newRangeAt(ranges, sec, duration);
  if (!r) return { ranges: ranges.slice(), index: -1 };
  const out = [...ranges, r].sort((a, b) => a.from - b.from);
  return { ranges: out, index: out.indexOf(r) };
}

/**
 * sec を含む、範囲と範囲のあいだ(範囲の外)。前後の範囲が無ければログの端まで。sec が範囲の中なら null。
 * チェックを外した範囲も、範囲として数える
 */
export function gapAround(ranges: readonly KeepRange[], sec: number, duration: number): TrimCut | null {
  if (sec < 0 || sec > duration || ranges.some((r) => sec >= r.from && sec <= r.to)) return null;
  const prev = ranges.filter((r) => r.to < sec).pop(), next = ranges.find((r) => r.from > sec);
  return { from: prev ? prev.to : 0, to: next ? next.from : duration };
}

/**
 * sec を含む範囲の外を取り込む範囲にした並びと、その範囲の番号。前後の範囲とは 1 つにつなぐ
 * (つないだ範囲は取り込む)。sec が範囲の中なら、そのままの並びと -1
 */
export function includeGap(ranges: readonly KeepRange[], sec: number, duration: number): { ranges: KeepRange[]; index: number } {
  const g = gapAround(ranges, sec, duration);
  if (!g) return { ranges: ranges.slice(), index: -1 };
  const before = ranges.filter((r) => r.to <= g.from), after = ranges.filter((r) => r.from >= g.to);
  const prev = before[before.length - 1], next = after[0];
  const merged: KeepRange = {
    from: prev ? prev.from : g.from, to: next ? next.to : g.to, on: true,
    ...(prev?.added || (!prev && next?.added) ? { added: true } : {}),
  };
  const out = [...(prev ? before.slice(0, -1) : before), merged, ...(next ? after.slice(1) : after)];
  return { ranges: out, index: out.indexOf(merged) };
}

/** 画面の範囲から、取り込まない区間(チェックした範囲の外)を返す */
export function rangesToCuts(ranges: readonly KeepRange[], duration: number): TrimCut[] {
  const out: TrimCut[] = [];
  let at = 0;
  for (const r of ranges) {
    if (!r.on) continue;
    if (r.from > at) out.push({ from: at, to: r.from });
    at = r.to;
  }
  if (duration > at) out.push({ from: at, to: duration });
  return out;
}
