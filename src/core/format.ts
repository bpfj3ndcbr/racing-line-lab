/**
 * 画面の表示に使う、小さな文字の処理(画面の各所で共通に使う)。
 */

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** HTML に埋め込む文字列のエスケープ(& < > ") */
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML_ESC[c]!);

/** 秒 → 「分:秒」(例: 83 → 「1:23」) */
export const fmtMinSec = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
