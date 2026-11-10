import { describe, expect, it } from 'vitest';
import {
  AREA_MAX_SIDE_M, cleanAreas, gridLines, latToTileY, lonToTileX, parseTileUrl, rectAtZoom, rectSizeM, rectToBox, rectWithinLimit,
  snapBox, tileCounts, tileInAreas, tileInRect, tilesOf, tileUrl, tileXToLon, tileYToLat, visibleTilesIn,
} from '../src/core';

// 地図タイルの計算(案件 31: Web 版の地図の保存)
describe('地図タイルの計算', () => {
  it('緯度・経度とタイルの番号を行き来できる', () => {
    expect(lonToTileX(-180, 18)).toBe(0);
    expect(tileXToLon(lonToTileX(138.927, 18), 18)).toBeCloseTo(138.927, 9);
    expect(tileYToLat(latToTileY(35.372, 18), 18)).toBeCloseTo(35.372, 9);
  });

  it('枠は、4 つの辺をそれぞれ一番近い Z18 の区切りにそろえる', () => {
    const r = { x0: 232700, y0: 103000, x1: 232716, y1: 103008 };
    const b = rectToBox(r);
    const tile = (b.east - b.west) / 16;          // Z18 の 1 枚分の経度
    const tileLat = (b.north - b.south) / 8;
    // 0.4 枚分外側 → 近い区切り(元の辺)にそろう。0.6 枚分外側 → 1 枚外側にそろう
    expect(snapBox({ west: b.west - tile * 0.4, east: b.east + tile * 0.6, north: b.north + tileLat * 0.4, south: b.south - tileLat * 0.6 }))
      .toEqual({ x0: 232700, y0: 103000, x1: 232717, y1: 103009 });
    // 1 枚分より小さい枠でも、1 枚分の大きさにする
    const s = snapBox({ west: b.west + tile * 0.1, east: b.west + tile * 0.2, north: b.north - tileLat * 0.1, south: b.north - tileLat * 0.2 });
    expect([s.x1 - s.x0, s.y1 - s.y0]).toEqual([1, 1]);
  });

  it('Z15〜Z17 は、Z18 の範囲を少しでも含むタイル(範囲を最低限含む外周まで)', () => {
    const r = { x0: 101, y0: 200, x1: 109, y1: 203 };
    expect(rectAtZoom(r, 17)).toEqual({ x0: 50, y0: 100, x1: 55, y1: 102 });
    expect(rectAtZoom(r, 15)).toEqual({ x0: 12, y0: 25, x1: 14, y1: 26 });
    expect(tileCounts(r)).toEqual({ 15: 2, 16: 3, 17: 10, 18: 24 });
    expect(tilesOf(r, [15])).toEqual([{ z: 15, x: 12, y: 25 }, { z: 15, x: 13, y: 25 }]);
    expect(tileInRect({ z: 18, x: 108, y: 202 }, r)).toBe(true);
    expect(tileInRect({ z: 18, x: 109, y: 202 }, r)).toBe(false);
    expect(tileInRect({ z: 16, x: 25, y: 50 }, r)).toBe(true);
    expect(tileInRect({ z: 14, x: 6, y: 12 }, r)).toBe(false);          // 保存しない倍率
    expect(tileInRect({ z: 19, x: 202, y: 400 }, r)).toBe(false);
    expect(tileInAreas({ z: 18, x: 300, y: 300 }, [r, { x0: 300, y0: 300, x1: 301, y1: 301 }])).toBe(true);
  });

  it('富士スピードウェイ程度(約 2050 × 920 m)の範囲は、Z18 で 200 枚に届かず、一辺の上限に収まる', () => {
    const r = snapBox({ west: 138.9165, east: 138.9390, north: 35.3755, south: 35.3672 });
    const { w, h } = rectSizeM(r);
    expect(w).toBeGreaterThan(1900); expect(w).toBeLessThan(2200);
    expect(h).toBeGreaterThan(800); expect(h).toBeLessThan(1050);
    const c = tileCounts(r);
    expect(c[18]).toBeLessThan(200);
    expect(c[15] + c[16]).toBeLessThan(25);
    expect(rectWithinLimit(r)).toBe(true);
    const big = { x0: r.x0, y0: r.y0, x1: r.x0 + Math.ceil(AREA_MAX_SIDE_M / (w / (r.x1 - r.x0))) + 1, y1: r.y1 };
    expect(rectWithinLimit(big)).toBe(false);
  });

  it('区切り線は、見えている範囲の中だけ。細かすぎるときは出さない', () => {
    const b = rectToBox({ x0: 1000, y0: 2000, x1: 1004, y1: 2002 });
    expect(gridLines(b)).toHaveLength(5 + 3);
    expect(gridLines(b, 4)).toEqual([]);
  });

  it('見えている範囲のタイルのうち、保存範囲に入るもの(Z19〜20 で表示中なら Z18)', () => {
    const r = { x0: 1000, y0: 2000, x1: 1008, y1: 2004 };
    const view = rectToBox({ x0: 1004, y0: 1990, x1: 1020, y1: 2010 });         // 範囲の右半分と、その外
    expect(visibleTilesIn(view, 18, r)).toHaveLength(4 * 4);
    expect(visibleTilesIn(view, 19.5, r).every((t) => t.z === 18)).toBe(true);
    expect(visibleTilesIn(view, 17, r).map((t) => t.z)).toEqual(Array(visibleTilesIn(view, 17, r).length).fill(17));
    expect(visibleTilesIn(view, 14, r)).toEqual([]);
  });

  it('地理院タイルの URL とタイルの番号', () => {
    const u = tileUrl({ z: 18, x: 232700, y: 103000 });
    expect(u).toBe('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/18/232700/103000.jpg');
    expect(parseTileUrl(u)).toEqual({ z: 18, x: 232700, y: 103000 });
    expect(parseTileUrl('https://cyberjapandata.gsi.go.jp/xyz/std/18/1/2.png')).toBeNull();
    expect(parseTileUrl('https://example.com/xyz/seamlessphoto/18/1/2.jpg')).toBeNull();
  });

  it('保存範囲の値: 壊れたものは捨てる', () => {
    const ok = { id: 'a', name: 'FSW', x0: 1, y0: 2, x1: 3, y1: 4 };
    expect(cleanAreas([ok, { ...ok, x1: 1 }, { ...ok, id: 3 }, null, 'x'])).toEqual([ok]);
    expect(cleanAreas({})).toEqual([]);
  });
});
