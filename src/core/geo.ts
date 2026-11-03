/** 緯度経度まわりの純粋な計算。UI にも Electron にも依存しない。 */

export interface LatLon { lat: number; lon: number }
export interface GeoLine { a: LatLon; b: LatLon }
/** 位置補正量(メートル)。東・北が正。 */
export interface Offset { east: number; north: number }

/** 緯度 lat における 1度あたりのメートル数 */
export function metersPerDegree(lat: number): { lat: number; lon: number } {
  const r = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
    lon: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
  };
}

/** 点をメートル単位でずらす */
export function offsetLatLon(p: LatLon, east: number, north: number): LatLon {
  const m = metersPerDegree(p.lat);
  return { lat: p.lat + north / m.lat, lon: p.lon + east / m.lon };
}

export function shiftLine(l: GeoLine, east: number, north: number): GeoLine {
  return { a: offsetLatLon(l.a, east, north), b: offsetLatLon(l.b, east, north) };
}

/** 2点間の距離(m)。サーキット規模なら等距円筒近似で十分。 */
export function distanceM(p: LatLon, q: LatLon): number {
  const m = metersPerDegree((p.lat + q.lat) / 2);
  const dx = (q.lon - p.lon) * m.lon;
  const dy = (q.lat - p.lat) * m.lat;
  return Math.hypot(dx, dy);
}

export interface Intersection {
  /** 線分 p→p2 上の位置 0..1 */
  t: number;
  /** 線分 a→b 上の位置 0..1 */
  u: number;
  /** p→p2 が a→b を左から右へ横切るなら +1、逆なら -1 */
  dir: 1 | -1;
}

/**
 * 線分 p→p2 と a→b の交差判定。x=lon, y=lat の度数座標のまま計算する
 * (異方スケールはアフィン変換なので、交差の有無・パラメータ・向きは変わらない)。
 */
export function segIntersect(
  px: number, py: number, p2x: number, p2y: number,
  ax: number, ay: number, bx: number, by: number,
): Intersection | null {
  const rx = p2x - px, ry = p2y - py;
  const sx = bx - ax, sy = by - ay;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const qpx = ax - px, qpy = ay - py;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t >= 1 || u < 0 || u > 1) return null;
  return { t, u, dir: denom > 0 ? 1 : -1 };
}
