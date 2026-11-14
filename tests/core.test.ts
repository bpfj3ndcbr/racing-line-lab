import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { detectLaps, formatJst, parseCln, parseSci, parseVbo, storableLog } from '../src/core';

const fx = (n: string) => `fixtures/${n}`;
const control = parseCln(readFileSync(fx('cl_autopolis.cln'), 'utf8'))[0];
const sectors = parseSci(readFileSync(fx('autopolis.sci'), 'utf8')).map((s) => s.line);

describe('.cln / .sci', () => {
  it('コントロールライン1本とセクター7本を読む', () => {
    expect(control.a.lat).toBeCloseTo(33.039045, 6);
    expect(control.b.lon).toBeCloseTo(130.97302, 6);
    expect(sectors).toHaveLength(7);
  });
});

describe('DigiSpice 変換 .vbo (1ラップ・20Hz・7列)', () => {
  const log = parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), '20260913140139_UTC.vbo');

  it('行数・サンプリング・座標変換', () => {
    expect(log.t.length).toBe(2860);
    expect(log.t[0]).toBe(0);
    expect(log.t[log.t.length - 1]).toBeCloseTo(142.92, 2);
    expect(Math.max(...log.speed)).toBeCloseTo(176.51, 2);
    expect(log.lat[0]).toBeGreaterThan(33.03);
    expect(log.lat[0]).toBeLessThan(33.04);
    expect(log.lon[0]).toBeGreaterThan(130.96);
    expect(log.lon[0]).toBeLessThan(130.98);
    expect(log.longAcc).toBeUndefined();
  });

  it('JST 表示は 2026/09/13 14:01', () => {
    expect(formatJst(log.startEpochMs!)).toBe('2026/09/13 14:01');
  });

  it('終端未通過の1ラップを参考値として作る', () => {
    const laps = detectLaps(log, control, sectors);
    expect(laps).toHaveLength(1);
    expect(laps[0].number).toBe(1);
    expect(laps[0].complete).toBe(false);
    expect(laps[0].duration).toBeCloseTo(142.9, 0);
    const exp = [0.1, 28.6, 41.7, 53.8, 75.1, 99.2, 120.8];
    exp.forEach((v, i) => expect(laps[0].sectorTimes[i]).toBeCloseTo(v, 0));
  });
});

const bigPath = fx('session_20260506_094550_autopolis.vbo');
describe.skipIf(!existsSync(bigPath))('RaceChrono .vbo (10Hz・30列・連続ログ)', () => {
  const log = parseVbo(readFileSync(bigPath, 'utf8'), 'session_20260506_094550_autopolis.vbo');
  const laps = detectLaps(log, control, sectors);

  it('10Hz・約82,000行・加速度列あり', () => {
    expect(log.t.length).toBe(82105);
    expect(log.t[1] - log.t[0]).toBeCloseTo(0.1, 3);
    expect(log.longAcc).toBeDefined();
    expect(formatJst(log.startEpochMs!)).toBe('2026/05/06 09:45');
  });

  it('RaceChrono と同じ番号で13ラップ(LAP5・LAP6 の長い区間も含む)', () => {
    expect(laps).toHaveLength(13);
    expect(laps.every((l) => l.complete)).toBe(true);
    const want: Record<number, number> = { 1: 147.4, 2: 146.5, 3: 166.4, 4: 171.2, 5: 4775.3, 6: 455.5, 7: 147.2, 13: 179.1 };
    for (const [n, d] of Object.entries(want)) expect(laps[+n - 1].duration).toBeCloseTo(d, 0);
  });

  it('LAP7 のセクター通過時刻', () => {
    const exp = [0.2, 28.5, 42.3, 54.3, 76.6, 102.1, 124.4];
    exp.forEach((v, i) => expect(laps[6].sectorTimes[i]).toBeCloseTo(v, 0));
  });

  it('保存用の写し(案件 59): 向き・高度・加速度を省き、位置・速度・時刻はそのまま。ラップの検出も同じ', () => {
    const s = storableLog(log);
    expect([s.heading, s.height, s.longAcc, s.latAcc]).toEqual([undefined, undefined, undefined, undefined]);
    expect(s.t).toBe(log.t); expect(s.lat).toBe(log.lat); expect(s.lon).toBe(log.lon); expect(s.speed).toBe(log.speed);
    expect(s.laptiming).toEqual(log.laptiming); expect(s.startEpochMs).toBe(log.startEpochMs);
    expect(log.longAcc).toBeDefined();                 // 元のログは変えない
    const again = detectLaps(s, control, sectors);
    expect(again.map((l) => [l.duration, l.sectorTimes])).toEqual(laps.map((l) => [l.duration, l.sectorTimes]));
  });

  it('位置補正(ライン側を逆方向にずらす)でも通過時刻が極端に変わらない', () => {
    const moved = detectLaps(log, control, sectors, { offset: { east: 1, north: 1 } });
    expect(moved).toHaveLength(13);
    expect(Math.abs(moved[6].duration - laps[6].duration)).toBeLessThan(0.5);
  });
});
