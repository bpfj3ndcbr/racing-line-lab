import { describe, expect, it } from 'vitest';
import { storableLog, type LapRef, type TimingLine, type TrackLog } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { RESUME_SCHEMA, newerState } from '../src/io/resume';
import { Session, type ResumeState, type SortState } from '../src/store/session';

/*
 * 保存の形の記録(案件 60)。Web 版・PWA 版は、走行ログ(storableLog の形)と小さな状態(Session.resumeState)を保存し、
 * 次に開いたときに元に戻す。前の版のアプリが保存したものを、新しい版が読むことになる。
 *
 * ここに書いた形と実際の形が違うと、型チェックかこのテストが落ちる。落ちたら:
 *   - 前の版の保存を、新しい版でもそのまま読めるなら(項目を足しただけで、無くても動く、など)、記録を直すだけでよい
 *   - 読めないなら、src/io/resume.ts の RESUME_SCHEMA を 1 上げる(前の版の保存は捨てる)か、読み替えを足す。
 *     そのうえで、ここの RECORDED_SCHEMA と記録を直す
 * 版を公開するときは、この記録が前の版から変わったかを見れば、保存を捨てる必要があるかが分かる。
 */
const RECORDED_SCHEMA = 2;

/** 走行ログの項目: 保存する(saved)か、省く(dropped。案件 59)か。TrackLog に項目を足すと、型チェックで落ちる */
const TRACK_LOG: Record<keyof TrackLog, 'saved' | 'dropped'> = {
  fileName: 'saved', createdUtc: 'saved', startEpochMs: 'saved', columns: 'saved', comments: 'saved',
  sessionName: 'saved', laptiming: 'saved', t: 'saved', lat: 'saved', lon: 'saved', speed: 'saved',
  heading: 'dropped', height: 'dropped', longAcc: 'dropped', latAcc: 'dropped', loop: 'saved', gaps: 'saved',
};
const TIMING_LINE: Record<keyof TimingLine, true> = { kind: true, p1: true, p2: true, name: true };

type SetEntry = ResumeState['sets'][number];
/** 小さな状態の項目 */
const STATE: Record<keyof ResumeState, true> = { v: true, active: true, sets: true };
const SET_ENTRY: Record<keyof SetEntry, true> = {
  logs: true, nextNo: true, assignment: true, circuitId: true, sort: true, showSectors: true, sectorMode: true,
};
const SET_LOG: Record<keyof SetEntry['logs'][number], true> = { id: true, no: true };
const LAP_REF: Record<keyof LapRef, true> = { logId: true, lap: true };
const SORT: Record<keyof SortState, true> = { key: true, dir: true };

const keys = (o: object) => Object.keys(o).sort();

describe('保存の形の記録(案件 60)', () => {
  it('保存の版は、記録した版と同じ', () => {
    expect(RESUME_SCHEMA).toBe(RECORDED_SCHEMA);
  });

  it('走行ログは、記録した項目だけを保存する(storableLog)', () => {
    const full = Object.fromEntries(Object.keys(TRACK_LOG).map((k) => [k, 0])) as unknown as TrackLog;
    expect(keys(storableLog(full))).toEqual(Object.keys(TRACK_LOG).filter((k) => TRACK_LOG[k as keyof TrackLog] === 'saved').sort());
  });

  it('小さな状態は、記録した項目の形で保存する(Session.resumeState)', () => {
    const s = new Session(new MemoryStore());
    s.addLog({ fileName: 'a.vbo', createdUtc: null, startEpochMs: null, columns: [], comments: [],
      t: new Float64Array([0, 1]), lat: new Float64Array([33, 33]), lon: new Float64Array([131, 131]), speed: new Float64Array([0, 0]) }, 'a', 0);
    const st = s.resumeState();
    expect(keys(st)).toEqual(keys(STATE));
    expect(keys(st.sets[0])).toEqual(keys(SET_ENTRY));
    expect(keys(st.sets[0].logs[0])).toEqual(keys(SET_LOG));
    expect(keys(st.sets[0].sort!)).toEqual(keys(SORT));
    expect(st.v).toBe(1);
    // 割り当て(LapRef)と計測ライン(TimingLine)は、型の記録だけ(項目が変わると型チェックで落ちる)
    expect(keys(LAP_REF)).toEqual(['lap', 'logId']);
    expect(keys(TIMING_LINE)).toEqual(['kind', 'name', 'p1', 'p2']);
  });
});

describe('保存の写しの選び方', () => {
  it('IndexedDB と同期の写しのうち、保存した時刻の新しい方を使う。形の合わないものは使わない', () => {
    const a = { schema: 2, at: 10, state: 'a' }, b = { schema: 2, at: 20, state: 'b' };
    expect(newerState(a, b)).toBe(b);
    expect(newerState(b, a)).toBe(b);
    expect(newerState(a, null)).toBe(a);
    expect(newerState(null, { state: 'x' })).toBeNull();
    expect(newerState({ schema: 1, at: 30, state: 'old' }, b)?.schema).toBe(1);    // 版が違えば、load で捨てる
  });
});
