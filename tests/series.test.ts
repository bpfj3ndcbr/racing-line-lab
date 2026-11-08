import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PlaybackEngine, alignedSeries, buildLapSeries, detectLaps, parseCln, parseSci, parseVbo, sampleSeries, timeAtDistance } from '../src/core';

const fx = (n: string) => `fixtures/${n}`;
const control = parseCln(readFileSync(fx('cl_autopolis.cln'), 'utf8'))[0];
const sectors = parseSci(readFileSync(fx('autopolis.sci'), 'utf8')).map((s) => s.line);
const log = parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');
const lap = detectLaps(log, control, sectors)[0];
const s = buildLapSeries(log, lap);

describe('ラップの時系列', () => {
  it('開始 0 秒・終了が duration、時刻は単調増加', () => {
    expect(s.t[0]).toBe(0);
    expect(s.duration).toBeCloseTo(lap.duration, 6);
    for (let i = 1; i < s.t.length; i++) expect(s.t[i]).toBeGreaterThan(s.t[i - 1]);
  });
  it('走行距離は約4.7km で単調増加', () => {
    expect(s.distance).toBeGreaterThan(4400);
    expect(s.distance).toBeLessThan(5000);
    for (let i = 1; i < s.dist.length; i++) expect(s.dist[i]).toBeGreaterThanOrEqual(s.dist[i - 1]);
  });
  it('位置補正は座標全体の平行移動(東へ 10m ≒ 経度が増える)', () => {
    const moved = buildLapSeries(log, lap, { east: 10, north: 0 });
    expect(moved.lon[100]).toBeGreaterThan(s.lon[100]);
    expect(moved.lat[100]).toBeCloseTo(s.lat[100], 9);
    expect((moved.lon[100] - s.lon[100]) * 91000).toBeCloseTo(10, 0);
  });
  it('サンプリング: 端に張り付き、補間でき、距離からの逆引きと往復で一致する', () => {
    expect(sampleSeries(s, -5).dist).toBe(0);
    expect(sampleSeries(s, 9999).dist).toBeCloseTo(s.distance, 6);
    const mid = sampleSeries(s, 70.03);
    expect(mid.speed).toBeGreaterThan(40);
    expect(timeAtDistance(s, mid.dist)).toBeCloseTo(70.03, 1);
    expect(timeAtDistance(s, 0)).toBe(0);
    expect(timeAtDistance(s, 1e9)).toBeCloseTo(s.duration, 6);
    expect(mid.heading).toBeGreaterThanOrEqual(0);
    expect(mid.heading).toBeLessThan(360);
  });
  it.skipIf(!existsSync(fx('session_20260506_094550_autopolis.vbo')))('RaceChrono LAP2 も距離が近い(同じコース)', () => {
    const big = parseVbo(readFileSync(fx('session_20260506_094550_autopolis.vbo'), 'utf8'), 'b.vbo');
    const l2 = detectLaps(big, control, sectors)[1];
    const b = buildLapSeries(big, l2);
    expect(b.duration).toBeCloseTo(146.5, 0);
    expect(Math.abs(b.distance - s.distance)).toBeLessThan(150);
  });
});

describe('再生エンジン', () => {
  const mk = (d = 10) => { const e = new PlaybackEngine(); e.setDuration(d); return e; };
  it('再生中だけ進み、最後で止まる。終わってから再生すると頭から', () => {
    const e = mk(); e.tick(1); expect(e.t).toBe(0);
    e.play(); e.tick(2.5); expect(e.t).toBeCloseTo(2.5);
    e.tick(100); expect(e.t).toBe(10); expect(e.playing).toBe(false);
    e.play(); expect(e.t).toBe(0); expect(e.playing).toBe(true);
  });
  it('再生速度', () => { const e = mk(); e.setRate(2); e.play(); e.tick(1); expect(e.t).toBeCloseTo(2); });
  it('コマ送り・戻しは 0.1 秒刻み(端は超えない)', () => {
    const e = mk(); e.seek(1.234);
    e.step(1); expect(e.t).toBeCloseTo(1.3, 6);
    e.step(1); expect(e.t).toBeCloseTo(1.4, 6);
    e.step(-1); expect(e.t).toBeCloseTo(1.3, 6);
    e.seek(1.234); e.step(-1); expect(e.t).toBeCloseTo(1.2, 6);
    e.seek(0); e.step(-1); expect(e.t).toBe(0);
    e.seek(10); e.step(1); expect(e.t).toBe(10);
  });
  it('10回のコマ送りでちょうど 1.0 秒(誤差が溜まらない)', () => {
    const e = mk(); for (let i = 0; i < 10; i++) e.step(1);
    expect(e.t).toBeCloseTo(1.0, 9);
  });
  it('長さが縮むと位置も収まる', () => { const e = mk(); e.seek(9); e.setDuration(5); expect(e.t).toBe(5); });
});

describe.skipIf(!existsSync(fx('session_20260506_094550_autopolis.vbo')))('距離の横軸を物差しに投影してそろえる(案件 20、オートポリスの実際のログ、10Hz)', () => {
  const ctl = parseCln(readFileSync(fx('cl_autopolis.cln'), 'utf8'))[0];
  const secs = parseSci(readFileSync(fx('autopolis.sci'), 'utf8')).map((s) => s.line);
  const big = parseVbo(readFileSync(fx('session_20260506_094550_autopolis.vbo'), 'utf8'), 's.vbo');
  const laps = detectLaps(big, ctl, secs).filter((l) => l.complete);
  const series = laps.map((l) => buildLapSeries(big, l));

  it('セクターを通る位置の距離が、全ラップでそろう(ピットから出たラップも含む)', () => {
    const r = series[0];
    let rawMax = 0, alignedMax = 0;
    laps.forEach((l, i) => {
      const a = alignedSeries(r, series[i]);
      l.sectorTimes.forEach((t, k) => {
        const t0 = laps[0].sectorTimes[k];
        if (t == null || t0 == null) return;
        const target = sampleSeries(r, t0).dist;
        rawMax = Math.max(rawMax, Math.abs(sampleSeries(series[i], t).dist - target));
        alignedMax = Math.max(alignedMax, Math.abs(sampleSeries(a, t).dist - target));
      });
    });
    expect(rawMax).toBeGreaterThan(20);                                 // 今の距離では、数十 m ずれる
    expect(alignedMax).toBeLessThan(1);
  });
});
