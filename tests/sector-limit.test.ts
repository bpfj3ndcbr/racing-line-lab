// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_SECTORS, formatSci, parseCln, parseSci, roundLine, type GeoLine } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';

const cln = readFileSync('fixtures/cl_autopolis.cln', 'utf8');
const sci = readFileSync('fixtures/autopolis.sci', 'utf8');
const control = roundLine(parseCln(cln)[0]);
const base = parseSci(sci).map((x) => roundLine(x.line));
/** n 本のセクター(線は少しずつずらして並べる。数だけが問題なので、中身は何でもよい) */
const many = (n: number): GeoLine[] => Array.from({ length: n }, (_, i) => {
  const l = base[i % base.length];
  return { a: { lat: l.a.lat + i * 1e-6, lon: l.a.lon }, b: { lat: l.b.lat + i * 1e-6, lon: l.b.lon } };
});

let session: Session;
beforeEach(() => { session = new Session(new MemoryStore()); });

describe('セクターは最大 8 本まで(案件 6)', () => {
  it('上限は 8 本', () => { expect(MAX_SECTORS).toBe(8); });

  it('画面で決めた線の登録: 8 本までは登録でき、9 本は登録できない(サーキットは増えない)', () => {
    expect(session.registerCircuitLines('A', control, many(8)).ok).toBe(true);
    const r = session.registerCircuitLines('B', control, many(9));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('最大 8 本');
    expect(session.circuits.map((c) => c.name)).toEqual(['A']);
  });

  it('保存済みのサーキットの保存: 9 本にはできず、前のセクターのまま', () => {
    session.registerCircuitLines('A', control, many(3));
    const id = session.circuits[0].id;
    const r = session.setCircuitLines(id, control, many(9));
    expect(r.ok).toBe(false);
    expect(session.circuits[0].sectors).toHaveLength(3);
    expect(session.setCircuitLines(id, control, many(8)).ok).toBe(true);
    expect(session.circuits[0].sectors).toHaveLength(8);
  });

  it('.sci の読み込み(新規登録・読み直し)も、9 本以上は受け付けない', () => {
    const sci9 = formatSci(many(9)), sci8 = formatSci(many(8));
    expect(parseSci(sci9)).toHaveLength(9);
    const r = session.registerCircuit('F', cln, sci9);
    expect(r.ok).toBe(false);
    expect(session.circuits).toHaveLength(0);
    expect(session.registerCircuit('F', cln, sci8).ok).toBe(true);
    const id = session.circuits[0].id;
    expect(session.reloadSectors(id, sci9).ok).toBe(false);
    expect(session.circuits[0].sectors).toHaveLength(8);
  });
});
