// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatSci, isInPassOrder, parseCln, parseSci, parseVbo, roundLine, type GeoLine } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';

const cln = readFileSync('fixtures/cl_autopolis.cln', 'utf8');
const sci = readFileSync('fixtures/autopolis.sci', 'utf8');
const control = roundLine(parseCln(cln)[0]);
/** 通った順(sci の順)のセクター */
const inOrder: GeoLine[] = parseSci(sci).map((x) => roundLine(x.line));
const reversed = [...inOrder].reverse();
const utc = () => parseVbo(readFileSync('fixtures/20260913140139_UTC.vbo', 'utf8'), 'u.vbo');

let session: Session;
beforeEach(() => { session = new Session(new MemoryStore()); });

describe('保存のとき、セクターを通った順に並べ替える(案件 83)', () => {
  it('走行ログがあれば、画面で逆に引いたセクターも、通った順に並べ替えて登録し、知らせる', () => {
    session.addLog(utc(), 'u');
    const r = session.registerCircuitLines('X', control, reversed, { announce: true });
    expect(r.ok).toBe(true);
    expect(session.circuits[0].sectors).toEqual(inOrder);
    expect(session.message).toContain('通った順に並べ替えて保存しました');
  });

  it('既存のサーキットの保存(線の編集)でも、並べ替えて保存する', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    const id = session.circuits[0].id;
    session.setCircuitLines(id, control, reversed);
    expect(session.circuits[0].sectors).toEqual(inOrder);
    expect(session.message).toContain('通った順に並べ替えて保存しました');
  });

  it('.sci の読み直しでも、並べ替えて保存する', () => {
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    const id = session.circuits[0].id;
    session.reloadSectors(id, formatSci(reversed));
    expect(session.circuits[0].sectors).toEqual(inOrder);
  });

  it('走行ログが無いときは並べ替えず、その旨を知らせる(登録のときも、保存のときも)', () => {
    const r = session.registerCircuitLines('X', control, reversed, { announce: true });
    expect(r.ok).toBe(true);
    expect(session.circuits[0].sectors).toEqual(reversed);
    expect(session.message).toContain('走行ログが無いため、セクターを並べ替えていません');
    session.setCircuitLines(session.circuits[0].id, control, inOrder);
    expect(session.message).toContain('走行ログが無いため、セクターを並べ替えていません');
  });

  it('並べ替えが要らないときは、何も知らせない', () => {
    session.addLog(utc(), 'u');
    session.registerCircuitLines('X', control, inOrder, { announce: true });
    expect(session.circuits[0].sectors).toEqual(inOrder);
    expect(session.message).toBe(`「X」を登録しました(セクター ${inOrder.length} 本)。`);
  });
});

describe('通った順の判定(isInPassOrder)', () => {
  it('時刻が増えていれば通った順。逆転していれば、通った順ではない。通過の無い所は比べない', () => {
    expect(isInPassOrder([10, 20, 30])).toBe(true);
    expect(isInPassOrder([10, null, 30])).toBe(true);
    expect(isInPassOrder([10, 30, 20])).toBe(false);
    expect(isInPassOrder([])).toBe(true);
  });
});
