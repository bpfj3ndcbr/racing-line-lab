import { describe, expect, it } from 'vitest';
import { type GeoLine, type TrackLog, checkLoop, closeLoop, detectLaps, metersPerDegree } from '../src/core';

// 半径 300 m の円を、反時計回りに 100 km/h・10Hz で走る人工のログ(走行ログのファイルが無くても動くテスト)
const C = { lat: 33, lon: 131 };
const R = 300;
const V = 100 / 3.6;
const m = metersPerDegree(C.lat);
const at = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return { lat: C.lat + (r * Math.sin(a)) / m.lat, lon: C.lon + (r * Math.cos(a)) / m.lon };
};
/** 角度 from〜to(度)を走ったログ。speed で各点の速度を変えられる */
function ride(from: number, to: number, speed: (i: number, n: number) => number = () => 100): TrackLog {
  const step = ((V * 0.1) / R) * (180 / Math.PI);                       // 0.1 秒で進む角度
  const n = Math.floor((to - from) / step) + 1;
  const log: TrackLog = {
    fileName: 'ring.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
    t: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const p = at(from + i * step);
    log.t[i] = i * 0.1; log.lat[i] = p.lat; log.lon[i] = p.lon; log.speed[i] = speed(i, n);
  }
  return log;
}
/** 角度 deg の位置で、コースを横切る線 */
const lineAt = (deg: number): GeoLine => ({ a: at(deg, R - 10), b: at(deg, R + 10) });
const PERIOD = (2 * Math.PI * R) / V;                                      // 1 周の時間(約 67.9 秒)

describe('1 周分のログ(輪)の判定', () => {
  it('始点と終点が近く、どちらも走行中で、向きもそろっていれば輪とみなす', () => {
    const c = checkLoop(ride(0, 360));
    expect(c?.closed).toBe(true);
    expect(c!.gapM).toBeLessThan(3);
    expect(c!.turnDeg).toBeLessThan(5);
  });

  it('1 周の途中まで(始点と終点が離れている)は輪とみなさない', () => {
    expect(checkLoop(ride(0, 300))?.closed).toBe(false);
  });

  it('止まった状態で始まって終わるログ(ピットで記録を始めて止めた)は輪とみなさない', () => {
    const log = ride(0, 360, (i, n) => (i < 5 || i > n - 6 ? 0 : 100));
    expect(checkLoop(log)?.closed).toBe(false);
  });

  it('輪でないログは closeLoop でそのまま。輪は 3 周分につなぎ、2 回目に呼んでも同じ', () => {
    const open = ride(0, 300);
    expect(closeLoop(open)).toBe(open);
    const ring = ride(0, 360);
    const closed = closeLoop(ring);
    expect(closed.loop?.n).toBe(ring.t.length);
    expect(closed.t.length).toBe(3 * ring.t.length - 2);
    expect(closed.loop!.period).toBeCloseTo(PERIOD, 0);
    for (let i = 1; i < closed.t.length; i++) expect(closed.t[i]).toBeGreaterThan(closed.t[i - 1]);   // 時刻は戻らない
    expect(closeLoop(closed)).toBe(closed);
  });
});

describe('1 周分のログ(輪)のラップ', () => {
  it('計測ラインがログの途中にあっても、1 周分の完了ラップになる(そのままでは参考値)', () => {
    const ring = ride(0, 360);
    const before = detectLaps(ring, lineAt(120));
    expect(before).toHaveLength(1);
    expect(before[0].complete).toBe(false);
    const laps = detectLaps(closeLoop(ring), lineAt(120));
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({ number: 1, complete: true });
    expect(laps[0].duration).toBeCloseTo(PERIOD, 0);
  });

  it('計測ラインが始点に重なっていても、同じ通過を 2 回数えない(1 周分のラップは 1 つ)', () => {
    const laps = detectLaps(closeLoop(ride(0, 360)), lineAt(0.05));
    expect(laps).toHaveLength(1);
    expect(laps[0].complete).toBe(true);
    expect(laps[0].duration).toBeCloseTo(PERIOD, 0);
  });

  it('つなぎ目をまたぐラップでも、セクターの通過を数える', () => {
    const laps = detectLaps(closeLoop(ride(0, 360)), lineAt(270), [lineAt(30), lineAt(180)]);
    const s = laps[0].sectorTimes;
    expect(s[0]).toBeCloseTo((PERIOD * 120) / 360, 0);                        // 270° → 30°(つなぎ目をまたぐ)
    expect(s[1]).toBeCloseTo((PERIOD * 270) / 360, 0);
  });

  it('元のログで完了ラップが取れるとき(2 周分の輪)は、今までと同じ結果', () => {
    const two = ride(0, 720);
    const closed = closeLoop(two);
    expect(closed.loop).toBeDefined();
    const before = detectLaps(two, lineAt(120));
    const after = detectLaps(closed, lineAt(120));
    expect(after).toEqual(before);
    expect(after.filter((l) => l.complete)).toHaveLength(1);
  });

  it('計測ラインを通らないときは、今までと同じく全体を参考値のラップにする', () => {
    const ring = ride(0, 360);
    const far: GeoLine = { a: { lat: 34, lon: 132 }, b: { lat: 34.001, lon: 132.001 } };
    expect(detectLaps(closeLoop(ring), far)).toEqual(detectLaps(ring, far));
  });
});
