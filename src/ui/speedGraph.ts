import type { Slot } from '../core';

const NS = 'http://www.w3.org/2000/svg';
export const GRAPH_LEFT = 26, GRAPH_RIGHT = 8;
const LEFT = GRAPH_LEFT, RIGHT = GRAPH_RIGHT, TOP = 18, BOTTOM = 18;
const RULER_H = 24;
export const ZOOM_MAX = 16;

export type XKind = 'dist' | 'time';
export interface GraphSeries { slot: Slot; x: Float64Array; y: Float64Array }
export interface SectorMark { label: string; x: number }
export interface CursorDot { slot: Slot; x: number; y: number }

/** steps のうち、range をおよそ target 本以内の目盛りに収められる最小の間隔 */
export function pickStep(range: number, steps: number[], target = 6): number {
  return steps.find((s) => range / s <= target) ?? steps[steps.length - 1];
}
export const DIST_STEPS = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
export const TIME_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300];

/** 横に並ぶラベルが重ならないよう、重なるものは次の段(0/1)へ。px は左端、width は文字の幅の目安 */
export function labelRows(items: { px: number; label: string }[], charW = 6): number[] {
  const ends = [-Infinity, -Infinity];
  return items.map((it) => {
    const row = it.px >= ends[0] ? 0 : 1;
    ends[row] = it.px + it.label.length * charW + 4;
    return row;
  });
}

export const fmtDistTick = (m: number) =>
  m === 0 ? '0' : m >= 1000 ? `${+(m / 1000).toFixed(2)} km` : `${m} m`;
export const fmtTimeTick = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

let uid = 0;

/**
 * 速度グラフ(縦軸=速度、横軸=距離 or 時間)。
 * - グラフ上のクリック/ドラッグで再生位置を動かす(onSeek)
 * - ズーム: 現在の再生位置(インジケータ)を中心に 2 倍ずつ、最大 16 倍。ホイールでも操作できる
 * - ズーム中は下にルーラー(全体の中の表示範囲を示す帯)を出し、ドラッグ・キーで前後に移動できる
 * - 色は CSS クラス(.s-a など)で付けるので、テーマを切り替えても描き直さなくてよい
 */
export class SpeedGraph {
  private plot = document.createElement('div');
  private rulerHost = document.createElement('div');
  private svg = el('svg', { class: 'speed-graph', role: 'img', 'aria-label': '速度グラフ。ドラッグすると再生位置を動かせます' });
  private rulerSvg = el('svg', { class: 'graph-ruler' });
  private clipId = `gclip${++uid}`;
  private w = 960;
  private h = 220;
  private series: GraphSeries[] = [];
  private kind: XKind = 'dist';
  private marks: SectorMark[] = [];
  private xMax = 1;
  private yMax = 200;
  private yMin = 0;
  /** 設定の最高速度(null = 自動: 走行データに合わせる) */
  private yMaxFixed: number | null = null;
  /** 走行データの最高速度(km/h) */
  private dataTop = 0;
  private zoomK = 1;
  private viewStart = 0;
  private cursorX: number | null = null;
  private lastInside = true;
  private dotsData: CursorDot[] = [];
  private muted = new Set<Slot>();
  private axisG!: SVGGElement;
  private linesG!: SVGGElement;
  private cursorG!: SVGGElement;
  private cursorLine!: SVGLineElement;
  private handle!: SVGRectElement;
  private dotEls = new Map<Slot, SVGCircleElement>();
  private thumb!: SVGRectElement;
  private rtick!: SVGLineElement;
  private rmarks!: SVGGElement;
  private seeking = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartCursor = 0;
  private rulerDrag: { grab: number } | null = null;
  private wheelAcc = 0;
  private ro?: ResizeObserver;

