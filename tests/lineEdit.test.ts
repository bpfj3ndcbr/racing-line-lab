import { describe, expect, it } from 'vitest';
import {
  type GeoLine, bearingDiff, distanceM, lineBearing, lineMid, lineMoveM, lineMovedTo, lineWithBearing, metersPerDegree,
  normBearing, rotateToward,
} from '../src/core';

// 計測ラインの補正(案件 15)の計算。走行ログのファイルが無くても動く

const C = { lat: 33.0388, lon: 130.9733 };
const m = metersPerDegree(C.lat);
/** 中心 C、長さ 36.8 m、北向き(a が南・b が北)の線 */
const north: GeoLine = { a: { lat: C.lat - 18.4 / m.lat, lon: C.lon }, b: { lat: C.lat + 18.4 / m.lat, lon: C.lon } };

describe('線の角度', () => {
  it('端点 a → b の向きを、北から時計回りの度で返す', () => {
    expect(lineBearing(north)).toBeCloseTo(0, 6);
    const east: GeoLine = { a: { lat: C.lat, lon: C.lon - 18.4 / m.lon }, b: { lat: C.lat, lon: C.lon + 18.4 / m.lon } };
    expect(lineBearing(east)).toBeCloseTo(90, 6);
    expect(lineBearing({ a: east.b, b: east.a })).toBeCloseTo(270, 6);
  });
  it('角度は 0 以上 360 未満、差は −180 より大きく 180 以下にそろえる', () => {
    expect(normBearing(-0.5)).toBeCloseTo(359.5, 9);
    expect(normBearing(720.25)).toBeCloseTo(0.25, 9);
    expect(bearingDiff(359.5, 0.7)).toBeCloseTo(1.2, 9);
    expect(bearingDiff(0.7, 359.5)).toBeCloseTo(-1.2, 9);
    expect(bearingDiff(10, 190)).toBeCloseTo(180, 9);
  });
});

describe('回転と移動', () => {
  it('角度を指定すると、中心と長さはそのまま', () => {
    const r = lineWithBearing(north, 213.4);
    expect(lineBearing(r)).toBeCloseTo(213.4, 6);
    expect(distanceM(r.a, r.b)).toBeCloseTo(36.8, 6);
    expect(distanceM(lineMid(r), C)).toBeLessThan(1e-6);
  });
  it('端点のつまみをドラッグすると、端点がその方向を向くように回る(長さは変えない)', () => {
    const p = { lat: C.lat, lon: C.lon + 50 / m.lon };                  // 中心から東へ 50 m
    const rb = rotateToward(north, 'b', p);
    expect(lineBearing(rb)).toBeCloseTo(90, 6);
    expect(distanceM(rb.a, rb.b)).toBeCloseTo(36.8, 6);
    const ra = rotateToward(north, 'a', p);                              // a を東へ = b は西
    expect(lineBearing(ra)).toBeCloseTo(270, 6);
    expect(rotateToward(north, 'a', C)).toBe(north);                    // 中心に重ねたときは、そのまま
  });
  it('中心を動かすと、角度と長さはそのままで、移動量を m で返す', () => {
    const to = { lat: C.lat + 3 / m.lat, lon: C.lon + 4 / m.lon };
    const mv = lineMovedTo(lineWithBearing(north, 123.4), to);
    expect(lineBearing(mv)).toBeCloseTo(123.4, 3);                      // 緯度で縮尺がわずかに変わる分(表示は 0.1° 単位)
    expect(distanceM(mv.a, mv.b)).toBeCloseTo(36.8, 3);
    expect(lineMoveM(north, mv)).toBeCloseTo(5, 3);
  });
});
