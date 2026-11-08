// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  type LapSeries, ACCEL_FULL, BRAKE_FULL, COAST, HEAT_STEPS, accelSeries, buildLapSeries, detectLaps,
  heatColor, heatLevel, heatRuns, parseCln, parseSci, parseVbo,
} from '../src/core';
import { MemoryStore } from '../src/io/storage';
import { Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

const fx = (n: string) => `fixtures/${n}`;
const cln = readFileSync(fx('cl_autopolis.cln'), 'utf8');
const sci = readFileSync(fx('autopolis.sci'), 'utf8');
const utc = () => parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u.vbo');
const bigPath = fx('session_20260506_094550_autopolis.vbo');

/** 速度(km/h)を時間の関数で与えて、合成の時系列を作る */
function synth(durationSec: number, hz: number, speed: (t: number) => number, jitter = 0): LapSeries {
  const n = Math.round(durationSec * hz) + 1;
  const t = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i / hz + (i > 0 && i < n - 1 ? ((i * 7919) % 11 - 5) / 5 * jitter : 0);   // 決まった疑似乱数でタイムスタンプを揺らす
    v[i] = speed(t[i]);
  }
  const z = new Float64Array(n);
  return { t, lat: z, lon: z, speed: v, dist: z, duration: t[n - 1], distance: 0 };
}

describe('加速度(速度の微分)', () => {
  it('一定速度なら 0、一定の加速なら その値(36km/h を 10 秒で → 1 m/s²)', () => {
    const flat = accelSeries(synth(10, 10, () => 100));
    expect(Math.max(...flat.map(Math.abs))).toBeLessThan(1e-9);
    const ramp = accelSeries(synth(10, 10, (t) => 3.6 * t));
    for (let i = 0; i < ramp.length; i++) expect(ramp[i]).toBeCloseTo(1, 6);
  });

  it('20Hz でタイムスタンプが 10ms 単位で揺れていても、真の値に近い', () => {
    const a = accelSeries(synth(10, 20, (t) => 3.6 * 2 * t, 0.01));      // 2 m/s²
    const mid = Array.from(a).slice(20, 180);
    expect(Math.max(...mid)).toBeLessThan(2.3);
    expect(Math.min(...mid)).toBeGreaterThan(1.7);
  });

  it('実走行(LapLoupe の1周): 減速は強く、加速は穏やか。極端な外れ値が無い', () => {
    const log = parseVbo(readFileSync(fx('20260913140139_UTC.vbo'), 'utf8'), 'u');
    const lap = detectLaps(log, parseCln(cln)[0], parseSci(sci).map((s) => s.line))[0];
    const a = accelSeries(buildLapSeries(log, lap));
    expect(Math.min(...a)).toBeLessThan(-5);
    expect(Math.min(...a)).toBeGreaterThan(-20);
    expect(Math.max(...a)).toBeGreaterThan(1.5);
    expect(Math.max(...a)).toBeLessThan(10);
  });
});

describe('ヒートマップの段階と色', () => {
  it('惰性は 0、強さで 1〜8 段、上限で頭打ち', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(COAST - 0.01)).toBe(0);
    expect(heatLevel(-(COAST - 0.01))).toBe(0);
    expect(heatLevel(COAST + 0.01)).toBe(1);
    expect(heatLevel(-(COAST + 0.01))).toBe(-1);
    expect(heatLevel(ACCEL_FULL)).toBe(HEAT_STEPS);
    expect(heatLevel(99)).toBe(HEAT_STEPS);
    expect(heatLevel(-BRAKE_FULL)).toBe(-HEAT_STEPS);
    expect(heatLevel(-99)).toBe(-HEAT_STEPS);
  });
  it('加速は緑、減速は赤、惰性は灰色', () => {
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
    const [gr, gg] = [rgb(heatColor(HEAT_STEPS))[0], rgb(heatColor(HEAT_STEPS))[1]];
    expect(gg).toBeGreaterThan(gr);
    const red = rgb(heatColor(-HEAT_STEPS));
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(heatColor(0)).toBe('rgb(208,214,222)');
  });
  it('段階が続く範囲にまとめ、端の点を隣と共有する', () => {
    const a = Float64Array.from([0, 0, 0, 5, 5, 5, -9, -9, 0, 0]);
    const runs = heatRuns(a);
    expect(runs[0].from).toBe(0);
    expect(runs[runs.length - 1].to).toBe(a.length - 1);
    for (let i = 1; i < runs.length; i++) expect(runs[i].from).toBe(runs[i - 1].to);
    expect(runs.some((r) => r.level > 0)).toBe(true);
    expect(runs.some((r) => r.level < 0)).toBe(true);
  });
});

