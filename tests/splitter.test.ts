// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { clamp } from '../src/ui/splitter';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');

let root: HTMLElement, store: MemoryStore, session: Session;

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
}
beforeEach(() => {
  store = new MemoryStore();
  mount();
  session.registerCircuit('オートポリス', cln, sci);
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
  root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
});

const cmp = () => root.querySelector<HTMLElement>('.cmp')!;
const sideW = () => cmp().style.getPropertyValue('--side-w');
const graphH = () => cmp().style.getPropertyValue('--graph-h');
const spV = () => root.querySelector<HTMLElement>('#cmp-sp-v')!;
const spG = () => root.querySelector<HTMLElement>('#cmp-sp-g')!;
const press = (el: HTMLElement, key: string, shiftKey = false) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
const rect = (el: Element, r: { left: number; right: number; top: number; bottom: number }) =>
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }) });

describe('境界の分割バー', () => {
  it('2本あり、名前・向き・値を持つ(スクリーンリーダーでも分かる)', () => {
    expect(spV().getAttribute('role')).toBe('separator');
    expect(spV().getAttribute('aria-orientation')).toBe('vertical');
    expect(spV().getAttribute('aria-label')).toContain('地図と右パネルの境界');
    expect(spV().getAttribute('aria-valuenow')).toBe('300');
    expect(spG().getAttribute('role')).toBe('separator');
    expect(spG().getAttribute('aria-orientation')).toBe('horizontal');
    expect(spG().getAttribute('aria-label')).toContain('セクターと速度グラフの境界');
    expect(spG().getAttribute('aria-valuenow')).toBe(String(parseInt(graphH())));
    expect(spV().tabIndex).toBe(0);
    expect(spG().tabIndex).toBe(0);
    expect(spV().title).toContain('ダブルクリック');
  });

  it('初期の大きさ(グラフはやや高め)', () => {
    expect(sideW()).toBe('300px');
    expect(parseInt(graphH())).toBeGreaterThanOrEqual(170);
  });

  it('A(縦線): ← で境界が左へ=右パネルが広がる、→ で狭まる。Shift で大きく動く', () => {
    press(spV(), 'ArrowLeft'); expect(sideW()).toBe('316px');
    press(spV(), 'ArrowRight'); press(spV(), 'ArrowRight'); expect(sideW()).toBe('284px');
    press(spV(), 'ArrowLeft', true); expect(sideW()).toBe('348px');
    expect(spV().getAttribute('aria-valuenow')).toBe('348');
  });

  it('縦線を狭める側の限界は 220px(それ以上は狭まらず、右パネルは折りたたまれない)', () => {
    press(spV(), 'End'); expect(sideW()).toBe('220px');
    press(spV(), 'ArrowRight', true); expect(sideW()).toBe('220px');
    expect(cmp().classList.contains('side-collapsed')).toBe(false);
    expect(root.querySelector<HTMLElement>('#cmp-cards')!.closest('[hidden]')).toBeNull();
    press(spV(), 'Home'); expect(sideW()).toBe('560px');          // 左端へ = 最大幅(上限 560px)
    for (let i = 0; i < 40; i++) press(spV(), 'ArrowLeft');
    expect(sideW()).toBe('560px');
  });

  it('B(横線): ↑ で境界が上へ=グラフが高くなる、↓ で低くなる。上限・下限がある', () => {
    press(spG(), 'End'); const lo = parseInt(graphH());
    expect(lo).toBe(170);                                         // 下限: 文字が読める高さ
    press(spG(), 'ArrowUp'); expect(graphH()).toBe('186px');
    press(spG(), 'ArrowDown'); expect(graphH()).toBe('170px');
    press(spG(), 'ArrowDown'); expect(graphH()).toBe('170px');
    press(spG(), 'Home'); const hi = parseInt(graphH());
    expect(hi).toBeGreaterThan(170);                              // 上限: 上の部分が全部収まる高さ
    press(spG(), 'ArrowUp', true); expect(parseInt(graphH())).toBe(hi);
  });

  it('ダブルクリックで初期値に戻る', () => {
    press(spV(), 'ArrowLeft', true); press(spG(), 'End');
    spV().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    spG().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(sideW()).toBe('300px');
    expect(parseInt(graphH())).toBeGreaterThan(170);
  });

  it('ドラッグ: ポインタ位置から幅・グラフの高さが決まる', () => {
    rect(root.querySelector('#cmp-main')!, { left: 0, right: 1200, top: 0, bottom: 500 });
    spV().dispatchEvent(new MouseEvent('pointerdown', { clientX: 900, clientY: 100, bubbles: true }));
    expect(document.body.classList.contains('resizing')).toBe(true);
    spV().dispatchEvent(new MouseEvent('pointermove', { clientX: 850, clientY: 100, bubbles: true }));
    expect(sideW()).toBe('350px');                                  // 右端 1200 - 850
    spV().dispatchEvent(new MouseEvent('pointermove', { clientX: 1190, clientY: 100, bubbles: true }));
    expect(sideW()).toBe('220px');                                  // 狭めても 220px まで
    spV().dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(document.body.classList.contains('resizing')).toBe(false);

    rect(root.querySelector('#cmp-side')!, { left: 900, right: 1200, top: 0, bottom: 800 });
    spG().dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 500, bubbles: true }));
    spG().dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 560, bubbles: true }));
    expect(graphH()).toBe('237px');                                 // 下端 800 - 560 - 境界の半分(3)
    spG().dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 790, bubbles: true }));
    expect(graphH()).toBe('170px');                                 // 下限
    spG().dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });

  it('ドラッグしていないときの移動は無視する', () => {
    spV().dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 0, bubbles: true }));
    expect(sideW()).toBe('300px');
  });

  it('大きさは保存され、次に開いたときも同じ', () => {
    press(spV(), 'ArrowLeft', true);
    press(spG(), 'End');
    expect(session.getSetting('compare.layout', {})).toMatchObject({ v: 1, sideW: 364, graphH: 170 });
    mount();
    session.registerCircuit('オートポリス', cln, sci);
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
    expect(sideW()).toBe('364px');
    expect(graphH()).toBe('170px');
  });

  it('分割バーにフォーカスして矢印キーを押しても、コマ送りにはならない', () => {
    press(spV(), 'ArrowRight');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));  // 比較画面の通常のコマ送り
    expect(root.querySelector('#cmp-time')!.textContent).toBe('0:00.1 / 2:22.9');                   // 後者の1回だけ
    spV().focus();
    spV().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(root.querySelector('#cmp-time')!.textContent).toBe('0:00.1 / 2:22.9');
    press(spG(), 'ArrowUp');
    expect(root.querySelector('#cmp-time')!.textContent).toBe('0:00.1 / 2:22.9');
  });

  it('割り当てが無いとき、横線は隠れる', () => {
    root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="import"]')!.click();
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
    expect(spG().hidden).toBe(true);
  });
});

describe('clamp', () => {
  it('範囲に収める(最大が最小より小さいときは最小)', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
    expect(clamp(15, 10, 5)).toBe(10);
  });
});
