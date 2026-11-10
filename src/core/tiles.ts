/**
 * 地図タイル(地理院タイル)の計算(案件 31: Web 版の地図の保存)。画面・service worker の両方から使う純粋な関数。
 * - 保存範囲は Z18 のタイルの区切りにそろえた四角(TileRect)で持つ
 * - Z15〜Z17 は、その範囲を少しでも含むタイルを保存の対象にする(範囲を最低限含む外周まで)
 * タイルの番号は Web メルカトル(XYZ)。x は東へ、y は南へ増える。
 */

/** 地理院タイル「シームレス空中写真」。実画像は Z18 まで */
export const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
/** 範囲をそろえる倍率 */
export const SNAP_ZOOM = 18;
/** 保存する倍率(Z19〜20 は Z18 を引き伸ばして表示するので、保存しない) */
export const SAVE_ZOOMS = [15, 16, 17, 18] as const;
/** 「概略の地図は表示前に保存する」で、範囲を決めたときにまとめて保存する倍率 */
export const PREFETCH_ZOOMS = [15, 16] as const;
/** 保存範囲の一辺の上限(メートル) */
export const AREA_MAX_SIDE_M = 5000;

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Z18 のタイルの区切りにそろえた四角。x0〜x1-1、y0〜y1-1 のタイル(x1・y1 は含まない) */
export interface TileRect { x0: number; y0: number; x1: number; y1: number }
/** 保存範囲 */
export interface SaveArea extends TileRect { id: string; name: string }
/** 緯度・経度の四角 */
export interface GeoBox { south: number; west: number; north: number; east: number }
export interface TileId { z: number; x: number; y: number }

/** 経度 → タイルの x(小数) */
export function lonToTileX(lon: number, z: number): number { return ((lon + 180) / 360) * 2 ** z; }
/** 緯度 → タイルの y(小数) */
export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tileXToLon(x: number, z: number): number { return (x / 2 ** z) * 360 - 180; }
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** 緯度・経度の四角を、4 つの辺をそれぞれ一番近い Z18 の区切りにそろえる(少なくとも 1 枚分の大きさにする) */
export function snapBox(box: GeoBox): TileRect {
  let x0 = Math.round(lonToTileX(box.west, SNAP_ZOOM)), x1 = Math.round(lonToTileX(box.east, SNAP_ZOOM));
  let y0 = Math.round(latToTileY(box.north, SNAP_ZOOM)), y1 = Math.round(latToTileY(box.south, SNAP_ZOOM));
  if (x1 <= x0) { const c = Math.floor(lonToTileX((box.west + box.east) / 2, SNAP_ZOOM)); x0 = c; x1 = c + 1; }
  if (y1 <= y0) { const c = Math.floor(latToTileY((box.north + box.south) / 2, SNAP_ZOOM)); y0 = c; y1 = c + 1; }
  return { x0, y0, x1, y1 };
}

/** Z18 の四角 → 緯度・経度の四角 */
export function rectToBox(r: TileRect): GeoBox {
  return { west: tileXToLon(r.x0, SNAP_ZOOM), east: tileXToLon(r.x1, SNAP_ZOOM), north: tileYToLat(r.y0, SNAP_ZOOM), south: tileYToLat(r.y1, SNAP_ZOOM) };
}

/** 倍率 z で、Z18 の四角を少しでも含むタイルの四角 */
export function rectAtZoom(r: TileRect, z: number): TileRect {
  const s = 2 ** (SNAP_ZOOM - z);
  return { x0: Math.floor(r.x0 / s), y0: Math.floor(r.y0 / s), x1: Math.ceil(r.x1 / s), y1: Math.ceil(r.y1 / s) };
}

/** タイルが、保存範囲(のその倍率での四角)に入るか。保存する倍率(Z15〜Z18)でなければ false */
export function tileInRect(t: TileId, r: TileRect): boolean {
  if (!(SAVE_ZOOMS as readonly number[]).includes(t.z)) return false;
  const q = rectAtZoom(r, t.z);
  return t.x >= q.x0 && t.x < q.x1 && t.y >= q.y0 && t.y < q.y1;
}
export function tileInAreas(t: TileId, areas: readonly TileRect[]): boolean { return areas.some((a) => tileInRect(t, a)); }

/** 四角に入るタイルを、倍率ごとに並べる */
export function tilesOf(r: TileRect, zooms: readonly number[]): TileId[] {
  const out: TileId[] = [];
  for (const z of zooms) {
    const q = rectAtZoom(r, z);
    for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) out.push({ z, x, y });
  }
  return out;
}

/** 倍率ごとのタイルの枚数(Z15〜Z18) */
export function tileCounts(r: TileRect): Record<number, number> {
  const out: Record<number, number> = {};
  for (const z of SAVE_ZOOMS) { const q = rectAtZoom(r, z); out[z] = (q.x1 - q.x0) * (q.y1 - q.y0); }
  return out;
}