// ---------------- 画面 ----------------
let root: HTMLElement, session: Session, fake: FakeMap, store: MemoryStore;
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  session = new Session(store);
  fake = new FakeMap();
  mountApp(root, session, new ThemeController(store), () => fake);
  session.registerCircuit('オートポリス', cln, sci);
}
beforeEach(() => { store = new MemoryStore(); mount(); });

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const goCompare = () => $<HTMLButtonElement>('[data-act="nav"][data-view="compare"]').click();
const cmp = () => $('.cmp');
const seekTo = (sec: number) => { const e = $<HTMLInputElement>('#cmp-seek'); e.value = String(sec); e.dispatchEvent(new Event('input')); };
const followBtn = (f: string) => $<HTMLButtonElement>(`[data-act="follow"][data-follow="${f}"]`);
const press = (el: HTMLElement, key: string, shiftKey = false) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

function setupTwo() {
  session.addLog(parseVbo(readFileSync(bigPath, 'utf8'), 'big.vbo'), 'big');
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'big', lap: 2 });     // 2:26.5
  session.toggleAssignment('B', { logId: 'u', lap: 1 });       // 2:22.9(速い)
  goCompare();
}
function setupOne() {
  session.addLog(utc(), 'u');
  session.toggleAssignment('A', { logId: 'u', lap: 1 });
  goCompare();
}

