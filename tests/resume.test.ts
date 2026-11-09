// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryStore, type NativeBridge } from '../src/io/storage';
import { MemoryResumeStore, type ResumeStore } from '../src/io/resume';
import { Session } from '../src/store/session';
import { parseVbo } from '../src/core';
import { mountApp, RESUME_SAVE_FAILED } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// Web 版の一時保存(案件 30): 同じタブの中の読み直しで、走行ログと画面の状態を元に戻す
const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const vbo = readFileSync(fx('20260913140139_UTC.vbo'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 20));
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;

let store: MemoryStore, root: HTMLElement, resume: MemoryResumeStore;
let app: { dispose(): void } | null = null;

function boot(opts: { resume?: ResumeStore | null; reload?: () => void } = {}) {
  app?.dispose();                                     // 前の画面は、読み直しで無くなる
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const session = new Session(store);
  app = mountApp(root, session, new ThemeController(store), () => new FakeMap(), { resume: resume, ...opts });
  return session;
}
/** 同じタブの中の読み直し(スリープ・アプリの切り替え・手での再読み込み) */
function reloadSameTab() {
  window.dispatchEvent(new Event('pagehide'));
  resume.resumed = true;
  return boot();
}
const view = (v: string) => root.querySelector<HTMLElement>(`#view-${v}`)!;
const nav = (v: string) => root.querySelector<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`)!.click();

beforeEach(() => { store = new MemoryStore(); resume = new MemoryResumeStore(false); });
afterEach(() => { app?.dispose(); app = null; delete (window as { rllNative?: NativeBridge }).rllNative; });

describe('Session の一時保存(resumeState / restoreResume)', () => {
  it('比較セットごとの走行ログ・Run 番号・割り当てと、表示中の比較セットを元に戻す', () => {
    const s1 = new Session(store);
    s1.registerCircuit('オートポリス', cln, sci);
    const log = parseVbo(vbo, 'a.vbo');
    s1.addLog(log, 'a', 0);
    s1.addLog(log, 'a', 2);
    s1.removeLog('a', 0);
    s1.addLog(log, 'a', 0);                            // 外して入れ直すと Run 番号は 2
    s1.activeIndex = 2;
    s1.toggleAssignment('B', { logId: 'a', lap: 1 });
    const saved = JSON.parse(JSON.stringify(s1.resumeState()));

    const s2 = new Session(new MemoryStore());
    s2.registerCircuit('オートポリス', cln, sci);
    expect(s2.restoreResume(saved, new Map([['a', log]]))).toBe(2);
    expect(s2.sets[0].logs.map((l) => [l.id, l.no])).toEqual([['a', 2]]);
    expect(s2.sets[2].logs.map((l) => l.id)).toEqual(['a']);
    expect(s2.activeIndex).toBe(2);
    expect(s2.assignment.B).toEqual({ logId: 'a', lap: 1 });
    expect(s2.message).toBe('前の画面の状態を元に戻しました。');
  });

  it('中身の無い走行ログは飛ばし、その割り当ても戻さない。走行ログがすでにあれば何もしない', () => {
    const s1 = new Session(store);
    s1.addLog(parseVbo(vbo, 'a.vbo'), 'a', 0);
    s1.toggleAssignment('A', { logId: 'a', lap: 1 });
    const saved = s1.resumeState();
    const s2 = new Session(new MemoryStore());
    expect(s2.restoreResume(saved, new Map())).toBe(0);
    expect(s2.logs).toHaveLength(0);
    expect(s2.assignment.A).toBeNull();
    expect(s2.restoreResume({ v: 2, sets: [] }, new Map())).toBe(0);
    expect(s2.restoreResume(null, new Map())).toBe(0);
    expect(s1.restoreResume(saved, new Map([['a', parseVbo(vbo, 'a.vbo')]]))).toBe(0);     // すでに入っている
  });

  it('走行ログを新しく入れた・どの比較セットからも外したときだけ、logHooks で知らせる', () => {
    const s = new Session(store);
    const ev: string[] = [];
    s.logHooks = { added: (id) => ev.push(`+${id}`), removed: (id) => ev.push(`-${id}`) };
    const log = parseVbo(vbo, 'a.vbo');
    s.addLog(log, 'a', 0);
    s.addLog(log, 'a', 1);                             // 別のセットに同じもの: 保存し直さない
    s.removeLog('a', 0);                               // まだセット 2 に残る
    s.removeLog('a', 1);
    expect(ev).toEqual(['+a', '-a']);
  });
});

describe('画面の一時保存(Web 版)', () => {
  async function firstRun() {
    const s = boot();
    s.registerCircuit('オートポリス', cln, sci);
    await s.addVboFile(file('a.vbo', vbo));
    s.toggleAssignment('B', { logId: s.logs[0].id, lap: 1 });
    await flush();
    return s;
  }

  it('同じタブで読み直すと、走行ログ・割り当てと、開いていた「比較」の画面に戻る', async () => {
    const s1 = await firstRun();
    const id = s1.logs[0].id;
    expect(resume.logs.has(id)).toBe(true);           // 走行ログは読み込んだときに保存
    nav('compare');
    const s2 = reloadSameTab();
    expect(s2.loading).toBe('前の画面の状態を元に戻しています…');
    await flush();
    expect(s2.loading).toBe('');
    expect(s2.logs.map((l) => l.id)).toEqual([id]);
    expect(s2.assignment.B).toEqual({ logId: id, lap: 1 });
    expect(s2.message).toBe('前の画面の状態を元に戻しました。');
    expect(view('compare').hidden).toBe(false);
  });

  it('画面が隠れたとき(visibilitychange)にも小さな状態を保存する。「データ管理」のままならデータ管理に戻る', async () => {
    await firstRun();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as { visibilityState?: string }).visibilityState;
    expect((resume.state as { view: string }).view).toBe('import');
    resume.resumed = true;
    const s2 = boot();
    await flush();
    expect(s2.logs).toHaveLength(1);
    expect(view('import').hidden).toBe(false);
  });

  it('新しいタブ(このタブで保存していない)では、初期状態で始まる', async () => {
    await firstRun();
    window.dispatchEvent(new Event('pagehide'));
    resume.resumed = false;
    const s2 = boot();
    await flush();
    expect(s2.logs).toHaveLength(0);
    expect(s2.loading).toBe('');
  });

  it('走行ログを外すと、一時保存からも消える', async () => {
    const s1 = await firstRun();
    s1.removeLog(s1.logs[0].id);
    expect(resume.logs.size).toBe(0);
    const s2 = reloadSameTab();
    await flush();
    expect(s2.logs).toHaveLength(0);
  });

  it('走行ログを保存できなかったら、そのことを知らせる', async () => {
    resume.putLog = async () => { throw new Error('QuotaExceededError'); };
    const s = boot();
    await s.addVboFile(file('a.vbo', vbo));
    await flush();
    expect(s.message).toBe(RESUME_SAVE_FAILED);
  });

  it('「アプリを初期状態に戻す」では、一時保存も消してから読み直す(読み直しても元に戻らない)', async () => {
    let reloaded = 0;
    const s1 = boot({ reload: () => { reloaded++; } });
    await s1.addVboFile(file('a.vbo', vbo));
    nav('settings');
    root.querySelector<HTMLButtonElement>('[data-wipe]')!.click();
    root.querySelector<HTMLButtonElement>('[data-wipe]')!.click();
    await flush();
    expect(reloaded).toBe(1);
    window.dispatchEvent(new Event('pagehide'));     // 読み直すときの pagehide でも、保存し直さない
    expect(resume.state).toBeNull();
    expect(resume.logs.size).toBe(0);
    expect(resume.resumed).toBe(false);
  });

  it('デスクトップ版(Electron)では使わない', async () => {
    (window as { rllNative?: NativeBridge }).rllNative = {
      storageGet: () => null, storageSet: () => {}, storageClear: () => {}, saveText: async () => ({ ok: true }),
      getPathForFile: (f) => `/data/${f.name}`, readTextFile: async () => null,
    };
    const s = boot();
    await s.addVboFile(file('a.vbo', vbo), '/data/a.vbo');
    window.dispatchEvent(new Event('pagehide'));
    expect(resume.logs.size).toBe(0);
    expect(resume.state).toBeNull();
  });
});
