import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { closeLoop, detectLaps, distanceM, lineCandidate, parseCln, parseVbo } from '../src/core';

// 実際の走行ログ(fixtures/)で、計測ラインの候補(案件 3)を確かめる
const fx = (name: string) => readFileSync(`fixtures/${name}`, 'utf8');

describe('RaceChrono の [laptiming] から作る候補(オートポリス 13 ラップ)', () => {
  const log = parseVbo(fx('session_20260506_094550_autopolis.vbo'), 'ap.vbo');
  const c = lineCandidate(log)!;

  it('名前は [session data] の name、セクターは 2 本', () => {
    expect(c.source).toBe('laptiming');
    expect(c.name).toBe('Autopolis');
    expect(c.sectors.length).toBe(2);
  });

  it('その計測ラインで、妥当なラップタイム(2 分 25 秒〜2 分 32 秒)の完了ラップが取れる', () => {
    const laps = detectLaps(log, c.control, c.sectors).filter((l) => l.complete && l.duration < 200);
    expect(laps.filter((l) => l.duration > 145 && l.duration < 152).length).toBeGreaterThanOrEqual(8);
    for (const l of laps) expect(l.sectorTimes.every((s) => s !== null)).toBe(true);
    // セクターは通る順(S1 が先)
    expect(laps[0].sectorTimes[0]!).toBeLessThan(laps[0].sectorTimes[1]!);
  });

  it('計測ラインの中心は、テスト用の .cln の計測ラインの近く(数 m)', () => {
    const cln = parseCln(fx('cl_autopolis.cln'))[0];
    const mid = (l: typeof cln) => ({ lat: (l.a.lat + l.b.lat) / 2, lon: (l.a.lon + l.b.lon) / 2 });
    expect(distanceM(mid(c.control), mid(cln))).toBeLessThan(10);
  });
});

describe('1 周分のログ(輪)から作る候補', () => {
  it('計測ラインだけの候補ができ、その線で 1 周分の完了ラップが取れる', () => {
    const log = closeLoop(parseVbo(fx('20260913140139_UTC.vbo'), 'loop.vbo'));
    const c = lineCandidate(log)!;
    expect(c.source).toBe('loop');
    expect(c.sectors).toEqual([]);
    const laps = detectLaps(log, c.control).filter((l) => l.complete);
    expect(laps.length).toBe(1);
    expect(laps[0].duration).toBeGreaterThan(140);
    expect(laps[0].duration).toBeLessThan(150);
  });
});
