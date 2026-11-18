// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, installLongPressScroll } from '../src/ui/longPressScroll';
import { installScrollGrip } from '../src/ui/scrollGrip';

/** jsdom には PointerEvent が無いので、MouseEvent に pointerId・pointerType を足して代用する */
function ptr(el: Element, type: string, y: number, kind = 'touch') {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 300, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: kind });
  el.dispatchEvent(e);
}

describe('画面のスクロールのつまみ(案件 79)', () => {
  let grip: HTMLElement, top: number, max: number, stop: () => void;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div id="g" class="scroll-grip"><i></i></div></div>';
    grip = document.getElementById('g')!;
    top = 100; max = 300;
    const scroller = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    // ブラウザと同じく、0〜max に収まる
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.min(max, Math.max(0, v)); }, configurable: true });
    stop = installScrollGrip(grip);
  });
  afterEach(() => { stop(); });

  it('押さえて指を下へ動かすと、動かした分だけ(倍率なしで)ページが上へ戻る。上へ動かすと進む', () => {
    ptr(grip, 'pointerdown', 500);
    ptr(grip, 'pointermove', 520);
    expect(top).toBe(80);
    ptr(grip, 'pointermove', 560);
    expect(top).toBe(40);
    ptr(grip, 'pointermove', 540);
    expect(top).toBe(60);
  });

  it('限りまで行ったあとは、指が先へ動いても、つまみは離れない(表示をずらさない)。戻すときは、指が元の位置へ戻るまで動かない', () => {
    ptr(grip, 'pointerdown', 500);
    ptr(grip, 'pointermove', 650);                    // 150 下へ: 100 - 150 → 先頭(0)で止まる
    expect(top).toBe(0);
    expect(grip.style.transform).toBe('');
    ptr(grip, 'pointermove', 620);                    // 指が少し戻っても、押さえた位置から 120 下: まだ先頭
    expect(top).toBe(0);
    ptr(grip, 'pointermove', 580);                    // 80 下 → 20
    expect(top).toBe(20);
    expect(grip.classList.contains('on')).toBe(true);
    ptr(grip, 'pointerup', 580);
    expect(grip.classList.contains('on')).toBe(false);
    ptr(grip, 'pointermove', 700);                    // 離したあとは何もしない
    expect(top).toBe(20);
  });

  it('つまみの上では、長押しスクロール(案件 44)を受け付けない。ほかの場所では今までどおり', () => {
    vi.useFakeTimers();
    const stopLp = installLongPressScroll(document.getElementById('root')!);
    ptr(grip, 'pointerdown', 100);
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(document.querySelector('.lp-ring')).toBeNull();
    ptr(grip, 'pointerup', 100);
    const other = document.createElement('div');
    document.getElementById('root')!.appendChild(other);
    ptr(other, 'pointerdown', 100);
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(document.querySelector('.lp-ring')).not.toBeNull();
    ptr(other, 'pointerup', 100);
    stopLp();
    vi.useRealTimers();
  });
});
