import { type GeoLine, type LatLon, distanceM, metersPerDegree, shiftLine } from './geo';

/**
 * 計測ラインの補正(案件 15)。線の角度・回転・移動の純粋な計算。
 * 角度は「線そのものの向き」(端点 a → 端点 b)を、北から時計回りの度(0 以上 360 未満)で表す。
 */

/** 線の中心 */
export function lineMid(l: GeoLine): LatLon {
  return { lat: (l.a.lat + l.b.lat) / 2, lon: (l.a.lon + l.b.lon) / 2 };
}

/** 角度を 0 以上 360 未満にそろえる */
export function normBearing(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** 点 p から点 q への向き(北から時計回りの度) */
function bearingOf(p: LatLon, q: LatLon): number {
  const m = metersPerDegree((p.lat + q.lat) / 2);
  return normBearing((Math.atan2((q.lon - p.lon) * m.lon, (q.lat - p.lat) * m.lat) * 180) / Math.PI);
}

/** 線の角度(端点 a → 端点 b の向き。北から時計回りの度) */
export function lineBearing(l: GeoLine): number {
  return bearingOf(l.a, l.b);
}

/** 角度の差 to − from を、−180 より大きく 180 以下にそろえる */
export function bearingDiff(from: number, to: number): number {
  const d = normBearing(to - from);
  return d > 180 ? d - 360 : d;
}

/** 中心と長さを変えずに、線の角度を deg にする */
export function lineWithBearing(l: GeoLine, deg: number): GeoLine {
  const c = lineMid(l);
  const h = distanceM(l.a, l.b) / 2;
  const m = metersPerDegree(c.lat);
  const r = (normBearing(deg) * Math.PI) / 180;
  const e = Math.sin(r) * h, n = Math.cos(r) * h;
  return {
    a: { lat: c.lat - n / m.lat, lon: c.lon - e / m.lon },
    b: { lat: c.lat + n / m.lat, lon: c.lon + e / m.lon },
  };
}

/**
 * 端点 end のつまみを点 p までドラッグしたときの線。中心と長さは変えずに、端点が p の方向を向くように回す。
 * p が中心に重なるときは、そのまま返す。
 */
export function rotateToward(l: GeoLine, end: 'a' | 'b', p: LatLon): GeoLine {
  const c = lineMid(l);
  if (distanceM(c, p) < 1e-6) return l;
  const toP = bearingOf(c, p);
  return lineWithBearing(l, end === 'b' ? toP : toP + 180);
}

/** 長さと角度を変えずに、線の中心を c に動かす */
export function lineMovedTo(l: GeoLine, c: LatLon): GeoLine {
  const m0 = lineMid(l);
  const m = metersPerDegree(m0.lat);
  return shiftLine(l, (c.lon - m0.lon) * m.lon, (c.lat - m0.lat) * m.lat);
}

/** 補正前 before から補正後 after への、中心の移動量(m) */
export function lineMoveM(before: GeoLine, after: GeoLine): number {
  return distanceM(lineMid(before), lineMid(after));
}

/** 修正の画面の線(案件 15・17)。before = 補正前(ファイルの線。足した線は、引いたときの線)、added = その画面で足した線 */
export interface FixLine { before: GeoLine; line: GeoLine; added?: boolean }
/** 線を補正前から動かしたか(足した線は、動かさなくても「変えた」) */
export const lineChanged = (f: FixLine): boolean =>
  !!f.added || lineMoveM(f.before, f.line) >= 0.005 || Math.abs(bearingDiff(lineBearing(f.before), lineBearing(f.line))) >= 0.005;
/** セクターの直し方の要約(「修正 1・追加 1・削除 1」。何もしていなければ空)。lines[0] は計測ライン、removed = 消した本数 */
export function sectorChanges(lines: FixLine[], removed: number): string {
  const secs = lines.slice(1);
  const moved = secs.filter((f) => !f.added && lineChanged(f)).length, added = secs.filter((f) => f.added).length;
  return [moved && `修正 ${moved}`, added && `追加 ${added}`, removed && `削除 ${removed}`].filter(Boolean).join('・');
}
/** 角度の差の表示(+1.2° / −0.3° / 0.0°) */
export function fmtAngleDiff(d: number): string {
  const r = Math.round(d * 10) / 10;
  return r === 0 ? '0.0°' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}°`;
}
/** 補正の内容(「角度 +1.2°・移動 0.6 m」) */
export function fixSummary(before: GeoLine, after: GeoLine): string {
  return `角度 ${fmtAngleDiff(bearingDiff(lineBearing(before), lineBearing(after)))}・移動 ${lineMoveM(before, after).toFixed(1)} m`;
}
