import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session, type WorkSet } from '../src/store/session';

// 比較セットの設定は、前回の状態の復元(デスクトップ版)と一時保存からの復元(Web 版)の、どちらでも同じように戻る(案件 38)。
// 設定の項目を足したときは、ここの prefsOf にも足すこと(片方の復元だけ直し忘れると、このテストで分かる)
const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const vbo = readFileSync(fx('20260913140139_UTC.vbo'), 'utf8');
const NAME = '20260913140139_UTC.vbo', PATH = '/data/a.vbo';
const file = { name: NAME, size: vbo.length, text: async () => vbo } as unknown as File;

const prefsOf = (w: WorkSet) => ({
  circuitId: w.selectedCircuitId, sort: w.sort, showSectors: w.showSectors, sectorMode: w.sectorMode, assignment: w.assignment,
});

/** 比較セット 2 の設定を、すべて初期値と違う値にしたセッション */
async function original(store: MemoryStore): Promise<Session> {
  const s = new Session(store);
  s.registerCircuit('オートポリス', cln, sci);
  s.registerCircuit('オートポリス(別)', cln, sci);
  await s.addVboFile(file, PATH, 1);
  s.setCircuit(s.circuits[1].id, 1);
  s.toggleSort('time', 1);
  s.toggleSort('time', 1);
  s.toggleSectors(1);
  s.setSectorMode('cumulative', 1);
  s.toggleAssignment('B', { logId: s.sets[1].logs[0].id, lap: 1 }, 1);
  return s;
}

describe('比較セットの設定は、2 つの復元のどちらでも同じように戻る(案件 38)', () => {
  it('サーキットの指定・並べ替え・セクターの表示・区間 / 通過・割り当て', async () => {
    const store = new MemoryStore();
    const s1 = await original(store);
    const want = prefsOf(s1.sets[1]);
    expect(want).toEqual({
      circuitId: s1.circuits[1].id, sort: { key: 'time', dir: -1 }, showSectors: true, sectorMode: 'cumulative',
      assignment: { A: null, B: { logId: s1.sets[1].logs[0].id, lap: 1 }, C: null, D: null },
    });
    const resume = JSON.parse(JSON.stringify(s1.resumeState()));

    // 前回の状態(lastSession)から
    const last = new Session(store);
    await last.restoreLast(async (p) => (p === PATH ? vbo : null));
    // 一時保存(ResumeState)から
    const res = new Session(store);
    expect(res.restoreResume(resume, new Map([[s1.sets[1].logs[0].id, parseVbo(vbo, NAME)]]))).toBe(1);

    for (const s of [last, res]) {
      expect(s.sets[1].logs.map((l) => l.id)).toEqual([s1.sets[1].logs[0].id]);
      expect(prefsOf(s.sets[1])).toEqual(want);
      expect(prefsOf(s.sets[0])).toEqual(prefsOf(s1.sets[0]));         // 触っていない比較セットは初期値のまま
    }
  });
});
