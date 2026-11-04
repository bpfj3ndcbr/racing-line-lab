// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type Lap, type TrackLog, metersPerDegree, pickPreviewRanges } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

/** 速度(km/h)の並びから、10 Hz の走行ログを作る(位置は使わない) */
function speedLog(speed: number[]): TrackLog {
  const n = speed.length;
  return {
    fileName: 's.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
    t: Float64Array.from({ length: n }, (_, i) => i / 10),
    lat: new Float64Array(n).fill(33), lon: new Float64Array(n).fill(131),
    speed: Float64Array.from(speed),
  };
}
const lap = (number: number, duration: number, startIndex: number, endIndex: number, complete = true): Lap =>
  ({ number, startTime: startIndex / 10, endTime: startIndex / 10 + duration, duration, complete, startIndex, endIndex, sectorTimes: [], baseDuration: duration, maxDuration: duration });

describe('位置補正の地図に描く区間(pickPreviewRanges)', () => {
  const log = speedLog(Array(1000).fill(100));

  it('完了ラップがあれば、速い順に 3 ラップ。並びはラップ番号の順で、終点の次のサンプルまで含める', () => {
    const laps = [lap(1, 50, 0, 99), lap(2, 40, 100, 199), lap(3, 45, 200, 299), lap(4, 42, 300, 399), lap(5, 30, 400, 499, false)];
    const p = pickPreviewRanges(log, laps);
    expect(p).toEqual({ kind: 'laps', laps: [2, 3, 4], ranges: [{ from: 100, to: 200 }, { from: 200, to: 300 }, { from: 300, to: 400 }] });
  });

  it('完了ラップが 3 つ未満なら、あるだけ。末尾のラップでもログの外へははみ出さない', () => {
    const p = pickPreviewRanges(log, [lap(1, 50, 900, 999)]);
    expect(p).toEqual({ kind: 'laps', laps: [1], ranges: [{ from: 900, to: 999 }] });
  });

  it('ラップが無ければ、30 km/h 以上の区間だけを、先頭から約 10 分ぶん(停止中は描かない)', () => {
    // 停止 100 秒 → 走行 400 秒 → 停止 100 秒 → 走行 400 秒
    const sp = [...Array(1000).fill(0), ...Array(4000).fill(120), ...Array(1000).fill(10), ...Array(4000).fill(120)];
    const p = pickPreviewRanges(speedLog(sp), [lap(1, 30, 0, 300, false)]);
    expect(p.kind).toBe('moving');
    if (p.kind !== 'moving') return;
    expect(p.ranges).toEqual([{ from: 1000, to: 4999 }, { from: 6000, to: 8001 }]);
    expect(p.seconds).toBeCloseTo(600, 1);
  });

  it('走行中の区間が 10 分に満たなければ全部。走っていないログは全体', () => {
    const p = pickPreviewRanges(speedLog([...Array(10).fill(0), ...Array(50).fill(40), 0]), []);
    expect(p).toEqual({ kind: 'moving', seconds: expect.closeTo(4.9, 5), ranges: [{ from: 10, to: 59 }] });
    expect(pickPreviewRanges(speedLog(Array(20).fill(0)), [])).toEqual({ kind: 'all', ranges: [{ from: 0, to: 19 }] });
  });
});

/**
 * 半径 100 m の円を反時計回りに回る走行ログ(10 Hz)。1 周の秒数を周ごとに変える。
 * 前後に停止中の記録を付ける(長いログの、ピットや待機の時間の代わり)
 */
const C = { lat: 33, lon: 131 }, R = 100, m = metersPerDegree(C.lat);
function circleLog(perRev: number[], idleSec: number): TrackLog {
  const t: number[] = [], lat: number[] = [], lon: number[] = [], speed: number[] = [];
  const push = (th: number, sp: number) => {
    t.push(t.length / 10); lat.push(C.lat + (R * Math.sin(th)) / m.lat); lon.push(C.lon + (R * Math.cos(th)) / m.lon); speed.push(sp);
  };
  for (let i = 0; i < idleSec * 10; i++) push(0, 0);
  let th = 0;
  for (let k = 0; k < perRev.length; k++) {
    const sp = (2 * Math.PI * R) / perRev[k];
    for (let i = 0; i < perRev[k] * 10; i++) { push(th, sp * 3.6); th += (2 * Math.PI) / (perRev[k] * 10); }
  }
  for (let i = 0; i < idleSec * 10; i++) push(th, 0);
  const f = (a: number[]) => Float64Array.from(a);
  return { fileName: 'circle.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [], t: f(t), lat: f(lat), lon: f(lon), speed: f(speed) };
}
/** 円の北の端を横切るコントロールライン(半径 80〜120 m) */
const clnText = ['1', C.lat + 80 / m.lat, C.lon, C.lat + 120 / m.lat, C.lon].map(String).join('\n');

describe('位置補正の画面: 長いログでも、ラインを崩さずに描く', () => {
  let root: HTMLElement, session: Session, maps: FakeMap[];
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    maps = [];
    session = new Session(new MemoryStore());
    mountApp(root, session, new ThemeController(new MemoryStore()), () => { const f = new FakeMap(); maps.push(f); return f; });
  });
  const open = () => root.querySelector<HTMLButtonElement>('[data-act="correct"]')!.click();
  const shown = () => root.querySelector('#cor-shown')!.textContent;
  const tracks = () => maps[maps.length - 1].tracks;

  it('ラップがあれば、ベスト 3 ラップを間引かずに、1 ラップずつ別の線で描く(停止中の 2 時間は描かない)', () => {
    session.registerCircuit('円', clnText, '');
    session.addLog(circleLog([40, 38, 34, 39, 36, 41, 40], 7200), 'c');
    const done = session.logs[0].laps.filter((l) => l.complete);
    expect(done.length).toBeGreaterThan(3);
    open();
    const best = [...done].sort((a, b) => a.duration - b.duration).slice(0, 3).map((l) => l.number).sort((a, b) => a - b);
    expect(shown()).toBe(`表示中: ベスト 3 ラップ(LAP ${best.join('・')})`);
    expect(tracks()).toHaveLength(3);
    for (const [i, no] of best.entries()) {
      const l = done.find((x) => x.number === no)!;
      expect(tracks()[i].points).toHaveLength(l.endIndex + 2 - l.startIndex);
    }
    // 隣り合う点は 0.1 秒ぶん(数 m)しか離れていない = 間を直線で飛ばしていない
    const p = tracks()[0].points;
    const gap = Math.max(...p.slice(1).map((q, i) => Math.hypot((q[0] - p[i][0]) * m.lat, (q[1] - p[i][1]) * m.lon)));
    expect(gap).toBeLessThan(3);
  });

  it('ラップが無ければ(サーキット未判定)、走行中の区間を描き、そう表示する', () => {
    session.addLog(circleLog([40, 38], 600), 'c');
    open();
    expect(shown()).toBe('表示中: 走行中(30 km/h 以上)の約 1 分(ラップが無いため)');
    expect(tracks()).toHaveLength(1);
    expect(tracks()[0].points.length).toBe(780);
  });
});