/** 四角の大きさ(東西・南北のメートル。中央の緯度で求める) */
export function rectSizeM(r: TileRect): { w: number; h: number } {
  const b = rectToBox(r);
  const tileM = (EARTH_CIRCUMFERENCE_M * Math.cos(((b.north + b.south) / 2) * Math.PI / 180)) / 2 ** SNAP_ZOOM;
  return { w: (r.x1 - r.x0) * tileM, h: (r.y1 - r.y0) * tileM };
}

/** 一辺が上限(AREA_MAX_SIDE_M)を超えていないか */
export function rectWithinLimit(r: TileRect): boolean {
  const { w, h } = rectSizeM(r);
  return w <= AREA_MAX_SIDE_M && h <= AREA_MAX_SIDE_M;
}

/** 緯度・経度の点が、四角の中にあるか */
export function boxContains(b: GeoBox, lat: number, lon: number): boolean {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

/** Z18 の区切り線(見えている範囲 box の中だけ)。本数が max を超えるときは空(細かすぎて見分けられないため) */
export function gridLines(box: GeoBox, max = 400): [number, number][][] {
  const E = 1e-6;                                  // 区切りちょうどの辺が、計算の誤差で外れないように
  const x0 = Math.ceil(lonToTileX(box.west, SNAP_ZOOM) - E), x1 = Math.floor(lonToTileX(box.east, SNAP_ZOOM) + E);
  const y0 = Math.ceil(latToTileY(box.north, SNAP_ZOOM) - E), y1 = Math.floor(latToTileY(box.south, SNAP_ZOOM) + E);
  if (x1 - x0 + 1 + y1 - y0 + 1 > max) return [];
  const out: [number, number][][] = [];
  for (let x = x0; x <= x1; x++) { const lon = tileXToLon(x, SNAP_ZOOM); out.push([[box.south, lon], [box.north, lon]]); }
  for (let y = y0; y <= y1; y++) { const lat = tileYToLat(y, SNAP_ZOOM); out.push([[lat, box.west], [lat, box.east]]); }
  return out;
}

export function tileUrl(t: TileId): string {
  return GSI_PHOTO_URL.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}
/** 地理院タイル(シームレス空中写真)の URL なら、タイルの番号。違えば null */
export function parseTileUrl(url: string): TileId | null {
  const m = /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/seamlessphoto\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.jpg$/.exec(url);
  return m ? { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
}

/** 保存範囲として読み込んだ値を確かめる(壊れた値・古い形式は捨てる) */
export function cleanAreas(v: unknown): SaveArea[] {
  if (!Array.isArray(v)) return [];
  const isInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
  return v.filter((a): a is SaveArea => !!a && typeof a === 'object'
    && typeof (a as SaveArea).id === 'string' && typeof (a as SaveArea).name === 'string'
    && isInt((a as SaveArea).x0) && isInt((a as SaveArea).y0) && isInt((a as SaveArea).x1) && isInt((a as SaveArea).y1)
    && (a as SaveArea).x1 > (a as SaveArea).x0 && (a as SaveArea).y1 > (a as SaveArea).y0)
    .map((a) => ({ id: a.id, name: a.name, x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 }));
}

/** 保存した地図タイルの置き場所(Cache Storage の名前)。画面と service worker で共通 */
export const TILE_CACHE = 'rll-tiles';
/** 保存範囲を service worker に渡す置き場所と、そのファイル名(sw.js と同じ場所からの相対パス) */
export const TILE_META_CACHE = 'rll-tiles-meta';
export const TILE_AREAS_FILE = 'rll-areas.json';
/** 保存したタイルの大きさ(バイト)を入れておく見出し(一覧の容量の表示に使う) */
export const TILE_BYTES_HEADER = 'x-rll-bytes';

/** 概略の地図(PREFETCH_ZOOMS)の、保存範囲すべての分のタイル(重なりは 1 つにまとめる) */
export function prefetchTilesOf(areas: readonly TileRect[]): TileId[] {
  const seen = new Set<string>(), out: TileId[] = [];
  for (const a of areas) for (const t of tilesOf(a, PREFETCH_ZOOMS)) {
    const k = `${t.z}/${t.x}/${t.y}`;
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

/**
 * 見えている範囲 view(倍率 zoom で表示中)のタイルのうち、保存範囲 r に入るもの。
 * 保存する倍率(Z15〜Z18)でなければ空。Z19〜20 で表示中なら Z18 のタイル
 */
export function visibleTilesIn(view: GeoBox, zoom: number, r: TileRect): TileId[] {
  const z = Math.min(SNAP_ZOOM, Math.floor(zoom));
  if (z < SAVE_ZOOMS[0]) return [];
  const q = rectAtZoom(r, z);
  const x0 = Math.max(q.x0, Math.floor(lonToTileX(view.west, z))), x1 = Math.min(q.x1, Math.floor(lonToTileX(view.east, z)) + 1);
  const y0 = Math.max(q.y0, Math.floor(latToTileY(view.north, z))), y1 = Math.min(q.y1, Math.floor(latToTileY(view.south, z)) + 1);
  const out: TileId[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push({ z, x, y });
  return out;
}
