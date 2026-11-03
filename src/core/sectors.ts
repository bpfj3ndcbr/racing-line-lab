import type { Lap } from './types';

/**
 * セクター k の区間タイム = セクターライン k の通過 〜 ライン k+1 の通過。
 * 最後のセクターはラインの通過 〜 ラップ終了(ゴール)まで。
 * 通過が欠けている区間は null。
 */
export function sectorSplits(lap: Lap): (number | null)[] {
  const st = lap.sectorTimes;
  return st.map((a, k) => {
    const b = k < st.length - 1 ? st[k + 1] : lap.duration;
    return a === null || b === null ? null : b - a;
  });
}

/**
 * 列ごと(セクターごと)の最速値。include[i] が false の行(外れ値ラップなど)は対象外。
 * 全行が null の列は null。
 */
export function bestPerColumn(rows: (number | null)[][], include: boolean[]): (number | null)[] {
  const n = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const best: (number | null)[] = Array.from({ length: n }, () => null);
  rows.forEach((r, i) => {
    if (!include[i]) return;
    r.forEach((v, k) => {
      if (v !== null && (best[k] === null || v < best[k]!)) best[k] = v;
    });
  });
  return best;
}

/** 表示(0.1秒単位)で同じなら最速とみなす */
export const isBest = (v: number | null, best: number | null): boolean =>
  v !== null && best !== null && Math.round(v * 10) === Math.round(best * 10);
