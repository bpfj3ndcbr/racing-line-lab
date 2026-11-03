// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { HEAT_WIDTH, LINE_WIDTH, MIN_LINE_WIDTH, WIDTH_REF_ZOOM, lineWidth } from '../src/ui/trackMap';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';
import { GRAPH_LEFT, GRAPH_RIGHT } from '../src/ui/speedGraph';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');
const bigPath = fx('session_20260506_094550_autopolis.vbo');

let root: HTMLElement, session: Session, fake: FakeMap;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const store = new MemoryStore();
  session = new Session(store);
  fake = new FakeMap();
  mountApp(root, session, new ThemeController(store), () => fake);
  session.registerCircuit('オートポリス', cln, sci);
});

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const goCompare = () => $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
const seekTo = (sec: number) => { const e = $<HTMLInputElement>('#cmp-seek'); e.value = String(sec); e.dispatchEvent(new Event('input')); };
const card = (slot: string) => $<HTMLButtonElement>(`[data-act="toggle-car"][data-slot="${slot}"]`);
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
function setupOne() {
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
  goCompare();
}
function setupTwo() {
  session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'big', lap: 2 });
  session.toggleAssignment('B', { logId: 'u', lap: 1 });
  goCompare();
}

describe('地図の線と車両アイコン', () => {
  it('走行ラインの太さは Z19 で 4px。拡大しても増えず、縮小すると細くなる(1px まで)', () => {
    expect(LINE_WIDTH).toBe(4);
    expect(HEAT_WIDTH).toBe(4);
    expect(WIDTH_REF_ZOOM).toBe(19);
    expect(lineWidth(19, 4)).toBe(4);
    expect(lineWidth(20, 4)).toBe(4);                    // それ以上拡大しても増えない
    expect(lineWidth(18, 4)).toBe(2);                    // 1段階の縮小ごとに半分
    expect(lineWidth(17, 4)).toBe(1);
    expect(lineWidth(15, 4)).toBe(MIN_LINE_WIDTH);       // 細くなりすぎない
    expect(lineWidth(10, 4)).toBe(MIN_LINE_WIDTH);
    for (let z = 10; z < 20; z++) expect(lineWidth(z + 1, 4)).toBeGreaterThanOrEqual(lineWidth(z, 4));
  });

  it('車両には進行方向(度)が渡される。引き出しの文字は、トグルを入れるまで渡さない', () => {
    setupOne();
    seekTo(40);
    const h = fake.cars[0].heading;
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(fake.cars[0].label).toBeUndefined();
  });

  it('「速度・差」のトグル: 入れると車に「速度kph」(基準車)が付き、切ると消える。選択は保存される', () => {
    setupOne();
    seekTo(40);
    const btn = $<HTMLButtonElement>('#cmp-carlabel');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(fake.cars[0].label).toMatch(/^\d+kph$/);
    seekTo(45);
    expect(fake.cars[0].label).toMatch(/^\d+kph$/);
    expect(session.getSetting('compare.labels', 'off')).toBe('speed');
    btn.click(); btn.click();                                  // 速度・差 → カード名 → 非表示
    expect(fake.cars[0].label).toBeUndefined();
    expect(session.getSetting('compare.labels', 'speed')).toBe('off');
  });

  it('引き出し線は 1 つのボタンで「非表示 → 速度・差 → カード名」と切り替わる。カード名は名前だけ(無ければ A〜D)', () => {
    setupTwo();
    seekTo(40);
    const btn = $<HTMLButtonElement>('#cmp-carlabel');
    expect(btn.textContent).toBe('ラベル: 非表示');
    btn.click();
    expect(btn.textContent).toBe('ラベル: 速度・差');
    expect(fake.cars[0].label).toMatch(/^\d+kph$/);
    btn.click();
    expect(btn.textContent).toBe('ラベル: カード名');
    expect(fake.cars.map((c) => c.label)).toEqual(['A', 'B']);
    session.setSlotAlias(session.activeIndex, 'A', '先週のベストラップ');
    expect(fake.cars[0].label).toBe('先週のベスト');               // 6 文字まで
    expect($('#cmp-cards').textContent).toContain('先週のベスト');
    btn.click();
    expect(btn.textContent).toBe('ラベル: 非表示');
    expect(fake.cars[0].label).toBeUndefined();
    expect(session.getSetting('compare.labels', 'x')).toBe('off');
  });

  it('データ管理で付けたカード名は、比較画面に戻ったとき(再読み込みなしで)カードに出る', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.setSlotAlias(session.activeIndex, 'B', '相手');
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect($('#cmp-cards').textContent).toContain('相手');
  });

  it('基準以外の車には「速度kph/タイム差s」が付く(時間ベース)。非表示の車には付かない', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    seekTo(40);
    $<HTMLButtonElement>('#cmp-carlabel').click();
    const [a, b] = fake.cars;
    expect(a.label).toMatch(/^\d+kph$/);
    expect(b.label).toMatch(/^\d+kph\/[+-]\d+\.\d\ds$/);
    card('B').click();
    expect(fake.cars.map((c) => c.slot)).toEqual(['A']);
  });

});

