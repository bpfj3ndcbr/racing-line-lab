import { describe, expect, it } from 'vitest';
import { SCRUB_MAX_FRAME_MS, SCRUB_STALE_MS, SCRUB_START_PX, ScrubVelocity } from '../src/core/scrub';

/** 一定の速さ(px/ms)で、ms ごとに動かす(指が一定の速さで動いている) */
function drag(v: ScrubVelocity, from: number, speedPxPerMs: number, startMs: number, durMs: number, stepMs = 16): number {
  let x = from;
  for (let t = startMs + stepMs; t <= startMs + durMs; t += stepMs) {
    x += speedPxPerMs * stepMs;
    v.move(x, t);
  }
  return x;
}

describe('ミニセクター表のドラッグ(案件 90)', () => {
  // 幅 400px・ラップ 80 秒 → 1× は 5px/s(幅を 80 秒でなぞる速さ)
  const W = 400, D = 80;

  it('幅をラップ 1 周分の時間でなぞると、1× になる', () => {
    const v = new ScrubVelocity(W, D);
    v.press(0, 0);
    drag(v, 0, 0.005, 0, 2000);
    expect(v.rate()).toBeCloseTo(1, 2);
  });

  it('遅く動かすと遅く、速く動かすと速く進む(速さに比例する)', () => {
    const slow = new ScrubVelocity(W, D);
    slow.press(0, 0);
    drag(slow, 0, 0.0025, 0, 2000);
    const fast = new ScrubVelocity(W, D);
    fast.press(0, 0);
    drag(fast, 0, 0.02, 0, 2000);
    expect(slow.rate()).toBeCloseTo(0.5, 2);
    expect(fast.rate()).toBeCloseTo(4, 2);
  });

  it('左へ動かすと、戻る方向になる', () => {
    const v = new ScrubVelocity(W, D);
    v.press(200, 0);
    drag(v, 200, -0.005, 0, 2000);
    expect(v.rate()).toBeCloseTo(-1, 2);
    let total = 0;
    for (let t = 2000; t <= 3000; t += 16) {
      v.move(200 - 0.005 * t, t);   // 同じ速さで続けて動かす
      total += v.advance(t);
    }
    expect(total).toBeLessThan(0);
  });

  it('1 秒ぶんの動きで、再生時間は速さの分だけ進む', () => {
    const v = new ScrubVelocity(W, D);
    v.press(0, 0);
    let x = 0;
    let total = 0;
    for (let t = 16; t <= 2000; t += 16) {
      x += 0.02 * 16;             // 4× の速さ
      v.move(x, t);
      total += v.advance(t);
    }
    // 最初の 2 秒ぶん(2000ms)、4× で約 8 秒進む(前後のコマの端数を許す)
    expect(total).toBeGreaterThan(7.5);
    expect(total).toBeLessThan(8.5);
  });

  it('指を止めると、再生は止まる', () => {
    const v = new ScrubVelocity(W, D);
    v.press(0, 0);
    const x = drag(v, 0, 0.02, 0, 500);
    expect(v.advance(500)).toBeGreaterThan(0);
    expect(v.advance(500 + SCRUB_STALE_MS + 1)).toBe(0);
    expect(v.advance(2000)).toBe(0);
    v.move(x, 2000);
    expect(v.advance(2016)).toBe(0);
  });

  it('タップ(動かさない)は、何も進めない', () => {
    const v = new ScrubVelocity(W, D);
    v.press(100, 0);
    expect(v.advance(16)).toBe(0);
    expect(v.advance(500)).toBe(0);
  });

  it('少しの揺れ(START_PX 未満)はドラッグとみなさない', () => {
    const v = new ScrubVelocity(W, D);
    v.press(100, 0);
    expect(v.isDrag(100 + SCRUB_START_PX - 1)).toBe(false);
    expect(v.isDrag(100 + SCRUB_START_PX)).toBe(true);
    expect(v.isDrag(100 - SCRUB_START_PX)).toBe(true);
  });

  it('一度に進む量は、上限(MAX_FRAME_MS)までに抑える', () => {
    const v = new ScrubVelocity(W, D);
    v.press(0, 0);
    drag(v, 0, 0.005, 0, 500);
    // 500ms のあとに、次の描画まで 1000ms 空いても、進むのは上限ぶんだけ
    const big = v.advance(500 + 1000);
    const cap = new ScrubVelocity(W, D);
    cap.press(0, 0);
    drag(cap, 0, 0.005, 0, 500);
    const capped = cap.advance(500 + SCRUB_MAX_FRAME_MS);
    expect(big).toBeCloseTo(capped, 6);
  });

  it('幅が 0 のときは何もしない', () => {
    const v = new ScrubVelocity(0, D);
    v.press(0, 0);
    drag(v, 0, 0.02, 0, 500);
    expect(v.advance(500)).toBe(0);
    expect(v.rate()).toBe(0);
  });
});
