/**
 * ミニセクター表の上のドラッグ(案件 90): 指の速さから、再生の進み方(秒/秒)を決める。
 *
 * - 遅いとき(〜SCRUB_KNEE_PX): 指の速さに比例する。コースの長さによらず同じ。SCRUB_PX_PER_SEC で 1×。
 * - 速いとき(SCRUB_KNEE_PX〜SCRUB_FULL_PX): 8× から、コースの長さの分だけ、対数の目盛りで増える。
 * - SCRUB_FULL_PX を超えると、コースの最後まで進む(1 秒で最後まで届く速さ)。
 * 指を止めると止まる。画面には出さない。
 */

/** 1× になる指の速さ(画面の px/秒) */
export const SCRUB_PX_PER_SEC = 15;
/** 比例の終わり(この倍率になる速さ)。SCRUB_KNEE_PX = 8 × 15 = 120px/秒 */
export const SCRUB_KNEE_RATE = 8;
export const SCRUB_KNEE_PX = SCRUB_KNEE_RATE * SCRUB_PX_PER_SEC;
/** この速さを超えると、コースの最後まで進む(画面の px/秒。実機の速いなぞりに合わせて調整) */
export const SCRUB_FULL_PX = 1200;
/** この時間(ms)、指が動かなければ、再生は止まる */
export const SCRUB_STALE_MS = 100;
/** 1 コマの時間(ms)の上限。画面が止まったあとに一度に進みすぎないように */
export const SCRUB_MAX_FRAME_MS = 100;
/** この距離(px)を超えて動いたら、ドラッグとみなす(タップは何もしない) */
export const SCRUB_START_PX = 3;

/** 指の速さ(px/秒の絶対値)から、進み方の大きさ(倍)を決める。D = コースの長さ(秒) */
export function scrubMagnitude(pxPerSec: number, duration: number): number {
  const v = Math.abs(pxPerSec);
  if (v <= SCRUB_KNEE_PX) return v / SCRUB_PX_PER_SEC;
  const end = Math.max(duration, SCRUB_KNEE_RATE);            // 最後まで届く倍率(短いコースでも、8× より下がらない)
  if (v >= SCRUB_FULL_PX) return end;
  const k = (v - SCRUB_KNEE_PX) / (SCRUB_FULL_PX - SCRUB_KNEE_PX);
  return SCRUB_KNEE_RATE * Math.pow(end / SCRUB_KNEE_RATE, k);  // 8× から end まで、対数で増える
}

export class ScrubVelocity {
  private vx = 0;            // 指の速さ(px/ms。右へ動くと正)
  private lastX = 0;
  private lastMoveAt = 0;
  private lastFrameAt = 0;
  private startX = 0;

  /** duration = コースの長さ(秒) */
  constructor(private readonly duration: number) {}

  press(x: number, now: number): void {
    this.startX = x;
    this.lastX = x;
    this.lastMoveAt = now;
    this.lastFrameAt = now;
    this.vx = 0;
  }

  /** ドラッグとみなす距離を、押した位置から超えたか */
  isDrag(x: number): boolean {
    return Math.abs(x - this.startX) >= SCRUB_START_PX;
  }

  move(x: number, now: number): void {
    const dt = now - this.lastMoveAt;
    if (dt <= 0) return;
    const v = (x - this.lastX) / dt;
    // 少し間が空いたあとの最初の動きは、そのまま使う。続いているときは、直前の速さと平均して揺れを抑える
    this.vx = dt > SCRUB_STALE_MS ? v : (this.vx + v) / 2;
    this.lastMoveAt = now;
    this.lastX = x;
  }

  /** 今の進み方(秒/秒)。正 = 進む、負 = 戻る。指が止まっていれば 0 */
  rate(now: number = this.lastMoveAt): number {
    if (now - this.lastMoveAt > SCRUB_STALE_MS) return 0;
    const m = scrubMagnitude(this.vx * 1000, this.duration);
    return this.vx < 0 ? -m : m;
  }

  /** 前回からの間に進む(戻る)再生時間(秒) */
  advance(now: number): number {
    const dt = Math.min(Math.max(now - this.lastFrameAt, 0), SCRUB_MAX_FRAME_MS);
    this.lastFrameAt = now;
    return this.rate(now) * dt / 1000;
  }
}
