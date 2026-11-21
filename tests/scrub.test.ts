import { describe, expect, it } from 'vitest';
import { SCRUB_FULL_PX, SCRUB_KNEE_PX, SCRUB_KNEE_RATE, SCRUB_MAX_FRAME_MS, SCRUB_PX_PER_SEC, SCRUB_STALE_MS, SCRUB_START_PX, ScrubVelocity, scrubMagnitude } from '../src/core/scrub';

/** 一定の速さ(px/秒)で、stepMs ごとに動かす。戻り値は最後の位置 */
function drag(v: ScrubVelocity, from: number, pxPerSec: number, startMs: number, durMs: number, stepMs = 16): number {
  let x = from;
  for (let t = startMs + stepMs; t <= startMs + durMs; t += stepMs) {
    x += (pxPerSec * stepMs) / 1000;
    v.move(x, t);
  }
  return x;
}
/** 一定の速さで動かしているときの進み方 */
function rateAt(pxPerSec: number, duration: number): number {
  const v = new ScrubVelocity(duration);
  v.press(0, 0);
  drag(v, 0, pxPerSec, 0, 2000);
  return v.rate(2000);
}

describe('ミニセクター表のドラッグ(案件 90)', () => {
  it('遅いところは、速さに比例する(1× = 15px/秒)', () => {
    expect(rateAt(SCRUB_PX_PER_SEC, 100)).toBeCloseTo(1, 2);
    expect(rateAt(SCRUB_PX_PER_SEC * 0.1, 100)).toBeCloseTo(0.1, 2);
    expect(rateAt(SCRUB_PX_PER_SEC * 4, 100)).toBeCloseTo(4, 2);
  });

  it('遅いところは、コースの長さによらず同じ', () => {
    for (const px of [5, 15, 60, 100]) {
      expect(rateAt(px, 60)).toBeCloseTo(rateAt(px, 200), 6);
    }
  });

  it('8× のところで、比例から対数の増え方に変わる(8× から増え続ける)', () => {
    expect(scrubMagnitude(SCRUB_KNEE_PX, 150)).toBeCloseTo(SCRUB_KNEE_RATE, 6);
    const mid = scrubMagnitude((SCRUB_KNEE_PX + SCRUB_FULL_PX) / 2, 150);
    expect(mid).toBeGreaterThan(SCRUB_KNEE_RATE);
    expect(mid).toBeLessThan(150);
    expect(scrubMagnitude(SCRUB_FULL_PX * 0.9, 150)).toBeGreaterThan(mid);
  });

  it('コースの長さに合わせて速くなる。長いコースほど、同じ速さで速く進む', () => {
    const v = SCRUB_KNEE_PX + (SCRUB_FULL_PX - SCRUB_KNEE_PX) / 2;
    expect(scrubMagnitude(v, 200)).toBeGreaterThan(scrubMagnitude(v, 60));
  });

  it('最大の速さを超えると、コースの最後まで進む(1 秒ぶんで届く)', () => {
    for (const d of [60, 150]) {
      const v = new ScrubVelocity(d);
      v.press(0, 0);
      drag(v, 0, SCRUB_FULL_PX * 1.2, 0, 1000);
      expect(v.rate(1000)).toBeCloseTo(d, 6);
      const total = v.advance(1016);
      expect(total).toBeCloseTo(d * SCRUB_MAX_FRAME_MS / 1000, 6);   // 1 コマの上限ぶん(100ms)
    }
  });

  it('左へ動かすと、戻る方向になる', () => {
    const v = new ScrubVelocity(150);
    v.press(500, 0);
    drag(v, 500, -SCRUB_PX_PER_SEC, 0, 2000);
    expect(v.rate(2000)).toBeCloseTo(-1, 2);
  });

  it('指を止めると、再生は止まる', () => {
    const v = new ScrubVelocity(150);
    v.press(0, 0);
    const x = drag(v, 0, 300, 0, 500);
    expect(v.advance(500)).toBeGreaterThan(0);
    expect(v.advance(500 + SCRUB_STALE_MS + 1)).toBe(0);
    expect(v.advance(2000)).toBe(0);
    v.move(x, 2000);
    expect(v.advance(2016)).toBe(0);
  });

  it('タップ(動かさない)は、何も進めない', () => {
    const v = new ScrubVelocity(150);
    v.press(100, 0);
    expect(v.advance(16)).toBe(0);
    expect(v.advance(500)).toBe(0);
  });

  it('少しの揺れ(START_PX 未満)はドラッグとみなさない', () => {
    const v = new ScrubVelocity(150);
    v.press(100, 0);
    expect(v.isDrag(100 + SCRUB_START_PX - 1)).toBe(false);
    expect(v.isDrag(100 + SCRUB_START_PX)).toBe(true);
    expect(v.isDrag(100 - SCRUB_START_PX)).toBe(true);
  });

  it('一度に進む量は、上限(MAX_FRAME_MS)までに抑える', () => {
    const v = new ScrubVelocity(150);
    v.press(0, 0);
    drag(v, 0, SCRUB_PX_PER_SEC, 0, 500);
    const big = v.advance(500 + 1000);
    const cap = new ScrubVelocity(150);
    cap.press(0, 0);
    drag(cap, 0, SCRUB_PX_PER_SEC, 0, 500);
    expect(big).toBeCloseTo(cap.advance(500 + SCRUB_MAX_FRAME_MS), 6);
  });
});