describe('A〜D のカードで地図上の表示 / 非表示を切り替える', () => {
  it('カードはボタン。押すと地図のラインと車両が消え、もう一度押すと戻る', () => {
    setupOne();
    expect(card('A').getAttribute('aria-pressed')).toBe('true');
    expect(fake.tracks).toHaveLength(1);
    expect(fake.cars).toHaveLength(1);
    card('A').click();
    expect(fake.tracks).toHaveLength(0);
    expect(fake.cars).toHaveLength(0);
    expect(card('A').getAttribute('aria-pressed')).toBe('false');
    expect(card('A').classList.contains('muted')).toBe(true);
    const tag = () => card('A').querySelector<HTMLElement>('.tag-hidden')!;
    expect(tag().hidden).toBe(false);                                  // 色だけに頼らず、「非表示」の文字でも分かる
    expect(tag().textContent).toContain('非表示');
    card('A').click();
    expect(fake.tracks).toHaveLength(1);
    expect(fake.cars).toHaveLength(1);
    expect(card('A').getAttribute('aria-pressed')).toBe('true');
    expect(tag().hidden).toBe(true);
  });

  it('速度グラフの線は、非表示の間は薄くなる(消えない)', () => {
    setupOne();
    const line = () => root.querySelector('.g-line[data-slot="A"]')!;
    expect(line().classList.contains('muted')).toBe(false);
    card('A').click();
    expect(line()).not.toBeNull();
    expect(line().classList.contains('muted')).toBe(true);
    card('A').click();
    expect(line().classList.contains('muted')).toBe(false);
  });

  it('非表示の間も、再生位置・時間差・速度の表示は続く', () => {
    setupOne();
    card('A').click();
    seekTo(50);
    expect($('[data-live="speed-a"]').textContent).toMatch(/^\d+km\/h$/);
    expect($('#cmp-time').textContent!.startsWith('0:50')).toBe(true);
  });

  it('ヒートマップでも非表示になる', () => {
    setupOne();
    for (const mode of ['speed', 'accel']) {
      $<HTMLButtonElement>(`[data-act="mapmode"][data-mode="${mode}"]`).click();
      card('A').click();
      expect(fake.tracks).toHaveLength(0);
      card('A').click();
      expect(fake.tracks[0].heat).toBeDefined();
    }
  });

  it('未割り当ての枠はボタンではない', () => {
    setupOne();
    expect(root.querySelector('[data-act="toggle-car"][data-slot="B"]')).toBeNull();
    expect($('#cmp-cards').textContent).toContain('未割り当て');
  });

  it.skipIf(!existsSync(bigPath))('2台: 片方だけ消せる。先頭追従は表示中の車だけが対象', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    card('B').click();
    expect(fake.tracks.map((t) => t.slot)).toEqual(['A']);
    expect(fake.cars.map((c) => c.slot)).toEqual(['A']);
    expect(root.querySelector('.g-line[data-slot="B"]')!.classList.contains('muted')).toBe(true);
    expect(root.querySelector('.g-line[data-slot="A"]')!.classList.contains('muted')).toBe(false);
    $<HTMLButtonElement>('[data-act="follow"][data-follow="leader"]').click();
    seekTo(100);                                   // 実際の先頭は B だが、B は非表示なので A に追従する
    const a = fake.cars.find((c) => c.slot === 'A')!;
    expect(fake.centers[fake.centers.length - 1]).toEqual([a.lat, a.lon]);
    card('B').click();
    seekTo(101);
    const b = fake.cars.find((c) => c.slot === 'B')!;
    expect(fake.centers[fake.centers.length - 1]).toEqual([b.lat, b.lon]);
  });

  it('割り当てを変えて戻ると、表示状態は初期化される', () => {
    setupOne();
    card('A').click();
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.toggleAssignment('A', { logId: 'u', lap: 1 });            // いったん外して
    session.toggleAssignment('B', { logId: 'u', lap: 1 });            // B に割り当て直す
    goCompare();
    expect(card('B').getAttribute('aria-pressed')).toBe('true');
    expect(fake.tracks.map((t) => t.slot)).toEqual(['B']);
    expect(fake.cars.map((c) => c.slot)).toEqual(['B']);
  });
});

