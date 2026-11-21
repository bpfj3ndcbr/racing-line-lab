import { describe, expect, it } from 'vitest';
import { SCRUB_MAX_FRAME_MS, SCRUB_MAX_RATE, SCRUB_PX_PER_SEC, SCRUB_STALE_MS, SCRUB_START_PX, ScrubVelocity } from '../src/core/scrub';

/** 一定の速さ(px/秒)で、stepMs ごとに動かす。戻り値は最後の位置 */
function drag(v: ScrubVelocity, from: number, pxPerSec: number, startMs: number, durMs: number, stepMs = 16): number {
  let x = from;
  for (let t = startMs + stepMs; t <= startMs + durMs; t += stepMs) {
    x += (pxPerSec * stepMs) / 1000;
    v.move(x, t);
  }
  return x;
}

describe('ミニセクター表のドラッグ(案件 90)', () => {
  it('固定の速さ(SCRUB_PX_PER_SEC)で動かすと、1× になる', () => {
    const v = new ScrubVelocity();
    v.press(0, 0);
    drag(v, 0, SCRUB_PX_PER_SEC, 0, 2000);
    expect(v.rate(2000)).toBeCloseTo(1, 2);
  });

  it('遅く動かすと 1× より遅く、速く動かすと速く進む(速さに比例する)', () => {
    const slow = new ScrubVelocity();
    slow.press(0, 0);
    drag(slow, 0, SCRUB_PX_PER_SEC * 0.1, 0, 2000);
    const fast = new ScrubVelocity();
    fast.press(0, 0);
    drag(fast, 0, SCRUB_PX_PER_SEC * 4, 0, 2000);
    expect(slow.rate(2000)).toBeCloseTo(0.1, 2);
    expect(fast.rate(2000)).toBeCloseTo(4, 2);
  });

  it('早送りは上限(8×)で止まる', () => {
    const v = new ScrubVelocity();
    v.press(0, 0);
    drag(v, 0, SCRUB_PX_PER_SEC * 20, 0, 2000);
    expect(v.rate(2000)).toBe(SCRUB_MAX_RATE);
  });

  it('左へ動かすと、戻る方向になる', () => {
    const v = new ScrubVelocity();
    v.press(500, 0);
    drag(v, 500, -SCRUB_PX_PER_SEC, 0, 2000);
    expect(v.rate(2000)).toBeCloseTo(-1, 2);
  });

  it('1 秒ぶんの動きで、再生時間は速さの分だけ進む', () => {
    const v = new ScrubVelocity();
    v.press(0, 0);
    let x = 0;
    let total = 0;
    for (let t = 16; t <= 1000; t += 16) {
      x += (SCRUB_PX_PER_SEC * 2 * 16) / 1000;      // 2× の速さ
      v.move(x, t);
      total += v.advance(t);
    }
    expect(total).toBeGreaterThan(1.8);
    expect(total).toBeLessThan(2.2);
  });

  it('指を止めると、再生は止まる', () => {
    const v = new ScrubVelocity();
    v.press(0, 0);
    const x = drag(v, 0, SCRUB_PX_PER_SEC * 2, 0, 500);
    expect(v.advance(500)).toBeGreaterThan(0);
    expect(v.advance(500 + SCRUB_STALE_MS + 1)).toBe(0);
    expect(v.advance(2000)).toBe(0);
    v.move(x, 2000);
    expect(v.advance(2016)).toBe(0);
  });

  it('タップ(動かさない)は、何も進めない', () => {
    const v = new ScrubVelocity();
    v.press(100, 0);
    expect(v.advance(16)).toBe(0);
    expect(v.advance(500)).toBe(0);
  });

  it('少しの揺れ(START_PX 未満)はドラッグとみなさない', () => {
    const v = new ScrubVelocity();
    v.press(100, 0);
    expect(v.isDrag(100 + SCRUB_START_PX - 1)).toBe(false);
    expect(v.isDrag(100 + SCRUB_START_PX)).toBe(true);
    expect(v.isDrag(100 - SCRUB_START_PX)).toBe(true);
  });

  it('一度に進む量は、上限(MAX_FRAME_MS)までに抑える', () => {
    const v = new ScrubVelocity();
    v.press(0, 0);
    drag(v, 0, SCRUB_PX_PER_SEC, 0, 500);
    const big = v.advance(500 + 1000);
    const cap = new ScrubVelocity();
    cap.press(0, 0);
    drag(cap, 0, SCRUB_PX_PER_SEC, 0, 500);
    expect(big).toBeCloseTo(cap.advance(500 + SCRUB_MAX_FRAME_MS), 6);
  });
});
