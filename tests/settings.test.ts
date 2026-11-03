// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { Prefs, DEFAULT_REMEMBER } from '../src/store/prefs';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');

let root: HTMLElement, store: MemoryStore, session: Session, fake: FakeMap;
function boot(prep?: (p: Prefs, s: Session) => void) {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  fake = new FakeMap();
  prep?.(new Prefs(session), session);
  mountApp(root, session, new ThemeController(store), () => fake);
  if (!session.circuits.length) session.registerCircuit('オートポリス', cln, sci);
  if (!session.logs.length) session.addLog(utc(), 'u');
  if (!session.assignment.A) session.toggleAssignment('A', { logId: 'u', lap: 1 });
}
beforeEach(() => { store = new MemoryStore(); boot(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const nav = (v: string) => $<HTMLButtonElement>(`[data-act="nav"][data-view="${v}"]`).click();
const row = (k: string) => $(`.srow[data-key="${k}"]`);
const rem = (k: string) => $<HTMLInputElement>(`[data-rem="${k}"]`);
const setRem = (k: string, on: boolean) => { const c = rem(k); c.checked = on; c.dispatchEvent(new Event('change', { bubbles: true })); };
const pick = (k: string, v: string) => $<HTMLButtonElement>(`[data-set="${k}"][data-v="${v}"]`).click();
const zoomSlider = () => $<HTMLInputElement>('[data-zoom]');
const slide = (el: HTMLInputElement, v: number) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };

describe('設定タブ', () => {
  it('上部に「設定」タブがあり、押すと設定の画面になる', () => {
    expect($('.navtabs').textContent).toContain('設定');
    nav('settings');
    expect($<HTMLElement>('#view-settings').hidden).toBe(false);
    expect($<HTMLElement>('#view-import').hidden).toBe(true);
    expect($('[data-act="nav"][data-view="settings"]').getAttribute('aria-current')).toBe('page');
    expect(Array.from(root.querySelectorAll('#view-settings h3')).map((h) => h.textContent)).toEqual(['外観', 'マップ', '速度グラフ', '再生・セクター', '起動時']);
  });

  it('項目: テーマ / 描画 / 引き出し線の表示 / 倍率 / 初期位置 / 追従 / 最低速度 / 横軸 / 再生速度 / セクターボタンの動作 / 自動読み込み と、初期化ボタン', () => {
    const names = Array.from(root.querySelectorAll('#view-settings .sname')).map((e) => e.textContent);
    expect(names).toEqual(['テーマ', '描画', '引き出し線の表示', '倍率', '初期位置', '追従', '最低速度', '横軸', '再生速度', 'セクターボタンの動作', '最後の走行データを自動で読み込む']);
    expect($('[data-reset]')).toBeTruthy();
  });

  it('初めから「記憶する」なのは、操作の結果を自動で保存する項目(テーマ・描画・ラベル・セクターの動作)', () => {
    for (const k of Object.keys(DEFAULT_REMEMBER) as (keyof typeof DEFAULT_REMEMBER)[]) expect(rem(k).checked).toBe(DEFAULT_REMEMBER[k]);
    expect(['theme', 'mapMode', 'labels', 'sync'].every((k) => rem(k).checked)).toBe(true);
    expect(['zoom', 'follow', 'xKind', 'rate'].every((k) => !rem(k).checked)).toBe(true);
  });

  it('「記憶する」にチェックすると、その項目は選べない(スライダー・ボタンが無効)。外すと選べる', () => {
    expect(row('mapMode').querySelectorAll('button:disabled')).toHaveLength(3);
    setRem('mapMode', false);
    expect(row('mapMode').querySelectorAll('button:disabled')).toHaveLength(0);
    setRem('zoom', true);
    expect(zoomSlider().disabled).toBe(true);
    setRem('labels', false);
    expect(row('labels').querySelectorAll('button:disabled')).toHaveLength(0);
    setRem('labels', true);
    expect(row('labels').querySelectorAll('button:disabled')).toHaveLength(3);
  });

  it('無効な項目を押しても、値は変わらない', () => {
    $<HTMLButtonElement>('[data-set="mapMode"][data-v="speed"]').click();
    expect(new Prefs(session).get('mapMode').value).toBe('line');
  });
});

describe('「記憶しない」: 設定した初期値で始まる', () => {
  it('描画・速度・差・横軸・再生速度・セクターの動作・追従が、比較画面の最初の状態になる', () => {
    store = new MemoryStore();
    boot((p) => {
      for (const k of ['mapMode', 'labels', 'xKind', 'rate', 'sync', 'follow'] as const) p.setRemember(k, false);
      p.setValue('mapMode', 'speed'); p.setValue('labels', 'speed'); p.setValue('xKind', 'time');
      p.setValue('rate', 2); p.setValue('sync', 'leader'); p.setValue('follow', 'A');
    });
    nav('compare');
    expect($('#view-compare [data-act="mapmode"].on').dataset.mode).toBe('speed');
    expect($('#cmp-carlabel').getAttribute('aria-pressed')).toBe('true');
    expect($('#view-compare [data-act="xkind"].on').dataset.kind).toBe('time');
    expect($('#view-compare [data-act="rate"].on').dataset.rate).toBe('2');
    expect($('#view-compare [data-act="syncmode"].on').dataset.mode).toBe('leader');
    expect($('#view-compare [data-act="follow"].on').dataset.follow).toBe('A');
  });

  it('比較画面で操作しても、次に開くときは初期値に戻る(前回の状態は使わない)', () => {
    store = new MemoryStore();
    boot((p) => { p.setRemember('rate', false); p.setValue('rate', 0.5); });
    nav('compare');
    $<HTMLButtonElement>('[data-act="rate"][data-rate="2"]').click();
    boot();            // 同じ保存先で起動し直す
    nav('compare');
    expect($('#view-compare [data-act="rate"].on').dataset.rate).toBe('0.5');
  });

  it('設定タブで変えると、すでに開いている比較画面にもすぐ反映される', () => {
    nav('compare');
    nav('settings');
    setRem('mapMode', false);
    pick('mapMode', 'accel');
    expect($('#view-compare [data-act="mapmode"].on').dataset.mode).toBe('accel');
    setRem('rate', false);
    pick('rate', '0.25');
    expect($('#view-compare [data-act="rate"].on').dataset.rate).toBe('0.25');
  });

  it('テーマ: 記憶しないなら、起動時に設定の値になり、設定を変えるとすぐ切り替わる', () => {
    expect(document.documentElement.dataset.theme).toBe('light');
    setRem('theme', false);
    pick('theme', 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    pick('theme', 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
    pick('theme', 'dark');
    boot();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('「記憶する」: 前回の状態で始まる', () => {
  it('描画を変えると、起動し直しても同じ。設定の初期値は無視される', () => {
    store = new MemoryStore();
    boot((p) => { p.setValue('mapMode', 'accel'); });          // 記憶する(初期設定)のまま、値だけ変えてある
    nav('compare');
    expect($('#view-compare [data-act="mapmode"].on').dataset.mode).toBe('accel');       // 前回の状態が無いので初期値
    $<HTMLButtonElement>('[data-act="mapmode"][data-mode="speed"]').click();
    boot();
    nav('compare');
    expect($('#view-compare [data-act="mapmode"].on').dataset.mode).toBe('speed');
  });

  it('横軸・再生速度・追従も、記憶にすると前回の状態で始まる', () => {
    store = new MemoryStore();
    boot((p) => { p.setRemember('xKind', true); p.setRemember('rate', true); });
    nav('compare');
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    $<HTMLButtonElement>('[data-act="rate"][data-rate="2"]').click();
    boot();
    nav('compare');
    expect($('#view-compare [data-act="xkind"].on').dataset.kind).toBe('time');
    expect($('#view-compare [data-act="rate"].on').dataset.rate).toBe('2');
  });

  it('前回の状態として保存した値(描画・ラベル・セクターの動作)で始まる', () => {
    store = new MemoryStore();
    boot((_p, s) => { s.setSetting('compare.mapMode', 'speed'); s.setSetting('compare.labels', 'speed'); s.setSetting('compare.sync', 'leader'); });
    nav('compare');
    expect($('#view-compare [data-act="mapmode"].on').dataset.mode).toBe('speed');
    expect($('#cmp-carlabel').getAttribute('aria-pressed')).toBe('true');
    expect($('#view-compare [data-act="syncmode"].on').dataset.mode).toBe('leader');
  });
});

describe('倍率', () => {
  it('スライダーは「サーキット全体」から Z14〜Z20。初期は「サーキット全体」', () => {
    expect(zoomSlider().min).toBe('0');
    expect(zoomSlider().max).toBe('7');
    expect($('[data-zoom-text]').textContent).toBe('サーキット全体');
    setRem('zoom', false);
    slide(zoomSlider(), 4);
    expect($('[data-zoom-text]').textContent).toBe('Z17');
    expect(new Prefs(session).get('zoom').value).toBe(17);
  });

  it('「サーキット全体」: 登録した表示位置があればそれ、無ければ走行ライン全体', () => {
    nav('compare');
    expect(fake.fitted).toBeGreaterThan(0);
    expect(fake.viewSet).toHaveLength(0);
  });

  it('Z17 にすると、地図の中心はそのままで倍率だけ Z17 になる', () => {
    store = new MemoryStore();
    boot((p) => { p.setRemember('zoom', false); p.setValue('zoom', 17); });
    nav('compare');
    expect(fake.fitted).toBeGreaterThan(0);
    expect(fake.viewSet.at(-1)?.[2]).toBe(17);
  });

  it('サーキット登録画面で保存した表示位置は、比較画面の地図には使わない(倍率は別々に管理する)', () => {
    store = new MemoryStore();
    boot((p, s) => {
      p.setRemember('zoom', false); p.setValue('zoom', 18);
      s.registerCircuit('オートポリス', cln, sci, { lat: 33.04, lon: 130.97, zoom: 16 });
    });
    nav('compare');
    expect(fake.fitted).toBeGreaterThan(0);
    expect(fake.viewSet.at(-1)![2]).toBe(18);
    expect(fake.viewSet.at(-1)).not.toEqual([33.04, 130.97, 18]);
  });

  it('「記憶する」: 地図を拡大・縮小した倍率を覚え、次に開くときその倍率になる。プログラムが動かした分は覚えない', () => {
    store = new MemoryStore();
    boot((p) => { p.setRemember('zoom', true); });
    nav('compare');
    expect(new Prefs(session).last('zoom')).toBeNull();
    fake.userZooms(16);
    expect(new Prefs(session).last('zoom')).toBe(16);
    fake.userZooms(12);                                    // 範囲の外は端に丸める
    expect(new Prefs(session).last('zoom')).toBe(14);
    boot();
    nav('compare');
    expect(fake.viewSet.at(-1)?.[2]).toBe(14);
  });
});

describe('速度グラフの最低速度', () => {
  const ticks = () => Array.from(root.querySelectorAll('svg.speed-graph .g-tick[text-anchor="end"]')).map((t) => t.textContent);   // 縦軸の目盛りだけ
  it('初期は 0 km/h。スライダーで上げると、縦軸の下限がその値になる', () => {
    nav('compare');
    expect(ticks()).toContain('0');
    const s = $<HTMLInputElement>('[data-ymin]');
    expect(s.value).toBe('0');
    slide(s, 50);
    expect($('[data-ymin-text]').textContent).toBe('50 km/h');
    expect(new Prefs(session).yMin).toBe(50);
    expect(ticks()).not.toContain('0');
    expect(ticks()[0]).toBe('50');
  });
  it('起動時にも反映される。「記憶する」のチェックは無い', () => {
    store = new MemoryStore();
    boot((p) => p.setYMin(30));
    nav('compare');
    expect(ticks()).not.toContain('0');
    expect(row('xKind')).toBeTruthy();
    expect(root.querySelector('[data-ymin]')!.closest('.srow')!.querySelector('input[type=checkbox]')).toBeNull();
  });
});

describe('初期化', () => {
  it('2 回押すと、すべての設定が初期値・初期の「記憶する」に戻る', () => {
    setRem('mapMode', false); pick('mapMode', 'accel'); setRem('zoom', true);
    $<HTMLButtonElement>('[data-reset]').click();
    expect($('[data-reset]').textContent).toContain('もう一度');
    expect(new Prefs(session).get('mapMode').value).toBe('accel');           // 1 回目ではまだ変わらない
    $<HTMLButtonElement>('[data-reset]').click();
    expect(new Prefs(session).get('mapMode')).toEqual({ remember: true, value: 'line' });
    expect(rem('zoom').checked).toBe(false);
    expect($('[data-reset]').textContent).toBe('すべて初期値に戻す');
  });
});

describe('Prefs(保存の仕組み)', () => {
  it('壊れた値は初期値に戻る', () => {
    const s = new Session(new MemoryStore());
    s.setSetting('prefs', { items: { mapMode: { remember: 'x', value: 'zzz' }, zoom: { value: 99 } }, yMin: 'a' });
    const p = new Prefs(s);
    expect(p.get('mapMode')).toEqual({ remember: true, value: 'line' });
    expect(p.get('zoom').value).toBe(0);
    expect(p.yMin).toBe(0);
  });
  it('initial: 記憶する → 前回の状態(無ければ初期値)、しない → 初期値', () => {
    const s = new Session(new MemoryStore());
    const p = new Prefs(s);
    p.setValue('rate', 2);
    p.setRemember('rate', true);
    expect(p.initial('rate')).toBe(2);
    p.saveLast('rate', 0.5);
    expect(p.initial('rate')).toBe(0.5);
    p.setRemember('rate', false);
    expect(p.initial('rate')).toBe(2);
  });
});

describe('アプリを初期状態に戻す', () => {
  it('「すべて初期値に戻す」とは別のボタン。2 回押すと、保存したものを全部消して画面を読み直す', () => {
    let reloaded = 0;
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    store = new MemoryStore();
    session = new Session(store);
    mountApp(root, session, new ThemeController(store), () => new FakeMap(), { reload: () => { reloaded++; } });
    session.registerCircuit("オートポリス", cln, sci);
    session.setAlias(0, '別名');
    new Prefs(session).setValue('zoom', 18);
    expect(store.get('circuits')).not.toBeNull();
    nav('settings');
    const wipe = () => $<HTMLButtonElement>('[data-wipe]');
    expect(wipe().textContent).toBe('アプリを初期状態に戻す');
    expect($<HTMLButtonElement>('[data-reset]').textContent).toBe('すべて初期値に戻す');
    wipe().click();
    expect(wipe().textContent).toBe('もう一度押すと、アプリを初期状態に戻します');
    expect(store.get('circuits')).not.toBeNull();                  // 1 回目では消えない
    expect(reloaded).toBe(0);
    wipe().click();
    expect(store.get('circuits')).toBeNull();
    expect(store.get('ui.prefs')).toBeNull();
    expect(store.get('ui.setAliases')).toBeNull();
    expect(reloaded).toBe(1);
  });
  it('別の操作をすると、確認の状態は元に戻る', () => {
    nav('settings');
    $<HTMLButtonElement>('[data-wipe]').click();
    $<HTMLButtonElement>('[data-reset]').click();
    expect($<HTMLButtonElement>('[data-wipe]').textContent).toBe('アプリを初期状態に戻す');
  });
});
