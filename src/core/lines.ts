import type { GeoLine } from './geo';

/**
 * (書き出しは formatCln / formatSci。読み込みと同じ形式で、小数 6 桁・CRLF 改行)
 * デジスパイスの .cln(コントロールライン)/ .sci(セクターライン)パーサ。
 *
 * .cln : 1行目=ライン本数、続けて 緯度1,経度1,緯度2,経度2 を1行ずつ(推測。サンプルは本数1)
 * .sci : 1行=1ライン。「緯度1,経度1,緯度2,経度2,フラグ」(フラグの意味は不明)
 */

const nonEmpty = (text: string) =>
  text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);

export function parseCln(text: string): GeoLine[] {
  const rows = nonEmpty(text);
  if (!rows.length) return [];
  const hasCount = /^\d+$/.test(rows[0]);
  const nums = (hasCount ? rows.slice(1) : rows).flatMap((r) => r.split(/[\s,]+/)).map(Number);
  const n = hasCount ? Number(rows[0]) : Math.floor(nums.length / 4);
  const out: GeoLine[] = [];
  for (let i = 0; i < n && (i + 1) * 4 <= nums.length; i++) {
    const [la1, lo1, la2, lo2] = nums.slice(i * 4, i * 4 + 4);
    out.push({ a: { lat: la1, lon: lo1 }, b: { lat: la2, lon: lo2 } });
  }
  return out;
}

export interface SectorLine { line: GeoLine; flag: number }

export function parseSci(text: string): SectorLine[] {
  const out: SectorLine[] = [];
  for (const row of nonEmpty(text)) {
    const v = row.split(',').map((s) => Number(s.trim()));
    if (v.length < 4 || v.slice(0, 4).some((x) => !Number.isFinite(x))) continue;
    out.push({
      line: { a: { lat: v[0], lon: v[1] }, b: { lat: v[2], lon: v[3] } },
      flag: Number.isFinite(v[4]) ? v[4] : 0,
    });
  }
  return out;
}

const f6 = (v: number) => v.toFixed(6);
const CRLF = '\r\n';
const row = (l: GeoLine) => [f6(l.a.lat), f6(l.a.lon), f6(l.b.lat), f6(l.b.lon)];

/** .cln の中身: 1行目 = 本数、続けて 緯度1・経度1・緯度2・経度2 を 1 行ずつ(parseCln と同じ形式) */
export function formatCln(lines: GeoLine[]): string {
  return [String(lines.length), ...lines.flatMap(row)].join(CRLF) + CRLF;
}

/** .sci の中身: 1 行 1 ライン「緯度1,経度1,緯度2,経度2,フラグ」(parseSci と同じ形式) */
export function formatSci(lines: GeoLine[], flag = 1): string {
  return lines.map((l) => [...row(l), String(flag)].join(',')).join(CRLF) + (lines.length ? CRLF : '');
}

/** ファイルに書いたときと同じ桁(6 桁)に丸める。保存するラインはこの値にそろえる */
export const roundLine = (l: GeoLine): GeoLine => {
  const r = (v: number) => Number(f6(v));
  return { a: { lat: r(l.a.lat), lon: r(l.a.lon) }, b: { lat: r(l.b.lat), lon: r(l.b.lon) } };
};
