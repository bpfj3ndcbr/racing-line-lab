// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlaybackEngine, SPEED_STEPS, parseVbo, speedColor, speedLevel, speedRange, speedRuns, type LapSeries } from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');

let root: HTMLElement, session: Session, store: MemoryStore, app: { dispose(): void } | null = null;
function mount() {
  app?.dispose();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  app = mountApp(root, session, new ThemeController(store), () => new FakeMap());
  session.registerCircuit('オートポリス', cln, sci);
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
  root.querySelector<HTMLButtonElement>('[data-act="nav"][data-view="compare"]')!.click();
}
beforeEach(() => { store = new MemoryStore(); mount(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const cmp = () => $('.cmp');
const host = () => $('#cmp-graph');
const spV = () => $('#cmp-sp-v');
const press = (el: Element, key: string, shiftKey = false) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
const rect = (el: Element, r: { left: number; right: number; top: number; bottom: number }) =>
  Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }) });
const time = () => $('#cmp-time').textContent;
const sideW = () => cmp().style.getPropertyValue('--side-w');

describe('キーボード操作は再生系のみ', () => {
  const doc = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it('Space で再生 / 一時停止。ボタンにフォーカスがあっても、そのボタンは押されず、再生のトグルになる', () => {
    const zin = $<HTMLButtonElement>('#cmp-zin');
    zin.focus();
    const e = doc(' ', {}, zin);
    expect(e.defaultPrevented).toBe(true);                    // ボタンが再び押されないよう、既定の動作を止める
    expect($('#cmp-pp').dataset.state).toBe('playing');
    expect($('#cmp-zoom').textContent).toBe('×1');
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    zin.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);                   // 離したときの動作も止める(ブラウザ差対策)
    doc(' ', {}, zin);
    expect($('#cmp-pp').dataset.state).toBe('paused');
  });

  it('Space の押しっぱなし(リピート)では切り替えない', () => {
    doc(' ');
    doc(' ', { repeat: true });
    doc(' ', { repeat: true });
    expect($('#cmp-pp').dataset.state).toBe('playing');
    doc(' ');
  });

  it('← → は一時停止中に 1コマ(0.1秒)。どこにフォーカスがあっても(地図の上でも)同じ', () => {
    doc('ArrowRight');
    expect(time()).toBe('0:00.1 / 2:22.9');
    const mapEl = $('#cmp-map');
    doc('ArrowRight', {}, mapEl);                             // 地図の上
    expect(time()).toBe('0:00.2 / 2:22.9');
    doc('ArrowLeft', {}, $('#cmp-zin'));                      // ボタンの上
    expect(time()).toBe('0:00.1 / 2:22.9');
  });

  it('Shift + ← → は 1 秒ずつ(再生中でも)', () => {
    doc('ArrowRight', { shiftKey: true });
    expect(time()).toBe('0:01.0 / 2:22.9');
    doc('ArrowRight', { shiftKey: true });
    expect(time()).toBe('0:02.0 / 2:22.9');
    doc('ArrowLeft', { shiftKey: true });
    expect(time()).toBe('0:01.0 / 2:22.9');
    doc('ArrowLeft', { shiftKey: true });
    doc('ArrowLeft', { shiftKey: true });
    expect(time()).toBe('0:00.0 / 2:22.9');                   // 0 より前には戻らない
    doc(' ');                                                  // 再生中
    doc('ArrowRight', { shiftKey: true });
    expect(root.querySelector<HTMLInputElement>('#cmp-seek')!.valueAsNumber).toBeGreaterThanOrEqual(1);
    doc(' ');
  });

  it('再生中の ← →(Shift なし)は無視する', () => {
    doc(' ');
    const before = $<HTMLInputElement>('#cmp-seek').valueAsNumber;
    doc('ArrowRight');
    expect($<HTMLInputElement>('#cmp-seek').valueAsNumber).toBeLessThan(before + 0.05);
    doc(' ');
  });

  it('スライダーにフォーカスがあっても、1コマ(二重には進まない)', () => {
    const seek = $<HTMLInputElement>('#cmp-seek');
    const e = doc('ArrowRight', {}, seek);
    expect(e.defaultPrevented).toBe(true);
    expect(time()).toBe('0:00.1 / 2:22.9');
  });

  it('境界の線・ルーラーにフォーカスがあるときは、その線の操作が優先される', () => {
    doc('ArrowLeft', {}, spV());
    expect(time()).toBe('0:00.0 / 2:22.9');
    $<HTMLButtonElement>('#cmp-zin').click();
    doc('ArrowRight', {}, $('.g-thumb'));
    expect(time()).not.toBe('0:00.1 / 2:22.9');     // コマ送り(0.1秒)ではなく、ルーラー自身の操作が動く
  });

  it('再生系以外のキーは何もしない(+ - 0 Enter など)', () => {
    for (const k of ['+', '-', '=', '0', 'f', 'Escape', 'ArrowUp', 'ArrowDown']) {
      const e = doc(k);
      expect(e.defaultPrevented).toBe(false);
    }
    expect($('#cmp-zoom').textContent).toBe('×1');
    expect(time()).toBe('0:00.0 / 2:22.9');
  });

  it('比較画面を離れると、キーは効かない', () => {
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    const e = doc(' ');
    expect(e.defaultPrevented).toBe(false);
    doc('ArrowRight');
    expect(time()).toBe('0:00.0 / 2:22.9');
  });
});

