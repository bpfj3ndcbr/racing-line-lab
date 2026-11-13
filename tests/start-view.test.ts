// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { LAST_VIEW_KEY, Prefs, DEFAULT_VALUES } from '../src/store/prefs';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 地図の初期位置「現在の表示位置」と、追従の初期値(案件 54)

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');

describe('設定の保存', () => {
  it('追従の初期値は「先頭追従」', () => {
    expect(DEFAULT_VALUES.follow).toBe('leader');
    expect(new Prefs(new Session(new MemoryStore())).get('follow').value).toBe('leader');
  });

  it('保存済みの追従の設定は、そのまま残る', () => {
    const s = new Session(new MemoryStore());
    const p = new Prefs(s);
    p.setValue('follow', 'fixed');
    expect(new Prefs(s).get('follow').value).toBe('fixed');
  });

  it('初期位置は「地図の中心」「コントロールライン」「現在の表示位置」の 3 つ。知らない値は「地図の中心」', () => {
    const s = new Session(new MemoryStore());
    const p = new Prefs(s);
    expect(p.startPos).toBe('center');
    p.setStartPos('view');
    expect(new Prefs(s).startPos).toBe('view');
    p.setStartPos('control');
    expect(new Prefs(s).startPos).toBe('control');
    s.setSetting('prefs', { startPos: 'unknown' });
    expect(new Prefs(s).startPos).toBe('center');
  });

  it('前回の表示位置は、正しい値だけ読む', () => {
    const s = new Session(new MemoryStore());
    const p = new Prefs(s);
    expect(p.lastView()).toBeNull();
    p.saveLastView({ circuit: 'c1', lat: 33.1, lon: 131.2, zoom: 18 });
    expect(p.lastView()).toEqual({ circuit: 'c1', lat: 33.1, lon: 131.2, zoom: 18 });
    for (const bad of [{ circuit: 1, lat: 33, lon: 131, zoom: 18 }, { circuit: 'c', lat: 99, lon: 131, zoom: 18 }, { circuit: 'c', lat: 33, lon: 131, zoom: 0 }, { circuit: 'c', lat: 'x', lon: 131, zoom: 18 }, 'oops']) {
      s.setSetting(LAST_VIEW_KEY, bad);
      expect(p.lastView()).toBeNull();
    }
  });
});

describe('設定タブの初期位置', () => {
  it('「現在の表示位置」を選べる', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const store = new MemoryStore();
    const session = new Session(store);
    mountApp(root, session, new ThemeController(store), () => new FakeMap());
    root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="settings"]')!.click();
    const labels = Array.from(root.querySelectorAll('[data-startpos]')).map((b) => b.textContent);
    expect(labels).toEqual(['地図の中心', 'コントロールライン', '現在の表示位置']);
    root.querySelector<HTMLButtonElement>('[data-startpos="view"]')!.click();
    expect(new Prefs(session).startPos).toBe('view');
    expect(root.querySelector('[data-startpos="view"]')!.getAttribute('aria-checked')).toBe('true');
  });
});

describe('比較画面の初期位置', () => {
  let root: HTMLElement, session: Session, fake: FakeMap, store: MemoryStore, circuitId: string;
  const goCompare = () => root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
  const boot = (prep?: (p: Prefs) => void) => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    session = new Session(store);
    fake = new FakeMap();
    prep?.(new Prefs(session));
    mountApp(root, session, new ThemeController(store), () => fake);
    session.registerCircuit('オートポリス', cln, sci);
    circuitId = session.circuits[0].id;
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
  };
  beforeEach(() => { vi.useFakeTimers(); store = new MemoryStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('「現在の表示位置」: 同じサーキットの前回の位置と倍率で始まる', () => {
    boot();
    const p = new Prefs(session);
    p.setStartPos('view');
    p.saveLastView({ circuit: circuitId, lat: 33.0391, lon: 130.9744, zoom: 18 });
    goCompare();
    expect(fake.viewSet[fake.viewSet.length - 1]).toEqual([33.0391, 130.9744, 18]);
  });

  it('サーキットが違う・覚えていないときは、地図の中心(走行ライン全体)で始まる', () => {
    boot();
    const p = new Prefs(session);
    p.setStartPos('view');
    p.saveLastView({ circuit: 'ほかのサーキット', lat: 10, lon: 10, zoom: 18 });
    goCompare();
    expect(fake.viewSet.some(([lat]) => lat === 10)).toBe(false);
    expect(fake.fitted).toBeGreaterThan(0);

    store = new MemoryStore();
    boot((q) => q.setStartPos('view'));
    goCompare();
    expect(fake.viewSet).toHaveLength(0);
  });

  it('「現在の表示位置」でなければ、前回の位置は使わない', () => {
    boot();
    new Prefs(session).saveLastView({ circuit: circuitId, lat: 33.0391, lon: 130.9744, zoom: 18 });
    goCompare();
    expect(fake.viewSet.some(([lat]) => lat === 33.0391)).toBe(false);
  });

  it('地図を動かすと、動きが止まってから前回の位置として覚える。最初に合わせた位置は覚えない', () => {
    boot();
    goCompare();
    vi.advanceTimersByTime(2000);
    expect(new Prefs(session).lastView()).toBeNull();           // プログラムが合わせた位置は、利用者が見ていた位置ではない
    fake.userMoves(33.049, 130.979, 16);                         // 利用者の操作ではない動き(追従など)だけでも、覚えない
    vi.advanceTimersByTime(2000);
    expect(new Prefs(session).lastView()).toBeNull();
    fake.userDrags();
    fake.userMoves(33.05, 130.98, 17);
    fake.userMoves(33.051, 130.981, 17);
    expect(new Prefs(session).lastView()).toBeNull();           // 動いている間は覚えない
    vi.advanceTimersByTime(400);
    expect(new Prefs(session).lastView()).toEqual({ circuit: circuitId, lat: 33.051, lon: 130.981, zoom: 17 });
  });
});
