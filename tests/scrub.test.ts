import { describe, expect, it } from 'vitest';
import { SCRUB_FULL_PX, SCRUB_KNEE_PX, SCRUB_KNEE_RATE, SCRUB_MAX_FRAME_MS, SCRUB_PX_PER_SEC, SCRUB_STALE_MS, SCRUB_START_PX, ScrubVelocity, scrubMagnitude } from '../src/core/scrub';

const W = 265;   // 表の幅(px)。スマホの横画面で、これくらい

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
  const v = new ScrubVelocity(duration, W);
  v.press(0, 0);
  drag(v, 0, pxPerSec, 0, 2000);
  return v.rate(2000);
}
/** 表の幅を、一定の速さでなぞったときに進む再生時間(秒) */
function sweep(pxPerSec: number, duration: number, dir: 1 | -1 = 1): number {
  const v = new ScrubVelocity(duration, W);
  v.press(0, 0);
  const ms = (W / pxPerSec) * 1000;
  let x = 0, total = 0;
  for (let t = 16; t <= ms; t += 16) {
    x += dir * (pxPerSec * 16) / 1000;
    v.move(x, t);
    total += v.advance(t);
  }
  return total;
}

describe('ミニセクター表のドラッグ(案件 90)', () => {
  it('遅いところは、速さに比例する(1× = 15px/秒)', () => {
    expect(rateAt(SCRUB_PX_PER_SEC, 100)).toBeCloseTo(1, 2);
    expect(rateAt(SCRUB_PX_PER_SEC * 0.1, 100)).toBeCloseTo(0.1, 2);
    expect(rateAt(SCRUB_PX_PER_SEC * 4, 100)).toBeCloseTo(4, 2);
  });

  it('遅いところは、コースの長さによらず同じ', () => {
    for (const px of [5, 15, 60, SCRUB_KNEE_PX]) {
      expect(rateAt(px, 60)).toBeCloseTo(rateAt(px, 200), 6);
    }
  });

  it('8× のところで、比例から変わる。速くするほど進み方は増え続ける(単調)', () => {
    expect(scrubMagnitude(SCRUB_KNEE_PX, 180, W)).toBeCloseTo(SCRUB_KNEE_RATE, 6);
    let last = 0;
    for (let v = 10; v <= SCRUB_FULL_PX * 2; v += 10) {
      const m = scrubMagnitude(v, 180, W);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });

  it('速いところは、コースの長さに合わせて速くなる(長いコースほど速い)', () => {
    const v = (SCRUB_KNEE_PX + SCRUB_FULL_PX) / 2;
    expect(scrubMagnitude(v, 200, W)).toBeGreaterThan(scrubMagnitude(v, 60, W));
  });

  it('最大の速さ以上で表の幅をなぞると、コース全体(3 分)を進む。1 回で最後の近く、2 回で最後まで届く', () => {
    for (const px of [SCRUB_FULL_PX, SCRUB_FULL_PX * 2]) {
      const adv = sweep(px, 180);
      expect(adv).toBeGreaterThan(180 * 0.85);
      expect(adv).toBeLessThan(180 * 1.15);
    }
    expect(sweep(SCRUB_FULL_PX, 180) * 2).toBeGreaterThanOrEqual(180);
  });

  it('コースの長さによらず、速いなぞりは、1 回で全体の近くまで進む', () => {
    for (const d of [60, 180, 400]) {
      const adv = sweep(SCRUB_FULL_PX, d);
      expect(adv / d).toBeGreaterThan(0.85);
    }
  });

  it('遅いなぞり(60px/秒)で表の幅をなぞっても、数秒しか進まない(3 分のコースでも変わらない)', () => {
    const a = sweep(60, 60), b = sweep(60, 180);
    expect(a).toBeCloseTo(b, 4);
    expect(b).toBeLessThan(25);
  });

  it('左へ動かすと、戻る方向になる', () => {
    const v = new ScrubVelocity(150, W);
    v.press(500, 0);
    drag(v, 500, -SCRUB_PX_PER_SEC, 0, 2000);
    expect(v.rate(2000)).toBeCloseTo(-1, 2);
    expect(sweep(SCRUB_FULL_PX, 180, -1)).toBeLessThan(-180 * 0.85);
  });

  it('指を止めると、再生は止まる', () => {
    const v = new ScrubVelocity(150, W);
    v.press(0, 0);
    const x = drag(v, 0, 300, 0, 500);
    expect(v.advance(500)).toBeGreaterThan(0);
    expect(v.advance(500 + SCRUB_STALE_MS + 1)).toBe(0);
    expect(v.advance(2000)).toBe(0);
    v.move(x, 2000);
    expect(v.advance(2016)).toBe(0);
  });

  it('タップ(動かさない)は、何も進めない', () => {
    const v = new ScrubVelocity(150, W);
    v.press(100, 0);
    expect(v.advance(16)).toBe(0);
    expect(v.advance(500)).toBe(0);
  });

  it('少しの揺れ(START_PX 未満)はドラッグとみなさない', () => {
    const v = new ScrubVelocity(150, W);
    v.press(100, 0);
    expect(v.isDrag(100 + SCRUB_START_PX - 1)).toBe(false);
    expect(v.isDrag(100 + SCRUB_START_PX)).toBe(true);
    expect(v.isDrag(100 - SCRUB_START_PX)).toBe(true);
  });

  it('一度に進む量は、上限(MAX_FRAME_MS)までに抑える', () => {
    const v = new ScrubVelocity(150, W);
    v.press(0, 0);
    drag(v, 0, SCRUB_PX_PER_SEC, 0, 500);
    const big = v.advance(500 + 1000);
    const cap = new ScrubVelocity(150, W);
    cap.press(0, 0);
    drag(cap, 0, SCRUB_PX_PER_SEC, 0, 500);
    expect(big).toBeCloseTo(cap.advance(500 + SCRUB_MAX_FRAME_MS), 6);
  });

  it('幅が分からないとき(0)は、固定のゲインのまま', () => {
    expect(scrubMagnitude(SCRUB_FULL_PX * 2, 180, 0)).toBeCloseTo((SCRUB_FULL_PX * 2) / SCRUB_PX_PER_SEC, 6);
  });
});
