import { describe, expect, it } from 'vitest';
import { SAME_LAP_SEC, matchLap } from '../src/core';

// 位置補正の前後で同じラップを探す(案件 19)。走行ログのファイルが無くても動く

const lap = (number: number, startTime: number, complete = true) => ({ number, startTime, complete });

describe('matchLap', () => {
  it('同じ番号で、開始時刻が近ければ、そのラップ', () => {
    expect(matchLap(lap(3, 300), [lap(2, 150), lap(3, 300.4), lap(4, 450)])).toEqual(lap(3, 300.4));
  });
  it('番号がずれても、開始時刻が近ければ同じラップ(最初の通過が増減したとき)', () => {
    expect(matchLap(lap(3, 300), [lap(3, 150), lap(4, 301)])).toEqual(lap(4, 301));
  });
  it(`開始時刻が ${SAME_LAP_SEC} 秒より離れていれば、見つからない`, () => {
    expect(matchLap(lap(3, 300), [lap(3, 300 + SAME_LAP_SEC + 0.1)])).toBeNull();
    expect(matchLap(lap(3, 300), [])).toBeNull();
  });
  it('完了かどうかが変わったものは、同じラップとみなさない', () => {
    expect(matchLap(lap(3, 300), [lap(3, 300, false)])).toBeNull();
  });
  it('1 周分のログ(輪)は、1 周の長さずれた開始時刻も同じラップ', () => {
    expect(matchLap(lap(1, 0), [lap(1, 142.8)])).toBeNull();
    expect(matchLap(lap(1, 0), [lap(1, 142.8)], 142.9)).toEqual(lap(1, 142.8));
  });
});
