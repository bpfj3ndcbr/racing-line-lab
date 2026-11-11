// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, LONG_PRESS_SCROLL_EVENT, installLongPressScroll } from '../src/ui/longPressScroll';

/** jsdom には PointerEvent が無いので、MouseEvent に pointerId・pointerType を足して代用する */
function ptr(el: Element, type: string, x: number, y: number, o: { id?: number; kind?: string } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: o.id ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: o.kind ?? 'touch' });
  el.dispatchEvent(e);
}

describe('長押ししてから縦になぞると、画面をスクロールする(案件 44)', () => {
  let root: HTMLElement, target: HTMLElement, scrolls: number[], moves: number, started: number, stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"><div id="t"></div></div>';
    root = document.getElementById('root')!;
    target = document.getElementById('t')!;
    scrolls = []; moves = 0; started = 0;
    const scroller = document.scrollingElement ?? document.documentElement;
    (scroller as HTMLElement).scrollBy = ((_x: number, y: number) => { scrolls.push(y); }) as never;
    target.addEventListener('pointermove', () => { moves++; });
    target.addEventListener(LONG_PRESS_SCROLL_EVENT, () => { started++; });
    stop = installLongPressScroll(root);
  });
  afterEach(() => { stop(); vi.useRealTimers(); });
  const ring = () => document.querySelector('.lp-ring');

  it('長押しで合図(色の線)が出て、縦になぞると画面がスクロールする。地図・グラフには指の動きを渡さない', () => {
    ptr(target, 'pointerdown', 100, 100);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(ring()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(ring()).not.toBeNull();
    ptr(target, 'pointermove', 102, 80);                              // 上へ 20px(縦の方が大きい)
    expect(started).toBe(1);
    ptr(target, 'pointermove', 103, 50);
    expect(scrolls).toEqual([20, 30]);                                // 指を上へ動かすと、下の方が見える
    expect(moves).toBe(0);
    ptr(target, 'pointerup', 103, 50);
    expect(ring()).toBeNull();
  });

  it('長押しのあとでも、横になぞったときはスクロールせず、今までどおり(地図の移動・グラフの操作)', () => {
    ptr(target, 'pointerdown', 100, 100);
    vi.advanceTimersByTime(HOLD_MS);
    ptr(target, 'pointermove', 120, 105);
    ptr(target, 'pointermove', 140, 95);
    expect(scrolls).toEqual([]);
    expect(started).toBe(0);
    expect(moves).toBe(2);
    expect(ring()).toBeNull();
  });

  it('長押しせずにすぐなぞったとき・マウス・2 本の指では、スクロールしない', () => {
    ptr(target, 'pointerdown', 100, 100);
    vi.advanceTimersByTime(100);
    ptr(target, 'pointermove', 100, 70);                              // すぐ縦に動かした
    vi.advanceTimersByTime(HOLD_MS);
    ptr(target, 'pointermove', 100, 40);
    ptr(target, 'pointerup', 100, 40);
    expect(scrolls).toEqual([]);
    expect(ring()).toBeNull();

    ptr(target, 'pointerdown', 100, 100, { kind: 'mouse' });          // マウス
    vi.advanceTimersByTime(HOLD_MS);
    ptr(target, 'pointermove', 100, 60, { kind: 'mouse' });
    ptr(target, 'pointerup', 100, 60, { kind: 'mouse' });
    expect(scrolls).toEqual([]);

    ptr(target, 'pointerdown', 100, 100, { id: 1 });                   // 2 本の指(拡大・縮小)
    ptr(target, 'pointerdown', 200, 100, { id: 2 });
    vi.advanceTimersByTime(HOLD_MS);
    ptr(target, 'pointermove', 100, 60, { id: 1 });
    expect(scrolls).toEqual([]);
    expect(ring()).toBeNull();
  });
});
