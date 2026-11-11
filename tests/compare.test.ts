// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseVbo } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { DIST_STEPS, TIME_STEPS, fmtDistTick, pickStep } from '../src/ui/speedGraph';
import { fmtMinSec } from '../src/core';
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
const goCompare = () => {
  $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
  $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();       // 以下は、時間ベース(横軸「時間」)の動作を調べる
};
const time = () => $('#cmp-time').textContent;
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const assignUtc = () => {
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
};

describe('画面の切り替え', () => {
  it('上部の「比較」「読み込み」で画面が入れ替わる', () => {
    expect($<HTMLElement>('#view-compare').hidden).toBe(true);
    goCompare();
    expect($<HTMLElement>('#view-compare').hidden).toBe(false);
    expect($<HTMLElement>('#view-import').hidden).toBe(true);
    expect($('[data-view="compare"]').getAttribute('aria-current')).toBe('page');
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    expect($<HTMLElement>('#view-import').hidden).toBe(false);
  });

  it('「比較画面へ」は割り当てがあるときだけ押せる', () => {
    session.addLog(utc(), 'u');
    expect($<HTMLButtonElement>('[data-act="goto-compare"]').disabled).toBe(true);
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    const b = $<HTMLButtonElement>('[data-act="goto-compare"]');
    expect(b.disabled).toBe(false);
    b.click();
    expect($<HTMLElement>('#view-compare').hidden).toBe(false);
  });
});

