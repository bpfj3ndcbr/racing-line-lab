/**
 * ミニセクター表の上のドラッグ(案件 90): 指の速さから、再生の進み方(秒/秒)を決める。
 * 「指が 1px 動くと、再生が何秒動くか」(ゲイン)を、指の速さで切り替える。
 *
 * - 遅いとき(〜SCRUB_KNEE_PX): ゲインは固定(1× = SCRUB_PX_PER_SEC)。コースの長さによらず同じ。
 * - 速いとき(SCRUB_KNEE_PX〜SCRUB_FULL_PX): ゲインが、対数の目盛りで、コースの長さに合わせた値まで増える。
 * - SCRUB_FULL_PX を超えると、ゲインは「表の幅 = コース全体」(幅をなぞると最後まで届く)。速いなぞりを 2 回で、端まで届く。
 * 指を止めると止まる。画面には出さない。
 */

/** 1× になる指の速さ(画面の px/秒) */
export const SCRUB_PX_PER_SEC = 15;
/** 比例の終わり(8× になる速さ)。SCRUB_KNEE_PX = 8 × 15 = 120px/秒 */
export const SCRUB_KNEE_RATE = 8;
export const SCRUB_KNEE_PX = SCRUB_KNEE_RATE * SCRUB_PX_PER_SEC;
/** この速さを超えると、表の幅をなぞるだけで、コース全体を進む(画面の px/秒。実機の速いなぞりに合わせて調整) */
export const SCRUB_FULL_PX = 600;
/** この時間(ms)、指が動かなければ、再生は止まる */
export const SCRUB_STALE_MS = 100;
/** 1 コマの時間(ms)の上限。画面が止まったあとに一度に進みすぎないように */
export const SCRUB_MAX_FRAME_MS = 100;
/** この距離(px)を超えて動いたら、ドラッグとみなす(タップは何もしない) */
export const SCRUB_START_PX = 3;

/**
 * 指の速さ(px/秒の絶対値)から、進み方の大きさ(倍)を決める。duration = コースの長さ(秒)、width = 表の幅(px)
 * 倍 = ゲイン(秒/px)× 速さ(px/秒)
 */
export function scrubMagnitude(pxPerSec: number, duration: number, width: number): number {
  const v = Math.abs(pxPerSec);
  const g0 = 1 / SCRUB_PX_PER_SEC;
  if (v <= SCRUB_KNEE_PX) return v * g0;
  const g1 = width > 0 ? Math.max(duration / width, g0) : g0;     // 幅をなぞるとコース全体(遅いコースでも、固定のゲインより下げない)
  if (v >= SCRUB_FULL_PX) return v * g1;
  const k = (v - SCRUB_KNEE_PX) / (SCRUB_FULL_PX - SCRUB_KNEE_PX);
  return v * g0 * Math.pow(g1 / g0, k);                            // 固定のゲインから g1 まで、対数で増える
}

export class ScrubVelocity {
  private vx = 0;            // 指の速さ(px/ms。右へ動くと正)
  private lastX = 0;
  private lastMoveAt = 0;
  private lastFrameAt = 0;
  private startX = 0;

  /** duration = コースの長さ(秒)、width = 表の幅(px) */
  constructor(private readonly duration: number, private readonly width: number) {}

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
    const m = scrubMagnitude(this.vx * 1000, this.duration, this.width);
    return this.vx < 0 ? -m : m;
  }

  /** 前回からの間に進む(戻る)再生時間(秒) */
  advance(now: number): number {
    const dt = Math.min(Math.max(now - this.lastFrameAt, 0), SCRUB_MAX_FRAME_MS);
    this.lastFrameAt = now;
    return this.rate(now) * dt / 1000;
  }
}
