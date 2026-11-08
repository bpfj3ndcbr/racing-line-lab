/** A〜D への割り当て。純粋な関数だけで構成し、UI から独立させる。 */

export type Slot = 'A' | 'B' | 'C' | 'D';
export const SLOTS: Slot[] = ['A', 'B', 'C', 'D'];

export interface LapRef { logId: string; lap: number }
export type Assignment = Record<Slot, LapRef | null>;

export const emptyAssignment = (): Assignment => ({ A: null, B: null, C: null, D: null });

const same = (a: LapRef | null, b: LapRef | null) =>
  !!a && !!b && a.logId === b.logId && a.lap === b.lap;

/**
 * slot に ref を割り当てる。
 * - 既に同じ割り当てなら解除(トグル)
 * - ref が別の枠に入っていれば、そちらを外す(同じラップは1枠だけ)
 * - slot の以前の割り当ては置き換わる
 */
export function toggleAssign(cur: Assignment, slot: Slot, ref: LapRef): Assignment {
  const next: Assignment = { ...cur };
  if (same(cur[slot], ref)) { next[slot] = null; return next; }
  for (const s of SLOTS) if (same(next[s], ref)) next[s] = null;
  next[slot] = ref;
  return next;
}

/** 指定ログに属する割り当てを全て外す */
export function clearLog(cur: Assignment, logId: string): Assignment {
  const next: Assignment = { ...cur };
  for (const s of SLOTS) if (next[s]?.logId === logId) next[s] = null;
  return next;
}

export function slotOf(cur: Assignment, ref: LapRef): Slot | null {
  return SLOTS.find((s) => same(cur[s], ref)) ?? null;
}

/** 位置補正の前後で「同じラップ」とみなす、開始時刻の差の上限(秒。案件 19) */
export const SAME_LAP_SEC = 5;

/**
 * 位置補正のあとのラップ laps から、補正の前のラップ old と同じラップを探す(案件 19)。
 * 同じ = 完了かどうかが同じで、開始時刻の差が SAME_LAP_SEC 以内。同じ番号を優先し、無ければ開始時刻が最も近いもの。
 * (補正で最初の通過が増減すると番号がずれるので、番号だけでは合わせない)。period は 1 周分のログ(輪)の 1 周の長さ。見つからなければ null
 */
export function matchLap<L extends { number: number; startTime: number; complete: boolean }>(old: L, laps: L[], period?: number): L | null {
  // 1 周分のログ(輪)は同じ 1 周を 2 回つないでいるので、開始時刻は 1 周の長さ period ずれても同じラップ
  const gap = (t: number) => {
    const d = Math.abs(t - old.startTime);
    if (!period) return d;
    const m = d % period;
    return Math.min(m, period - m);
  };
  const near = laps.filter((l) => l.complete === old.complete && gap(l.startTime) <= SAME_LAP_SEC);
  if (!near.length) return null;
  return near.find((l) => l.number === old.number) ?? near.reduce((a, b) => (gap(b.startTime) < gap(a.startTime) ? b : a));
}
