/**
 * 「終端の調整」(案件 14)のスライドバーの段階(1〜)と、終端(ラップ開始からの秒)の対応。
 * 上限が 10 分以下なら、端から端まで 10 秒刻み。10 分を超える長いラップでは、左半分(30 段階)を 0〜5 分の 10 秒刻み、
 * 右半分(30 段階)を 5 分〜上限に割り当てる(最初の数分を切り出しやすくするため)。右端は上限
 */
const FINE_SEC = 300;
const HALF_STEPS = 30;
const isLong = (max: number) => max > 2 * FINE_SEC;
/** 上限 max(秒)のときの段階の数 */
export function endSteps(max: number): number { return isLong(max) ? 2 * HALF_STEPS : Math.max(1, Math.ceil(max / 10)); }
/** 段階 k → 終端(秒) */
export function endFromStep(k: number, max: number): number {
  const n = endSteps(max);
  if (k >= n) return max;
  if (!isLong(max) || k <= HALF_STEPS) return 10 * Math.max(1, k);
  return FINE_SEC + Math.round(((max - FINE_SEC) * (k - HALF_STEPS)) / HALF_STEPS / 10) * 10;
}
/** 終端(秒) → いちばん近い段階 */
export function stepFromEnd(sec: number, max: number): number {
  const n = endSteps(max);
  if (sec >= max - 0.5) return n;
  if (!isLong(max) || sec <= FINE_SEC) return Math.min(n - 1, Math.max(1, Math.round(sec / 10)));
  return Math.min(n - 1, Math.max(HALF_STEPS + 1, HALF_STEPS + Math.round(((sec - FINE_SEC) / (max - FINE_SEC)) * HALF_STEPS)));
}