  constructor(private host: HTMLElement, private onSeek: (x: number) => void, private onZoom: (k: number) => void = () => {}) {
    this.plot.className = 'g-plot';
    this.rulerHost.className = 'g-ruler';
    this.rulerHost.hidden = true;
    this.plot.appendChild(this.svg);
    this.rulerHost.appendChild(this.rulerSvg);
    host.append(this.plot, this.rulerHost);

    // グラフ上: 1× のときはインジケータが動く(押した位置へ、ドラッグで追従)。
    // 拡大中はインジケータが中央に固定され、ドラッグでグラフが動く(再生位置を前後させる)。クリックはその位置へ移動。
    this.svg.addEventListener('pointerdown', ((e: MouseEvent) => {
      this.seeking = true;
      this.dragMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartCursor = this.cursorX ?? this.viewStart + this.span / 2;
      try { this.svg.setPointerCapture((e as PointerEvent).pointerId); } catch { /* 無視 */ }
      if (this.zoomK === 1) this.seekFrom(e.clientX);
    }) as EventListener);
    this.svg.addEventListener('pointermove', ((e: MouseEvent) => {
      if (!this.seeking) return;
      if (this.zoomK === 1) { this.seekFrom(e.clientX); return; }
      const dx = e.clientX - this.dragStartX;
      if (!this.dragMoved && Math.abs(dx) < 3) return;
      this.dragMoved = true;
      const pxPerUnit = this.svgPx(this.svg, e.clientX) - this.svgPx(this.svg, this.dragStartX);
      this.seekTo(this.dragStartCursor - (pxPerUnit / this.plotW) * this.span);
    }) as EventListener);
    const up = (e: Event) => {
      if (this.seeking && this.zoomK > 1 && !this.dragMoved && e.type === 'pointerup') this.seekFrom((e as MouseEvent).clientX);
      this.seeking = false;
    };
    this.svg.addEventListener('pointerup', up);
    this.svg.addEventListener('pointercancel', up);
    // ホイール: 再生位置を中心にズーム
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelAcc += e.deltaY;
      if (Math.abs(this.wheelAcc) < 50) return;
      if (this.wheelAcc < 0) this.zoomIn(); else this.zoomOut();
      this.wheelAcc = 0;
    }, { passive: false });

    // ルーラー: 表示範囲の移動
    this.rulerSvg.addEventListener('pointerdown', ((e: MouseEvent) => {
      try { this.rulerSvg.setPointerCapture((e as PointerEvent).pointerId); } catch { /* 無視 */ }
      const px = this.rulerPx(e.clientX);
      const thumbX = this.bx(this.clampStart(this.viewStart)), thumbW = this.plotW / this.zoomK;
      const onThumb = px >= thumbX && px <= thumbX + thumbW;
      this.rulerDrag = { grab: onThumb ? px - thumbX : thumbW / 2 };   // 帯の外を押したら、そこへ表示範囲を寄せる
      this.moveThumbTo(px - this.rulerDrag.grab);
    }) as EventListener);
    this.rulerSvg.addEventListener('pointermove', ((e: MouseEvent) => {
      if (this.rulerDrag) this.moveThumbTo(this.rulerPx(e.clientX) - this.rulerDrag.grab);
    }) as EventListener);
    const rup = () => { this.rulerDrag = null; };
    this.rulerSvg.addEventListener('pointerup', rup);
    this.rulerSvg.addEventListener('pointercancel', rup);

    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.plot);
    }
    this.draw();
  }

  get element(): SVGSVGElement { return this.svg; }
  get zoom(): number { return this.zoomK; }
  /** いま表示している範囲(横軸の値) */
  view(): { start: number; end: number } { return { start: this.viewStart, end: this.viewStart + this.span }; }

  /**
   * keepView = true のときは、ズームの倍率と表示位置を保ったまま、データだけ入れ替える
   * (セクターボタンで時間のずれが変わったときなど)。false なら全体表示に戻す。
   */
  setData(series: GraphSeries[], kind: XKind, marks: SectorMark[] = [], keepView = false): void {
    this.series = series; this.kind = kind; this.marks = marks;
    this.xMax = Math.max(1e-6, ...series.map((s) => (s.x.length ? s.x[s.x.length - 1] : 0)));
    this.dataTop = Math.max(0, ...series.map((s) => s.y.reduce((m, v) => Math.max(m, v), 0)));
    this.yMax = this.autoYMax();
    if (keepView) {
      this.recenter();
    } else {
      this.zoomK = 1; this.viewStart = 0; this.lastInside = true;
      this.onZoom(1);
    }
    this.draw();
  }

  /**
   * 縦軸の範囲(km/h)。設定タブの「速度レンジ」。max = null なら、上限は走行データに合わせて自動。
   * 範囲の外の速度は、グラフの上下の端で切れる
   */
  setYRange(min: number, max: number | null): void {
    const lo = Math.max(0, min);
    const hi = max !== null && max > lo ? max : null;
    if (lo === this.yMin && hi === this.yMaxFixed) return;
    this.yMin = lo; this.yMaxFixed = hi;
    this.yMax = this.autoYMax();
    this.draw();
  }
  /** 縦軸の上限: 設定の最高速度、自動なら走行データの最高速度を 50 km/h 単位で切り上げ(最低速度 + 50 以上) */
  private autoYMax(): number {
    return this.yMaxFixed ?? Math.max(50, Math.ceil(this.dataTop / 50) * 50, this.yMin + 50);
  }

  /** ズーム中なら、表示範囲を再生位置の中心へ移す(倍率はそのまま) */
  centerOnCursor(): void {
    if (this.zoomK <= 1 || this.cursorX === null) return;
    this.recenter();
    this.applyView();
  }

  /** 非表示にした車は、線と点を薄く表示する */
  setMuted(slots: Set<Slot>): void {
    this.muted = new Set(slots);
    this.applyMuted();
  }

  setCursor(x: number | null, dots: CursorDot[]): void {
    this.cursorX = x; this.dotsData = dots;
    // 拡大中はインジケータを中央に固定し、グラフのほうを動かす
    if (x !== null && this.zoomK > 1) { this.viewStart = x - this.span / 2; this.applyView(); return; }
    this.drawCursor();
    this.updateRuler();
  }

  /** 再生位置を中心にズーム(2 倍ずつ) */
  zoomIn(): void { this.zoomTo(this.zoomK * 2); }
  zoomOut(): void { this.zoomTo(this.zoomK / 2); }
  resetZoom(): void { this.zoomTo(1); }

  /** 表示範囲を delta(横軸の値)だけ動かす */
  panBy(delta: number): void {
    if (this.zoomK > 1 && this.cursorX !== null) this.seekTo(this.cursorX + delta);   // 拡大中は再生位置を動かす(=グラフが動く)
    else this.setViewStart(this.viewStart + delta);
  }

  resize(): void {
    const w = this.plot.clientWidth, h = this.plot.clientHeight;
    if ((w && w !== this.w) || (h && h !== this.h)) this.draw();
  }

  destroy(): void { this.ro?.disconnect(); this.plot.remove(); this.rulerHost.remove(); }

  // ---------- 座標 ----------
  private get span() { return this.xMax / this.zoomK; }
  private get plotW() { return Math.max(10, this.w - LEFT - RIGHT); }
  private get plotH() { return Math.max(10, this.h - TOP - BOTTOM); }
  /** 全体表示での x 座標(線はこの座標で一度だけ作り、ズームは変換で表す) */
  private bx = (x: number) => LEFT + (x / this.xMax) * this.plotW;
  private sx = (x: number) => LEFT + ((x - this.viewStart) / this.span) * this.plotW;
  private sy = (y: number) => TOP + this.plotH - ((y - this.yMin) / (this.yMax - this.yMin)) * this.plotH;
  private clampStart(s: number) { return Math.min(Math.max(s, 0), Math.max(0, this.xMax - this.span)); }
  /** 拡大中は再生位置が中央になる位置(端では空白が見える)。1× は全体 */
  private recenter() {
    this.viewStart = this.zoomK > 1 && this.cursorX !== null ? this.cursorX - this.span / 2 : this.clampStart(this.viewStart);
    this.lastInside = true;
  }
  private seekTo(x: number) { this.onSeek(Math.min(Math.max(x, 0), this.xMax)); }
  private inView(x: number) { return x >= this.viewStart - 1e-9 && x <= this.viewStart + this.span + 1e-9; }

  private zoomTo(k: number) {
    const next = Math.min(ZOOM_MAX, Math.max(1, k));
    if (next === this.zoomK) return;
    const center = this.cursorX ?? this.viewStart + this.span / 2;
    this.zoomK = next;
    this.viewStart = next === 1 ? 0 : center - this.span / 2;
    this.lastInside = true;
    this.applyView();
    this.onZoom(next);
  }

  private setViewStart(s: number) {
    this.viewStart = this.clampStart(s);
    this.lastInside = this.cursorX === null || this.inView(this.cursorX);
    this.applyView();
  }

  private svgPx(svg: SVGSVGElement, clientX: number) {
    const r = svg.getBoundingClientRect();
    return (clientX - r.left) * (r.width ? this.w / r.width : 1);
  }
  private rulerPx(clientX: number) { return this.svgPx(this.rulerSvg, clientX); }

  private seekFrom(clientX: number) {
    const f = Math.min(1, Math.max(0, (this.svgPx(this.svg, clientX) - LEFT) / this.plotW));
    this.seekTo(this.viewStart + f * this.span);
  }

  /** 表示範囲の左端を start にする。拡大中は、その範囲の中心へ再生位置を移す */
  private moveViewTo(start: number) {
    if (this.zoomK > 1) this.seekTo(Math.min(Math.max(start, 0), this.xMax - this.span) + this.span / 2);
    else this.setViewStart(start);
  }

  /** ルーラーの帯を動かす: 拡大中は、帯の中心の位置へ再生位置を移す */
  private moveThumbTo(px: number) {
    this.moveViewTo(((px - LEFT) / this.plotW) * this.xMax);
  }

  // ---------- 描画 ----------
  private draw() {
    this.w = this.plot.clientWidth || this.host.clientWidth || this.w;
    this.h = this.plot.clientHeight || this.h;
    const s = this.svg;
    s.replaceChildren();
    s.setAttribute('width', String(this.w));
    s.setAttribute('height', String(this.h));
    s.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);

    const clip = el('clipPath', { id: this.clipId });
    clip.appendChild(el('rect', { x: LEFT, y: TOP - 6, width: this.plotW, height: this.plotH + 6 }));
    s.appendChild(el('defs')).appendChild(clip);

    // 縦軸(速度)
    // 目盛りの間隔は、表示する範囲の幅で決める(狭い範囲でも目盛りが出るように)
    const span = this.yMax - this.yMin;
    const ystep = span > 100 ? (this.plotH < 130 ? 100 : 50) : span > 50 ? (this.plotH < 110 ? 50 : 25)
      : span > 20 ? (this.plotH < 110 ? 25 : 10) : 5;
    for (let v = Math.ceil(this.yMin / ystep) * ystep; v <= this.yMax; v += ystep) {
      s.appendChild(el('line', { class: 'g-grid', x1: LEFT, x2: this.w - RIGHT, y1: this.sy(v), y2: this.sy(v) }));
      const t = el('text', { class: 'g-tick', x: LEFT - 3, y: this.sy(v) + 3, 'text-anchor': 'end' });
      t.textContent = String(v);
      s.appendChild(t);
    }
    const unit = el('text', { class: 'g-unit', x: 2, y: 9 });
    unit.textContent = 'km/h';
    s.appendChild(unit);

    this.axisG = el('g');
    s.appendChild(this.axisG);

    // 速度の線(全体の座標で一度だけ作る。ズームは線の太さを変えない変換で表す)
    const clipped = el('g', { 'clip-path': `url(#${this.clipId})` });
    this.linesG = el('g', { class: 'g-lines' });
    for (const ser of this.series) {
      let d = '';
      for (let i = 0; i < ser.x.length; i++) d += `${i ? 'L' : 'M'}${this.bx(ser.x[i]).toFixed(1)},${this.sy(ser.y[i]).toFixed(1)}`;
      this.linesG.appendChild(el('path', { class: `g-line s-${ser.slot.toLowerCase()}`, 'data-slot': ser.slot, d, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));
    }
    clipped.appendChild(this.linesG);
    s.appendChild(clipped);

    // 現在位置(線・つまみ・各車の点)
    this.cursorG = el('g', { class: 'g-cursor' });
    this.cursorLine = el('line', { class: 'g-cursor-line', y1: TOP - 4, y2: TOP + this.plotH });
    this.handle = el('rect', { class: 'g-handle', width: 10, height: 8, rx: 2, y: TOP + this.plotH - 8 });
    this.cursorG.append(this.cursorLine, this.handle);
    s.appendChild(this.cursorG);
    this.dotEls.clear();

    this.buildRuler();
    this.applyView();
    this.applyMuted();
  }

  private buildRuler() {
    const r = this.rulerSvg;
    r.replaceChildren();
    r.setAttribute('width', String(this.w));
    r.setAttribute('height', String(RULER_H));
    r.setAttribute('viewBox', `0 0 ${this.w} ${RULER_H}`);
    r.appendChild(el('rect', { class: 'g-rtrack', x: LEFT, y: 7, width: this.plotW, height: 10, rx: 2 }));
    this.rmarks = el('g');
    for (const m of this.marks) {
      this.rmarks.appendChild(el('line', { class: 'g-rmark', x1: this.bx(m.x), x2: this.bx(m.x), y1: 5, y2: 19 }));
    }
    r.appendChild(this.rmarks);
    this.rtick = el('line', { class: 'g-rtick', y1: 3, y2: 21 });
    r.appendChild(this.rtick);
    this.thumb = el('rect', {
      class: 'g-thumb', y: 4, height: 16, rx: 2, tabindex: 0, role: 'scrollbar',
      'aria-orientation': 'horizontal', 'aria-label': '速度グラフの表示範囲(左右キーで移動)',
      'aria-valuemin': 0, 'aria-valuemax': 100,
    });
    this.thumb.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      const step = this.span * (ev.shiftKey ? 0.5 : 0.1);
      if (ev.key === 'ArrowLeft') this.panBy(-step);
      else if (ev.key === 'ArrowRight') this.panBy(step);
      else if (ev.key === 'PageUp') this.panBy(-this.span);
      else if (ev.key === 'PageDown') this.panBy(this.span);
      else if (ev.key === 'Home') this.moveViewTo(0);
      else if (ev.key === 'End') this.moveViewTo(this.xMax);
      else return;
      ev.preventDefault();
    });
    r.appendChild(this.thumb);
  }

  /** ズーム・移動のたびに更新するもの(線の変換・横軸の目盛り・現在位置・ルーラー) */
  private applyView() {
    const k = this.zoomK;
    const tx = LEFT * (1 - k) - (this.viewStart * k * this.plotW) / this.xMax;
    this.linesG.setAttribute('transform', `translate(${tx},0) scale(${k},1)`);
    this.renderAxis();
    this.rulerHost.hidden = k === 1;
    this.host.classList.toggle('zoomed', k > 1);
    this.drawCursor();
    this.updateRuler();
  }

  private renderAxis() {
    const g = this.axisG;
    g.replaceChildren();
    const steps = this.kind === 'dist' ? DIST_STEPS : TIME_STEPS;
    const step = pickStep(this.span, steps, Math.max(2, Math.floor(this.plotW / 46)));
    const end = Math.min(this.viewStart + this.span, this.xMax);
    const first = Math.max(0, Math.ceil(this.viewStart / step - 1e-9) * step);
    for (let v = first; v <= end + 1e-9; v += step) {
      const t = el('text', { class: 'g-tick', x: this.sx(v), y: this.h - 6, 'text-anchor': v === 0 ? 'start' : 'middle' });
      t.textContent = this.kind === 'dist' ? fmtDistTick(v) : fmtTimeTick(v);
      g.appendChild(t);
    }
    // セクターの線とラベル(重なるラベルは 2 段にずらす)
    const vis = this.marks.filter((m) => this.inView(m.x));
    const rows = labelRows(vis.map((m) => ({ px: this.sx(m.x) + 2, label: m.label })), 6);
    vis.forEach((m, i) => {
      g.appendChild(el('line', { class: 'g-mark', x1: this.sx(m.x), x2: this.sx(m.x), y1: TOP - 4, y2: TOP + this.plotH }));
      const t = el('text', { class: 'g-marklabel', x: this.sx(m.x) + 2, y: rows[i] ? TOP - 12 : TOP - 4 });
      t.textContent = m.label;
      g.appendChild(t);
    });
  }

  private drawCursor() {
    if (!this.cursorG) return;
    const g = this.cursorG;
    if (this.cursorX === null || !this.inView(this.cursorX)) { g.setAttribute('visibility', 'hidden'); return; }
    g.setAttribute('visibility', 'visible');
    const x = this.sx(this.cursorX);
    this.cursorLine.setAttribute('x1', String(x));
    this.cursorLine.setAttribute('x2', String(x));
    this.handle.setAttribute('x', String(x - 5));
    const live = new Set(this.dotsData.map((d) => d.slot));
    for (const [slot, c] of this.dotEls) if (!live.has(slot)) { c.remove(); this.dotEls.delete(slot); }
    for (const d of this.dotsData) {
      let c = this.dotEls.get(d.slot);
      if (!c) { c = el('circle', { class: `g-dot s-${d.slot.toLowerCase()}`, 'data-slot': d.slot, r: 3.5 }); g.appendChild(c); this.dotEls.set(d.slot, c); }
      const cx = this.sx(Math.min(d.x, this.xMax));
      c.setAttribute('visibility', cx < LEFT - 1 || cx > LEFT + this.plotW + 1 ? 'hidden' : 'visible');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(this.sy(d.y)));
      c.classList.toggle('muted', this.muted.has(d.slot));
    }
  }

  private updateRuler() {
    if (!this.thumb) return;
    this.thumb.setAttribute('x', String(this.bx(this.clampStart(this.viewStart))));
    this.thumb.setAttribute('width', String(this.plotW / this.zoomK));
    const room = this.xMax - this.span;
    this.thumb.setAttribute('aria-valuenow', String(room > 0 ? Math.round((this.clampStart(this.viewStart) / room) * 100) : 0));
    const f = (v: number) => (this.kind === 'dist' ? fmtDistTick(Math.round(v)) : fmtTimeTick(v));
    this.thumb.setAttribute('aria-valuetext', `表示範囲 ${f(this.viewStart)} から ${f(this.viewStart + this.span)}`);
    this.rtick.setAttribute('visibility', this.cursorX === null ? 'hidden' : 'visible');
    if (this.cursorX !== null) {
      const x = this.bx(Math.min(this.cursorX, this.xMax));
      this.rtick.setAttribute('x1', String(x));
      this.rtick.setAttribute('x2', String(x));
    }
  }

  private applyMuted() {
    this.svg.querySelectorAll('.g-line, .g-dot').forEach((n) => {
      n.classList.toggle('muted', this.muted.has(n.getAttribute('data-slot') as Slot));
    });
  }
}
