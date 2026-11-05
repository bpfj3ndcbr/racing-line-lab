import { beforeEach, describe, expect, it } from 'vitest';
import { type GeoLine, type TimingLine, type TrackLog, formatCln, metersPerDegree } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';

// 比較セットのサーキットは 1 つ / 計測ラインの候補(案件 3)。走行ログのファイルが無くても動く人工のログで確かめる

const R = 300, V = 100 / 3.6;
/** 中心 c の半径 300 m の円を、反時計回りに 100 km/h・10Hz で deg 度まで走るログ */
function ride(c: { lat: number; lon: number }, deg: number, extra: Partial<TrackLog> = {}): TrackLog {
  const m = metersPerDegree(c.lat);
  const step = ((V * 0.1) / R) * (180 / Math.PI);
  const n = Math.floor(deg / step) + 1;
  const log: TrackLog = {
    fileName: 'x.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
    t: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float64Array(n), ...extra,
  };
  for (let i = 0; i < n; i++) {
    const a = (i * step * Math.PI) / 180;
    log.t[i] = i * 0.1; log.lat[i] = c.lat + (R * Math.sin(a)) / m.lat; log.lon[i] = c.lon + (R * Math.cos(a)) / m.lon; log.speed[i] = 100;
  }
  return log;
}
const A = { lat: 33, lon: 131 }, B = { lat: 34.8, lon: 136.5 };
/** 円の 90° の位置(北)で、コースを横切る線 */
function northLine(c: { lat: number; lon: number }): GeoLine {
  const m = metersPerDegree(c.lat);
  return { a: { lat: c.lat + (R - 10) / m.lat, lon: c.lon }, b: { lat: c.lat + (R + 10) / m.lat, lon: c.lon } };
}
/** 北の点を計測位置、その 50 m 手前(東寄り)を 2 点目にした [laptiming] の Start */
function timingAt(c: { lat: number; lon: number }): TimingLine {
  const m = metersPerDegree(c.lat);
  return { kind: 'start', p1: { lat: c.lat + R / m.lat, lon: c.lon }, p2: { lat: c.lat + R / m.lat, lon: c.lon + 50 / m.lon }, name: 'Control line' };
}

let session: Session;
beforeEach(() => { session = new Session(new MemoryStore()); });

describe('比較セットのサーキットは 1 つ', () => {
  it('自動判定では、最初に判定できたログのサーキットがセットのサーキット。通らないログはラップ無し', () => {
    session.registerCircuit('サーキットA', formatCln([northLine(A)]), '');
    session.registerCircuit('サーキットB', formatCln([northLine(B)]), '');
    session.addLog(ride(A, 800), 'a');
    session.addLog(ride(B, 800), 'b');
    const [a, b] = session.sets[0].logs;
    expect(session.setCircuitOf(0)?.name).toBe('サーキットA');
    expect(a.circuit?.name).toBe('サーキットA');
    expect(a.laps.some((l) => l.complete)).toBe(true);
    expect(b.circuit).toBeNull();
    expect(b.outside?.name).toBe('サーキットA');
    expect(b.laps).toEqual([]);
  });

  it('「使用するサーキット」で切り替えると、そのサーキットのログにラップが出る', () => {
    session.registerCircuit('サーキットA', formatCln([northLine(A)]), '');
    session.registerCircuit('サーキットB', formatCln([northLine(B)]), '');
    session.addLog(ride(A, 800), 'a');
    session.addLog(ride(B, 800), 'b');
    session.setCircuit(session.circuits[1].id, 0);
    const [a, b] = session.sets[0].logs;
    expect(a.outside?.name).toBe('サーキットB');
    expect(b.circuit?.name).toBe('サーキットB');
    expect(b.laps.length).toBeGreaterThan(0);
  });

  it('最初のログを消すと、残ったログのサーキットがセットのサーキットになる', () => {
    session.registerCircuit('サーキットA', formatCln([northLine(A)]), '');
    session.registerCircuit('サーキットB', formatCln([northLine(B)]), '');
    session.addLog(ride(A, 800), 'a');
    session.addLog(ride(B, 800), 'b');
    session.removeLog('a', 0);
    expect(session.sets[0].logs[0].circuit?.name).toBe('サーキットB');
    expect(session.sets[0].logs[0].outside).toBeNull();
  });

  it('サーキットが決まっていなければ、どのログも未判定(outside は null)', () => {
    session.addLog(ride(A, 800), 'a');
    expect(session.setCircuitOf(0)).toBeNull();
    expect(session.sets[0].logs[0].circuit).toBeNull();
    expect(session.sets[0].logs[0].outside).toBeNull();
  });
});

describe('計測ラインの候補', () => {
  it('[laptiming] のあるログは自分の候補。無いログでも、その計測ラインを通れば、ほかのログの候補を使える', () => {
    session.addLog(ride(A, 800, { laptiming: [timingAt(A)], sessionName: 'サーキットA' }), 'rc');
    session.addLog(ride(A, 800), 'plain');
    session.addLog(ride(B, 800), 'far');
    const [rc, plain, far] = session.sets[0].logs;
    expect(rc.candidate?.source).toBe('laptiming');
    expect(rc.candidate?.name).toBe('サーキットA');
    expect(session.candidateFor(rc)?.from.id).toBe('rc');
    expect(plain.candidate).toBeNull();
    expect(session.candidateFor(plain)?.from.id).toBe('rc');
    expect(session.candidateFor(far)).toBeNull();
  });

  it('候補で登録すると、同じ計測ラインを通るログはまとめて判定される', () => {
    session.addLog(ride(A, 800, { laptiming: [timingAt(A)] }), 'rc');
    session.addLog(ride(A, 800), 'plain');
    const c = session.sets[0].logs[0].candidate!;
    session.registerCircuit('サーキットA', formatCln([c.control]), '');
    expect(session.sets[0].logs.map((l) => l.circuit?.name)).toEqual(['サーキットA', 'サーキットA']);
  });
});
