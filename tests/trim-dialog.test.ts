// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type KeepRange, addBounds, addRange, canSplitRange, gapAround, includeGap, initialRanges, moveRange, parseVbo, rangeBounds, rangeNames, rangesToCuts, splitBounds, splitRange,
} from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { type TrimResult, trimDialog, trimDuration } from '../src/ui/trimDialog';
import { FakeMap } from './helpers';

// 走行ログの取り込み範囲の画面(案件 59)。人工の .vbo(1 秒ごと。走っている間は東へ進む)で確かめる

const pad = (v: number, w: number) => (v < 0 ? '-' : '+') + Math.abs(v).toFixed(6).padStart(w, '0');
/** parts = [秒数, 速度 km/h] の並び */
function vboText(parts: [number, number][]): string {
  const rows: string[] = [];
  let x = 0, sec = 0;
  for (const [len, v] of parts) for (let i = 0; i < len; i++) {
    const t = 36000 + sec++;
    const hms = `${String(Math.floor(t / 3600)).padStart(2, '0')}${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}${(t % 60).toFixed(2).padStart(5, '0')}`;
    rows.push(`010 ${hms} ${pad(33 * 60, 13)} ${pad(-(131 + x) * 60, 13)} ${v.toFixed(3)} 0.00 +00800.00`);
    x += v / 3.6 / 93000;
  }
  return `File created on 06/05/2026 at 10:00:00\r\n\r\n[column names]\r\nsats time lat long velocity heading height\r\n\r\n[data]\r\n${rows.join('\r\n')}\r\n`;
}
/** 先頭 100 秒・途中 400 秒・末尾 1000 秒の停止があるログ(候補は 先頭・候補1・末尾) */
const STOPS = vboText([[100, 0], [200, 80], [400, 0], [200, 80], [1000, 0]]);
const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text }) as unknown as File;
const flush = () => new Promise((r) => setTimeout(r, 20));
const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $ = <T extends HTMLElement>(sel: string) => q<T>(sel)!;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.modal.tr .tr-row'));
const rowTexts = () => rows().map((r) => r.querySelector('b')!.textContent);
const act = (a: string) => $<HTMLButtonElement>(`.modal.tr [data-trim="${a}"]`).click();
const key = (el: HTMLElement, k: string, shift = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));

beforeEach(() => { document.body.innerHTML = ''; });

