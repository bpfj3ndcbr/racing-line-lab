// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_LEFT, GRAPH_RIGHT, SpeedGraph, labelRows } from '../src/ui/speedGraph';
import { LONG_PRESS_SCROLL_EVENT } from '../src/ui/longPressScroll';

const X_MAX = 4700;
const series = (slot: 'A' | 'B', k: number) => {
  const n = 471;
  const x = Float64Array.from({ length: n }, (_, i) => (i / (n - 1)) * X_MAX);
  const y = Float64Array.from(x, (v) => 120 + 50 * Math.sin((v / 400) * k));
  return { slot, x, y };
};

let host: HTMLElement, seeks: number[], zooms: number[], g: SpeedGraph;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
  seeks = []; zooms = [];
  g = new SpeedGraph(host, (x) => seeks.push(x), (k) => zooms.push(k));
  g.setData([series('A', 1), series('B', 1.1)], 'dist', [{ label: 'S1', x: 100 }, { label: 'S2', x: 2400 }]);
  g.setCursor(2350, [{ slot: 'A', x: 2350, y: 130 }, { slot: 'B', x: 2380, y: 140 }]);
});

const ruler = () => host.querySelector<HTMLElement>('.g-ruler')!;
const thumb = () => host.querySelector<SVGRectElement>('.g-thumb')!;
const lines = () => host.querySelector<SVGGElement>('.g-lines')!;
const ticks = () => Array.from(host.querySelectorAll('.g-tick')).map((t) => t.textContent);
const pointer = (el: Element, type: string, clientX: number) => el.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));

