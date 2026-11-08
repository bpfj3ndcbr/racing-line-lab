import { describe, expect, it } from 'vitest';
import {
  type LapSeries, alignedSeries, metersPerDegree, pickRuler, projectDistances, sampleInterval, sampleSeries,
} from '../src/core';

// 距離の横軸を、物差しの走行ラインに投影してそろえる(案件 20)。走行ログのファイルが無くても動く(実際のログでの確認は series.test.ts)

const O = { lat: 33.0388, lon: 130.9733 };
const m = metersPerDegree(O.lat);

/**
 * 平面上の点(m)の並びから、ラップの時系列を作る。速度は点の間の長さから求め、scale 倍にする(速度の記録の誤差)。
 * 走行距離は、アプリと同じく速度 × 時間の積み上げ。
 */
function mk(pts: [number, number][], dt: number, scale = 1): LapSeries {
  const n = pts.length;
  const t = Float64Array.from(pts, (_, i) => i * dt);
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const span = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * dt;
    speed[i] = (Math.hypot(b[0] - a[0], b[1] - a[1]) / span) * 3.6 * scale;
  }
  const dist = new Float64Array(n);
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + ((speed[i] + speed[i - 1]) / 2 / 3.6) * dt;
  return {
    t, speed, dist, duration: t[n - 1], distance: dist[n - 1],
    lat: Float64Array.from(pts, (p) => O.lat + p[1] / m.lat),
    lon: Float64Array.from(pts, (p) => O.lon + p[0] / m.lon),
  };
}

/** 半径 r の円を 1 周(真東から反時計回り)。1 周を n 点で */
const circle = (r: number, n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);

/** 時刻 tau に、円の上で何度の位置にいるか(0〜360) */
const angleAt = (s: LapSeries, tau: number) => {
  const p = sampleSeries(s, tau);
  return ((Math.atan2((p.lat - O.lat) * m.lat, (p.lon - O.lon) * m.lon) * 180) / Math.PI + 360) % 360;
};

