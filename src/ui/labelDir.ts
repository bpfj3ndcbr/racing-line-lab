import type { Slot } from '../core';

/** 引き出し線の向きの好み(北=0、時計回りの度)。車ごとに変えて、近くを走る車どうしでも重ならないようにする */
const PREFERRED: Record<Slot, number> = { A: 45, B: 90, C: 135, D: 315 };
/** 進行方向と真後ろの、この角度(±度)の中には線を出さない(車の影や走行ラインと重なるため) */
export const KEEP_OUT_DEG = 30;
export const LABEL_LEN = 50;

const norm = (a: number) => ((a % 360) + 540) % 360 - 180;   // -180〜180

/** 引き出し線の向き(度)。好みの向きが進行方向・真後ろの近くなら、その禁止範囲の縁まで回す */
export function labelAngle(slot: Slot, heading: number): number {
  let p = PREFERRED[slot];
  for (const z of [heading, heading + 180]) {
    const d = norm(p - z);
    if (Math.abs(d) < KEEP_OUT_DEG) p = z + (d < 0 ? -KEEP_OUT_DEG : KEEP_OUT_DEG);
  }
  return ((p % 360) + 360) % 360;
}

/** 画面上のずれ(px、右・下が正) */
export function labelOffset(slot: Slot, heading: number): [number, number] {
  const r = (labelAngle(slot, heading) * Math.PI) / 180;
  return [Math.round(LABEL_LEN * Math.sin(r)) + 0, Math.round(-LABEL_LEN * Math.cos(r)) + 0];
}
