import type { GeoLine } from './geo';

/**
 * (書き出しは formatCln / formatSci。読み込みと同じ形式で、CRLF 改行。ファイルは小数 6 桁、アプリ内の登録は 7 桁)
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

/** 書き出すファイル(.cln / .sci)の、緯度・経度の小数の桁(約 10 cm) */
export const FILE_DIGITS = 6;
/**
 * アプリ内で保存するラインの、緯度・経度の小数の桁(約 1 cm)。長さ 36.8 m の線を 0.1° 刻みで回せるように、
 * ファイルより 1 桁多くしている(6 桁では、丸めで角度が最大 0.2° ほど変わるため。案件 15)
 */
export const LINE_DIGITS = 7;
const CRLF = '\r\n';
const row = (l: GeoLine, d: number) => [l.a.lat, l.a.lon, l.b.lat, l.b.lon].map((v) => v.toFixed(d));

/** .cln の中身: 1行目 = 本数、続けて 緯度1・経度1・緯度2・経度2 を 1 行ずつ(parseCln と同じ形式)。digits = 小数の桁 */
export function formatCln(lines: GeoLine[], digits = FILE_DIGITS): string {
  return [String(lines.length), ...lines.flatMap((l) => row(l, digits))].join(CRLF) + CRLF;
}

/** .sci の中身: 1 行 1 ライン「緯度1,経度1,緯度2,経度2,フラグ」(parseSci と同じ形式)。digits = 小数の桁 */
export function formatSci(lines: GeoLine[], flag = 1, digits = FILE_DIGITS): string {
  return lines.map((l) => [...row(l, digits), String(flag)].join(',')).join(CRLF) + (lines.length ? CRLF : '');
}

/** アプリ内で保存するときの桁(LINE_DIGITS)に丸める。保存するラインはこの値にそろえる */
export const roundLine = (l: GeoLine): GeoLine => {
  const r = (v: number) => Number(v.toFixed(LINE_DIGITS));
  return { a: { lat: r(l.a.lat), lon: r(l.a.lon) }, b: { lat: r(l.b.lat), lon: r(l.b.lon) } };
};
