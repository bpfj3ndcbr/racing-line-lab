import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATCH_IDLE_MS, CATCH_SPEED, createScrollCatch } from '../src/ui/scrollCatch';

/** 境目の位置を pin、いまのスクロール位置を y とする。人の操作で y まで動いた(スクロールのイベントが届いた)ことにする */
let y: number, pin: number | null;
let held: boolean;
const catcher = () => createScrollCatch({ getY: () => y, setY: (v) => { y = v; }, pin: () => pin, onHold: (h) => { held = h; } });
/**
 * 人の操作で newY までスクロールした。dt ミリ秒前のイベントから動いた(速さ = 動いた量 / dt)。
 * 戻した(止めた)ときは、戻したあとのスクロールのイベントも届ける
 */
const scrollTo = (c: ReturnType<typeof catcher>, newY: number, user = true, dt = 16) => {
  vi.advanceTimersByTime(dt);
  y = newY;
  if (user) c.noteInput(300);
  c.onScroll();
  c.onScroll();                                          // 自分で戻したときの、スクロールのイベント(位置は変わらない)
  return y;
};

beforeEach(() => { vi.useFakeTimers(); y = 900; pin = 1000; held = false; });
afterEach(() => { vi.useRealTimers(); });

describe('スクロールの引っかかり(比較セットの中の 1 か所。案件 74 のあと)', () => {
  it('一気に(速く)越えたら止める。ゆっくり越えたら、止めない', () => {
    const fast = catcher();
    expect(scrollTo(fast, 1000 + 16 * CATCH_SPEED + 10)).toBe(1000);       // 1 コマで 22px 以上: 速い → 止める
    vi.advanceTimersByTime(CATCH_IDLE_MS + 1);
    y = 900;
    const slow = catcher();
    slow.sync();
    expect(scrollTo(slow, 994)).toBe(994);                                  // ゆっくり近づく
    expect(scrollTo(slow, 1002)).toBe(1002);                                // 1 コマで 8px(ゆっくり)で越える → 止めない
    expect(scrollTo(slow, 1010)).toBe(1010);                                // そのまま進む
  });

  it('動きの最初のイベントは、1 コマ(16ms)の動きとして測る。間が空いたあとの大きな動きは、速い', () => {
    const c = catcher();
    y = 990;
    c.sync();
    vi.advanceTimersByTime(CATCH_IDLE_MS + 500);
    expect(scrollTo(c, 1300, true, 0)).toBe(1000);
  });

  it('動きが速くても、境目を越えなければ止めない', () => {
    expect(scrollTo(catcher(), 960)).toBe(960);
  });

  it('下へ境目を越えたら、境目へ戻して止める(越えた量が大きくても同じ)', () => {
    expect(scrollTo(catcher(), 1100)).toBe(1000);
    y = 900;
    expect(scrollTo(catcher(), 1900)).toBe(1000);
  });

  it('止めている間は、触れたまま・慣性で、さらに下へ動かしても、止めた位置から動かない', () => {
    const c = catcher();
    scrollTo(c, 1100);
    expect(scrollTo(c, 1300)).toBe(1000);
    expect(scrollTo(c, 2000)).toBe(1000);
  });

  it('止めている間は、上へ動かしても、止めた位置から動かない(動きが止まるまで)', () => {
    const c = catcher();
    scrollTo(c, 1100);
    expect(scrollTo(c, 800)).toBe(1000);
  });

  it('止めた位置は、止めた時のもので固定する(境目の位置が変わっても、動かない)', () => {
    const c = catcher();
    scrollTo(c, 1100);
    pin = 960;                                             // 上に固定している行の高さが変わった
    expect(scrollTo(c, 1010)).toBe(1000);
    expect(scrollTo(c, 1000)).toBe(1000);
  });

  it('スクロールの動きが止まって間を置いたあと(タッチし直したあと)は、そのまま動く', () => {
    const c = catcher();
    scrollTo(c, 1100);
    vi.advanceTimersByTime(CATCH_IDLE_MS + 1);
    expect(scrollTo(c, 1060)).toBe(1060);
    expect(scrollTo(c, 1400)).toBe(1400);
  });

  it('動きが続いている間は、止めたまま。間を置くと解除する', () => {
    const c = catcher();
    scrollTo(c, 1100);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(CATCH_IDLE_MS - 20);          // 間が空きすぎない動きが続く
      expect(scrollTo(c, 1200 + i * 50)).toBe(1000);
    }
    vi.advanceTimersByTime(CATCH_IDLE_MS + 1);
    expect(scrollTo(c, 1100)).toBe(1100);
  });

  it('止めている間は onHold(true) で知らせ、解除したら onHold(false)', () => {
    const c = catcher();
    scrollTo(c, 1100);
    expect(held).toBe(true);
    vi.advanceTimersByTime(CATCH_IDLE_MS + 1);
    expect(held).toBe(false);
  });

  it('止めている間は、入力(ホイール・タッチ)が続く限り、止めた状態を保つ(スクロールのイベントが無くても)', () => {
    const c = catcher();
    scrollTo(c, 1100);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(CATCH_IDLE_MS - 30);          // スクロールのイベントは来ない
      c.noteInput(300);                                    // 小さな動きの入力だけが続く
      expect(held).toBe(true);
    }
    expect(scrollTo(c, 1100)).toBe(1000);
    vi.advanceTimersByTime(CATCH_IDLE_MS + 1);
    expect(held).toBe(false);
  });

  it('止めている間、ホイールの量が減っていく(慣性)間は止めたまま。量が増えたら、新しい操作として止めた状態をやめる', () => {
    const c = catcher();
    scrollTo(c, 1100);
    for (const d of [80, 60, 40, 30, 20, 12]) { c.noteWheel(d); expect(held).toBe(true); }     // 慣性: 減っていく
    c.noteWheel(40);                                      // 増えた(新しく触れて動かし始めた)
    expect(held).toBe(false);
    expect(scrollTo(c, 1050)).toBe(1050);                  // そのまま動く
  });

  it('止めている間に逆向きのホイールが来たら、新しい操作として止めた状態をやめる', () => {
    const c = catcher();
    scrollTo(c, 1100);
    c.noteWheel(50);
    c.noteWheel(-20);
    expect(held).toBe(false);
  });

  it('上へ境目を越えるときも、境目で止める', () => {
    y = 1100;
    const c = catcher();
    expect(scrollTo(c, 900)).toBe(1000);
    expect(scrollTo(c, 500)).toBe(1000);
    vi.advanceTimersByTime(CATCH_IDLE_MS + 1);
    expect(scrollTo(c, 950)).toBe(950);
  });

  it('境目を越えない動きは、止めない', () => {
    const c = catcher();
    expect(scrollTo(c, 990)).toBe(990);
    expect(scrollTo(c, 400)).toBe(400);
    y = 1200;
    c.sync();
    expect(scrollTo(c, 1500)).toBe(1500);
  });

  it('人の操作ではないスクロール(スクロールして見せる・タブの切り替え)は、止めない', () => {
    const c = catcher();
    expect(scrollTo(c, 1300, false)).toBe(1300);
    y = 900;
    c.sync();
    expect(scrollTo(c, 1100, false)).toBe(1100);
  });

  it('人の操作のあと、一定時間たつと、人の操作ではないと見なす', () => {
    const c = catcher();
    c.noteInput(300);
    vi.advanceTimersByTime(400);
    y = 1100;
    c.onScroll();
    expect(y).toBe(1100);
  });

  it('境目が無い(null)ときは、何もしない', () => {
    pin = null;
    const c = catcher();
    expect(scrollTo(c, 1500)).toBe(1500);
  });
});
