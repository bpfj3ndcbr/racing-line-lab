// @vitest-environment jsdom
// 再生の時計(案件 36): 1 コマの描画に時間がかかっても、再生時刻は実際の時間どおりに進む
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');

let root: HTMLElement, session: Session;
let queue: FrameRequestCallback[] = [];
let clock = 0;                                    // performance.now() が返す時刻(ms)

beforeEach(() => {
  queue = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const store = new MemoryStore();
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
  session.registerCircuit('オートポリス', cln, sci);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

/** 時刻 t(ms)のコマを描く。描画に busy ms かかったことにする(コールバックの中の performance.now() は t + busy) */
function frame(t: number, busy: number) {
  const cbs = queue.splice(0);
  clock = t + busy;
  for (const cb of cbs) cb(t);
}

describe('再生の時計', () => {
  it('1 コマの描画に 8 ms かかっても、60 コマ(1 秒)で再生時刻は 1 秒進む', () => {
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect($('#cmp-time').textContent).toMatch(/^0:00\.0 \//);
    $<HTMLButtonElement>('[data-act="toggle"]').click();          // 再生(このとき performance.now() = 0)
    for (let i = 1; i <= 60; i++) frame((i * 1000) / 60, 8);
    expect($('#cmp-time').textContent).toMatch(/^0:01\.0 \//);
  });
});