describe('Run の表記と、右パネルのカード(3段)', () => {
  it('上部のタブは「データ管理」', () => {
    expect(root.querySelector('[data-act="nav"][data-view="import"]')!.textContent).toBe('データ管理');
    expect(root.querySelector('[data-act="nav"][data-view="compare"]')!.textContent).toBe('比較');
  });

  it('カード: 1段目 Run X(太字)/ 2段目 LAP X: タイム / 3段目 速度 / 時間差(時間ベース。距離ベースでは速度だけ)', () => {
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="dist"]').click();
    expect($<HTMLElement>('[data-act="toggle-car"][data-slot="A"] .c3-gap').hidden).toBe(true);
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();
    expect($<HTMLElement>('[data-act="toggle-car"][data-slot="A"] .c3-gap').hidden).toBe(false);
    const card = $('[data-act="toggle-car"][data-slot="A"]');
    expect(card.querySelector('.c1')!.textContent!.replace(' ・ 非表示', '')).toBe('Run 1');
    expect(card.querySelector('.c2')!.textContent).toBe('LAP 1: 2:22.9');
    expect(card.querySelector('.c3')!.textContent).toMatch(/^\d+km\/h \/ 基準$/);
    const order = Array.from(card.querySelector('.card-body')!.children).map((c) => c.className.split(' ')[0]);
    expect(order).toEqual(['c1', 'c2', 'c3']);
    expect(card.textContent).not.toContain('走行データ');
  });

  it('データ管理画面の見出しも Run。割り当てが無い枠は「未割り当て」', () => {
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    expect($('.fno').textContent).toBe('Run 1');
    expect($('#slots').textContent).toContain('Run 1');
    expect($('#slots').textContent).toContain('未割り当て');
    expect(root.textContent).not.toContain('走行データ1');
  });

  it('割り当てが無いときの案内ボタンは「データ管理画面へ」', () => {
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
    expect($('[data-act="back"]').textContent).toBe('データ管理画面へ');
  });
});

describe('速度ヒートマップの色(全車共通の物差し)', () => {
  const series = (speeds: number[]): LapSeries => {
    const n = speeds.length, z = new Float64Array(n);
    return { t: Float64Array.from(speeds, (_, i) => i), lat: z, lon: z, speed: Float64Array.from(speeds), dist: z, duration: n - 1, distance: 0 };
  };
  it('段階: 最低は 0、最高は最大。範囲外は端に張り付く', () => {
    expect(speedLevel(60, 60, 180)).toBe(0);
    expect(speedLevel(180, 60, 180)).toBe(SPEED_STEPS - 1);
    expect(speedLevel(0, 60, 180)).toBe(0);
    expect(speedLevel(999, 60, 180)).toBe(SPEED_STEPS - 1);
    expect(speedLevel(50, 100, 100)).toBe(0);
  });
  it('同じ速度なら、どの走行でも同じ色', () => {
    const a = speedRuns(series([100, 120, 140]), 60, 180), b = speedRuns(series([100, 120, 140, 100]), 60, 180);
    expect(speedColor(a[0].level)).toBe(speedColor(b[0].level));
  });
  it('色は速度が上がるほど変わる(低速=紫 → 高速=黄)', () => {
    const lo = speedColor(0).match(/\d+/g)!.map(Number), hi = speedColor(SPEED_STEPS - 1).match(/\d+/g)!.map(Number);
    expect(lo[2]).toBeGreaterThan(lo[0]);        // 紫: 青が強い
    expect(hi[0]).toBeGreaterThan(200);          // 黄: 赤・緑が強い
    expect(hi[1]).toBeGreaterThan(200);
    expect(new Set(Array.from({ length: SPEED_STEPS }, (_, i) => speedColor(i))).size).toBe(SPEED_STEPS);
  });
  it('範囲(speedRange)は 10km/h 単位で、複数の走行をまとめて決める', () => {
    expect(speedRange([series([62, 150]), series([88, 171])])).toEqual({ lo: 60, hi: 180 });
    expect(speedRange([series([100, 100])])).toEqual({ lo: 100, hi: 110 });
    expect(speedRange([])).toEqual({ lo: 0, hi: 100 });
  });
  it('範囲(run)は端の点を共有して全体をカバーする', () => {
    const runs = speedRuns(series([60, 60, 120, 180, 180]), 60, 180);
    expect(runs[0].from).toBe(0);
    expect(runs[runs.length - 1].to).toBe(4);
    for (let i = 1; i < runs.length; i++) expect(runs[i].from).toBe(runs[i - 1].to);
  });
});

describe('再生エンジン: 秒単位のジャンプ', () => {
  it('skip は 0.1 秒の位取りに丸め、両端を超えない。再生中でも使える', () => {
    const e = new PlaybackEngine(); e.setDuration(10);
    e.seek(1.234); e.skip(1, 1); expect(e.t).toBeCloseTo(2.2, 9);
    e.skip(-1, 1); expect(e.t).toBeCloseTo(1.2, 9);
    e.seek(0.4); e.skip(-1, 1); expect(e.t).toBe(0);
    e.seek(9.5); e.skip(1, 1); expect(e.t).toBe(10);
    e.seek(2); e.play(); e.skip(1, 1); expect(e.t).toBe(3); expect(e.playing).toBe(true);
  });
});

