import { describe, expect, it } from 'vitest';
import { KEEP_OUT_DEG, labelAngle, labelOffset } from '../src/ui/labelDir';
import type { Slot } from '../src/core';

const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('引き出し線の向き', () => {
  it('好みの向きが進行方向・真後ろに近くなければ、そのまま', () => {
    expect(labelAngle('A', 180)).toBe(45);     // 南向きの車: 45° は進行方向(180°)からも真後ろ(0°)からも離れている
    expect(labelAngle('B', 0)).toBe(90);
  });

  it('どの車・どの進行方向でも、進行方向と真後ろの ±30° には出ない', () => {
    for (const s of ['A', 'B', 'C', 'D'] as Slot[]) {
      for (let h = 0; h < 360; h += 3) {
        const a = labelAngle(s, h);
        expect(diff(a, h)).toBeGreaterThanOrEqual(KEEP_OUT_DEG - 1e-9);
        expect(diff(a, h + 180)).toBeGreaterThanOrEqual(KEEP_OUT_DEG - 1e-9);
      }
    }
  });

  it('進行方向が好みの向きと同じ車は、禁止範囲の縁へ回される', () => {
    expect(labelAngle('B', 90)).toBe(120);     // 真後ろ(270°)ではなく、進行方向(90°)に重なる → 縁へ
    expect(diff(labelAngle('A', 45), 45)).toBe(30);
  });

  it('ずれ(px)は向きと長さから決まる: 東向きなら右、北向きなら上(y が負)', () => {
    const [dx, dy] = labelOffset('B', 0);      // 好み 90°(右)。北向きの車(進行方向 0°、真後ろ 180°)から離れている
    expect(dx).toBe(50); expect(dy).toBe(0);
    expect(labelOffset('A', 180)[1]).toBeLessThan(0);
  });
});
