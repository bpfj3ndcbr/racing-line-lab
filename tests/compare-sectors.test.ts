// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildLapSeries, distanceM, formatLapTime, miniSpeeds, parseVbo, segmentRange } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';
import { GRAPH_LEFT, GRAPH_RIGHT } from '../src/ui/speedGraph';

const fx = (n: string) => `fixtures/${n}`;
const flush = () => new Promise<void>((r) => setTimeout(r, 20));
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');
const bigPath = fx('session_20260506_094550_autopolis.vbo');
const big = existsSync(bigPath);

let root: HTMLElement, session: Session, fake: FakeMap, store: MemoryStore, app: { dispose(): void } | null = null;
function mount() {
  app?.dispose();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  fake = new FakeMap();
  app = mountApp(root, session, new ThemeController(store), () => fake);
  session.registerCircuit('オートポリス', cln, sci);
}
beforeEach(() => { store = new MemoryStore(); mount(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const goCompare = () => {
  $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
  $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();       // 以下は、時間ベース(横軸「時間」)の動作を調べる
};
const sector = (k: number) => $<HTMLButtonElement>(`[data-act="sector"][data-k="${k}"]`);
const mode = (m: string) => $<HTMLButtonElement>(`[data-act="syncmode"][data-mode="${m}"]`);
const time = () => $('#cmp-time').textContent!;
const lapOf = (slot: 'A' | 'B') => session.resolveRef(session.assignment[slot])!.lap;
const carPos = (slot: string) => fake.cars.find((c) => c.slot === slot)!;
const gap = (slot: string) => $(`[data-live="gap-${slot.toLowerCase()}"]`).textContent!;
const seekTo = (sec: number) => { const e = $<HTMLInputElement>('#cmp-seek'); e.value = String(sec); e.dispatchEvent(new Event('input')); };
const apart = () => distanceM({ lat: carPos('A').lat, lon: carPos('A').lon }, { lat: carPos('B').lat, lon: carPos('B').lon });

function setupOne() {
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
  goCompare();
}
function setupTwo() {
  session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'big', lap: 2 });     // 2:26.5
  session.toggleAssignment('B', { logId: 'u', lap: 1 });       // 2:22.9(速い)
  goCompare();
}

describe('地図の左上の 3 つの札(案件 73。どの幅でも同じ)', () => {
  it('3 つの丸い札(追従設定・ライン表示・ラベル)。押すとその選択肢が開き、選んだら閉じる。札には今の設定を出す', () => {
    setupOne();
    const titles = () => ['#cmp-tool-pos', '#cmp-tool-line', '#cmp-tool-label'].map((sel) => $<HTMLElement>(sel).title);
    expect(titles()).toEqual(['追従設定: 先頭追従', 'ライン表示: 走行ライン', 'ラベル: なし']);
    const pos = $<HTMLButtonElement>('#cmp-tool-pos'), line = $<HTMLButtonElement>('#cmp-tool-line');
    pos.click();
    expect($('#cmp-sub-pos').hidden).toBe(false);
    line.click();                                                          // 別の札を押すと、開いていた方は閉じる
    expect($('#cmp-sub-pos').hidden).toBe(true);
    expect($('#cmp-sub-line').hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-act="mapmode"][data-mode="speed"]')!.click();
    expect($('#cmp-sub-line').hidden).toBe(true);
    expect(line.title).toBe('ライン表示: 速度');
    expect(line.textContent).toBe('速度');                                // 札の中は今の設定の名前(白抜き)
  });

  it('「なし」を選ぶと、走行ラインを描かない(凡例も出ない)。「走行ライン」に戻すと描く', () => {
    setupOne();
    root.querySelector<HTMLButtonElement>('[data-act="mapmode"][data-mode="none"]')!.click();
    expect(fake.tracks).toHaveLength(0);
    expect($<HTMLElement>('#cmp-legend').hidden).toBe(true);
    expect(root.querySelector('[data-act="mapmode"][data-mode="none"]')!.classList.contains('on')).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-act="mapmode"][data-mode="line"]')!.click();
    expect(fake.tracks.length).toBeGreaterThan(0);
  });

  it('ラベルの札: 選ぶと、その選択肢が閉じ、札の文字が変わる。「表示」のボタンは無い', () => {
    setupOne();
    $<HTMLButtonElement>('#cmp-tool-label').click();
    root.querySelector<HTMLButtonElement>('[data-act="carlabel"][data-label="name"]')!.click();
    expect($('#cmp-sub-label').hidden).toBe(true);
    expect($<HTMLElement>('#cmp-tool-label').title).toBe('ラベル: カード名');
    expect(root.querySelector('#cmp-menu-btn')).toBeNull();
  });
});

describe('地図をタップして再生・一時停止(案件 1)', () => {
  const ptr = (type: string, o: { id?: number; x?: number; y?: number; kind?: string } = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: o.x ?? 100, clientY: o.y ?? 100 });
    Object.defineProperty(e, 'pointerId', { value: o.id ?? 1 });
    Object.defineProperty(e, 'pointerType', { value: o.kind ?? 'touch' });
    $('#cmp-map').dispatchEvent(e);
  };
  const state = () => $('#cmp-pp').dataset.state;
  it('指で軽くたたくと切り替わる。動かした・2 本の指・マウスでは切り替わらない', () => {
    setupOne();
    expect(state()).toBe('paused');
    ptr('pointerdown'); ptr('pointerup');
    expect(state()).toBe('playing');
    ptr('pointerdown'); ptr('pointerup');
    expect(state()).toBe('paused');
    ptr('pointerdown'); ptr('pointerup', { x: 160 });                            // ドラッグ(地図を動かした)
    expect(state()).toBe('paused');
    ptr('pointerdown', { id: 1 }); ptr('pointerdown', { id: 2, x: 200 });         // ピンチ(2 本の指)
    ptr('pointerup', { id: 2, x: 200 }); ptr('pointerup', { id: 1 });
    expect(state()).toBe('paused');
    ptr('pointerdown', { kind: 'mouse' }); ptr('pointerup', { kind: 'mouse' });  // マウスのクリックは対象外
    expect(state()).toBe('paused');
  });

  it('札の選択肢が開いているときに地図をたたくと、閉じるだけで再生・停止はしない(案件 41)', () => {
    setupOne();
    $<HTMLButtonElement>('#cmp-tool-pos').click();
    expect($('#cmp-sub-pos').hidden).toBe(false);
    ptr('pointerdown'); ptr('pointerup');
    expect($('#cmp-sub-pos').hidden).toBe(true);
    expect(state()).toBe('paused');
    ptr('pointerdown'); ptr('pointerup');                                        // 閉じたあとは、今までどおり
    expect(state()).toBe('playing');
  });

  it('地図の上のボタンの付近(24px 以内)をたたいても切り替わらない(案件 43)', () => {
    setupOne();
    const rect = { left: 300, top: 10, right: 400, bottom: 40, x: 300, y: 10, width: 100, height: 30, toJSON: () => ({}) };
    $('#cmp-tool-line').getBoundingClientRect = () => rect as DOMRect;           // jsdom は矩形が 0 なので、右上の「表示」の位置を決める
    ptr('pointerdown', { x: 290, y: 60 }); ptr('pointerup', { x: 290, y: 60 }); // 左へ 10px・下へ 20px(約 22px)
    expect(state()).toBe('paused');
    ptr('pointerdown', { x: 350, y: 65 }); ptr('pointerup', { x: 350, y: 65 }); // 真下へ 25px
    expect(state()).toBe('playing');
  });
});

