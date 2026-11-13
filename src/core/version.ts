/** 版の番号(○.○.○)の読み取りと比べ方。デスクトップ版の「更新を確認する」(案件 52)で、GitHub のタグと今の版を比べるのに使う */

export type Ver = [number, number, number];

/** 「1.6.0」「v1.6.0」を読む。○.○.○ の形でないもの(v1.6.0-beta など)は null */
export function parseVersion(s: string): Ver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a が新しければ正、同じなら 0、古ければ負 */
export function compareVersion(a: Ver, b: Ver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** タグの名前の中で、いちばん新しい版(「v」を除いた ○.○.○)。読めるタグが無ければ null */
export function latestVersion(tags: readonly string[]): string | null {
  let best: Ver | null = null;
  for (const t of tags) {
    const v = parseVersion(t);
    if (v && (!best || compareVersion(v, best) > 0)) best = v;
  }
  return best ? best.join('.') : null;
}

/** latest が current より新しいか(どちらかが読めなければ false) */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current);
  return !!a && !!b && compareVersion(a, b) > 0;
}
