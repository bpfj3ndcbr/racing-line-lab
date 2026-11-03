import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { type Circuit, emptyAssignment, matchCircuit, parseCln, parseSci, parseVbo, slotOf, toggleAssign, clearLog } from '../src/core';

const fx = (n: string) => `fixtures/${n}`;
const autopolis: Circuit = {
  id: 'ap', name: 'オートポリス',
  control: parseCln(readFileSync(fx('cl_autopolis.cln'), 'utf8'))[0],
  sectors: parseSci(readFileSync(fx('autopolis.sci'), 'utf8')).map((s) => s.line),
};
// 地球の反対側のダミー(通過しない)
const dummy: Circuit = {
  id: 'dm', name: 'ダミー',
  control: { a: { lat: 35.0, lon: 139.0 }, b: { lat: 35.001, lon: 139.001 } }, sectors: [],
};

describe('サーキットの自動判定', () => {
  const utc = parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');
  it('コントロールラインを通る方のサーキットを選ぶ', () => {
    expect(matchCircuit(utc, [dummy, autopolis])?.circuit.id).toBe('ap');
  });
  it('どれも通らなければ null', () => {
    expect(matchCircuit(utc, [dummy])).toBeNull();
    expect(matchCircuit(utc, [])).toBeNull();
  });
  it.skipIf(!existsSync(fx('session_20260506_094550_autopolis.vbo')))('RaceChrono ログは14回通過', () => {
    const big = parseVbo(readFileSync(fx('session_20260506_094550_autopolis.vbo'), 'utf8'), 'b.vbo');
    expect(matchCircuit(big, [dummy, autopolis])).toMatchObject({ crossings: 14 });
  });
});

describe('A〜D の割り当て', () => {
  const r1 = { logId: 'f1', lap: 1 }, r2 = { logId: 'f1', lap: 2 }, r3 = { logId: 'f2', lap: 1 };
  it('同じボタンをもう一度押すと解除', () => {
    const a = toggleAssign(emptyAssignment(), 'A', r1);
    expect(a.A).toEqual(r1);
    expect(toggleAssign(a, 'A', r1).A).toBeNull();
  });
  it('同じ枠に別ラップを入れると置き換わる', () => {
    const a = toggleAssign(toggleAssign(emptyAssignment(), 'A', r1), 'A', r2);
    expect(a.A).toEqual(r2);
  });
  it('同じラップは1枠だけ(別の枠へ移る)', () => {
    const a = toggleAssign(toggleAssign(emptyAssignment(), 'A', r1), 'B', r1);
    expect(a.A).toBeNull();
    expect(a.B).toEqual(r1);
    expect(slotOf(a, r1)).toBe('B');
  });
  it('ログ単位で解除', () => {
    let a = toggleAssign(emptyAssignment(), 'A', r1);
    a = toggleAssign(a, 'B', r3);
    a = clearLog(a, 'f1');
    expect(a.A).toBeNull();
    expect(a.B).toEqual(r3);
  });
});