describe('ズーム(再生位置が中心)', () => {
  it('初期は全体表示で、ルーラーは出ない', () => {
    expect(g.zoom).toBe(1);
    expect(ruler().hidden).toBe(true);
    expect(g.view()).toEqual({ start: 0, end: X_MAX });
  });

  it('拡大すると、再生位置(2350m)が表示範囲の中心になり、ルーラーが出る', () => {
    g.zoomIn();
    expect(g.zoom).toBe(2);
    expect(g.view().start).toBeCloseTo(1175, 6);
    expect(g.view().end).toBeCloseTo(3525, 6);
    expect(ruler().hidden).toBe(false);
    expect(zooms[zooms.length - 1]).toBe(2);
    g.zoomIn(); g.zoomIn(); g.zoomIn(); g.zoomIn();                 // 4, 8, 16, (16 のまま)
    expect(g.zoom).toBe(16);
    const v = g.view();
    expect((v.start + v.end) / 2).toBeCloseTo(2350, 6);
    expect(v.end - v.start).toBeCloseTo(X_MAX / 16, 6);
  });

  it('端の近くでも、拡大するとインジケータが中央(端では空白が見える)', () => {
    g.setCursor(100, []);
    g.zoomIn();
    const v = g.view();
    expect((v.start + v.end) / 2).toBeCloseTo(100, 6);
    g.setCursor(4650, []);
    const w = g.view();
    expect((w.start + w.end) / 2).toBeCloseTo(4650, 6);
  });

  it('縮小で全体に戻り、ルーラーも消える', () => {
    g.zoomIn(); g.zoomIn();
    g.zoomOut(); g.zoomOut(); g.zoomOut();
    expect(g.zoom).toBe(1);
    expect(g.view()).toEqual({ start: 0, end: X_MAX });
    expect(ruler().hidden).toBe(true);
    g.zoomIn(); g.resetZoom();
    expect(g.zoom).toBe(1);
  });

  it('線の太さは変えず(non-scaling-stroke)、横方向にだけ拡大する', () => {
    g.zoomIn();
    expect(lines().getAttribute('transform')).toMatch(/scale\(2,1\)/);
    expect(host.querySelector('.g-line')!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('横軸の目盛りが細かくなる(16倍: 約290m の範囲に 20m 刻み)', () => {
    expect(ticks()).toContain('1 km');
    for (let i = 0; i < 4; i++) g.zoomIn();
    expect(ticks()).toContain('2.3 km');
    expect(ticks()).not.toContain('1 km');
  });

  it('ズーム中のセクター位置は、範囲内のものだけ表示する', () => {
    expect(host.querySelectorAll('.g-mark')).toHaveLength(2);
    for (let i = 0; i < 4; i++) g.zoomIn();                          // 2203〜2497m
    expect(host.querySelectorAll('.g-mark')).toHaveLength(1);        // S2(2400m)だけ
    expect(host.querySelector('.g-marklabel')!.textContent).toBe('S2');
  });

  it('ホイールで拡大(上)・縮小(下)', () => {
    const svg = host.querySelector('svg.speed-graph')!;
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    expect(g.zoom).toBe(2);
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    expect(g.zoom).toBe(1);
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));     // 小さな動きは無視
    expect(g.zoom).toBe(1);
  });

  it('データを入れ替えると、ズームは全体に戻る', () => {
    g.zoomIn();
    g.setData([series('A', 1)], 'time');
    expect(g.zoom).toBe(1);
    expect(zooms[zooms.length - 1]).toBe(1);
  });

  it('ズーム中にグラフをクリックすると、見えている範囲の中での位置へ移動する', () => {
    g.zoomIn();                                                      // 1175〜3525
    const svg = host.querySelector('svg.speed-graph')!;
    const w = Number(svg.getAttribute('width'));
    const mid = GRAPH_LEFT + (w - GRAPH_LEFT - GRAPH_RIGHT) / 2;
    pointer(svg, 'pointerdown', mid);                                // プロットの中央
    pointer(svg, 'pointerup', mid);
    expect(seeks[seeks.length - 1]).toBeCloseTo(2350, 3);
    pointer(svg, 'pointerdown', GRAPH_LEFT);                         // 左端
    pointer(svg, 'pointerup', GRAPH_LEFT);
    expect(seeks[seeks.length - 1]).toBeCloseTo(1175, 3);
  });

  it('ズーム中にドラッグすると、グラフが指に付いて動く(再生位置が逆向きに動く)', () => {
    g.zoomIn();                                                      // 幅 2350m
    const svg = host.querySelector('svg.speed-graph')!;
    const plotW = Number(svg.getAttribute('width')) - GRAPH_LEFT - GRAPH_RIGHT;
    pointer(svg, 'pointerdown', 400);
    seeks.length = 0;
    pointer(svg, 'pointermove', 400 + plotW / 4);                    // 右へ 1/4 → 範囲の 1/4(587.5m)だけ手前へ
    expect(seeks[seeks.length - 1]).toBeCloseTo(2350 - 587.5, 3);
    pointer(svg, 'pointerup', 400 + plotW / 4);
    expect(seeks[seeks.length - 1]).toBeCloseTo(2350 - 587.5, 3);   // ドラッグ後のクリック扱いはしない
  });

  it('1× のときは、押した位置・ドラッグでインジケータが動く(グラフは動かない)', () => {
    const svg = host.querySelector('svg.speed-graph')!;
    const plotW = Number(svg.getAttribute('width')) - GRAPH_LEFT - GRAPH_RIGHT;
    pointer(svg, 'pointerdown', GRAPH_LEFT + plotW / 2);
    expect(seeks[seeks.length - 1]).toBeCloseTo(X_MAX / 2, 3);
    pointer(svg, 'pointermove', GRAPH_LEFT + plotW);
    expect(seeks[seeks.length - 1]).toBeCloseTo(X_MAX, 3);
    pointer(svg, 'pointerup', 0);
    expect(g.view()).toEqual({ start: 0, end: X_MAX });
  });
});

describe('ルーラー(表示範囲の移動 = 再生位置の移動)', () => {
  beforeEach(() => { g.zoomIn(); g.zoomIn(); });                      // 4倍: 幅 1175m、中心 2350 → 1762.5〜2937.5

  it('スクロールバーとして名前・値を持つ', () => {
    expect(thumb().getAttribute('role')).toBe('scrollbar');
    expect(thumb().getAttribute('aria-label')).toContain('表示範囲');
    expect(thumb().getAttribute('aria-valuetext')).toContain('km');
    expect(thumb().tabIndex).toBe(0);
  });

  it('矢印キーで 10% ずつ、Shift で半分ずつ、Home / End で端へ。いずれも再生位置を動かす', () => {
    const key = (k: string, shiftKey = false) =>
      thumb().dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
    key('ArrowRight');
    expect(seeks[seeks.length - 1]).toBeCloseTo(2350 + 117.5, 6);
    key('ArrowLeft', true);
    expect(seeks[seeks.length - 1]).toBeCloseTo(2350 - 587.5, 6);
    key('End');
    expect(seeks[seeks.length - 1]).toBeCloseTo(X_MAX - 587.5, 6);
    key('Home');
    expect(seeks[seeks.length - 1]).toBeCloseTo(587.5, 6);
  });

  it('帯をドラッグして前後に動かせる。帯の外を押すとそこへ寄る', () => {
    const rsvg = host.querySelector('svg.graph-ruler')!;
    const w = Number(rsvg.getAttribute('width'));
    const plotW = w - GRAPH_LEFT - GRAPH_RIGHT;
    const px = (x: number) => GRAPH_LEFT + (x / X_MAX) * plotW;
    const grabAt = px(g.view().start + 100);                          // 帯の中をつかむ
    pointer(rsvg, 'pointerdown', grabAt);
    expect(seeks[seeks.length - 1]).toBeCloseTo(2350, 0);
    pointer(rsvg, 'pointermove', grabAt + (500 / X_MAX) * plotW);     // 500m ぶん右へ
    expect(seeks[seeks.length - 1]).toBeCloseTo(2850, 0);
    pointer(rsvg, 'pointerup', 0);
    pointer(rsvg, 'pointerdown', px(4000));                           // 帯の外(右の方)を押す → そこが中心に
    expect(seeks[seeks.length - 1]).toBeCloseTo(4000, 0);
    pointer(rsvg, 'pointerup', 0);
    pointer(rsvg, 'pointerdown', px(100));                            // 端に近すぎるときは、範囲が全体からはみ出さない位置まで
    expect(seeks[seeks.length - 1]).toBeCloseTo(587.5, 0);
    pointer(rsvg, 'pointerup', 0);
  });

  it('再生位置は全体の範囲からはみ出さない', () => {
    g.panBy(-99999);
    expect(seeks[seeks.length - 1]).toBe(0);
    g.panBy(99999);
    expect(seeks[seeks.length - 1]).toBe(X_MAX);
  });
});

describe('ズーム中: インジケータは中央に固定され、グラフが動く', () => {
  beforeEach(() => { g.zoomIn(); g.zoomIn(); });                      // 1762.5〜2937.5

  it('再生位置が動くたびに、表示範囲がその位置を中心に移る', () => {
    for (const x of [2400, 2900, 3000, 100]) {
      g.setCursor(x, []);
      const v = g.view();
      expect((v.start + v.end) / 2).toBeCloseTo(x, 6);
    }
  });

  it('インジケータの線は常に同じ画面位置(プロットの中央)に描く', () => {
    const lineX = () => Number(host.querySelector('.g-cursor-line')!.getAttribute('x1'));
    g.setCursor(2400, [{ slot: 'A', x: 2400, y: 100 }]);
    const x0 = lineX();
    g.setCursor(3100, [{ slot: 'A', x: 3100, y: 100 }]);
    expect(lineX()).toBeCloseTo(x0, 6);
  });

  it('1× のときは逆に、表示範囲は動かずインジケータの線が動く', () => {
    g.resetZoom();
    const lineX = () => Number(host.querySelector('.g-cursor-line')!.getAttribute('x1'));
    const x0 = lineX();
    g.setCursor(3100, []);
    expect(lineX()).toBeGreaterThan(x0);
    expect(g.view()).toEqual({ start: 0, end: X_MAX });
  });

  it('中央から外れた車の点(別の車が先に行ったとき)は、プロットの外に出たら隠れる', () => {
    g.setCursor(2350, [{ slot: 'A', x: 2350, y: 100 }, { slot: 'B', x: 4500, y: 100 }]);
    expect(host.querySelector('.g-dot[data-slot="A"]')!.getAttribute('visibility')).toBe('visible');
    expect(host.querySelector('.g-dot[data-slot="B"]')!.getAttribute('visibility')).toBe('hidden');
  });

  it('ルーラーの印で、全体の中の位置が分かる', () => {
    expect(host.querySelector('.g-rtick')!.getAttribute('visibility')).toBe('visible');
  });
});

describe('ラベルの重なり回避', () => {
  it('重なるものは次の段へ、離れていれば同じ段', () => {
    expect(labelRows([{ px: 10, label: 'S1' }, { px: 14, label: 'S2' }, { px: 80, label: 'S3' }])).toEqual([0, 1, 0]);
  });
});

describe('非表示にした車は薄く表示する', () => {
  it('線と点に muted が付き、戻すと外れる(再描画しても保たれる)', () => {
    g.setMuted(new Set(['A']));
    expect(host.querySelector('.g-line[data-slot="A"]')!.classList.contains('muted')).toBe(true);
    expect(host.querySelector('.g-line[data-slot="B"]')!.classList.contains('muted')).toBe(false);
    expect(host.querySelector('.g-dot[data-slot="A"]')!.classList.contains('muted')).toBe(true);
    g.setCursor(2400, [{ slot: 'A', x: 2400, y: 130 }, { slot: 'B', x: 2400, y: 140 }]);
    expect(host.querySelector('.g-dot[data-slot="A"]')!.classList.contains('muted')).toBe(true);
    g.zoomIn();
    expect(host.querySelector('.g-line[data-slot="A"]')!.classList.contains('muted')).toBe(true);
    g.setMuted(new Set());
    expect(host.querySelector('.g-line[data-slot="A"]')!.classList.contains('muted')).toBe(false);
  });
});

describe('長押しで画面のスクロールになったとき(案件 44)', () => {
  it('触れた瞬間に動かした再生位置を、触れる前(2350m)に戻し、そのあとの指の動きでは動かさない', () => {
    const svg = host.querySelector('svg.speed-graph')!;
    pointer(svg, 'pointerdown', GRAPH_LEFT + 10);                     // 1× なので、触れた位置へ動く
    expect(seeks[seeks.length - 1]).toBeLessThan(1000);
    svg.dispatchEvent(new Event(LONG_PRESS_SCROLL_EVENT, { bubbles: true }));
    expect(seeks[seeks.length - 1]).toBe(2350);
    const n = seeks.length;
    pointer(svg, 'pointermove', GRAPH_LEFT + 200);
    expect(seeks).toHaveLength(n);
  });
});
