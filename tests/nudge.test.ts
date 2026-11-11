// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { NUDGE_STEPS, arrowDelta, isTypingTarget, markStep, modalOpen, stepSegHtml } from '../src/ui/nudge';

// 線を少しずつ動かす操作の、共通の道具(案件 39)
describe('arrowDelta: 矢印キー・矢印ボタンの向き → [東, 北](m)', () => {
  it('北・東が正。矢印キーの名前と N / S / E / W の両方を受ける', () => {
    expect(arrowDelta('ArrowUp', 0.5)).toEqual([0, 0.5]);
    expect(arrowDelta('ArrowDown', 0.5)).toEqual([0, -0.5]);
    expect(arrowDelta('ArrowRight', 0.5)).toEqual([0.5, 0]);
    expect(arrowDelta('ArrowLeft', 0.5)).toEqual([-0.5, 0]);
    expect(arrowDelta('N', 1)).toEqual([0, 1]);
    expect(arrowDelta('S', 1)).toEqual([0, -1]);
    expect(arrowDelta('E', 1)).toEqual([1, 0]);
    expect(arrowDelta('W', 1)).toEqual([-1, 0]);
  });
  it('Shift で 10 倍。矢印でなければ null', () => {
    expect(arrowDelta('ArrowUp', 0.1, true)).toEqual([0, 1]);
    expect(arrowDelta('ArrowLeft', 0.5, true)).toEqual([-5, 0]);
    expect(arrowDelta('Enter', 0.1)).toBeNull();
    expect(arrowDelta('', 0.1)).toBeNull();
  });
});

describe('入力中の判定・ダイアログ・移動量の切り替え', () => {
  it('isTypingTarget: 入力欄・選択・複数行は入力中。スライダーは allowRange のときだけ入力中としない', () => {
    const el = (tag: string, type?: string) => { const e = document.createElement(tag); if (type) e.setAttribute('type', type); return e; };
    expect(isTypingTarget(el('input', 'text'))).toBe(true);
    expect(isTypingTarget(el('select'))).toBe(true);
    expect(isTypingTarget(el('textarea'))).toBe(true);
    expect(isTypingTarget(el('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(el('input', 'range'))).toBe(true);
    expect(isTypingTarget(el('input', 'range'), true)).toBe(false);
    expect(isTypingTarget(el('input', 'number'), true)).toBe(true);
  });
  it('modalOpen: アプリのダイアログ(.modal)があるときだけ true', () => {
    document.body.innerHTML = '';
    expect(modalOpen()).toBe(false);
    document.body.innerHTML = '<div class="modal-back"><div class="modal"></div></div>';
    expect(modalOpen()).toBe(true);
  });
  it('stepSegHtml / markStep: 0.1・0.5・1 m のボタン。選んだものだけ押した表示', () => {
    document.body.innerHTML = stepSegHtml('x-step', 0.5);
    const pressed = () => Array.from(document.querySelectorAll<HTMLElement>('[data-act="x-step"]')).map((b) => `${b.dataset.step}:${b.getAttribute('aria-pressed')}:${b.classList.contains('on')}`);
    expect(NUDGE_STEPS).toEqual([0.1, 0.5, 1]);
    expect(pressed()).toEqual(['0.1:false:false', '0.5:true:true', '1:false:false']);
    markStep(document, 'x-step', 1);
    expect(pressed()).toEqual(['0.1:false:false', '0.5:false:false', '1:true:true']);
  });
});
