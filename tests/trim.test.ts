import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  type TrackLog, applyCuts, closeLoop, detectLaps, findCrossings, normalizeCuts, parseCln, parseSci, parseVbo, stopCandidates,
} from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';

// 走行ログの取り込み範囲(案件 59): 止まっている区間の候補・区間を取り込まないログ・保存と読み込み時の当てはめ
const fx = (n: string) => `fixtures/${n}`;

/** 1 秒ごとのログ。parts = [秒数, 速度 km/h] の並び。走っている間は東へ進む(速度に比例) */
function makeLog(parts: [number, number][]): TrackLog {
  const t: number[] = [], lat: number[] = [], lon: number[] = [], speed: number[] = [];
  let x = 0, sec = 0;
  for (const [len, v] of parts) for (let i = 0; i < len; i++) {
    t.push(sec++); lat.push(33); lon.push(131 + x); speed.push(v);
    x += v / 3.6 / 93000;                            // 1 秒に進む経度(およそ)
  }
  return {
    fileName: 'x.vbo', createdUtc: null, startEpochMs: 1_000_000, columns: [], comments: [],
    t: Float64Array.from(t), lat: Float64Array.from(lat), lon: Float64Array.from(lon), speed: Float64Array.from(speed),
    height: Float64Array.from(t, () => 100),
  };
}

describe('止まっている区間の候補(stopCandidates)', () => {
  it('先頭・途中(5 分以上)・末尾の停止を、走っている部分の前後 30 秒を残して候補にする', () => {
    const log = makeLog([[100, 0], [200, 80], [400, 0], [200, 80], [200, 0], [100, 80], [1000, 0]]);
    expect(stopCandidates(log)).toEqual([
      { kind: 'head', from: 0, to: 70 },                 // 100 秒目に走り出す → 70 秒まで
      { kind: 'middle', from: 330, to: 669 },            // 300〜699 秒の停止(400 秒) → 前後 30 秒を残す
      { kind: 'tail', from: 1229, to: 2199 },            // 最後に走ったのは 1199 秒
    ]);                                                  // 900〜1099 秒の停止(200 秒)は候補にしない
  });

  it('先頭・末尾の停止が短い(30 秒未満)なら候補にしない。走っていないログは候補なし', () => {
    expect(stopCandidates(makeLog([[40, 0], [300, 80], [40, 0]]))).toEqual([]);
    expect(stopCandidates(makeLog([[600, 0]]))).toEqual([]);
  });
});

describe('区間を取り込まないログ(applyCuts)', () => {
  const log = makeLog([[100, 0], [200, 80], [400, 0], [200, 80], [100, 0]]);

  it('残した先頭を 0 に置き直し、開始時刻をずらす。つなぎ目を gaps に覚える。元のログは変えない', () => {
    const out = applyCuts(log, [{ from: 0, to: 69.5 }, { from: 330, to: 669 }]);
    expect(out.t.length).toBe(log.t.length - 70 - 340);
    expect(out.t[0]).toBe(0);
    expect(out.startEpochMs).toBe(1_000_000 + 70_000);
    expect(out.gaps).toEqual([260]);                     // 70〜329 秒の 260 点のあとが 670 秒
    expect(out.t[260] - out.t[259]).toBe(670 - 329);     // 時刻は飛ぶ(経過時間はそのまま)
    expect(out.lon[0]).toBe(log.lon[70]);
    expect(out.height?.length).toBe(out.t.length);
    expect(log.t.length).toBe(1000);
  });

  it('区間が無い・ログの外なら、元のログをそのまま返す。全部を消すときはエラー', () => {
    expect(applyCuts(log, [])).toBe(log);
    expect(applyCuts(log, [{ from: 2000, to: 3000 }])).toBe(log);
    expect(() => applyCuts(log, [{ from: 0, to: 999 }])).toThrow();
  });

  it('区間は並べ替え、重なりをまとめ、ログの範囲に収める', () => {
    expect(normalizeCuts([{ from: 50, to: 10 }, { from: 0, to: 20 }, { from: 900, to: 2000 }, { from: 5, to: 5 }], 999))
      .toEqual([{ from: 0, to: 50 }, { from: 900, to: 999 }]);
  });

  it('つなぎ目をまたいでも、計測ラインの通過には数えない。途中を消したログは 1 周分のログ(輪)として扱わない', () => {
    const x = 131 + 50 * 80 / 3.6 / 93000;              // 走り出して 50 秒(150 秒目)の位置
    const line = { a: { lat: 32.999, lon: x }, b: { lat: 33.001, lon: x } };
    expect(findCrossings(log, line)).toHaveLength(1);    // 走っている途中で通過
    const out = applyCuts(log, [{ from: 120, to: 200 }]);
    expect(findCrossings(out, line)).toHaveLength(0);    // 通過したあたりを消すと、飛んだ所では数えない
    expect(closeLoop(out)).toBe(out);
  });
});

