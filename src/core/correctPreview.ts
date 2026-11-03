import type { Lap, TrackLog } from './types';

/**
 * 位置補正の地図に描く区間の選び方。
 * 長いログ(1 日分など)を丸ごと描くと重く、間引くとラインが崩れるので、合わせるのに足りる数ラップだけを描く。
 */
export interface PreviewOptions {
  /** ラップがあるときに描くラップの数(速い順) */
  laps?: number;
  /** ラップが無いときに「走っている」とみなす速度(km/h) */
  minSpeedKmh?: number;
  /** ラップが無いときに描く時間(秒)。走っている区間の先頭から数える */
  maxSeconds?: number;
}

/** from〜to 番目(両端を含む)のサンプル。区間ごとに別の線として描く(区間の間を直線で結ばない) */
export interface PreviewRange { from: number; to: number }

export type PreviewPick =
  /** 完了ラップの速い順(ranges はラップ番号の順) */
  | { kind: 'laps'; laps: number[]; ranges: PreviewRange[] }
  /** ラップが無いとき: 走っている区間の先頭から maxSeconds 秒(seconds は実際に選んだ長さ) */
  | { kind: 'moving'; seconds: number; ranges: PreviewRange[] }
  /** 走っている区間も無いとき: ログ全体 */
  | { kind: 'all'; ranges: PreviewRange[] };

export function pickPreviewRanges(log: TrackLog, laps: Lap[], opts: PreviewOptions = {}): PreviewPick {
  const n = log.t.length;
  const best = laps.filter((l) => l.complete)
    .sort((a, b) => a.duration - b.duration)
    .slice(0, opts.laps ?? 3)
    .sort((a, b) => a.number - b.number);
  if (best.length) {
    // endIndex は終点の直前のサンプルなので、1 つ先まで含めて線を閉じる
    return { kind: 'laps', laps: best.map((l) => l.number), ranges: best.map((l) => ({ from: l.startIndex, to: Math.min(n - 1, l.endIndex + 1) })) };
  }

  const minSp = opts.minSpeedKmh ?? 30, maxSec = opts.maxSeconds ?? 600;
  const ranges: PreviewRange[] = [];
  let total = 0;
  for (let i = 0; i < n && total < maxSec; i++) {
    if (log.speed[i] < minSp) continue;
    // i から続けて走っている区間を、残りの時間の分だけ取る
    let j = i;
    while (j + 1 < n && log.speed[j + 1] >= minSp && log.t[j + 1] - log.t[i] <= maxSec - total) j++;
    if (j > i) { ranges.push({ from: i, to: j }); total += log.t[j] - log.t[i]; }
    while (j + 1 < n && log.speed[j + 1] >= minSp) j++;
    i = j;
  }
  if (ranges.length) return { kind: 'moving', seconds: total, ranges };
  return { kind: 'all', ranges: n ? [{ from: 0, to: n - 1 }] : [] };
}
