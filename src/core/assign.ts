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
