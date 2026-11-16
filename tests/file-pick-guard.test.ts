// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFilePickGuard } from '../src/ui/filePickGuard';

/** クリックを送り、既定の動作を止められたか(= 選ぶ画面が開かないか)を返す */
const tap = (el: HTMLElement) => !el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

let fileA: HTMLInputElement, fileB: HTMLInputElement, text: HTMLInputElement;
let off: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<input id="a" type="file"><input id="b" type="file"><input id="t" type="text">';
  fileA = document.getElementById('a') as HTMLInputElement;
  fileB = document.getElementById('b') as HTMLInputElement;
  text = document.getElementById('t') as HTMLInputElement;
  off = installFilePickGuard(document);
});
afterEach(() => { off(); vi.useRealTimers(); });

describe('ファイルを選ぶ欄の二重タップの禁止(案件 70)', () => {
  it('1 回目は開く。選び終わるまで、ほかの欄へのタップも無視する', () => {
    expect(tap(fileA)).toBe(false);
    expect(tap(fileA)).toBe(true);
    expect(tap(fileB)).toBe(true);
  });

  it('選び終わったら(change)、次のタップを受ける', () => {
    tap(fileA);
    fileA.dispatchEvent(new Event('change', { bubbles: true }));
    expect(tap(fileA)).toBe(false);
  });

  it('やめたら(cancel)、次のタップを受ける', () => {
    tap(fileA);
    fileA.dispatchEvent(new Event('cancel'));
    expect(tap(fileB)).toBe(false);
  });

  it('合図が来なくても、10 秒で解除する', () => {
    tap(fileA);
    vi.advanceTimersByTime(9_000);
    expect(tap(fileA)).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(tap(fileA)).toBe(false);
  });

  it('ファイル以外の入力欄には影響しない', () => {
    tap(fileA);
    expect(tap(text)).toBe(false);
  });

  it('取り消すと、元どおりに戻る', () => {
    tap(fileA);
    off();
    expect(tap(fileA)).toBe(false);
    off = installFilePickGuard(document);
  });
});
