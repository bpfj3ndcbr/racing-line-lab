import { describe, expect, it } from 'vitest';
import {
  EDGE_MIN_MOVING_SEC, type GeoLine, STOP_SEC, TAIL_MAX_SEC, type TrackLog, detectLapRun, metersPerDegree,
} from '../src/core';

// 半径 300 m の円を反時計回りに走る人工のログ(走行ログのファイルが無くても動くテスト)。
// speed(t) の速度(km/h)で 0.1 秒ごとに進む。角度 0° に計測ラインを置く
const C = { lat: 33, lon: 131 };
const R = 300;
const m = metersPerDegree(C.lat);
const at = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180;
  return { lat: C.lat + (r * Math.sin(a)) / m.lat, lon: C.lon + (r * Math.cos(a)) / m.lon };
};
const LINE: GeoLine = { a: at(0, R - 10), b: at(0, R + 10) };
const PERIOD = (2 * Math.PI * R) / (100 / 3.6);                            // 100 km/h で 1 周(約 67.9 秒)
/** -90° から 100 km/h で出たときの、最初の通過の時刻 */
const FIRST = PERIOD / 4;

function drive(startDeg: number, seconds: number, speed: (t: number) => number): TrackLog {
  const n = Math.round(seconds * 10) + 1;
  const log: TrackLog = {
    fileName: 'edges.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
    t: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float64Array(n),
  };
  let deg = startDeg;
  for (let i = 0; i < n; i++) {
    const t = i / 10, v = speed(t);
    const p = at(deg);
    log.t[i] = t; log.lat[i] = p.lat; log.lon[i] = p.lon; log.speed[i] = v;
    deg += ((v / 3.6) * 0.1 / R) * (180 / Math.PI);
  }
  return log;
}

describe('最後の通過より後(終点無しのラップ)', () => {
  // -90° から出て、2 周と 40 秒走り、コース上で止まる(STOP_SEC より長く)。そのあと少し動く(回収)
  const stopAt = FIRST + 2 * PERIOD + 40;
  const log = drive(-90, stopAt + 120, (t) => (t < stopAt ? 100 : t < stopAt + 100 ? 0 : 40));

  it('終点無しのラップ(参考値)を、最後の完了ラップの次の番号で作る。止まり始めた時点で切る', () => {
    const { laps } = detectLapRun(log, LINE);
    const done = laps.filter((l) => l.complete);
    expect(done).toHaveLength(2);
    const tail = laps[laps.length - 1];
    expect(tail).toMatchObject({ number: 3, complete: false });
    expect(tail.startTime + tail.duration).toBeCloseTo(stopAt, 0);            // 回収の移動は入らない
    expect(tail.maxDuration).toBeCloseTo(log.t[log.t.length - 1] - tail.startTime, 0);
  });

  it('短い停止(STOP_SEC 未満)では切らない', () => {
    const short = drive(-90, FIRST + 2 * PERIOD + 60, (t) => {
      const s = FIRST + 2 * PERIOD + 10;                                    // 最後の通過の 10 秒後に、10 秒だけ止まる
      return t >= s && t < s + STOP_SEC / 3 ? 0 : 100;
    });
    const tail = detectLapRun(short, LINE).laps.at(-1)!;
    expect(tail.complete).toBe(false);
    expect(tail.startTime + tail.duration).toBeCloseTo(short.t[short.t.length - 1], 0);
  });

  it(`走行中が ${EDGE_MIN_MOVING_SEC} 秒未満なら、終点無しのラップは作らない(ラップ書き出しの前後に付く数秒)`, () => {
    const lapExport = drive(-20, PERIOD * (40 / 360) + 2 * PERIOD + 4, () => 100);   // 通過の前後が数秒ずつ
    const { laps, hasHead } = detectLapRun(lapExport, LINE);
    expect(laps.every((l) => l.complete)).toBe(true);
    expect(hasHead).toBe(false);
  });

  it('終点無しのラップの終端は、記録の終わりまで(最大 30 分)延ばせる', () => {
    const { laps } = detectLapRun(log, LINE, [], { ends: { 3: 10_000 } });
    const tail = laps.at(-1)!;
    expect(tail.startTime + tail.duration).toBeCloseTo(log.t[log.t.length - 1], 0);
    expect(TAIL_MAX_SEC).toBe(1800);
  });
});

describe('最初の通過より前(始点無し)', () => {
  it('走行中の区間があれば hasHead。ラップにはしない', () => {
    const log = drive(-180, 3 * PERIOD, () => 100);                         // 半周走ってから最初の通過
    const { laps, hasHead } = detectLapRun(log, LINE);
    expect(hasHead).toBe(true);
    expect(laps[0].number).toBe(1);
    expect(laps[0].startTime).toBeGreaterThan(PERIOD / 3);
  });

  it('止まっていただけ(ピットで待っていた)なら hasHead にしない', () => {
    const log = drive(-1, 120 + 3 * PERIOD, (t) => (t < 120 ? 0 : 100));
    expect(detectLapRun(log, LINE).hasHead).toBe(false);
  });
});

describe('終端の調整', () => {
  const log = drive(-90, 40 + 3 * PERIOD + 20, () => 100);

  it('完了ラップの終端を縮めると参考値になる。番号は変わらず、通っていないセクターは null', () => {
    const sector: GeoLine = { a: at(180, R - 10), b: at(180, R + 10) };
    const { laps } = detectLapRun(log, LINE, [sector], { ends: { 2: 20 } });
    const lap = laps.find((l) => l.number === 2)!;
    expect(lap).toMatchObject({ complete: false, duration: 20 });
    expect(lap.baseDuration).toBeCloseTo(PERIOD, 0);
    expect(lap.sectorTimes).toEqual([null]);
    expect(laps.find((l) => l.number === 1)!.complete).toBe(true);         // ほかのラップはそのまま
  });

  it('本来の終点(上限)を指したときは、完了ラップのまま', () => {
    const { laps } = detectLapRun(log, LINE, [], { ends: { 1: Math.round(PERIOD) } });
    expect(laps[0].complete).toBe(true);
    expect(detectLapRun(log, LINE, [], { ends: { 1: 99_999 } }).laps[0].complete).toBe(true);
  });
});