describe('取り込む範囲の編集(core)', () => {
  const T = 2000;
  const ranges: KeepRange[] = [{ from: 70, to: 330, on: true }, { from: 669, to: 929, on: true }];

  it('端を動かせる範囲: 範囲は 30 秒以上、範囲どうしのあいだも 30 秒以上。ログの端までは動かせる', () => {
    expect(rangeBounds(ranges, 0, 'from', T)).toEqual([0, 300]);
    expect(rangeBounds(ranges, 0, 'to', T)).toEqual([100, 639]);
    expect(rangeBounds(ranges, 1, 'from', T)).toEqual([360, 899]);
    expect(rangeBounds(ranges, 1, 'to', T)).toEqual([699, T]);
    expect(moveRange(ranges, 0, 'to', 5000, T)[0].to).toBe(639);
    expect(moveRange(ranges, 0, 'from', -5, T)[0].from).toBe(0);
  });

  it('分ける: 指定した位置を中央に 1 分の取り込まない区間を入れて 2 つに(後ろ側は「足したもの」)。両側に 30 秒は残す。2 分未満は分けられない', () => {
    const s = splitRange(ranges, 0, 200);
    expect(s.map((r) => [r.from, r.to, !!r.added])).toEqual([[70, 170, false], [230, 330, true], [669, 929, false]]);
    expect(rangeNames(s)).toEqual(['範囲1', '範囲2', '範囲3']);
    expect(splitBounds(ranges[0])).toEqual([130, 270]);
    expect(splitRange(ranges, 0, 80).slice(0, 2).map((r) => [r.from, r.to])).toEqual([[70, 100], [160, 330]]);   // 130 に収める
    expect(canSplitRange({ from: 0, to: 119 })).toBe(false);
    expect(splitRange([{ from: 0, to: 100, on: true }], 0, 50)).toHaveLength(1);
  });

  it('足す: 範囲の外に、隣とのあいだ 30 秒をあけて 2 分の範囲を足す(狭ければ縮める)。範囲の中や、30 秒も取れないところには足せない', () => {
    expect(addBounds(ranges, 500, T)).toEqual([360, 639]);
    expect(addRange(ranges, 500, T)).toEqual({ ranges: [ranges[0], { from: 440, to: 560, on: true, added: true }, ranges[1]], index: 1 });
    expect(addRange(ranges, 370, T).ranges[1]).toEqual({ from: 360, to: 480, on: true, added: true });   // 前の範囲に寄せない
    expect(addRange(ranges, 30, T).ranges[0]).toEqual({ from: 0, to: 40, on: true, added: true });       // 0〜40 秒しか取れない
    expect(addBounds(ranges, 200, T)).toBeNull();                                                         // 範囲の中
    expect(addBounds([{ from: 0, to: 100, on: true }, { from: 150, to: 300, on: true }], 120, T)).toBeNull();
    expect(addRange(ranges, 200, T).index).toBe(-1);
  });

  it('範囲の外を取り込む: 前後の範囲と 1 つにつなぐ。ログの端の区間は、隣の範囲を端まで広げる', () => {
    expect(gapAround(ranges, 500, T)).toEqual({ from: 330, to: 669 });
    expect(gapAround(ranges, 200, T)).toBeNull();
    expect(includeGap(ranges, 500, T)).toEqual({ ranges: [{ from: 70, to: 929, on: true }], index: 0 });
    expect(includeGap(ranges, 10, T)).toEqual({ ranges: [{ from: 0, to: 330, on: true }, ranges[1]], index: 0 });
    expect(includeGap(ranges, 1500, T).ranges[1]).toEqual({ from: 669, to: T, on: true });
    expect(includeGap([], 10, T)).toEqual({ ranges: [{ from: 0, to: T, on: true }], index: 0 });
    expect(includeGap(ranges, 200, T).index).toBe(-1);
  });

  it('チェックした範囲の外を、取り込まない区間にする', () => {
    expect(rangesToCuts(ranges, T)).toEqual([{ from: 0, to: 70 }, { from: 330, to: 669 }, { from: 929, to: T }]);
    expect(rangesToCuts([{ ...ranges[0], on: false }, ranges[1]], T)).toEqual([{ from: 0, to: 669 }, { from: 929, to: T }]);
    expect(rangesToCuts([{ from: 0, to: T, on: true }], T)).toEqual([]);
    expect(rangesToCuts(ranges.map((r) => ({ ...r, on: false })), T)).toEqual([{ from: 0, to: T }]);
  });

  it('初めの範囲: 停止の候補を除いた残り。保存した区間があれば、その残り。停止が無ければログ全体', () => {
    const log = parseVbo(STOPS, 'a.vbo');
    expect(initialRanges(log).map((r) => [r.from, r.to, r.on])).toEqual([[70, 330, true], [669, 929, true]]);
    expect(initialRanges(log, [{ from: 500, to: 600 }, { from: 1500, to: 1899 }]).map((r) => [r.from, r.to])).toEqual([[0, 500], [600, 1500]]);
    expect(initialRanges(parseVbo(vboText([[300, 80]]), 'b.vbo')).map((r) => [r.from, r.to])).toEqual([[0, 299]]);
  });
});

