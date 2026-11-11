// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { distanceM, formatLapTime, parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';
import { GRAPH_LEFT, GRAPH_RIGHT } from '../src/ui/speedGraph';

const fx = (n: string) => `fixtures/${n}`;
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

describe('地図の上の「表示 ▾」(案件 41。どの幅でも同じメニュー)', () => {
  it('ボタンには今の表示。押すと「走行ライン・速度・加減速」と「ラベル」のメニューが開き、選ぶと閉じる', () => {
    setupOne();
    const btn = $<HTMLButtonElement>('#cmp-view-btn'), list = $('#cmp-view-list');
    expect(btn.textContent).toBe('表示: 走行ライン ▾');
    expect(list.hidden).toBe(true);
    btn.click();
    expect(list.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toBe('表示: 走行ライン ▴');
    expect($('#cmp-label-list').hidden).toBe(true);                       // ラベルの選択肢は、「ラベル」を押すと開く
    root.querySelector<HTMLButtonElement>('[data-act="mapmode"][data-mode="speed"]')!.click();
    expect(list.hidden).toBe(true);
    expect(btn.textContent).toBe('表示: 速度 ▾');
    btn.click();
    $<HTMLButtonElement>('#cmp-label-btn').click();
    expect($('#cmp-label-list').hidden).toBe(false);
    expect($('#cmp-label-btn').textContent).toBe('ラベル: 非表示 ▴');
    expect(Array.from(root.querySelectorAll('[data-act="carlabel"]')).map((b) => b.textContent)).toEqual(['非表示', '速度・差', 'カード名']);
    root.querySelector<HTMLButtonElement>('[data-act="carlabel"][data-label="name"]')!.click();
    expect(list.hidden).toBe(true);
    expect($('#cmp-label-btn').textContent).toBe('ラベル: カード名 ▾');
    btn.click();
    expect($('#cmp-label-list').hidden).toBe(true);                       // 開き直すと、ラベルの選択肢は閉じている
  });

  it('「表示位置」と「表示」は、片方を開くともう片方が閉じる', () => {
    setupOne();
    $<HTMLButtonElement>('#cmp-follow-btn').click();
    expect($('#cmp-follow-list').hidden).toBe(false);
    $('#cmp-view-btn').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    $<HTMLButtonElement>('#cmp-view-btn').click();
    expect($('#cmp-follow-list').hidden).toBe(true);
    expect($('#cmp-view-list').hidden).toBe(false);
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

  it('表示位置のメニューが開いているときに地図をたたくと、メニューを閉じるだけで再生・停止はしない(案件 41)', () => {
    setupOne();
    $<HTMLButtonElement>('#cmp-follow-btn').click();
    expect($('#cmp-follow-list').hidden).toBe(false);
    ptr('pointerdown'); ptr('pointerup');
    expect($('#cmp-follow-list').hidden).toBe(true);
    expect(state()).toBe('paused');
    ptr('pointerdown'); ptr('pointerup');                                        // 閉じたあとは、今までどおり
    expect(state()).toBe('playing');
  });
});

describe('セクターボタンの動作の切り替え', () => {
  it('セクターのボタンは、地図の上(#cmp-map-secs、狭い幅のときだけ見える)にも同じものが出て、押した状態もそろう(案件 1)', () => {
    setupOne();
    const side = Array.from(root.querySelectorAll('#cmp-sectors [data-act="sector"]')).map((b) => b.textContent);
    const onMap = Array.from(root.querySelectorAll('#cmp-map-secs [data-act="sector"]')).map((b) => b.textContent);
    expect(onMap).toEqual(side);
    expect(onMap.length).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('#cmp-map-secs [data-k="1"]')!.click();
    expect(root.querySelector('#cmp-sectors [data-k="1"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#cmp-map-secs [data-k="1"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('「先頭車両」「全車一致」と「解除」が 1 つの切り替えにまとまる。初期は全車一致', () => {
    setupOne();
    expect(Array.from(root.querySelectorAll('[data-act="syncmode"]')).map((b) => b.textContent)).toEqual(['先頭車両', '全車一致']);
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

  it('「セクター設定無し」と表示し、ボタンと動作の切り替えは出さない', () => {
    withoutSectors();
    expect($('#cmp-sectors').textContent).toBe('セクター設定無し');
    expect($('#cmp-sectors').querySelectorAll('button')).toHaveLength(0);
    expect($<HTMLElement>('#cmp-sync').hidden).toBe(true);
  });

  it('セクターがあるときは、表示は出ない', () => {
    setupOne();
    expect($('#cmp-sectors').querySelector('.no-sector')).toBeNull();
    expect($('#cmp-sectors').querySelectorAll('button')).toHaveLength(7);
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

  it('地図の表示は「走行ライン / 速度 / 加減速」', () => {
    setupOne();
    expect(Array.from(root.querySelectorAll('[data-act="mapmode"]')).map((b) => b.textContent)).toEqual(['走行ライン', '速度', '加減速']);
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
    expect($('#cmp-sectors button').classList.contains('sec')).toBe(true);
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
    expect($('#cmp-sectors').querySelectorAll('button')).toHaveLength(7);
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
