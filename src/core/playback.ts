/**
 * 再生状態。時間を進める仕組み(requestAnimationFrame)は持たず、tick() で進める。
 * そのためテストでは時間を自由に進められ、UI 側は好きな方法で呼べる。
 */
export const FRAME_STEP = 0.1;

export class PlaybackEngine {
  t = 0;
  duration = 0;
  rate = 1;
  playing = false;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { this.listeners.forEach((f) => f()); }

  setDuration(d: number): void {
    this.duration = Math.max(0, d);
    if (this.t > this.duration) this.t = this.duration;
    this.emit();
  }

  play(): void {
    if (this.duration <= 0) return;
    if (this.t >= this.duration - 1e-9) this.t = 0;   // 最後まで来ていたら頭から
    this.playing = true;
    this.emit();
  }
  pause(): void { if (this.playing) { this.playing = false; this.emit(); } }
  toggle(): void { if (this.playing) this.pause(); else this.play(); }

  seek(t: number): void {
    this.t = Math.min(Math.max(t, 0), this.duration);
    this.emit();
  }

  setRate(r: number): void { this.rate = r; this.emit(); }

  /** 1コマ(0.1秒)進める / 戻す。0.1秒の刻みにそろえる。 */
  step(dir: 1 | -1, dt = FRAME_STEP): void {
    const k = this.t / dt;
    const onGrid = Math.abs(k - Math.round(k)) < 1e-6;
    const target = onGrid ? (Math.round(k) + dir) * dt : (dir > 0 ? Math.ceil(k) : Math.floor(k)) * dt;
    this.seek(Math.round(target * 1e6) / 1e6);
  }

  /** sec 秒ぶん進める / 戻す(0.1 秒の位取りに丸める)。再生中でも使える。 */
  skip(dir: 1 | -1, sec = 1): void {
    this.seek(Math.round((this.t + dir * sec) * 10) / 10);
  }

  /** 実時間 dtSec 秒ぶん進める(再生中のみ)。最後まで来たら止まる。 */
  tick(dtSec: number): void {
    if (!this.playing) return;
    this.t += dtSec * this.rate;
    if (this.t >= this.duration) { this.t = this.duration; this.playing = false; }
    this.emit();
  }
}