describe('セクターボタンの動作の切り替え', () => {
  it('セクターのボタン(ライン S1〜Sn)は地図の上(#cmp-map-secs)に出る。表の見出しは押せないラベル(案件 84)', () => {
    setupOne();
    const onMap = Array.from(root.querySelectorAll('#cmp-map-secs [data-act="sector"]')).map((b) => b.textContent);
    expect(onMap.length).toBeGreaterThan(0);
    expect(onMap[0]).toBe('S1');
    expect(root.querySelectorAll('#cmp-sectors [data-act="sector"]')).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('#cmp-map-secs [data-k="1"]')!.click();
    expect(root.querySelector('#cmp-map-secs [data-k="1"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('「先頭車両」「全車一致」と「解除」が 1 つの切り替えにまとまる。初期は全車一致', () => {
    setupOne();
    // 右の列と上部バー(スマホの横向き。案件 46)の 2 か所に同じものがある
    expect(Array.from(root.querySelectorAll('#cmp-sync [data-act="syncmode"]')).map((b) => b.textContent)).toEqual(['先頭車両', '全車一致']);
    expect(Array.from(root.querySelectorAll('#top-set [data-act="syncmode"]')).map((b) => b.textContent)).toEqual(['先頭車両', '全車一致']);
    expect(root.querySelector('#cmp-sec-note')).toBeNull();                      // 説明文は無い
    expect(mode('all').getAttribute('aria-pressed')).toBe('true');
    mode('leader').click();
    expect(mode('leader').getAttribute('aria-pressed')).toBe('true');
    expect(mode('all').getAttribute('aria-pressed')).toBe('false');
  });

  it('選んだ動作は保存され、次回も同じ', () => {
    setupOne();
    mode('leader').click();
    mount();
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    goCompare();
    expect(mode('leader').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('先頭車両モード', () => {
  it('1台: 押すと、その車がセクターを通った時刻へ移動する(再生は止めたまま)', () => {
    setupOne();
    mode('leader').click();
    sector(2).click();                                   // S3
    expect(time().startsWith(formatLapTime(lapOf('A').sectorTimes[2]!))).toBe(true);
    expect($('#cmp-pp').dataset.state).toBe('paused');
    expect($<HTMLElement>('#cmp-sync-status').hidden).toBe(false);    // 移動したことを知らせる文
    expect($('#cmp-sync-text').textContent).toContain('S3');
    expect(sector(2).getAttribute('aria-pressed')).toBe('true');             // 先頭車両でも、選んでいるセクターが分かる
    expect(sector(1).getAttribute('aria-pressed')).toBe('false');
  });

  it('再生中に押すと、移動したあとも再生のまま', () => {
    setupOne();
    mode('leader').click();
    $<HTMLButtonElement>('#cmp-pp').click();
    sector(3).click();
    expect($('#cmp-pp').dataset.state).toBe('playing');
    $<HTMLButtonElement>('#cmp-pp').click();
  });

  it.skipIf(!big)('2台: 先に通った方(先頭)の通過時刻へ移動し、遅れている車は手前に残る', () => {
    setupTwo();
    mode('leader').click();
    const k = 5;                                         // S6
    const tA = lapOf('A').sectorTimes[k]!, tB = lapOf('B').sectorTimes[k]!;
    expect(tB).toBeLessThan(tA);                         // B が先頭
    sector(k).click();
    expect(time().startsWith(formatLapTime(tB))).toBe(true);
    // 時間はそのままで、A は B より手前(約 (tA - tB) 秒ぶん後ろ)。距離はおおよそ速度 × 時間差
    expect(apart()).toBeGreaterThan(30);
    expect($('#cmp-sync-text').textContent).toContain('B');
  });

  it.skipIf(!big)('非表示の車は、先頭の判定に入れない', () => {
    setupTwo();
    mode('leader').click();
    const k = 5;
    $<HTMLButtonElement>('[data-act="toggle-car"][data-slot="B"]').click();    // B を非表示に
    sector(k).click();
    expect(time().startsWith(formatLapTime(lapOf('A').sectorTimes[k]!))).toBe(true);
  });
});

describe('全車一致モード', () => {
  it('1台: セクターを通る時刻へ移動し、「S3 で全車一致中」と「解除」が出る。ボタンは押した状態に', () => {
    setupOne();
    sector(2).click();
    expect(time().startsWith(formatLapTime(lapOf('A').sectorTimes[2]!))).toBe(true);
    expect($('#cmp-sync-text').textContent).toBe('S3 で全車一致中');
    expect($<HTMLButtonElement>('[data-act="sync-release"]').disabled).toBe(false);
    expect(sector(2).getAttribute('aria-pressed')).toBe('true');
    expect(sector(1).getAttribute('aria-pressed')).toBe('false');
  });

  it.skipIf(!big)('2台: 全車が同時にセクターの線の上に来る(押す前は何十メートルも離れている)', () => {
    setupTwo();
    const k = 5;
    const tA = lapOf('A').sectorTimes[k]!, tB = lapOf('B').sectorTimes[k]!;
    const T = Math.max(tA, tB);
    seekTo(Math.round(T * 10) / 10);
    const before = apart();                              // 同じ時刻でも、通常は大きくずれている
    expect(before).toBeGreaterThan(30);
    sector(k).click();
    expect(time().startsWith(formatLapTime(T))).toBe(true);
    expect(apart()).toBeLessThan(25);                    // どちらもセクターの線の上(線の長さ程度の差)
    expect(apart()).toBeLessThan(before);
  });

  it.skipIf(!big)('時間差はセクターで 0 から始まる。全体の長さは、最後に走り終える車まで', () => {
    setupTwo();
    const k = 5;
    sector(k).click();
    expect(gap('B')).toBe('+0.00s');
    expect(gap('A')).toBe('基準');
    // 1秒進むと、区間の差が付く(0 ではなくなるか、少なくとも形式は保たれる)
    $<HTMLButtonElement>('#cmp-ff').click();
    for (let i = 0; i < 9; i++) $<HTMLButtonElement>('#cmp-ff').click();
    expect(gap('B')).toMatch(/^[+-]\d+\.\d\ds$/);
    const dur = Math.max(lapOf('A').duration, lapOf('B').duration + (Math.max(lapOf('A').sectorTimes[k]!, lapOf('B').sectorTimes[k]!) - lapOf('B').sectorTimes[k]!));
    expect(time().endsWith(formatLapTime(dur))).toBe(true);
  });

  it.skipIf(!big)('時間軸のグラフ: 速い車の線は右へずれ、セクターの縦線と再生位置が重なる', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    const x0 = (slot: string) => parseFloat(root.querySelector(`.g-line[data-slot="${slot}"]`)!.getAttribute('d')!.slice(1));
    const before = { A: x0('A'), B: x0('B') };
    expect(Math.abs(before.A - before.B)).toBeLessThan(0.2);          // 通常はどちらもラップ開始(0 秒)から
    const k = 5;
    sector(k).click();
    const [fast, slow] = lapOf('B').sectorTimes[k]! < lapOf('A').sectorTimes[k]! ? ['B', 'A'] : ['A', 'B'];
    expect(x0(fast)).toBeGreaterThan(x0(slow) + 1);                   // 速い車は、遅い車に合わせて「あとからスタート」
    const mark = Array.from(root.querySelectorAll('.g-marklabel')).find((t) => t.textContent === `S${k + 1}`)!;
    const markX = Number(mark.previousElementSibling!.getAttribute('x1'));
    const cursorX = Number($('.g-cursor-line').getAttribute('x1'));
    expect(cursorX).toBeCloseTo(markX, 0);
  });

  it.skipIf(!big)('「解除」で通常(ラップ開始をそろえた状態)に戻り、基準の車の位置は保たれる', () => {
    setupTwo();
    const k = 5;
    sector(k).click();
    const aBefore = { ...carPos('A') };
    $<HTMLButtonElement>('[data-act="sync-release"]').click();
    expect($<HTMLElement>('#cmp-sync-status').hidden).toBe(true);
    expect($<HTMLButtonElement>('[data-act="sync-release"]').disabled).toBe(true);
    expect(sector(k).getAttribute('aria-pressed')).toBe('false');
    expect(carPos('A').lat).toBeCloseTo(aBefore.lat, 9);
    expect(carPos('A').lon).toBeCloseTo(aBefore.lon, 9);
    expect(apart()).toBeGreaterThan(30);                              // 同じ時刻なので、また離れる
    expect(time().endsWith(formatLapTime(lapOf('A').duration))).toBe(true);
  });

  it.skipIf(!big)('割り当てが変わると、全車一致は解除される', () => {
    setupTwo();
    sector(3).click();
    expect($<HTMLElement>('#cmp-sync-status').hidden).toBe(false);
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.toggleAssignment('B', { logId: 'u', lap: 1 });            // B を外す
    goCompare();
    expect($<HTMLElement>('#cmp-sync-status').hidden).toBe(true);
    expect(time().startsWith('0:00.0')).toBe(true);
  });

  it('Space を押しても、押したセクターボタンが再び押されない(再生の切り替えになる)', () => {
    setupOne();
    sector(2).focus();
    sector(2).click();
    const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    sector(2).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect($('#cmp-pp').dataset.state).toBe('playing');
    $<HTMLButtonElement>('#cmp-pp').click();
  });
});

describe('セクター設定が無いとき', () => {
  function withoutSectors() {
    session.registerCircuit('設定無し', cln, '');
    const id = session.circuits.find((c) => c.name === '設定無し')!.id;
    session.setCircuit(id);
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    goCompare();
  }

  it('1 周全体の「全周」を 1 列(5 つの区間)で出し、ボタンと動作の切り替えは出さない(案件 84)', () => {
    withoutSectors();
    expect(Array.from($('#cmp-sectors').querySelectorAll('.mini-head')).map((h) => h.textContent)).toEqual(['全周']);
    const cells = root.querySelectorAll('#cmp-sectors .mini-cell[data-slot="A"]');
    expect(cells).toHaveLength(1);
    expect(cells[0].querySelectorAll('.mini-seg')).toHaveLength(5);
    expect(cells[0].hasAttribute('data-none')).toBe(false);
    for (const g of Array.from(cells[0].querySelectorAll('.mini-seg'))) expect(Number(g.getAttribute('data-v'))).toBeGreaterThan(0);
    expect($('#cmp-sectors').querySelectorAll('button')).toHaveLength(0);
    expect($('#cmp-map-secs').children).toHaveLength(0);
    expect($<HTMLElement>('#cmp-sync').hidden).toBe(true);
  });

  it('セクターがあるときは、S1〜S(n+1) の見出しが並ぶ(n = ライン数。S1 = スタート〜最初のライン)', () => {
    setupOne();
    const heads = Array.from($('#cmp-sectors').querySelectorAll('.mini-head'));
    expect(heads).toHaveLength(8);
    expect(heads.map((h) => h.textContent)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(heads[0].getAttribute('title')).toBe('S1: スタート〜ライン 1');
    expect(heads[7].getAttribute('title')).toBe('S8: ライン 7〜エンド');
    expect($('#cmp-map-secs').querySelectorAll('button')).toHaveLength(7);
    expect($<HTMLElement>('#cmp-sync').hidden).toBe(false);
  });
});

describe('表記・外観の変更', () => {
  it('右パネルの説明文を削除した(「A〜D を押すと…」「時間差は A が基準…」など)', () => {
    setupOne();
    const t = $('#cmp-upper').textContent!;
    expect(t).not.toContain('基準・+は遅れ');
    expect(t).not.toContain('地図上の表示 / 非表示を切り替えます。');
    expect(t).not.toContain('ボタンを押すと');
    expect(root.querySelector('#cmp-ref')).toBeNull();
    expect(root.querySelector('#cmp-hint')).toBeNull();
  });

  it('地図の表示は「走行ライン / 速度 / 加減速 / なし」', () => {
    setupOne();
    expect(Array.from(root.querySelectorAll('[data-act="mapmode"]')).map((b) => b.textContent)).toEqual(['走行ライン', '速度', '加減速', 'なし']);
  });

  it('上部の項目はタブ(使い方 / データ管理 / 比較 / 設定)。選んでいるものが分かる(aria-current)。サーキット登録はデータ管理の中', () => {
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.navtabs .navtab'));
    expect(tabs.map((t) => t.textContent)).toEqual(['使い方', 'データ管理', '比較', '設定']);
    expect(tabs[1].getAttribute('aria-current')).toBe('page');
    expect(tabs[2].hasAttribute('aria-current')).toBe(false);
    goCompare();
    expect(tabs[2].getAttribute('aria-current')).toBe('page');
    expect(tabs[1].hasAttribute('aria-current')).toBe(false);
  });

  it('セクターボタンは小さいボタン用のクラスで描かれる', () => {
    setupOne();
    expect($('#cmp-map-secs button').classList.contains('sec')).toBe(true);
  });
});

describe('セクターボタンを押してもグラフのズームは保たれる', () => {
  const zoom = () => $('#cmp-zoom').textContent;
  const zin = () => $<HTMLButtonElement>('#cmp-zin').click();
  const plotCenterX = () => GRAPH_LEFT + (Number(root.querySelector('svg.speed-graph')!.getAttribute('width')) - GRAPH_LEFT - GRAPH_RIGHT) / 2;
  const cursorX = () => Number($('.g-cursor-line').getAttribute('x1'));

  it('全車一致(1台): ×4 のまま、再生位置(セクター)が表示範囲の中心に来る。ルーラーも残る', () => {
    setupOne();
    zin(); zin();
    expect(zoom()).toBe('×4');
    sector(4).click();                                                      // S5
    expect(zoom()).toBe('×4');
    expect(root.querySelector<HTMLElement>('.g-ruler')!.hidden).toBe(false);
    expect($('.g-cursor').getAttribute('visibility')).toBe('visible');
    expect(cursorX()).toBeCloseTo(plotCenterX(), 0);
  });

  it('先頭車両モードでも保たれる', () => {
    setupOne();
    mode('leader').click();
    zin(); zin(); zin();
    sector(2).click();
    expect(zoom()).toBe('×8');
    expect(cursorX()).toBeCloseTo(plotCenterX(), 0);
  });

  it('時間軸でも保たれる', () => {
    setupOne();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    zin();
    sector(3).click();
    expect(zoom()).toBe('×2');
    expect($('.g-cursor').getAttribute('visibility')).toBe('visible');
  });

  it('別のセクターを続けて押しても、そのつど倍率はそのまま(表示範囲だけ動く)', () => {
    setupOne();
    zin(); zin();
    const seen: number[] = [];
    for (const k of [1, 4, 2]) {
      sector(k).click();
      expect(zoom()).toBe('×4');
      seen.push(Number($('.g-thumb').getAttribute('x')));
    }
    expect(new Set(seen).size).toBe(3);                                      // 範囲(ルーラーの帯)は、押したセクターへ動いている
  });

  it('「解除」でも保たれる', () => {
    setupOne();
    sector(3).click();
    zin(); zin();
    $<HTMLButtonElement>('[data-act="sync-release"]').click();
    expect(zoom()).toBe('×4');
  });

  it.skipIf(!big)('2台の全車一致(時間軸でグラフがずれる場合)でも保たれ、そろえたセクターが見える位置に来る', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    zin(); zin();
    sector(5).click();
    expect(zoom()).toBe('×4');
    expect($('.g-cursor').getAttribute('visibility')).toBe('visible');
    expect(cursorX()).toBeCloseTo(plotCenterX(), 0);
    const mark = Array.from(root.querySelectorAll('.g-marklabel')).find((t) => t.textContent === 'S6');
    expect(mark).toBeDefined();                                               // S6 の縦線も、表示範囲の中に出ている
  });

  it('横軸(距離/時間)を切り替えたときは、単位が変わるので全体表示に戻る', () => {
    setupOne();
    zin();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    expect(zoom()).toBe('×1');
  });
});

const press = (el: Element, key: string, shiftKey = false) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
const status = () => $('#cmp-sync-text').textContent!;
const release = () => $<HTMLButtonElement>('[data-act="sync-release"]');

describe('セクター欄の構成', () => {
  it('走行データ欄との間に境界線(動かせない)', () => {
    setupOne();
    const block = $('#cmp-sec-block');
    expect(block.classList.contains('sec-block')).toBe(true);
    expect(block.previousElementSibling).toBe($('#cmp-cards'));                // 走行データ欄のすぐ下
    expect(block.querySelector('#cmp-sec-h span')!.textContent).toBe('セクター');
    expect(block.hasAttribute('role')).toBe(false);                            // 動かす境界(separator)ではない
    expect(block.hasAttribute('tabindex')).toBe(false);
    expect(block.querySelector('[role="separator"]')).toBeNull();
  });

  it('「解除」は「先頭車両」「全車一致」と同じ切り替えの 3 つ目のボタン。選んでいないときは押せない', () => {
    setupOne();
    const seg = release().closest('.seg')!;
    expect(Array.from(seg.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['先頭車両', '全車一致', '解除']);
    expect(seg.contains(mode('leader'))).toBe(true);
    expect(seg.contains(mode('all'))).toBe(true);
    expect(release().textContent).toBe('解除');
    expect(release().disabled).toBe(true);
    sector(2).click();
    expect(release().disabled).toBe(false);
    release().click();
    expect(release().disabled).toBe(true);
    expect(sector(2).getAttribute('aria-pressed')).toBe('false');
    expect($<HTMLElement>('#cmp-sync-status').hidden).toBe(true);
  });

  it('「先頭車両」でも、選んだセクターのボタンが選択中の表示になる。別のセクターを押すと移る。解除で消える', () => {
    setupOne();
    mode('leader').click();
    expect(sector(1).getAttribute('aria-pressed')).toBe('false');
    sector(1).click();
    expect(sector(1).getAttribute('aria-pressed')).toBe('true');
    sector(4).click();
    expect(sector(4).getAttribute('aria-pressed')).toBe('true');
    expect(sector(1).getAttribute('aria-pressed')).toBe('false');
    release().click();
    expect(sector(4).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('右パネルは最小幅でも折りたたまれない', () => {
  it('最小(220px)まで狭めても、カードとセクターボタンは通常の表示のまま', () => {
    setupOne();
    press($('#cmp-sp-v'), 'End');
    expect($('.cmp').style.getPropertyValue('--side-w')).toBe('220px');
    expect($('.cmp').classList.contains('side-collapsed')).toBe(false);
    expect($<HTMLElement>('#cmp-cards').closest('[hidden]')).toBeNull();
    expect($<HTMLElement>('#cmp-sync').hidden).toBe(false);
    expect($('#cmp-map-secs').querySelectorAll('button')).toHaveLength(7);
    expect(root.querySelector('#cmp-mapinfo')).toBeNull();                      // 地図の上の速度・時間差の表示は廃止
  });
});

describe('動作の切り替えは、選んでいるセクターに反映される', () => {
  it('セクターを選んでいないときは、切り替えても時刻は変わらない', () => {
    setupOne();
    seekTo(30);
    mode('leader').click();
    expect(time().startsWith('0:30.0')).toBe(true);
    mode('all').click();
    expect(time().startsWith('0:30.0')).toBe(true);
  });

  it('1台: 全車一致 → 先頭車両 に切り替えると、表示が書き換わる(状態の文が変わり、解除はそのまま使える)', () => {
    setupOne();
    sector(3).click();
    expect(status()).toBe('S4 で全車一致中');
    mode('leader').click();
    expect(status()).toContain('S4');
    expect(status()).not.toContain('全車一致中');
    expect(sector(3).getAttribute('aria-pressed')).toBe('true');
    expect(release().disabled).toBe(false);
    mode('all').click();
    expect(status()).toBe('S4 で全車一致中');
  });

  it.skipIf(!big)('2台: 全車一致 ⇔ 先頭車両 を切り替えるたびに、そのセクターを開始したものとして現在位置が計算し直される', () => {
    setupTwo();
    const k = 5;
    const tA = lapOf('A').sectorTimes[k]!, tB = lapOf('B').sectorTimes[k]!;
    const T = Math.max(tA, tB);
    sector(k).click();                                    // 全車一致: 全車が線の上
    expect(time().startsWith(formatLapTime(T))).toBe(true);
    expect(apart()).toBeLessThan(25);
    mode('leader').click();                               // 先頭車両: 先頭(B)が通る時刻へ。A は手前に残る
    expect(time().startsWith(formatLapTime(Math.min(tA, tB)))).toBe(true);
    expect(apart()).toBeGreaterThan(30);
    mode('all').click();                                  // 全車一致に戻す
    expect(time().startsWith(formatLapTime(T))).toBe(true);
    expect(apart()).toBeLessThan(25);
    expect(gap('B')).toBe('+0.00s');
  });

  it.skipIf(!big)('再生中でも、一時停止中でも、その状態を保ったまま書き換わる', () => {
    setupTwo();
    sector(5).click();
    $<HTMLButtonElement>('#cmp-pp').click();             // 再生中
    mode('leader').click();
    expect($('#cmp-pp').dataset.state).toBe('playing');
    expect(sector(5).getAttribute('aria-pressed')).toBe('true');
    $<HTMLButtonElement>('#cmp-pp').click();            // 一時停止
    mode('all').click();
    expect($('#cmp-pp').dataset.state).toBe('paused');
    expect(apart()).toBeLessThan(25);
  });

  it('解除したあとに切り替えても、何も起きない', () => {
    setupOne();
    sector(2).click();
    release().click();
    seekTo(20);
    mode('leader').click();
    expect(time().startsWith('0:20.0')).toBe(true);
  });
});

/** 点から線分までの距離(m) */
function offLine(p: { lat: number; lon: number }, l: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }) {
  const ky = 111000, kx = 111000 * Math.cos((p.lat * Math.PI) / 180);
  const ax = (l.a.lon - p.lon) * kx, ay = (l.a.lat - p.lat) * ky, bx = (l.b.lon - p.lon) * kx, by = (l.b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const u = Math.min(1, Math.max(0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + u * dx, ay + u * dy);
}

describe('横軸「距離」のセクターボタン(案件 20)', () => {
  it.skipIf(!big)('どのセクターを押しても、全車がセクターのライン上に並ぶ(距離は物差しの走行ラインに投影したもの)', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="dist"]').click();
    const n = lapOf('A').sectorTimes.length;
    expect(n).toBeGreaterThan(3);
    for (let k = 0; k < n; k++) {
      if (lapOf('A').sectorTimes[k] == null || lapOf('B').sectorTimes[k] == null) continue;
      sector(k).click();
      const line = session.resolveRef(session.assignment.A)!.log.circuit!.sectors[k];
      for (const slot of ['A', 'B']) expect(offLine(carPos(slot), line)).toBeLessThan(2);
    }
  });
});

describe('上部バーのセクターボタンの動作(スマホの横向き。案件 46)', () => {
  const top = (m: string) => $<HTMLButtonElement>(`#top-set [data-act="syncmode"][data-mode="${m}"]`);
  const side = (m: string) => $<HTMLButtonElement>(`#cmp-sync [data-act="syncmode"][data-mode="${m}"]`);
  const topRelease = () => $<HTMLButtonElement>('#top-set [data-act="sync-release"]');

  it('右の列と同じ「先頭車両・全車一致・解除」を出し、押すと右の列のボタンを押したのと同じになる', () => {
    setupOne();
    expect($<HTMLElement>('#top-set .sync-grp').hidden).toBe(false);
    expect(top('all').getAttribute('aria-pressed')).toBe('true');
    top('leader').click();
    expect(side('leader').getAttribute('aria-pressed')).toBe('true');
    expect(top('leader').getAttribute('aria-pressed')).toBe('true');
    expect(top('all').getAttribute('aria-pressed')).toBe('false');
    top('all').click();
    expect(topRelease().disabled).toBe(true);
    sector(2).click();
    expect(topRelease().disabled).toBe(false);                    // 「解除」の押せる・押せないも同じ
    topRelease().click();
    expect($<HTMLElement>('#cmp-sync-status').hidden).toBe(true);
    expect(topRelease().disabled).toBe(true);
    expect($('#top-set [id]')?.id).toBe('cmp-set-top');            // 右の列のボタンの id は写さない
  });
});

describe('地図の上のセクターの線(案件 82)', () => {
  it('ボタンの間の線と、スタート・エンドの縦線が出る。今の走行位置の区間の線だけ濃い(on)。線は点滅しない', () => {
    setupOne();
    const n = root.querySelectorAll('#cmp-map-secs [data-act="sector"]').length;
    expect(n).toBeGreaterThan(0);
    const segs = Array.from(root.querySelectorAll<HTMLElement>('#cmp-map-secs .sec-seg'));
    const ticks = root.querySelectorAll('#cmp-map-secs .sec-tick');
    expect(segs.length).toBe(n + 1);                       // 区間は、スタート〜S1 から Sn〜エンドまで n + 1 本
    expect(ticks.length).toBe(2);                          // スタート・エンドの縦線
    expect(segs.map((s) => s.dataset.seg)).toEqual(Array.from({ length: n + 1 }, (_, i) => String(i)));
    expect(root.querySelectorAll('#cmp-map-secs .pass').length).toBe(0);
    // 並び: スタート | 区間0 | S1 | 区間1 | …
    const kids = Array.from(root.querySelector('#cmp-map-secs')!.children).map((el) => el.className.split(' ')[0]);
    expect(kids[0]).toBe('sec-tick');
    expect(kids[1]).toBe('sec-seg');
    expect(kids[2]).toBe('btn');
    expect(kids[kids.length - 1]).toBe('sec-tick');
    const tickOn = () => Array.from(root.querySelectorAll<HTMLElement>('#cmp-map-secs .sec-tick')).flatMap((el, i) => (el.classList.contains('on') ? [i === 0 ? 'start' : 'end'] : []));
    const onNow = () => Array.from(root.querySelectorAll<HTMLElement>('#cmp-map-secs .sec-seg.on')).map((s) => s.dataset.seg);
    // スタート位置(まだ走っていない): スタートの縦線だけが走行色。最初の横線は通常色
    expect(onNow()).toEqual([]);
    expect(tickOn()).toEqual(['start']);
    const s1 = lapOf('A').sectorTimes[0] as number;         // この 1 周ログでは S1 がスタートのすぐ後(0.12 秒)にある
    expect(s1).toBeGreaterThan(0.02);
    seekTo(s1 / 2);                                        // 走り出した(S1 の手前): スタート〜S1 の横線が走行色、スタートの縦線は通常色
    expect(onNow()).toEqual(['0']);
    expect(tickOn()).toEqual([]);
    seekTo(s1 + 0.5);                          // S1 を過ぎた: 次の区間の横線が走行色、スタートの縦線は通常色
    expect(onNow()).toEqual(['1']);
    expect(tickOn()).toEqual([]);
    seekTo(0);                                             // スタート位置に戻ると、スタートの縦線だけが走行色
    expect(tickOn()).toEqual(['start']);
    expect(onNow()).toEqual([]);
    seekTo(Number($<HTMLInputElement>('#cmp-seek').max) - 0.5);   // エンド前: 最後のセクターとエンドの間の横線が走行色
    expect(onNow()).toEqual([String(n)]);
    expect(tickOn()).toEqual([]);
    seekTo(Number($<HTMLInputElement>('#cmp-seek').max));          // エンドに到着: エンドの縦線が走行色、横線は通常色に戻る
    expect(tickOn()).toEqual(['end']);
    expect(onNow()).toEqual([]);
  });
});

describe('ミニセクター表(案件 6): 「セクター」欄', () => {
  const cells = (slot: string) => Array.from(root.querySelectorAll<HTMLElement>(`#cmp-sectors .mini-cell[data-slot="${slot}"]`));
  const tones = (slot: string, tone: string) => root.querySelectorAll(`#cmp-sectors .mini-cell[data-slot="${slot}"] .t-${tone}`).length;
  const follow = (f: string) => $<HTMLButtonElement>(`[data-act="follow"][data-follow="${f}"]`).click();

  it('通った順になっているラップでは、注意(セクターの順番)は出ない', () => {
    setupOne();
    expect($<HTMLElement>('#cmp-sec-warn').hidden).toBe(true);
  });

  it('車ごとの行に、区間の数(ライン数 + 1)だけ並び、1 区間は 5 つの小区間。見出しはラベル。比較する車が無いので色は付かない', () => {
    setupOne();
    const n = lapOf('A').sectorTimes.length;
    expect(n).toBeGreaterThan(0);
    expect(root.querySelectorAll('#cmp-sectors .mini-tbl > .mini-head')).toHaveLength(n + 1);
    expect(cells('A')).toHaveLength(n + 1);
    for (const c of cells('A')) expect(c.querySelectorAll('.mini-seg')).toHaveLength(5);
    expect(tones('A', 'faster') + tones('A', 'slower') + tones('A', 'pb')).toBe(0);    // 基準の車(1 台だけ)・自己ベストの別名も無い
    expect(root.querySelector('#cmp-edit-circuit')).toBeNull();                          // 「セクターを追加・編集…」は無い
  });

  it('未割り当ての枠も空の行になる(スマホの縦画面で、カードの行と表の行をそろえるため)', () => {
    setupOne();
    const n = lapOf('A').sectorTimes.length;
    expect(root.querySelectorAll('#cmp-sectors .mini-name')).toHaveLength(4);             // A〜D の 4 行
    expect(root.querySelectorAll('#cmp-sectors .mini-name.empty')).toHaveLength(3);        // B〜D は空
    expect(root.querySelectorAll('#cmp-sectors .mini-cell.empty')).toHaveLength(3 * (n + 1));
    expect(root.querySelectorAll('#cmp-sectors .mini-cell.empty .mini-seg')).toHaveLength(0);
  });

  it('入れ替えボタン: 初めはセクターのエリアが上(data-first="sectors")。押すとグラフが上になり、覚える。もう一度押すと戻る', () => {
    setupOne();
    const side = $('#cmp-side');
    const btn = () => $<HTMLButtonElement>('#cmp-sync [data-act="swap-graph"]');
    expect(side.dataset.first).toBe('sectors');
    btn().click();
    expect(side.dataset.first).toBe('graph');
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(session.getSetting('compare.sectorsFirst', true)).toBe(false);
    btn().click();
    expect(side.dataset.first).toBe('sectors');
    expect(session.getSetting('compare.sectorsFirst', false)).toBe(true);
  });

  it('比較を離れてサーキットのセクターを変えると、戻ったとき、ミニセクター表は新しいセクターで計算し直される', async () => {
    setupOne();
    const shown = () => Array.from(root.querySelectorAll('#cmp-sectors .mini-cell[data-slot="A"]'))
      .map((c) => Array.from(c.querySelectorAll('.mini-seg')).map((g) => g.getAttribute('data-v')));
    const expected = () => {
      const r = session.resolveRef(session.assignment.A)!;
      const ser = buildLapSeries(r.log.log, r.lap, r.log.offset);
      const n = r.lap.sectorTimes.length;
      return Array.from({ length: n + 1 }, (_, k) => {
        const g = segmentRange(r.lap, k, n);
        return g ? miniSpeeds(ser, g.a, g.b).map((v) => (v === null ? '' : v.toFixed(1))) : Array(5).fill('');
      });
    };
    const c = session.circuits[0];
    for (const [a, b] of [[0, 3], [1, 4], [2, 5], [0, 7]]) {                              // 本数が変わる・同じ本数で線が変わる
      $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
      session.setCircuitLines(c.id, c.control, c.sectors.slice(a, b));
      await flush();
      $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
      expect(shown()).toHaveLength(b - a + 1);
      expect(shown()).toEqual(expected());
    }
  });

  it('カードは「LAP の別名・LAP のタイム」。LAP の文字だけを包んである(スマホの縦画面で隠す)', () => {
    setupOne();
    const c2 = $('.card .c2');
    expect(c2.querySelector('.lapno')!.textContent).toMatch(/^LAP \d+: $/);
  });

  it('比較基準: 「Runベスト」は、自分の走行データの最速ラップと比べる(基準の車の行にも色が付く)。「追従車」に戻すと付かない。覚える', () => {
    setupOne();
    const t = (tone: string) => root.querySelectorAll(`#cmp-sectors .mini-cell[data-slot="A"] .t-${tone}`).length;
    const mode = (m: string) => $<HTMLButtonElement>(`#cmp-sync [data-act="minibase"][data-mode="${m}"]`);
    expect(mode('car').getAttribute('aria-pressed')).toBe('true');
    expect(t('faster') + t('slower')).toBe(0);                    // 追従車(A だけ): 基準の行は色が付かない
    mode('run').click();
    expect(mode('run').getAttribute('aria-pressed')).toBe('true');
    expect(t('faster')).toBeGreaterThan(0);                         // A のラップは最速のラップ(同じ走行データの 1 周): 全区間が「速い」側
    expect(t('slower')).toBe(0);
    expect(session.getSetting('compare.miniBase', 'car')).toBe('run');
    mode('car').click();
    expect(t('faster') + t('slower')).toBe(0);
    expect(session.getSetting('compare.miniBase', 'run')).toBe('car');
  });

  it('比較基準「全体ベスト」: 比較セット全体の最速ラップと比べる(1 本のログなら Run ベストと同じ)。覚える', () => {
    setupOne();
    const t = (tone: string) => root.querySelectorAll(`#cmp-sectors .mini-cell[data-slot="A"] .t-${tone}`).length;
    $<HTMLButtonElement>('#cmp-sync [data-act="minibase"][data-mode="all"]').click();
    expect(t('faster')).toBeGreaterThan(0);
    expect(t('slower')).toBe(0);
    expect(session.getSetting('compare.miniBase', 'car')).toBe('all');
  });

  it.skipIf(!big)('比較基準「全体ベスト」: ほかのログに速いラップがあれば、遅い車は黄色の区間が出る', () => {
    setupTwo();                                                     // A = big の 2 周目(2:26.5)、B = u の 1 周(2:22.9、速い)
    const t = (s: string, tone: string) => root.querySelectorAll(`#cmp-sectors .mini-cell[data-slot="${s}"] .t-${tone}`).length;
    $<HTMLButtonElement>('#cmp-sync [data-act="minibase"][data-mode="all"]').click();
    expect(t('A', 'slower')).toBeGreaterThan(0);
  });

  it.skipIf(!big)('比較基準「Runベスト」: 最速ラップより遅い車は、遅い区間が黄色になる', () => {
    setupTwo();                                                     // A = big の 2 周目(最速ではない)
    $<HTMLButtonElement>('#cmp-sync [data-act="minibase"][data-mode="run"]').click();
    const t = (s: string, tone: string) => root.querySelectorAll(`#cmp-sectors .mini-cell[data-slot="${s}"] .t-${tone}`).length;
    const log = session.resolveRef(session.assignment.A)!.log;
    const fastest = log.laps.filter((l) => l.complete).reduce((a, b) => (b.duration < a.duration ? b : a));
    if (fastest.number !== lapOf('A').number) expect(t('A', 'slower')).toBeGreaterThan(0);
    else expect(t('A', 'slower')).toBe(0);
  });

  it('比較基準のラップの情報(スマホの縦画面でカードの上に出す 1 段): 追従車の Run・LAP(別名があれば別名)・タイム', () => {
    setupOne();
    const info = $('#cmp-base-info');
    const lap = lapOf('A');
    expect(info.textContent).toBe(`基準Run 1LAP ${lap.number}${formatLapTime(lap.duration)}`);
    session.setLapAlias('u', lap.number, 'ベスト周');
    session.setRunAlias('u', '朝');
    expect(info.textContent).toBe(`基準朝ベスト周${formatLapTime(lap.duration)}`);
    $<HTMLButtonElement>('#cmp-sync [data-act="minibase"][data-mode="run"]').click();
    expect(info.textContent).toBe('基準LAPが入っている走行ログのベスト');
    $<HTMLButtonElement>('#cmp-sync [data-act="minibase"][data-mode="all"]').click();
    expect(info.textContent).toContain('朝');                       // 全体ベストのラップ(1 本のログなので、その最速ラップ)
  });

  it('セクター合わせの札: 状態で表示と有効・無効が変わる(時間: 合わせなし → S1 全車一致 → 自動。距離: 基準車の位置)', () => {
    setupOne();                                                      // 横軸は「時間」
    const tag = () => $<HTMLButtonElement>('#cmp-tool-sync');
    const modeBtn = (m: string) => $<HTMLButtonElement>(`#cmp-sub-sync [data-mode="${m}"]`);
    const rel = () => $<HTMLButtonElement>('#cmp-sub-sync [data-act="sync-release"]');
    // 未選択・自動オフ: 合わせなし。札も押せない(中身が全部使えない)
    expect($('#cmp-sync-note').hidden).toBe(true);
    expect(tag().textContent!.trim()).toBe('合わせなし');
    expect(tag().disabled).toBe(true);
    expect(modeBtn('leader').disabled).toBe(true);
    expect(rel().disabled).toBe(true);
    // セクターを選ぶ: 「S1 全車一致」。動作を選べて、解除できる
    sector(0).click();
    expect(tag().textContent!.trim()).toBe('S1 全車一致');
    expect(tag().disabled).toBe(false);
    expect(modeBtn('leader').disabled).toBe(false);
    expect(rel().disabled).toBe(false);
    tag().click();
    expect($('#cmp-sub-sync').hidden).toBe(false);
    modeBtn('leader').click();
    expect(tag().textContent!.trim()).toBe('S1 先頭車両');
    expect($('#cmp-sub-sync').hidden).toBe(true);
    // 解除: 合わせなしに戻る
    tag().click();
    rel().click();
    expect(tag().textContent!.trim()).toBe('合わせなし');
    expect(tag().disabled).toBe(true);
    // 「自動」をオンにすると、セクターを選ばなくても動作を選べる。解除は自動をオフにする
    $<HTMLButtonElement>('#cmp-sync-tags [data-act="autosync"]').click();
    expect(tag().textContent!.trim()).toBe('自動 先頭車両');
    expect(modeBtn('all').disabled).toBe(false);
    expect(rel().disabled).toBe(false);
    tag().click(); rel().click();
    expect($('#cmp-sync-tags [data-act="autosync"]').classList.contains('on')).toBe(false);
    expect(tag().textContent!.trim()).toBe('合わせなし');
    // 横軸が「距離」: 動作は選べない(灰色)。セクターを選んでいれば、解除はできる
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="dist"]').click();
    expect(tag().textContent!.trim()).toBe('基準車の位置');
    expect(tag().disabled).toBe(false);                              // 選べない理由を見られるように、札は開ける
    expect($('#cmp-sync-note').hidden).toBe(false);
    expect(modeBtn('all').disabled).toBe(true);
    sector(0).click();
    expect(tag().disabled).toBe(false);
    expect(tag().classList.contains('muted')).toBe(true);
    expect(modeBtn('all').disabled).toBe(true);
    expect(rel().disabled).toBe(false);
  });

  it('比較基準の札: 今の基準を札に出し、メニューで選ぶと札の文字が変わってメニューが閉じる。別の札を開くと、開いていた方は閉じる', () => {
    setupOne();
    const base = () => $('#cmp-tool-base').textContent!.trim();
    expect(base()).toBe('比較基準 割当最速');                                 // 追従設定が「固定」なので、車の名前は「先頭」
    $<HTMLButtonElement>('#cmp-tool-base').click();
    expect($('#cmp-sub-base').hidden).toBe(false);
    $<HTMLButtonElement>('#cmp-sub-base [data-mode="all"]').click();
    expect(base()).toBe('比較基準 全体ベスト');
    expect($('#cmp-sub-base').hidden).toBe(true);
    expect(session.getSetting('compare.miniBase', 'car')).toBe('all');
    // 札の「入替」も、右の列の同じボタンと同じ動作
    $<HTMLButtonElement>('#cmp-sync-tags [data-act="swap-graph"]').click();
    expect($('#cmp-side').dataset.first).toBe('graph');
  });

  it('比較基準の車の名前: 追従車を選んでいるときは「追従車」、固定・先頭追従のときは「割当最速」', () => {
    setupOne();
    const base = () => $('#cmp-tool-base').textContent!.trim();
    const carBtns = () => Array.from(root.querySelectorAll<HTMLElement>('[data-act="minibase"][data-mode="car"]')).map((b) => b.textContent);
    expect(carBtns()).toEqual(['割当最速', '割当最速']);                            // 右の列と上部バー
    $<HTMLButtonElement>('[data-act="follow"][data-follow="A"]').click();
    expect(base()).toBe('比較基準 追従車');
    expect(carBtns()).toEqual(['追従車', '追従車']);
    $<HTMLButtonElement>('[data-act="follow"][data-follow="leader"]').click();
    expect(base()).toBe('比較基準 割当最速');
    expect(carBtns()).toEqual(['割当最速', '割当最速']);
  });

  it('通過した区間は濃く、通過前は薄い。再生位置より前のセクターは全部濃く、後ろは全部薄い', () => {
    setupOne();
    const done = (k: number) => root.querySelectorAll(`#cmp-sectors .mini-cell[data-slot="A"][data-sk="${k}"] .mini-seg.done`).length;
    const lap = lapOf('A');
    const s0 = lap.sectorTimes[0] as number, s1 = lap.sectorTimes[1] as number;
    seekTo(0);
    expect(root.querySelectorAll('#cmp-sectors .mini-seg.done')).toHaveLength(0);      // スタート位置: 全部薄い
    seekTo(s0 / 2);
    expect(done(0)).toBeGreaterThanOrEqual(1);                                          // スタート〜最初のライン(列 0)の途中: 通過した分だけ濃い
    expect(done(0)).toBeLessThanOrEqual(4);
    expect(done(1)).toBe(0);
    seekTo((s0 + s1) / 2);
    expect(done(0)).toBe(5);                                                            // 次の区間に入ると、前の区間は全部濃い
    expect(done(1)).toBeGreaterThanOrEqual(1);
    expect(done(1)).toBeLessThanOrEqual(4);
    expect(done(2)).toBe(0);
    seekTo(lap.duration);
    for (let k = 0; k <= lap.sectorTimes.length; k++) expect(done(k)).toBe(5);          // ゴール後は全部濃い(最後の区間はエンドまで)
    seekTo(0);
    expect(root.querySelectorAll('#cmp-sectors .mini-seg.done')).toHaveLength(0);      // 戻すと薄くなる
  });

  it.skipIf(!big)('2台: 追従が「先頭」のときは最速の車が基準(基準の行は色が付かない)。「A を追従」にすると A が基準になる', () => {
    setupTwo();                                            // A = 2:26.5、B = 2:22.9(速い)
    const slow = (s: string) => tones(s, 'slower'), fast = (s: string) => tones(s, 'faster');
    expect(fast('B') + slow('B')).toBe(0);                 // 基準(最速の B)
    expect(fast('A') + slow('A')).toBeGreaterThan(0);
    expect(slow('A')).toBeGreaterThan(0);                  // 遅い A は、基準より遅い区間がある
    follow('A');
    expect(fast('A') + slow('A')).toBe(0);                 // 基準が A に変わる
    expect(fast('B')).toBeGreaterThan(0);                  // 速い B は、A より速い区間がある
    follow('leader');
    expect(fast('B') + slow('B')).toBe(0);                 // 先頭追従(固定も)に戻すと、最速の B が基準
  });

  it.skipIf(!big)('2台: 自己ベストは、その走行データの「PB」の別名のラップ。付けると A の速い区間が紫になり、外すと戻る', () => {
    setupTwo();
    const log = session.resolveRef(session.assignment.A)!.log;
    const slowest = log.laps.filter((l) => l.complete && l.number !== lapOf('A').number).reduce((a, b) => (b.duration > a.duration ? b : a));
    expect(tones('A', 'pb')).toBe(0);
    session.setLapAlias('big', slowest.number, 'PB');
    expect(tones('A', 'pb')).toBeGreaterThan(0);           // A(2 周目)は、いちばん遅いラップより速い区間がある
    session.setLapAlias('big', slowest.number, '');
    expect(tones('A', 'pb')).toBe(0);
  });
});