describe('速度グラフのズーム操作', () => {
  const zin = () => $<HTMLButtonElement>('#cmp-zin');
  const zout = () => $<HTMLButtonElement>('#cmp-zout');

  it('拡大 / 縮小ボタンと倍率の表示。最大 16 倍、最小は全体', () => {
    setupOne();
    expect($('#cmp-zoom').textContent).toBe('×1');
    expect(zout().disabled).toBe(true);
    expect($<HTMLElement>('#cmp-zreset').hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.g-ruler')!.hidden).toBe(true);
    zin().click();
    expect($('#cmp-zoom').textContent).toBe('×2');
    expect(zout().disabled).toBe(false);
    expect($<HTMLElement>('#cmp-zreset').hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.g-ruler')!.hidden).toBe(false);       // ズーム中はルーラーが出る
    for (let i = 0; i < 5; i++) zin().click();
    expect($('#cmp-zoom').textContent).toBe('×16');
    expect(zin().disabled).toBe(true);
    zout().click();
    expect($('#cmp-zoom').textContent).toBe('×8');
    $<HTMLButtonElement>('#cmp-zreset').click();
    expect($('#cmp-zoom').textContent).toBe('×1');
    expect(root.querySelector<HTMLElement>('.g-ruler')!.hidden).toBe(true);
  });

  it('ズームは再生位置が中心: 位置を変えてから拡大すると、その位置が範囲の中ほどに来る', () => {
    setupOne();
    seekTo(100);
    const cursorX = () => Number(root.querySelector('.g-cursor-line')!.getAttribute('x1'));
    zin().click();
    const w = Number(root.querySelector('svg.speed-graph')!.getAttribute('width'));
    expect(cursorX()).toBeCloseTo(GRAPH_LEFT + (w - GRAPH_LEFT - GRAPH_RIGHT) / 2, 0);              // プロット幅の中央
  });

  it('+ / - キーでは何も起きない(キーボード操作は再生系のみ)', () => {
    setupOne();
    key('+'); expect($('#cmp-zoom').textContent).toBe('×1');
    key('-'); expect($('#cmp-zoom').textContent).toBe('×1');
  });

  it('横軸の切り替えで全体表示に戻る', () => {
    setupOne();
    zin().click();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    expect($('#cmp-zoom').textContent).toBe('×1');
  });

  it('再生が進んで範囲を越えると、表示範囲が追いかける', () => {
    setupOne();
    for (let i = 0; i < 3; i++) zin().click();                        // 8倍
    const x1 = () => Number(root.querySelector('.g-cursor-line')!.getAttribute('x1'));
    seekTo(5);
    const before = x1();
    expect(before).toBeGreaterThan(0);
    seekTo(120);                                                       // 範囲の外へ飛ぶ(自分で移動した位置)
    expect(root.querySelector('.g-cursor')!.getAttribute('visibility')).toBe('visible');
  });

  it('ルーラーにフォーカスして ← → を押しても、コマ送り(0.1秒)にはならない。ルーラー自身の操作で再生位置が動く', () => {
    setupOne();
    seekTo(70);
    zin().click(); zin().click();
    const thumb = root.querySelector<SVGElement>('.g-thumb')!;
    const before = $('#cmp-time').textContent;
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect($('#cmp-time').textContent).not.toBe(before);
    expect(Number($<HTMLInputElement>('#cmp-seek').value)).toBeGreaterThan(70.15);     // 0.1秒より大きく動いた
  });

});

describe('速度グラフが「距離」のときは、地図も距離ベースで再生する', () => {
  it('2台: 全車が基準の車と同じ走行距離の位置に出る(時間ベースより近い)。タイム差は出さない(カードも地図のラベルも速度だけ)', () => {
    setupTwo();
    seekTo(60);
    const gap = () => { const [a, b] = fake.cars; return Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 111000 * Math.cos((a.lat * Math.PI) / 180)); };
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    $<HTMLButtonElement>('#cmp-carlabel').click();                 // ラベル: 速度・差
    const byTime = gap();
    expect(fake.cars[1].label).toMatch(/^\d+kph\/[+-]\d+\.\d\ds$/);
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="dist"]').click();
    expect(gap()).toBeLessThan(byTime);                            // 距離ベースでは、同じ場所に並ぶ(GPS の距離の誤差は残る)
    expect(gap()).toBeLessThan(30);
    expect(fake.cars[0].label).toMatch(/^\d+kph$/);
    expect(fake.cars[1].label).toMatch(/^\d+kph$/);
    expect($<HTMLElement>('[data-act="toggle-car"][data-slot="B"] .c3-gap').hidden).toBe(true);
  });
});