const bigPath = fx('session_20260506_094550_autopolis.vbo');
describe.skipIf(!existsSync(bigPath))('実ログ(オートポリス、13 ラップ)', () => {
  const control = parseCln(readFileSync(fx('cl_autopolis.cln'), 'utf8'))[0];
  const sectors = parseSci(readFileSync(fx('autopolis.sci'), 'utf8')).map((s) => s.line);
  const log = parseVbo(readFileSync(bigPath, 'utf8'), 'a.vbo');

  it('停止の候補をすべて取り込まなくても、ラップの数・タイム・セクタータイムは変わらない', () => {
    const cands = stopCandidates(log);
    expect(cands.map((c) => c.kind)).toEqual(['head', 'middle', 'middle', 'middle', 'tail']);
    const out = applyCuts(log, cands);
    expect(out.t.length).toBeLessThan(log.t.length * 0.6);
    const before = detectLaps(log, control, sectors), after = detectLaps(out, control, sectors);
    expect(after).toHaveLength(13);
    after.forEach((l, i) => {
      expect(l.duration).toBeCloseTo(before[i].duration, 6);
      l.sectorTimes.forEach((s, k) => expect(s).toBeCloseTo(before[i].sectorTimes[k]!, 6));
    });
    expect(after[4].duration).toBeCloseTo(4775.3, 0);    // ピットで止まった LAP 5 も、経過時間はそのまま
  });
});

describe('取り込み範囲の保存と、読み込むときの当てはめ(Session)', () => {
  const vbo = readFileSync(fx('20260913140139_UTC.vbo'), 'utf8');
  const NAME = '20260913140139_UTC.vbo', PATH = '/data/a.vbo';
  const file = { name: NAME, size: vbo.length, text: async () => vbo } as unknown as File;
  const id = `${NAME}:${vbo.length}`;
  const raw = parseVbo(vbo, NAME);

  it('setTrim で保存した区間を、次に読み込むときから当てはめる(デスクトップ版の前回のファイルの読み直しも)', async () => {
    const store = new MemoryStore();
    const s1 = new Session(store);
    s1.setTrim(id, [{ from: 0, to: 10 }]);
    expect(JSON.parse(store.get('trims')!)).toEqual({ [id]: [{ from: 0, to: 10 }] });
    expect(s1.trimOf(id)).toEqual([{ from: 0, to: 10 }]);
    await s1.addVboFile(file, PATH, 0);
    const got = s1.sets[0].logs[0].log;
    expect(got.t.length).toBeLessThan(raw.t.length);
    expect(got.startEpochMs).toBeGreaterThan(raw.startEpochMs!);

    const s2 = new Session(store);                     // 次に起動したとき(前回のファイルを読み直す)
    await s2.restoreLast(async (p) => (p === PATH ? vbo : null));
    expect(s2.sets[0].logs[0].log.t.length).toBe(got.t.length);

    s2.setTrim(id, []);                                // 空で消す
    expect(JSON.parse(store.get('trims')!)).toEqual({});
    expect(s2.trimOf(id)).toEqual([]);
  });
});