describe('取り込み範囲の画面', () => {
  const log = parseVbo(STOPS, 'stops.vbo');            // 範囲1 = 70〜330 秒、範囲2 = 669〜929 秒(19:00:00 が 0 秒)
  const open = (deps: Parameters<typeof trimDialog>[1] = {}) => {
    const maps: FakeMap[] = [];
    const p = trimDialog(log, { mapFactory: () => { const m = new FakeMap(); maps.push(m); return m; }, ...deps });
    return { p, maps };
  };
  /** 全体のグラフで i 番目の範囲を押す(jsdom は幅が 0 なので、範囲の中央に印が付く) */
  const tapBand = (i: number) => $(`.tr-all [data-i="${i}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const okCuts = async (p: Promise<TrimResult>) => (await p as Extract<TrimResult, { kind: 'ok' }>).cuts;
  /** 拡大のグラフに、幅 600px の大きさを与える(jsdom は 0 なので) */
  const sized = (edge: 'from' | 'to') => {
    const g = $(`.tr-edge[data-edge="${edge}"] .tr-zoom`);
    g.getBoundingClientRect = () => ({ left: 0, right: 600, width: 600, top: 0, bottom: 84, height: 84, x: 0, y: 0, toJSON: () => ({}) });
    return (type: string, x: number) => g.dispatchEvent(new MouseEvent(type, { clientX: x, bubbles: true }));
  };

  it('ファイル名・何本目か・取り込む範囲の一覧を出す。初めは範囲1 を選び、「次へ」で、範囲の外を取り込まない区間として返す', async () => {
    const { p, maps } = open({ step: 2, total: 3 });
    expect($('.tr-step').textContent).toBe('2 / 3');
    expect($('.tr-file').textContent).toContain('stops.vbo');
    expect($('.tr-file').textContent).toContain('2026/05/06 19:00 から 32 分');     // 10:00 UTC = 19:00 JST。1899 秒
    expect($('.tr-desc').textContent).toContain('止まっている時間が長い区間を除いて、取り込む範囲を決めました');
    expect(rowTexts()).toEqual(['範囲1', '範囲2']);
    expect(rows()[0].classList.contains('sel')).toBe(true);
    expect($('.tr-det-cap').textContent).toBe('範囲1(4 分)');
    expect($('.tr-edge[data-edge="from"] .tr-e-l').textContent).toBe('取り込み開始');
    expect($('.tr-edge[data-edge="to"] .tr-e-l').textContent).toBe('取り込み終了');
    expect($('.tr-sum').textContent).toBe(`取り込むのは ${trimDuration(520)}(元の 27%)`);
    // 地図(ダイアログが画面に入ってから作る): 取り込まない部分は灰色、取り込む部分は青、選んでいる範囲は赤
    await flush();
    const colors = () => maps[0].tracks.map((t) => t.slot);
    expect(colors()).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(maps[0].tracks.filter((t) => t.slot === 'C').every((t) => t.minWidth === 2)).toBe(true);   // 選んでいる範囲は太く
    expect(maps[0].tracks.filter((t) => t.slot === 'B').every((t) => t.minWidth === undefined)).toBe(true);
    expect(colors()).not.toContain('D');
    tapBand(0);                                          // 分ける位置の印(間に入る 1 分)はオレンジ
    expect(colors()).toContain('D');
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 0, to: 70 }, { from: 330, to: 669 }, { from: 929, to: 1899 }]);
    expect(maps[0].destroyed).toBe(true);
    expect(q('.modal.tr')).toBeNull();
  });

  it('チェックを外した範囲は取り込まない。どれも外すと「次へ」は押せない', async () => {
    const { p } = open();
    rows()[0].querySelector<HTMLInputElement>('input')!.click();     // チェックあり → なし
    expect(rows()[0].classList.contains('off')).toBe(true);
    expect($('.tr-sum').textContent).toContain('元の 14%');
    rows()[1].querySelector<HTMLInputElement>('input')!.click();
    expect($('.tr-sum').textContent).toBe('取り込む範囲がありません');
    expect($<HTMLButtonElement>('[data-trim="next"]').disabled).toBe(true);
    rows()[1].querySelector<HTMLInputElement>('input')!.click();
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 0, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('← → で端を 1 秒(Shift で 10 秒)ずつ動かす。止まっていなくても、ログの先頭まで動かせる', async () => {
    const { p } = open();
    const fromKnob = () => $('.tr-edge[data-edge="from"] [data-k="from"]');
    key(fromKnob(), 'ArrowLeft');
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:01:09');
    expect(document.activeElement).toBe(fromKnob());     // 描き直しても、つまみにフォーカスが残る
    key(fromKnob(), 'ArrowLeft', true);
    expect(rows()[0].querySelector('.tr-range')!.textContent).toContain('19:00:59〜');
    for (let i = 0; i < 30; i++) key(fromKnob(), 'ArrowLeft', true);
    expect(rows()[0].querySelector('.tr-range')!.textContent).toContain('19:00:00〜');
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 330, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('全体のグラフで範囲を押すと、そこに分ける位置の印を出し、「範囲を分ける」で 1 分の切れ目を入れて後ろ側を選ぶ。分けて足した範囲は「×」で消せる', async () => {
    const { p } = open();
    expect($<HTMLButtonElement>('[data-trim="split"]').disabled).toBe(true);    // 印を置くまでは押せない
    expect($('.tr-hint').textContent).toBe('グラフを押すと、分ける位置(灰色の所なら足す位置)を決められます');
    tapBand(0);
    expect($('.tr-hint').textContent).toBe('分ける位置 19:03:20');
    expect(q('.tr-all .tr-mark')).not.toBeNull();
    expect($<HTMLButtonElement>('[data-trim="split"]').disabled).toBe(false);
    act('split');
    expect(rowTexts()).toEqual(['範囲1', '範囲2(追加)', '範囲3']);
    expect(rows()[1].classList.contains('sel')).toBe(true);
    expect($<HTMLButtonElement>('[data-trim="split"]').disabled).toBe(true);    // 分けたら印は消える
    expect($('.tr-hint').textContent).toBe('グラフの灰色の所を押すと、範囲を足せます');   // 100 秒は、もう分けられない
    rows()[1].querySelector<HTMLButtonElement>('.tr-del')!.click();
    expect(rowTexts()).toEqual(['範囲1', '範囲2']);
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 0, to: 70 }, { from: 170, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('拡大のグラフでは、つまみの近くを押すとつまみを動かし、範囲の中のほかの所を押すと分ける位置、範囲の外なら足す位置の印を置く', async () => {
    const { p } = open();                                // 範囲1(70〜330 秒)。取り込み開始のグラフは 0〜360 秒
    const ptr = sized('from');
    ptr('pointerdown', 50);                              // 範囲の外(30 秒)→ 足す位置
    expect($('.tr-hint').textContent).toBe('追加する位置 19:00:30');
    expect($('[data-trim="split"]').textContent).toBe('範囲を追加');
    expect(q('.tr-edge[data-edge="from"] .tr-mark.add')).not.toBeNull();
    ptr('pointerdown', 400);                             // 240 秒(範囲の中で、つまみから離れている)→ 分ける位置
    ptr('pointerup', 400);
    expect($('.tr-hint').textContent).toBe('分ける位置 19:04:00');
    expect($('[data-trim="split"]').textContent).toBe('範囲を分ける');
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:01:10');   // つまみは動かない
    expect(q('.tr-edge[data-edge="from"] .tr-mark:not(.add)')).not.toBeNull();
    ptr('pointerdown', 125);                             // つまみ(116.7px)の近く → つまみを動かす(75 秒)
    ptr('pointerup', 125);
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:01:15');
    act('split');
    expect(await (act('next'), okCuts(p))).toEqual([{ from: 0, to: 75 }, { from: 210, to: 270 }, { from: 330, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('どの範囲も「×」で消せる。消したところを押すと、そこに 2 分の範囲を足せる(「範囲を追加」)', async () => {
    const { p } = open();
    rows()[0].querySelector<HTMLButtonElement>('.tr-del')!.click();                 // 自動で決めた範囲1 を消す
    expect(rowTexts()).toEqual(['範囲1']);
    expect(rows()[0].querySelector('.tr-range')!.textContent).toContain('19:11:09〜');
    const ptr = sized('from');                           // 取り込み開始のグラフは 489〜849 秒
    ptr('pointerdown', 100);                             // 549 秒(範囲の外)
    expect($('.tr-hint').textContent).toBe('追加する位置 19:09:09');
    act('split');                                        // 「範囲を追加」: 489〜609 秒
    expect(rowTexts()).toEqual(['範囲1(追加)', '範囲2']);
    expect(rows()[0].classList.contains('sel')).toBe(true);
    expect(rows()[0].querySelector('.tr-range')!.textContent).toContain('19:08:09〜19:10:09');
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 0, to: 489 }, { from: 609, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('取り込まない区間を押すと選んだ表示にし、「取り込み範囲にする」で前後の範囲と 1 つにする', async () => {
    const { p } = open();
    expect($<HTMLButtonElement>('[data-trim="include"]').disabled).toBe(true);
    tapBand(0);
    act('split');                                        // 70〜170 | 170〜230 は取り込まない | 230〜330(選ぶ)
    const ptr = sized('from');                           // 1 つのグラフ(100〜460 秒)
    ptr('pointerdown', 167);                             // 200 秒(1 分の切れ目)
    expect($('.tr-det-cap').textContent).toBe('取り込まない区間(1 分)');
    expect(q('.tr-all .tr-band.gap')).not.toBeNull();
    expect(q('.tr-all .tr-band.sel')).toBeNull();        // 範囲の枠は出さない
    expect($<HTMLButtonElement>('[data-trim="include"]').disabled).toBe(false);
    expect($<HTMLButtonElement>('[data-trim="split"]').disabled).toBe(true);   // 1 分の区間には、範囲は足せない
    act('include');
    expect(rowTexts()).toEqual(['範囲1', '範囲2']);
    expect(rows()[0].classList.contains('sel')).toBe(true);
    expect(rows()[0].querySelector('.tr-range')!.textContent).toContain('19:01:10〜19:05:30');
    expect($<HTMLButtonElement>('[data-trim="include"]').disabled).toBe(true);
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 0, to: 70 }, { from: 330, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('範囲を全部消すと「取り込む範囲がありません」と出し、「次へ」は押せない', () => {
    void open();
    rows()[0].querySelector<HTMLButtonElement>('.tr-del')!.click();
    rows()[0].querySelector<HTMLButtonElement>('.tr-del')!.click();
    expect($('.tr-none').textContent).toContain('グラフの灰色の所を押すと、範囲を足せます');
    expect($('.tr-det-cap').textContent).toBe('範囲を選んでいません');
    expect($('.tr-edges').hidden).toBe(true);
    expect($<HTMLButtonElement>('[data-trim="next"]').disabled).toBe(true);
  });

  it('両端が 1 つの表示に収まる短い範囲は、間を省かずに 1 つの拡大のグラフ(取り込む範囲)で出す', () => {
    void open();
    tapBand(0);
    act('split');                                        // 範囲2(追加)= 230〜330 秒を選ぶ
    expect($('.tr-edge[data-edge="to"]').hidden).toBe(true);
    const one = $('.tr-edge[data-edge="from"]');
    expect(one.querySelector('.tr-e-l')!.textContent).toBe('取り込む範囲');
    expect(one.querySelector('.tr-e-t')!.textContent).toBe('19:03:50〜19:05:30');
    expect(Array.from(one.querySelectorAll<HTMLElement>('.tr-knob:not(.sub)')).map((k) => k.dataset.k)).toEqual(['from', 'to']);
    key(one.querySelector<HTMLElement>('[data-k="to"]')!, 'ArrowLeft', true);
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:03:50〜19:05:20');
    expect((document.activeElement as HTMLElement).dataset.k).toBe('to');
  });

  it('ドラッグで縮めて、間の側の枠まで来たら、離さなくても 1 つのグラフに切り替え、つまみをマウスの位置に出す', () => {
    void open();
    rows()[1].click();                                   // 範囲2(669〜929 秒)。取り込み開始のグラフは 489〜849 秒
    const ptr = sized('from');
    ptr('pointerdown', 300);                             // 669 秒(つまみの位置)
    ptr('pointermove', 500);                             // 789 秒。まだ 2 つ
    expect($('.tr-edge[data-edge="to"]').hidden).toBe(false);
    ptr('pointermove', 700);                             // 枠の外 → 表示が 60 秒進み、つまみは 899 秒(残り 30 秒)→ 1 つに
    expect($('.tr-edge[data-edge="to"]').hidden).toBe(true);
    expect($('.tr-edge[data-edge="from"] .tr-e-l').textContent).toBe('取り込む範囲');
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:14:59〜19:15:29');
    // つまみはマウスの位置(700px)に寄せる。もう一方の端も収まるように、右から 3% と残り 30 秒の分は空ける
    expect(parseFloat($<HTMLElement>('.tr-edge[data-edge="from"] .tr-knob[data-k="from"]').style.left)).toBeCloseTo((0.97 - 30 / 360) * 100, 1);
    ptr('pointermove', 640);                             // 60px = 36 秒だけ戻る(指の位置へは飛ばない)
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:14:23〜19:15:29');
    ptr('pointerup', 640);
    expect($('.tr-edge[data-edge="from"] .tr-e-l').textContent).toBe('取り込む範囲');
  });

  it('つまみをドラッグしているあいだも、地図の色分けがついていく(離す前に描き直す)', async () => {
    const { maps } = open();                             // 範囲1(70〜330 秒)
    await flush();
    const red = () => maps[0].tracks.filter((t) => t.slot === 'C').reduce((s, t) => s + t.points.length, 0);
    const before = red();
    const ptr = sized('to');                             // 取り込み終了のグラフ(150〜510 秒)。つまみは 300px
    ptr('pointerdown', 300);
    ptr('pointermove', 100);                             // 終わりを 210 秒へ(まだ離さない)
    await new Promise((r) => setTimeout(r, 120));        // 地図は 80ms に 1 回まで
    expect(red()).toBeLessThan(before);
    ptr('pointerup', 100);
  });

  it('枠の外までドラッグしても、表示がついて動くのは、動かせる範囲の外が 1 分見えるところまで', () => {
    void open();
    rows()[1].click();                                   // 範囲2 の始まり(669 秒)。動かせるのは 範囲1 の終わり(330 秒)+ 30 秒 まで
    const ptr = sized('from');
    ptr('pointerdown', 300);
    ptr('pointermove', -300);
    ptr('pointermove', -900);
    ptr('pointermove', -1500);
    expect($('.tr-edge[data-edge="from"] .tr-e-t').textContent).toBe('19:06:00');
    // 表示は 300〜660 秒で止まる(360 − 60 秒)。範囲1 の終わり(330 秒)は 8.33% の位置
    expect($<HTMLElement>('.tr-edge[data-edge="from"] .tr-knob.sub').style.left).toBe('8.33%');
    expect($<HTMLElement>('.tr-edge[data-edge="from"] .tr-knob[data-k="from"]').style.left).toBe('16.67%');
    ptr('pointerup', -1500);
  });

  it('全体のグラフにも選んだ範囲のつまみを出し、← → で 10 秒(Shift で 1 分)ずつ動かす', async () => {
    const { p } = open();
    const ov = () => Array.from(document.querySelectorAll<HTMLElement>('.tr-all [data-k]'));
    expect(ov().map((k) => k.dataset.k)).toEqual(['from', 'to']);
    key(ov()[1], 'ArrowRight');
    key(ov()[1], 'ArrowRight', true);
    expect($('.tr-edge[data-edge="to"] .tr-e-t').textContent).toBe('19:06:40');   // 330 + 70 秒
    expect((document.activeElement as HTMLElement).closest('.tr-all')).not.toBeNull();
    act('next');
    expect((await okCuts(p))[1]).toEqual({ from: 400, to: 669 });
  });

  it('全体のグラフは「＋」「−」で 2 倍ずつ拡大・縮小する。表示の幅は 10 分まで', () => {
    void open();                                         // 1899 秒のログ → 2 倍(約 16 分)まで
    const inner = () => $('.tr-all-in');
    expect($('.tr-zl').textContent).toBe('全体');
    expect($<HTMLButtonElement>('[data-trim="zout"]').disabled).toBe(true);
    act('zin');
    expect(inner().style.width).toBe('200%');
    expect($('.tr-zl').textContent).toBe('×2');
    expect($('.tr-all').classList.contains('zoomed')).toBe(true);
    expect($<HTMLButtonElement>('[data-trim="zin"]').disabled).toBe(true);
    expect(inner().querySelectorAll('[data-k]')).toHaveLength(2);           // つまみ・範囲の帯は内側に描く
    // 拡大した倍率だけ座標の幅も広げる(帯の位置・最小の幅が、拡大で広がらないように)
    expect(inner().querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 2000 60');
    const cut = inner().querySelectorAll('.tr-band.on')[1];                  // 330〜669 秒
    expect([cut.getAttribute('x'), cut.getAttribute('width')]).toEqual([((330 / 1899) * 2000).toFixed(1), ((339 / 1899) * 2000).toFixed(1)]);
    act('zout');
    expect(inner().style.width).toBe('100%');
    expect($('.tr-zl').textContent).toBe('全体');
  });

  it('全体のグラフの拡大は、選んだ範囲の中央を真ん中にする', () => {
    void open();
    const g = $('.tr-all');
    let left = 0;
    Object.defineProperty(g, 'clientWidth', { value: 500 });
    Object.defineProperty(g, 'scrollLeft', { get: () => left, set: (v: number) => { left = v; } });
    rows()[1].click();                                   // 範囲2(669〜929 秒)の中央 799 秒
    act('zin');                                          // 内側の幅 1000px。799 秒は 420.7px → 真ん中(250px)に
    expect(left).toBeCloseTo((799 / 1899) * 1000 - 250, 3);
  });

  it('拡大のグラフに出ている隣の範囲の端を押すと、その範囲を選ぶ', () => {
    void open();
    tapBand(0);
    act('split');                                        // 範囲1 と 範囲2 の間は 1 分 → 範囲1 の終わりが拡大のグラフに入る
    const sub = $('.tr-edge[data-edge="from"] .tr-knob.sub');
    sub.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(rows()[0].classList.contains('sel')).toBe(true);
  });

  it('「このファイルの読み込みを止める」「全ての読み込みを止める」。Esc は、このファイルの読み込みを止める', async () => {
    let r = open();
    act('skip');
    expect(await r.p).toEqual({ kind: 'skip' });
    r = open();
    act('abort');
    expect(await r.p).toEqual({ kind: 'abort' });
    r = open();
    await flush();
    key($('.modal.tr'), 'Escape');
    expect(await r.p).toEqual({ kind: 'skip' });
    expect(r.maps[0].destroyed).toBe(true);
  });

  it('止まっている区間が無いログは、ログ全体を 1 つの範囲で出す。前後も削れる', async () => {
    const p = trimDialog(parseVbo(vboText([[300, 80]]), 'run.vbo'));
    expect($('.tr-desc').textContent).toContain('止まっている時間が長い区間はありませんでした');
    expect(rowTexts()).toEqual(['範囲1']);
    expect(q('.tr-step')).toBeNull();                    // 1 本だけのときは「1 / 1」を出さない
    key($('.tr-all [data-k="from"]'), 'ArrowRight');
    act('next');
    expect(await okCuts(p)).toEqual([{ from: 0, to: 10 }]);
  });
});

describe('ファイルの追加で、取り込み範囲の画面を 1 本ずつ出す', () => {
  let session: Session, store: MemoryStore;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    store = new MemoryStore();
    session = new Session(store);
    mountApp(document.getElementById('app')!, session, new ThemeController(new MemoryStore()), () => new FakeMap());
  });
  function addFiles(set: number, files: File[]) {
    document.querySelector<HTMLButtonElement>(`#sec-set-${set} [data-act="add"]`)!.click();
    const inp = document.querySelector<HTMLInputElement>('#vbo-input')!;
    Object.defineProperty(inp, 'files', { value: files, configurable: true });
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const B = vboText([[50, 0], [300, 80], [100, 0]]);

  it('「次へ」で、取り込まない区間を保存して、切り取ったログを追加する', async () => {
    addFiles(0, [file('a.vbo', STOPS), file('b.vbo', B)]);
    await flush();
    expect($('.tr-step').textContent).toBe('1 / 2');
    expect($('.tr-file').textContent).toContain('a.vbo');
    act('next');
    await flush();
    expect($('.tr-step').textContent).toBe('2 / 2');
    expect(session.sets[0].logs).toHaveLength(0);         // 全部決めてから、まとめて追加する
    act('next');
    await flush();
    expect(session.sets[0].logs.map((l) => l.id)).toEqual([`a.vbo:${STOPS.length}`, `b.vbo:${B.length}`]);
    expect(session.sets[0].logs[0].log.t.length).toBe(1900 - 71 - 340 - 971);
    expect(session.trimOf(`a.vbo:${STOPS.length}`)).toEqual([{ from: 0, to: 70 }, { from: 330, to: 669 }, { from: 929, to: 1899 }]);
  });

  it('「このファイルの読み込みを止める」はそのファイルだけ、「全ての読み込みを止める」は 1 本も追加しない', async () => {
    addFiles(0, [file('a.vbo', STOPS), file('b.vbo', B)]);
    await flush();
    act('skip');
    await flush();
    act('next');
    await flush();
    expect(session.sets[0].logs.map((l) => l.id)).toEqual([`b.vbo:${B.length}`]);
    expect(session.message).toBe('1 件の走行ログは読み込みませんでした。');

    addFiles(1, [file('a.vbo', STOPS), file('c.vbo', B + '\r\n')]);
    await flush();
    act('next');
    await flush();
    act('abort');
    await flush();
    expect(session.sets[1].logs).toHaveLength(0);
    expect(session.message).toBe('走行ログの読み込みを止めました。');
  });

  it('ほかの比較セットに読み込み済みのファイルは、画面を出さずに同じ中身で追加する', async () => {
    addFiles(0, [file('a.vbo', STOPS)]);
    await flush();
    act('next');
    await flush();
    addFiles(1, [file('a.vbo', STOPS)]);
    await flush();
    expect(q('.modal.tr')).toBeNull();
    expect(session.sets[1].logs[0].log).toBe(session.sets[0].logs[0].log);
  });
});
