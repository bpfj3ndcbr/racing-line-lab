/**
 * ミニセクター表の上のドラッグ(案件 90): 指の速さから、再生の進み方(秒/秒)を決める。
 * 基準は固定の速さ。SCRUB_PX_PER_SEC(画面の px/秒)で指が動くと 1×。遅い動きは 1× より遅く、速い動きは早送り(上限は SCRUB_MAX_RATE)。
 * 指を止めると止まる。画面には出さない。
 */

/** 1× になる指の速さ(画面の px/秒) */
export const SCRUB_PX_PER_SEC = 150;
/** 早送りの上限(倍) */
export const SCRUB_MAX_RATE = 8;
/** この時間(ms)、指が動かなければ、再生は止まる */
export const SCRUB_STALE_MS = 100;
/** 1 コマの時間(ms)の上限。画面が止まったあとに一度に進みすぎないように */
export const SCRUB_MAX_FRAME_MS = 100;
/** この距離(px)を超えて動いたら、ドラッグとみなす(タップは何もしない) */
export const SCRUB_START_PX = 3;

export class ScrubVelocity {
  private vx = 0;            // 指の速さ(px/ms。右へ動くと正)
  private lastX = 0;
  private lastMoveAt = 0;
  private lastFrameAt = 0;
  private startX = 0;

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

  /** 今の進み方(秒/秒)。1 = 等速、負 = 戻る。指が止まっていれば 0。上限は SCRUB_MAX_RATE */
  rate(now: number = this.lastMoveAt): number {
    if (now - this.lastMoveAt > SCRUB_STALE_MS) return 0;
    const r = (this.vx * 1000) / SCRUB_PX_PER_SEC;
    return Math.max(-SCRUB_MAX_RATE, Math.min(SCRUB_MAX_RATE, r));
  }

  /** 前回からの間に進む(戻る)再生時間(秒) */
  advance(now: number): number {
    const dt = Math.min(Math.max(now - this.lastFrameAt, 0), SCRUB_MAX_FRAME_MS);
    this.lastFrameAt = now;
    return this.rate(now) * dt / 1000;
  }
}