describe('比較画面', () => {
  it('割り当てが無いと案内を出し、「読み込み画面へ」で戻れる', () => {
    goCompare();
    expect($<HTMLElement>('#cmp-empty').hidden).toBe(false);
    expect($<HTMLElement>('#cmp-main').hidden).toBe(true);
    $<HTMLButtonElement>('[data-act="back"]').click();
    expect($<HTMLElement>('#view-import').hidden).toBe(false);
  });

  it('地図にライン・計測ライン・セクター(S1〜S7)・車両が渡される', () => {
    assignUtc();
    goCompare();
    expect(fake.tracks).toHaveLength(1);
    expect(fake.tracks[0].slot).toBe('A');
    expect(fake.tracks[0].points.length).toBeGreaterThan(2000);
    expect(fake.lines.map((l) => l.label)).toEqual(['計測ライン', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    expect(fake.cars).toHaveLength(1);
    expect(fake.fitted).toBeGreaterThan(0);
    expect($('#cmp-cards').textContent).toContain('Run 1');
    expect($('#cmp-cards').textContent).toContain('LAP 1: 2:22.9');
    expect($('#cmp-cards').textContent).toContain('基準');
  });

  it('速度グラフに線とセクター位置が描かれる', () => {
    assignUtc();
    goCompare();
    expect(root.querySelectorAll('svg.speed-graph path.g-line')).toHaveLength(1);
    expect(root.querySelectorAll('svg.speed-graph .g-mark')).toHaveLength(7);
    expect(root.querySelector('svg.speed-graph')!.textContent).toContain('km');
  });

  it('再生/一時停止は1つのトグルボタン: 止まっているときは「再生」、再生中は「一時停止」。再生中はコマ送りが無効', () => {
    assignUtc();
    goCompare();
    const pp = $<HTMLButtonElement>('#cmp-pp'), fwd = $<HTMLButtonElement>('#cmp-ff');
    expect(pp.getAttribute('aria-label')).toBe('再生');
    expect(pp.dataset.state).toBe('paused');
    expect(pp.querySelector('path')!.getAttribute('d')).toContain('M4 2l10 6');       // 再生アイコン(三角形)
    expect(fwd.disabled).toBe(false);
    pp.click();
    expect(pp.getAttribute('aria-label')).toBe('一時停止');
    expect(pp.dataset.state).toBe('playing');
    expect(pp.querySelector('path')!.getAttribute('d')).toContain('M4 2h3v12');      // 一時停止アイコン(2本線)
    expect(fwd.disabled).toBe(true);
    pp.click();
    expect(pp.getAttribute('aria-label')).toBe('再生');
    expect(pp.dataset.state).toBe('paused');
    expect(fwd.disabled).toBe(false);
  });

  it('ボタンの並び: 先頭へ → 1コマ戻る → 再生/一時停止 → 1コマ進む → 以降(再生速度・時間・スライダー…)', () => {
    assignUtc();
    goCompare();
    const acts = Array.from(root.querySelectorAll('.cmp-ctl > button.ib')).map((b) => (b as HTMLElement).dataset.act);
    expect(acts.slice(0, 4)).toEqual(['to-start', 'frame-back', 'toggle', 'frame-fwd']);
    const kids = Array.from(root.querySelector('.cmp-ctl')!.children);
    const idx = (sel: string) => kids.findIndex((k) => k.matches(sel));
    expect(idx('[aria-label="再生速度"]')).toBe(4);
    expect(idx('#cmp-time')).toBeGreaterThan(4);
    expect(idx('#cmp-seek')).toBeGreaterThan(idx('#cmp-time'));
  });

  it('一時停止中は → で +0.1 秒、← で -0.1 秒', () => {
    assignUtc();
    goCompare();
    expect(time()).toBe('0:00.0 / 2:22.9');
    key('ArrowRight'); expect(time()).toBe('0:00.1 / 2:22.9');
    key('ArrowRight'); expect(time()).toBe('0:00.2 / 2:22.9');
    key('ArrowLeft'); expect(time()).toBe('0:00.1 / 2:22.9');
    key('ArrowLeft'); key('ArrowLeft'); expect(time()).toBe('0:00.0 / 2:22.9');
  });

  it('再生中は ←→ を無視する。Space で再生 / 一時停止', () => {
    assignUtc();
    goCompare();
    key(' ');
    const pp = $<HTMLButtonElement>('#cmp-pp');
    expect(pp.dataset.state).toBe('playing');
    key('ArrowRight');
    expect(time()).toBe('0:00.0 / 2:22.9');
    key(' ');
    expect(pp.dataset.state).toBe('paused');
  });

  it('比較画面を離れると再生が止まり、キー操作も効かなくなる', () => {
    assignUtc();
    goCompare();
    key(' ');
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    expect($<HTMLButtonElement>('#cmp-pp').dataset.state).toBe('paused');
    key('ArrowRight');
    expect(time()).toBe('0:00.0 / 2:22.9');
  });

  it('スライダーでシークすると、車両の位置と時刻表示が変わる', () => {
    assignUtc();
    goCompare();
    const before = { ...fake.cars[0] };
    const seek = $<HTMLInputElement>('#cmp-seek');
    seek.value = '60';
    seek.dispatchEvent(new Event('input'));
    expect(time()).toBe('1:00.0 / 2:22.9');
    expect(fake.cars[0].lat).not.toBe(before.lat);
    expect($('[data-live="speed-a"]').textContent).toMatch(/^\d+km\/h$/);
  });

  it('グラフをクリック/ドラッグしてシーク(横軸=時間)', () => {
    assignUtc();
    goCompare();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    expect(root.querySelector('svg.speed-graph')!.textContent).toContain('0:30');
    const svg = root.querySelector('svg.speed-graph')!;
    const w = Number(svg.getAttribute('width'));
    const x = GRAPH_LEFT + (w - GRAPH_LEFT - GRAPH_RIGHT) / 2;                    // プロット幅のちょうど中央
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, bubbles: true }));
    expect($<HTMLElement>('#cmp-time').textContent!.startsWith('1:11')).toBe(true);   // 142.9 / 2 = 71.4 秒
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: x + 100, bubbles: true }));
    expect(time()).not.toMatch(/^1:11/);
    svg.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });

  it('グラフをクリックして位置を決める(横軸=距離)と、基準車がその距離にいる時刻になる', () => {
    assignUtc();
    goCompare();
    const svg = root.querySelector('svg.speed-graph')!;
    const w = Number(svg.getAttribute('width'));
    svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: GRAPH_LEFT + (w - GRAPH_LEFT - GRAPH_RIGHT) * 0.5, bubbles: true }));
    const t = parseFloat(time()!.split(':')[1]) + 60;
    expect(t).toBeGreaterThan(50);
    expect(t).toBeLessThan(90);
    svg.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });

  it('再生速度の切り替え', () => {
    assignUtc();
    goCompare();
    $<HTMLButtonElement>('[data-act="rate"][data-rate="2"]').click();
    expect($('[data-act="rate"][data-rate="2"]').getAttribute('aria-pressed')).toBe('true');
    expect($('[data-act="rate"][data-rate="1"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('割り当てを変えて戻ってくると、新しい内容で作り直し 0 秒に戻る', () => {
    assignUtc();
    goCompare();
    key('ArrowRight');
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.toggleAssignment('A', { logId: 'u', lap: 1 });          // 解除
    goCompare();
    expect($<HTMLElement>('#cmp-empty').hidden).toBe(false);
    expect(fake.cars).toHaveLength(0);
  });

  it.skipIf(!existsSync(bigPath))('2台: 基準(A)との時間差が表示され、セクター位置は基準車のもの', () => {
    session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'big', lap: 2 });
    session.toggleAssignment('B', { logId: 'u', lap: 1 });
    goCompare();
    expect(fake.tracks.map((t) => t.slot)).toEqual(['A', 'B']);
    expect($('[data-live="gap-a"]').textContent).toBe('基準');
    expect($('[data-live="gap-b"]').textContent).toBe('+0.00s');
    const seek = $<HTMLInputElement>('#cmp-seek');
    seek.value = '100';
    seek.dispatchEvent(new Event('input'));
    // B(2:22.9)は A(2:26.5)より速いので、同じ距離に着くのが早い = 負
    expect($('[data-live="gap-b"]').textContent).toMatch(/^-\d+\.\d\ds$/);
    expect(time()).toBe('1:40.0 / 2:26.5');
    expect(root.querySelectorAll('svg.speed-graph path.g-line')).toHaveLength(2);
  });
});

describe('グラフの目盛り', () => {
  it('間隔の選び方', () => {
    expect(pickStep(4700, DIST_STEPS)).toBe(1000);
    expect(pickStep(900, DIST_STEPS)).toBe(200);
    expect(pickStep(146, TIME_STEPS)).toBe(30);
    expect(pickStep(30, TIME_STEPS)).toBe(5);
  });
  it('ラベル', () => {
    expect(fmtDistTick(0)).toBe('0');
    expect(fmtDistTick(500)).toBe('500 m');
    expect(fmtDistTick(1000)).toBe('1 km');
    expect(fmtDistTick(1500)).toBe('1.5 km');
    expect(fmtMinSec(90)).toBe('1:30');
  });
});

describe('登録フォーム', () => {
  it('1行1項目で、最後の行に「登録」ボタン', () => {
    const rows = Array.from(root.querySelectorAll('#panel-reg .circ-form > .frow'));
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 3).map((r) => r.querySelector('span')!.textContent)).toEqual(['名前', 'コントロールライン(.cln)', 'セクター(.sci)']);
    expect(rows[3].querySelector('[data-act="register"]')).not.toBeNull();
  });
});