describe('物差しのラインに投影した距離', () => {
  // 物差し: 半径 200 m の円を 10Hz で。比べる車: 外側(半径 206 m)を回り、速度の記録が 2% 大きい
  const ruler = mk(circle(200, 600), 0.1);
  const other = mk(circle(206, 540), 0.1, 1.02);

  it('今の距離(速度の積み上げ)は、同じ位置でも車ごとに違う', () => {
    const half = other.duration / 2;                                   // 円の反対側(180°)
    expect(angleAt(other, half)).toBeCloseTo(180, 0);
    const rulerHalf = sampleSeries(ruler, ruler.duration / 2).dist;
    expect(sampleSeries(other, half).dist - rulerHalf).toBeGreaterThan(30);
  });

  it('投影した距離は、同じ位置なら物差しと同じになる(走行ラインと速度の誤差によらない)', () => {
    const a = alignedSeries(ruler, other);
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const tau = other.duration * f;
      const deg = angleAt(other, tau);
      const rulerDist = ruler.distance * (deg / 360);
      expect(Math.abs(sampleSeries(a, tau).dist - rulerDist)).toBeLessThan(0.5);
    }
    expect(a.dist[0]).toBe(0);
    expect(a.distance).toBe(ruler.distance);                            // どちらも 1 周を走り切ったラップ
    for (let i = 1; i < a.dist.length; i++) expect(a.dist[i]).toBeGreaterThanOrEqual(a.dist[i - 1]);
  });

  it('1Hz のログでも、ほぼ同じ位置になる', () => {
    const slow = mk(circle(206, 54), 1, 1.02);                         // 比べる車が 1Hz
    const a = alignedSeries(ruler, slow);
    for (const f of [0.25, 0.5, 0.75]) {
      const tau = slow.duration * f;
      expect(Math.abs(sampleSeries(a, tau).dist - ruler.distance * (angleAt(slow, tau) / 360))).toBeLessThan(1);
    }
  });

  it('物差し自身はそのまま', () => {
    expect(alignedSeries(ruler, ruler)).toBe(ruler);
    const d = projectDistances(ruler, ruler);
    for (let i = 0; i < d.length; i += 50) expect(d[i]).toBeCloseTo(ruler.dist[i], 6);
  });

  it('行きと帰りが近くを通るヘアピンでも、帰りの道に飛ばない', () => {
    // 東へ 300 m → 半径 10 m で折り返し → 20 m 北を西へ 300 m(行きと帰りの間は 20 m)
    const path = (lane: number, step: number): [number, number][] => {
      const p: [number, number][] = [];
      for (let x = 0; x <= 300; x += step) p.push([x, lane]);
      for (let k = 1; k < 20; k++) {
        const a = -Math.PI / 2 + (Math.PI * k) / 20;
        p.push([300 + (10 - lane) * Math.cos(a), 10 + (10 - lane) * Math.sin(a)]);
      }
      for (let x = 300; x >= 0; x -= step) p.push([x, 20 - lane]);
      return p;
    };
    const r = mk(path(0, 3), 0.1);
    const c = mk(path(4, 3), 0.1, 0.97);                                // 4 m 内側を走る
    const d = projectDistances(r, c);
    for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBeLessThan(10);   // 途中で大きく飛ばない
    const i = c.t.length >> 2;                                          // 行きの途中(西から約 1/4)
    const x = (c.lon[i] - O.lon) * m.lon;
    expect(d[i]).toBeCloseTo(x, -1);                                    // 物差しの行きの道の、同じ x の位置
  });

  it('ラインから離れた区間(ピットロードなど)では距離を進めず、ラインに戻ったところから合わせ直す', () => {
    const r = mk(Array.from({ length: 1001 }, (_, i) => [i, 0]), 0.05);      // 東へ 1000 m
    const p: [number, number][] = [];
    for (let x = 0; x <= 200; x += 2) p.push([x, 0]);
    for (let k = 1; k <= 30; k++) p.push([200 + k * 2, k * 2]);              // 北へ外れて
    for (let x = 260; x <= 500; x += 2) p.push([x, 60]);                     // 60 m 離れたまま進み
    for (let k = 1; k <= 30; k++) p.push([500 + k * 2, 60 - k * 2]);         // 戻ってくる
    for (let x = 562; x <= 1000; x += 2) p.push([x, 0]);
    const c = mk(p, 0.1);
    const d = projectDistances(r, c);
    const at = (x: number) => d[p.findIndex((q) => q[0] >= x && q[1] === 0 && q[0] > 500)];
    expect(at(700)).toBeCloseTo(700, -1);                                    // 外れていた区間の長さに引きずられない
    expect(d[d.length - 1]).toBe(r.distance);
  });
});

describe('物差しの選び方', () => {
  const ten = mk(circle(200, 600), 0.1), twenty = mk(circle(200, 1200), 0.05), one = mk(circle(200, 60), 1);
  it('記録の間隔の中央値', () => {
    expect(sampleInterval(ten)).toBeCloseTo(0.1, 9);
    expect(sampleInterval(one)).toBeCloseTo(1, 9);
  });
  it('記録の間隔がいちばん細かい車を選ぶ。同じなら先の車(基準車)', () => {
    expect(pickRuler([{ series: one, complete: true }, { series: ten, complete: true }, { series: twenty, complete: true }])).toBe(2);
    expect(pickRuler([{ series: ten, complete: true }, { series: mk(circle(205, 600), 0.1), complete: true }])).toBe(0);
    expect(pickRuler([{ series: one, complete: true }])).toBe(0);
  });
  it('1 周を走り切ったラップを優先する', () => {
    expect(pickRuler([{ series: one, complete: true }, { series: twenty, complete: false }])).toBe(0);
  });
});
