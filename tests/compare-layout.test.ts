// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
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
const css = readFileSync('src/style.css', 'utf8');

let root: HTMLElement, store: MemoryStore;
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const session = new Session(store);
  mountApp(root, session, new ThemeController(store), () => new FakeMap());
  session.registerCircuit('オートポリス', cln, sci);
  session.addLog(parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo'), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
  root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
}
beforeEach(() => { store = new MemoryStore(); mount(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const spG = () => $('#cmp-sp-g');
const graphH = () => parseInt($('.cmp').style.getPropertyValue('--graph-h'));
const key = (k: string, shiftKey = false) => spG().dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
const size = (el: Element, prop: 'clientHeight' | 'offsetHeight', v: number) => Object.defineProperty(el, prop, { configurable: true, value: v });

describe('グラフの高さの範囲(上の部分とグラフの比率だけを変える)', () => {
  it('上限 = 上の部分(カード・セクター)がちょうど収まる高さ。上の部分が増えれば上限は下がる', () => {
    size($('#cmp-side'), 'clientHeight', 900);
    size($('#cmp-upper-in'), 'offsetHeight', 350);
    key('Home');
    expect(graphH()).toBe(900 - 6 - 350 - 2);                  // 542
    size($('#cmp-upper-in'), 'offsetHeight', 500);
    key('Home');
    expect(graphH()).toBe(900 - 6 - 500 - 2);                  // 392
  });

  it('下限 = 文字が読める高さ(170px)。上の部分が大きくて余裕が無くても、下限は守る', () => {
    size($('#cmp-side'), 'clientHeight', 500);
    size($('#cmp-upper-in'), 'offsetHeight', 450);
    key('Home');
    expect(graphH()).toBe(170);
    key('End');
    expect(graphH()).toBe(170);
  });

  it('保存された高さが上限より大きいときは、表示だけ上限に収める(保存値は変えない)', () => {
    size($('#cmp-side'), 'clientHeight', 700);
    size($('#cmp-upper-in'), 'offsetHeight', 400);
    key('End'); key('ArrowUp', true); key('ArrowUp', true); key('ArrowUp', true); key('ArrowUp', true);  // 170 → 426 → 上限 292 で止まる
    expect(graphH()).toBe(292);
  });

  it('スクロールバーを出さない: 右パネルと上の部分は overflow:hidden で、グラフは固定の高さ', () => {
    expect(css).toMatch(/\.cmp-side\{[^}]*overflow:hidden/);
    expect(css).toMatch(/\.side-upper\{[^}]*overflow:hidden/);
    expect(css).toMatch(/\.side-graph\{[^}]*height:var\(--graph-h\)/);
  });
});

describe('見た目の指定', () => {
  it('カードは指定の CSS(最小高さ 56px・余白 4px 12px・文字 10px / 10px / 12px)', () => {
    expect(css).toMatch(/\.card\{display:flex;gap:10px;align-items:center;min-height:56px;padding:4px 12px;border-radius:var\(--r-m\);background:var\(--surface\);border:1px solid var\(--border\)\}/);
    expect(css).toMatch(/\.card \.c1\{font-weight:700;font-size:10px\}/);
    expect(css).toMatch(/\.card \.c2\{font-weight:700;font-size:10px\}/);
    expect(css).toMatch(/\.card \.c3\{font-size:12px;line-height:1\.35\}/);
  });

  it('グラフの文字は小さく(縦軸・横軸 9px)、縦軸ラベルは左端に寄せる(余白 26px)', () => {
    expect(css).toMatch(/\.g-tick\{[^}]*font-size:9px/);
    expect(css).toMatch(/\.g-marklabel\{[^}]*font-size:9px/);
    const svg = $('svg.speed-graph');
    const tick = Array.from(svg.querySelectorAll('.g-tick')).find((t) => t.getAttribute('text-anchor') === 'end')!;
    expect(Number(tick.getAttribute('x'))).toBeLessThan(26);
  });

  it('速度グラフの操作(横軸・ズーム)は、グラフの上の行にある', () => {
    const bar = $('.graph-bar');
    for (const id of ['#cmp-zin', '#cmp-zout', '#cmp-zoom']) expect(bar.contains($(id))).toBe(true);
    expect(bar.querySelector('[data-act="xkind"]')).not.toBeNull();
  });
});