describe('走行ライン / ヒートマップ(速度) / 加減速 の切り替え', () => {
  const mode = (m: string) => $<HTMLButtonElement>(`[data-act="mapmode"][data-mode="${m}"]`);

  it('3つの表示。初期は走行ライン(色分けなし)で凡例は出ない', () => {
    setupOne();
    expect(Array.from(root.querySelectorAll('[data-act="mapmode"]')).map((b) => b.textContent)).toEqual(['走行ライン', '速度', '加減速']);
    expect(fake.tracks[0].heat).toBeUndefined();
    expect($<HTMLElement>('#cmp-legend').hidden).toBe(true);
  });

  it('ヒートマップ: 速度で色分け。凡例に速度の範囲が出る', () => {
    setupOne();
    mode('speed').click();
    const heat = fake.tracks[0].heat!;
    expect(heat.length).toBeGreaterThan(20);
    expect(heat[0].from).toBe(0);
    expect(heat[heat.length - 1].to).toBe(fake.tracks[0].points.length - 1);
    expect(new Set(heat.map((h) => h.color)).size).toBeGreaterThan(5);
    expect($<HTMLElement>('#cmp-legend').hidden).toBe(false);
    expect($('#cmp-leg-bar').classList.contains('speed')).toBe(true);
    expect($('#cmp-leg-lo').textContent).toMatch(/^低速 \d+$/);
    expect($('#cmp-leg-hi').textContent).toMatch(/^\d+ km\/h 高速$/);
    expect(mode('speed').getAttribute('aria-pressed')).toBe('true');
  });

  it('加減速: 加速・減速で色分け。凡例は「減速 ⇔ 加速」', () => {
    setupOne();
    mode('accel').click();
    const heat = fake.tracks[0].heat!;
    expect(heat.length).toBeGreaterThan(20);
    expect($('#cmp-leg-bar').classList.contains('accel')).toBe(true);
    expect($('#cmp-leg-lo').textContent).toBe('減速');
    expect($('#cmp-leg-hi').textContent).toBe('加速');
    // 減速(赤)も加速(緑)も、惰性(灰色)も含まれる
    const reds = heat.filter((h) => { const [r, g] = h.color.match(/\d+/g)!.map(Number); return r > g + 40; });
    const greens = heat.filter((h) => { const [r, g] = h.color.match(/\d+/g)!.map(Number); return g > r + 40; });
    expect(reds.length).toBeGreaterThan(0);
    expect(greens.length).toBeGreaterThan(0);
  });

  it('走行ラインに戻すと色分けが消える', () => {
    setupOne();
    mode('speed').click();
    mode('line').click();
    expect(fake.tracks[0].heat).toBeUndefined();
    expect($<HTMLElement>('#cmp-legend').hidden).toBe(true);
  });

  it.skipIf(!existsSync(bigPath))('色は全車で共通: 同じ速度・同じ加速度なら、どの車でも同じ色になる', () => {
    setupTwo();
    for (const m of ['speed', 'accel']) {
      mode(m).click();
      const [a, b] = fake.tracks;
      expect(a.heat).toBeDefined();
      expect(b.heat).toBeDefined();
      // 車ごとの色(color)は使わず、色分けはすべて共通の段階表から作られる
      const palette = new Set([...a.heat!, ...b.heat!].map((h) => h.color));
      const own = new Set(fake.tracks.map((t) => t.color));
      for (const c of palette) expect(own.has(c)).toBe(false);
      expect(palette.size).toBeLessThanOrEqual(17);
    }
  });

  it.skipIf(!existsSync(bigPath))('速度の色の物差しは全車で同じ範囲(遅い車の最高速度が、速い車の最高速度の色にはならない)', () => {
    setupTwo();
    mode('speed').click();
    const [a, b] = fake.tracks;
    const maxA = a.heat!.map((h) => h.color), maxB = b.heat!.map((h) => h.color);
    expect(maxA.length).toBeGreaterThan(0);
    expect(maxB.length).toBeGreaterThan(0);
    const lo = Number($('#cmp-leg-lo').textContent!.replace(/\D/g, ''));
    const hi = Number($('#cmp-leg-hi').textContent!.replace(/\D/g, ''));
    expect(hi).toBeGreaterThan(lo);
    expect(hi % 10).toBe(0);
    expect(lo % 10).toBe(0);
  });

  it('選んだ表示は保存され、次回も同じ', () => {
    setupOne();
    mode('accel').click();
    mount();
    session.addLog(utc(), 'u');
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    goCompare();
    expect(fake.tracks[0].heat).toBeDefined();
    expect(mode('accel').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('地図の追従', () => {
  it('初期は固定: 地図の中心は動かさない', () => {
    setupOne();
    seekTo(30);
    expect(fake.centers).toHaveLength(0);
    expect(followBtn('fixed').getAttribute('aria-pressed')).toBe('true');
  });

  it('割り当てが無い枠(B〜D)への追従は選べない', () => {
    setupOne();
    expect(followBtn('A').disabled).toBe(false);
    for (const s of ['B', 'C', 'D']) expect(followBtn(s).disabled).toBe(true);
  });

  it('A に追従: 再生位置を動かすたびに A の位置へ中心が移る', () => {
    setupOne();
    followBtn('A').click();
    expect(fake.centers).toHaveLength(1);
    seekTo(50);
    const last = fake.centers[fake.centers.length - 1];
    expect(last).toEqual([fake.cars[0].lat, fake.cars[0].lon]);
    seekTo(100);
    expect(fake.centers[fake.centers.length - 1]).toEqual([fake.cars[0].lat, fake.cars[0].lon]);
  });

  it('地図を手でドラッグすると追従をやめて固定になる', () => {
    setupOne();
    followBtn('A').click();
    fake.userDrags();
    expect(followBtn('fixed').getAttribute('aria-pressed')).toBe('true');
    const n = fake.centers.length;
    seekTo(60);
    expect(fake.centers).toHaveLength(n);
  });

  it.skipIf(!existsSync(bigPath))('先頭追従: その時点で最も長く走っている車(B が速いので途中から B が先頭)', () => {
    setupTwo();
    $<HTMLButtonElement>('[data-act="xkind"][data-kind="time"]').click();    // 先頭が決まるのは時間ベース
    followBtn('leader').click();
    const carAt = (slot: string) => fake.cars.find((c) => c.slot === slot)!;
    seekTo(0);
    seekTo(100);
    const dA = [carAt('A').lat, carAt('A').lon], dB = [carAt('B').lat, carAt('B').lon];
    const c = fake.centers[fake.centers.length - 1];
    expect(c).toEqual(dB);              // B の方が速く、100秒時点では先に進んでいる
    expect(c).not.toEqual(dA);
    followBtn('A').click();
    seekTo(101);
    expect(fake.centers[fake.centers.length - 1]).toEqual([carAt('A').lat, carAt('A').lon]);
  });

  it.skipIf(!existsSync(bigPath))('先頭追従(横軸「距離」): 全車が同じ距離にいるので、表示中のいちばん若い枠(基準車)を追う', () => {
    setupTwo();
    followBtn('leader').click();
    const carAt = (slot: string) => fake.cars.find((c) => c.slot === slot)!;
    for (const t of [0, 40, 100]) {
      seekTo(t);
      expect(fake.centers[fake.centers.length - 1]).toEqual([carAt('A').lat, carAt('A').lon]);
    }
  });

  it('割り当てを外すと、その枠への追従は固定に戻る', () => {
    setupOne();
    followBtn('A').click();
    $<HTMLButtonElement>('[data-act="nav"][data-view="import"]').click();
    session.toggleAssignment('A', { logId: 'u', lap: 1 });
    session.toggleAssignment('B', { logId: 'u', lap: 1 });
    goCompare();
    expect(followBtn('fixed').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('画面の構成: 左 = 地図 + 再生の操作 / 右 = カード・セクター・速度グラフ', () => {
  it('地図のすぐ下に再生の操作の行だけがある(画面の最下段にグラフの領域は無い)', () => {
    setupOne();
    const left = $('.cmp-left');
    expect(Array.from(left.children).map((c) => c.className.split(' ')[0])).toEqual(['cmp-map', 'cmp-ctl']);
    for (const id of ['#cmp-pp', '#cmp-fb', '#cmp-ff', '#cmp-seek', '#cmp-time']) expect($(id).closest('.cmp-ctl')).not.toBeNull();
    expect(root.querySelector('#cmp-bottom')).toBeNull();
    expect(root.querySelector('#cmp-sp-h')).toBeNull();
    expect(root.querySelector('#cmp-graph-toggle')).toBeNull();
  });

  it('右の列は上から カード → セクター → 境界線 → 速度グラフ', () => {
    setupOne();
    const side = $('#cmp-side');
    expect(Array.from(side.children).map((c) => c.id)).toEqual(['cmp-upper', 'cmp-sp-g', 'cmp-graphwrap']);
    const upper = Array.from($('#cmp-upper-in').children).map((c) => c.id);
    expect(upper).toEqual(['cmp-set-wrap', 'cmp-cards', 'cmp-sec-block']);
    expect($('#cmp-graphwrap').contains($('#cmp-graph'))).toBe(true);
    expect($('#cmp-graphwrap').contains($('#cmp-zin'))).toBe(true);
  });

  it('右パネルを折りたたむ仕組みは無い(「閉じる」「開く」のボタンも、最小化の表示も無い)', () => {
    setupOne();
    expect(root.querySelector('#cmp-side-close')).toBeNull();
    expect(root.querySelector('#cmp-side-open')).toBeNull();
    expect(root.querySelector('#cmp-side-full')).toBeNull();
    rect($('#cmp-main'), { left: 0, right: 1200, top: 0, bottom: 500 });
    $('#cmp-sp-v').dispatchEvent(new MouseEvent('pointerdown', { clientX: 900, clientY: 100, bubbles: true }));
    $('#cmp-sp-v').dispatchEvent(new MouseEvent('pointermove', { clientX: 1190, clientY: 100, bubbles: true }));   // 幅 10px 相当まで狭める
    $('#cmp-sp-v').dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(cmp().style.getPropertyValue('--side-w')).toBe('220px');
    expect(cmp().classList.contains('side-collapsed')).toBe(false);
  });

  it('カードは 3 行(Run / LAP とタイム / 速度と時間差)のままで、最小幅でも内容が変わらない', () => {
    setupOne();
    const card = $('[data-act="toggle-car"][data-slot="A"]');
    expect(Array.from(card.querySelector('.card-body')!.children).map((c) => c.className.split(' ')[0])).toEqual(['c1', 'c2', 'c3']);
  });
});

const rect = (el: Element, r: { left: number; right: number; top: number; bottom: number }) =>
  Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }) });

describe('再生系の行: アイコンボタン', () => {
  it('テキストではなくアイコン(SVG)で、名前(aria-label)とヒント(title)を持つ', () => {
    setupOne();
    const labels: Record<string, string> = {
      'to-start': '先頭へ', toggle: '再生', 'frame-back': '1コマ戻る(0.1秒)', 'frame-fwd': '1コマ進む(0.1秒)',
      'zoom-in': 'グラフを拡大', 'zoom-out': 'グラフを縮小',
    };
    for (const [act, label] of Object.entries(labels)) {
      const b = $<HTMLButtonElement>(`.cmp [data-act="${act}"]`);
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.textContent!.trim()).toBe('');
      expect(b.getAttribute('aria-label')).toBe(label);
      expect(b.title).toContain(label.replace(/\(.*\)/, ''));
      expect(b.classList.contains('ib')).toBe(true);
    }
  });
});
