import {
  type HeatRun as CoreRun, type Lap, type LapSeries, PlaybackEngine, SLOTS, type Slot,
  accelSeries, alignedSeries, buildLapSeries, pickRuler, formatLapTime, heatColor, heatRuns, sampleSeries, speedColor, speedRange, speedRuns, timeAtDistance,
} from '../core';
import type { LoadedLog, Session } from '../store/session';
import { Prefs, RATE_CHOICES, ZOOM_CHOICES, type LabelV, type PrefKey } from '../store/prefs';
import { SpeedGraph, ZOOM_MAX, type XKind } from './speedGraph';
import { clamp, makeSplitter } from './splitter';
import type { HeatRun, MapFactory, TrackMap } from './mapTypes';
import type { ThemeController } from './theme';

/**
 * series: ラップの時系列(距離は速度の積み上げ)。
 * track: 距離を、物差しの車の走行ラインに投影した距離に置き換えたもの。横軸「距離」で使う(コース上の同じ位置が同じ距離になる)
 */
interface Car { slot: Slot; log: LoadedLog; lap: Lap; series: LapSeries; track: LapSeries; accel: HeatRun[]; speed: HeatRun[] }
/** line = 車ごとの色の線 / speed = 速度のヒートマップ / accel = 加速・減速のマップ */
type MapMode = 'line' | 'speed' | 'accel';
type Follow = 'fixed' | 'leader' | Slot;
type SyncMode = 'leader' | 'all';

export interface CompareDeps {
  mapFactory: MapFactory;
  theme?: ThemeController;
  /** 割り当てが無いときの「データ管理画面へ」 */
  onBack: () => void;
  /** 「サーキットを編集…」(セクターの追加など)。編集が終わると、比較に戻る */
  onEditCircuit?: (circuitId: string) => void;
}
export interface CompareView {
  show(): void; hide(): void; readonly engine: PlaybackEngine;
  /** 設定タブで初期値が変わったとき、その項目を比較画面にも反映する(「記憶する」項目は何もしない) */
  applyPref(key: PrefKey | 'yRange' | 'startPos' | 'autoLoad'): void;
}

const RATES = RATE_CHOICES;
const LABEL_TEXT: Record<LabelV, string> = { off: '非表示', speed: '速度・差', name: 'カード名' };

// 再生系ボタンのアイコン(16x16)
const ICONS = {
  start: '<path d="M2.5 2.5v11M8 3L3.5 8 8 13zM13.5 3L9 8l4.5 5z"/>',
  play: '<path d="M4 2l10 6-10 6z"/>',
  pause: '<path d="M4 2h3v12H4zM9 2h3v12H9z"/>',
  back: '<path d="M12.5 2.5v11M10 3L3.5 8 10 13z"/>',
  fwd: '<path d="M3.5 2.5v11M6 3l6.5 5L6 13z"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.5" fill="none"/><path d="M10.5 10.5L14 14M5 7h4M7 5v4" fill="none"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.5" fill="none"/><path d="M10.5 10.5L14 14M5 7h4" fill="none"/>',
};
const icon = (p: string) =>
  `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${p}</svg>`;

// 画面の分割(サイズの上限・下限など)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LAYOUT_VERSION = 1;
interface Layout { v: number; sideW: number; graphH: number }
const DEFAULT_LAYOUT: Layout = { v: LAYOUT_VERSION, sideW: 300, graphH: 300 };
/** 右パネルの幅の範囲(最小 220px はこれ以上狭められない) */
const SIDE_MIN = 220, SIDE_MAX = 560, MAP_MIN_W = 240;
/** 速度グラフの高さの下限(これより低いと文字が読めない)、境界線の太さ、上の部分の高さが測れないときの値 */
const GRAPH_MIN_H = 170, SPLITTER_H = 6, UPPER_FALLBACK_H = 400;
const EASE_MS = 400;

/** 比較画面: 地図 + 速度グラフ + 再生。セクター同期は段階5。 */
export function mountCompareView(root: HTMLElement, session: Session, deps: CompareDeps): CompareView {
  root.innerHTML = `
    <div class="cmp">
      <div class="cmp-main" id="cmp-main">
        <div class="cmp-left">
          <div class="cmp-map">
            <div class="map" id="cmp-map"></div>
            <div class="map-ov tl">
              <span class="seg sm" role="group" aria-label="地図の表示位置">
                <button data-act="follow" data-follow="fixed" aria-pressed="true" class="on">固定</button>
                <button data-act="follow" data-follow="leader" aria-pressed="false">先頭追従</button>
                ${SLOTS.map((s) => `<button data-act="follow" data-follow="${s}" aria-pressed="false">${s}</button>`).join('')}
              </span>
            </div>
            <div class="map-ov tr">
              <span class="seg sm" role="group" aria-label="走行ラインの表示">
                <button data-act="mapmode" data-mode="line" aria-pressed="true" class="on">走行ライン</button>
                <button data-act="mapmode" data-mode="speed" aria-pressed="false" title="速度で色分け(全車共通の色)">速度</button>
                <button data-act="mapmode" data-mode="accel" aria-pressed="false" title="加速・減速で色分け(全車共通の色)">加減速</button>
              </span>
              <span class="seg sm" role="group" aria-label="車の数値の表示">
                <button data-act="carlabel" id="cmp-carlabel" aria-pressed="false" title="車から引き出す線の表示を切り替えます(非表示 → 速度・差 → カード名)">ラベル: 非表示</button>
              </span>
            </div>
            <div class="map-legend" id="cmp-legend" hidden>
              <span id="cmp-leg-lo"></span><i class="legend-bar" id="cmp-leg-bar" aria-hidden="true"></i><span id="cmp-leg-hi"></span>
            </div>
          </div>
          <div class="cmp-ctl" id="cmp-ctl">
            <button class="ib" data-act="to-start" aria-label="先頭へ" title="先頭へ">${icon(ICONS.start)}</button>
            <button class="ib" id="cmp-fb" data-act="frame-back" aria-label="1コマ戻る(0.1秒)" title="1コマ戻る [←](一時停止中のみ)  1秒戻る [Shift+←]">${icon(ICONS.back)}</button>
            <button class="ib pri" id="cmp-pp" data-act="toggle" data-state="paused" aria-label="再生" title="再生 [Space]">${icon(ICONS.play)}</button>
            <button class="ib" id="cmp-ff" data-act="frame-fwd" aria-label="1コマ進む(0.1秒)" title="1コマ進む [→](一時停止中のみ)  1秒進む [Shift+→]">${icon(ICONS.fwd)}</button>
            <span class="seg sm" role="group" aria-label="再生速度">${RATES.map((r) =>
              `<button data-act="rate" data-rate="${r}" aria-pressed="${r === 1}" class="${r === 1 ? 'on' : ''}">${r}x</button>`).join('')}</span>
            <span class="num cmp-time" id="cmp-time">0:00.0 / 0:00.0</span>
            <input id="cmp-seek" class="cmp-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="再生位置(秒)">
          </div>
        </div>
        <div class="splitter v" id="cmp-sp-v" role="separator" aria-orientation="vertical" tabindex="0"
          aria-label="地図と右パネルの境界(ドラッグで幅を変更)"
          title="ドラッグで幅を変更 / ダブルクリックで元に戻す"></div>
        <aside class="cmp-side" id="cmp-side" aria-label="走行データ">
          <div class="side-upper" id="cmp-upper">
            <div class="side-upper-in" id="cmp-upper-in">
              <label class="sel cmp-set" id="cmp-set-wrap">表示中 <select id="cmp-set" data-fk="cmp-set"></select></label>
              <div id="cmp-cards" class="cmp-cards"></div>
              <div class="sec-block" id="cmp-sec-block">
                <div class="h sec-h-row" id="cmp-sec-h"><span>セクター</span><button class="btn xs" id="cmp-edit-circuit" data-act="edit-circuit" hidden title="このサーキットのセクターを追加・編集します(終わったら比較に戻ります)">セクターを追加・編集…</button></div>
                <div id="cmp-sync" class="sync-grp">
                  <span class="seg sm" role="group" aria-label="セクターボタンの動作">
                    <button data-act="syncmode" data-mode="leader" aria-pressed="false">先頭車両</button>
                    <button data-act="syncmode" data-mode="all" aria-pressed="true" class="on">全車一致</button>
                    <button id="cmp-sync-release" data-act="sync-release" disabled title="選んでいるセクターを解除して、通常の表示に戻します">解除</button>
                  </span>
                </div>
                <div id="cmp-sectors" class="secs"></div>
                <div id="cmp-sync-status" class="sub sync-status" role="status" hidden>
                  <span id="cmp-sync-text"></span>
                </div>
              </div>
            </div>
          </div>
          <div class="splitter h" id="cmp-sp-g" role="separator" aria-orientation="horizontal" tabindex="0"
            aria-label="セクターと速度グラフの境界(ドラッグで高さを変更)" title="ドラッグで高さを変更 / ダブルクリックで元に戻す"></div>
          <div class="side-graph" id="cmp-graphwrap">
            <div class="graph-bar">
              <span class="seg sm" role="group" aria-label="横軸">
                <button data-act="xkind" data-kind="dist" aria-pressed="true" class="on">距離</button>
                <button data-act="xkind" data-kind="time" aria-pressed="false">時間</button>
              </span>
              <span class="zoom-grp" role="group" aria-label="速度グラフのズーム(再生位置が中心)">
                <button class="btn xs" id="cmp-zreset" data-act="zoom-reset" hidden title="全体を表示">全体</button>
                <button class="ib" id="cmp-zout" data-act="zoom-out" aria-label="グラフを縮小" title="グラフを縮小(再生位置が中心)" disabled>${icon(ICONS.zoomOut)}</button>
                <span class="num cmp-zoom" id="cmp-zoom" aria-live="polite">×1</span>
                <button class="ib" id="cmp-zin" data-act="zoom-in" aria-label="グラフを拡大" title="グラフを拡大(再生位置が中心)">${icon(ICONS.zoomIn)}</button>
              </span>
            </div>
            <div id="cmp-graph" class="graph-host"></div>
          </div>
        </aside>
      </div>
      <div class="cmp-empty" id="cmp-empty" hidden>
        <p>A〜D にラップが割り当てられていません。</p>
        <button class="btn pri" data-act="back">データ管理画面へ</button>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const engine = new PlaybackEngine();
  let cars: Car[] = [];
  let range = { lo: 0, hi: 100 };             // 速度ヒートマップの色の範囲(全車共通)
  const hidden = new Set<Slot>();             // 地図で非表示にしている車
  let sig = '';
  const prefs = new Prefs(session);
  let xKind: XKind = prefs.initial('xKind');
  let mapMode: MapMode = prefs.initial('mapMode');
  let aliasSig = '';
  let labelMode: LabelV = prefs.initial('labels');   // 車の引き出し線: 出さない / 速度・タイム差 / カード名
  let follow: Follow = prefs.initial('follow');
  // セクターボタンの動作(先頭車両 / 全車一致)と、全車一致で作った「車ごとの時間のずれ」
  let syncMode: SyncMode = prefs.initial('sync');
  let off = new Map<Slot, number>();          // 各車の「再生時刻に足すずれ(秒、0 以下)」。ラップ内の時刻 = 再生時刻 + ずれ
  let anchor: { k: number; t: Map<Slot, number>; d: Map<Slot, number> } | null = null;   // 全車一致の基準(セクター k)
  let syncMsg = '';
  let activeSector: number | null = null;      // 選んでいるセクター(どちらの動作でも)
  let map: TrackMap | null = null;
  let visible = false;
  let raf = 0;
  let last = 0;
  let lastPlaying: boolean | null = null;
  // 追従カメラ(先頭車両が入れ替わったときだけ、短く滑らかに移動する)
  let followSlot: Slot | null = null;
  let camera: { lat: number; lon: number } | null = null;
  let ease: { from: { lat: number; lon: number }; start: number } | null = null;

  const ref = () => cars[0];
  const offOf = (c: Car) => off.get(c.slot) ?? 0;
  /** 再生時刻 tau のときの、その車のラップ内の時刻(範囲の外は端に張り付く) */
  /** 横軸に合わせた時系列: 距離のときは、物差しに投影した距離のもの */
  const sv = (c: Car) => (xKind === 'dist' ? c.track : c.series);
  const localOf = (c: Car, tau: number) => Math.min(Math.max(tau + offOf(c), 0), c.series.duration);
  /** 全体の長さ: 最後の車が走り終えるまで */
  const totalDuration = () => xKind === 'dist' && ref()
    ? Math.max(0, ref().series.duration - offOf(ref()))      // 距離ベース: 基準の車が走り終えるまで(他の車は、基準の車と同じ距離の位置に出る)
    : Math.max(0, ...cars.map((c) => c.series.duration - offOf(c)));
  const shown = () => cars.filter((c) => !hidden.has(c.slot));
  const cssColor = (slot: Slot) =>
    getComputedStyle(document.documentElement).getPropertyValue('--' + slot.toLowerCase()).trim() || '#888';
  const setPressed = (sel: string, match: (b: HTMLElement) => boolean) =>
    root.querySelectorAll<HTMLElement>(sel).forEach((b) => {
      const on = match(b);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

  // ---------- 画面の分割 ----------
  const stored = session.getSetting<Partial<Layout>>('compare.layout', {});
  const okStored = stored.v === LAYOUT_VERSION;       // 保存の形式が変わったときは、版を上げて初期値に戻す
  const layout: Layout = {
    v: LAYOUT_VERSION,
    sideW: okStored && typeof stored.sideW === 'number' ? stored.sideW : DEFAULT_LAYOUT.sideW,
    graphH: okStored && typeof stored.graphH === 'number' ? stored.graphH : DEFAULT_LAYOUT.graphH,
  };
  const cmpEl = root.querySelector<HTMLElement>('.cmp')!;
  const mainW = () => $('cmp-main').clientWidth || 1280;
  const sideMax = () => Math.min(SIDE_MAX, mainW() - MAP_MIN_W);
  /** 右の列の高さ(境界線を除いた、上の部分とグラフを合わせた高さ) */
  const columnH = () => $('cmp-side').clientHeight || 800;
  /** 上の部分(カード・セクター)が全部収まるのに必要な高さ */
  const upperNeed = () => $('cmp-upper-in').offsetHeight || UPPER_FALLBACK_H;
  /** グラフの最大の高さ = 上の部分がちょうど収まるときの高さ */
  const graphMax = () => Math.max(GRAPH_MIN_H, columnH() - SPLITTER_H - upperNeed() - 2);
  const graphNow = () => clamp(layout.graphH, GRAPH_MIN_H, graphMax());

  function applyLayout() {
    layout.sideW = clamp(layout.sideW, SIDE_MIN, sideMax());
    cmpEl.style.setProperty('--side-w', `${layout.sideW}px`);
    cmpEl.style.setProperty('--graph-h', `${graphNow()}px`);
    $('cmp-sync').hidden = (ref()?.log.circuit?.sectors.length ?? 0) === 0;
    $('cmp-sync-status').hidden = !anchor && !syncMsg;
    $('cmp-sp-g').hidden = cars.length === 0;
  }
  const saveLayout = () => session.setSetting('compare.layout', { ...layout });
  const sideSplit = makeSplitter({
    el: $('cmp-sp-v'), axis: 'x', dir: -1, initial: DEFAULT_LAYOUT.sideW,
    get: () => layout.sideW,
    set: (v) => { layout.sideW = v; applyLayout(); },
    min: () => SIDE_MIN, max: sideMax,
    fromPointer: (x) => $('cmp-main').getBoundingClientRect().right - x,
    commit: saveLayout,
    valueText: (v) => `右パネルの幅 ${v}px`,
  });
  // セクターとグラフの境界: 上の部分とグラフの比率だけを変える(スクロールは出さない)
  const graphSplit = makeSplitter({
    el: $('cmp-sp-g'), axis: 'y', dir: -1, initial: DEFAULT_LAYOUT.graphH,
    get: graphNow,
    set: (v) => { layout.graphH = v; applyLayout(); graph?.resize(); },
    min: () => GRAPH_MIN_H, max: graphMax,
    fromPointer: (_x, y) => $('cmp-side').getBoundingClientRect().bottom - y - SPLITTER_H / 2,
    commit: saveLayout,
    valueText: (v) => `速度グラフの高さ ${v}px`,
  });
  const relayout = () => { applyLayout(); sideSplit.refresh(); graphSplit.refresh(); };

  const graph: SpeedGraph = new SpeedGraph($('cmp-graph'), (v) => {
    const r = ref();
    if (!r) return;
    engine.seek(xKind === 'time' ? v : timeAtDistance(r.track, v) - offOf(r));
  }, (k) => {
    $('cmp-zoom').textContent = `×${k}`;
    $<HTMLButtonElement>('cmp-zin').disabled = k >= ZOOM_MAX;
    $<HTMLButtonElement>('cmp-zout').disabled = k <= 1;
    $('cmp-zreset').hidden = k <= 1;
  });
  applyLayout();

  // ---------- データ ----------
  function renderSetSelect() {
    const sel = root.querySelector<HTMLSelectElement>('#cmp-set')!;
    sel.innerHTML = session.sets.map((w, i) =>
      `<option value="${i}"${w.logs.length ? '' : ' disabled'}${i === session.activeIndex ? ' selected' : ''}>${esc(`${session.setName(i)}(${w.logs.length}本)`)}</option>`).join('');
  }
  root.querySelector('#cmp-set')!.addEventListener('change', (e) => session.setActive(Number((e.target as HTMLSelectElement).value)));

  function signature(): string {
    return session.activeIndex + '/' + SLOTS.map((s) => {
      const r = session.resolveRef(session.assignment[s]);
      return r ? `${s}:${r.log.id}#${r.lap.number}~${r.lap.endTime}@${r.log.offset.east},${r.log.offset.north}:${r.log.circuit?.id ?? ''}:${JSON.stringify(r.log.circuit?.sectors ?? [])}:${r.lap.sectorTimes.length}` : '-';
    }).join('|');
  }

  const toRuns = (runs: CoreRun[], color: (level: number) => string): HeatRun[] =>
    runs.map((h) => ({ from: h.from, to: h.to, color: color(h.level) }));

  function rebuild() {
    aliasSig = aliasSigOf();
    const built = SLOTS.flatMap((slot) => {
      const r = session.resolveRef(session.assignment[slot]);
      return r ? [{ slot, log: r.log, lap: r.lap, series: buildLapSeries(r.log.log, r.lap, r.log.offset) }] : [];
    });
    // 色は全車で共通: 速度は全車を通した範囲で、加減速は同じ段階表で決める
    range = speedRange(built.map((b) => b.series));
    // 距離の物差し: 記録の間隔がいちばん細かい車(同じなら基準車)。画面の基準車は変えない
    const ruler = built[pickRuler(built.map((b) => ({ series: b.series, complete: b.lap.complete })))];
    cars = built.map((b) => ({
      ...b,
      track: alignedSeries(ruler.series, b.series, ruler.lap.complete && b.lap.complete),
      accel: toRuns(heatRuns(accelSeries(b.series)), heatColor),
      speed: toRuns(speedRuns(b.series, range.lo, range.hi), speedColor),
    }));
    hidden.clear();
    off = new Map(); anchor = null; syncMsg = ''; activeSector = null;
    const has = cars.length > 0;
    $('cmp-main').hidden = !has;
    $('cmp-empty').hidden = has;
    applyLayout();
    // 割り当てが無くなった枠への追従は、固定に戻す
    if (follow !== 'fixed' && follow !== 'leader' && !cars.some((c) => c.slot === follow)) follow = 'fixed';
    syncFollowButtons();
    engine.setDuration(totalDuration());
    engine.seek(0);
    $<HTMLInputElement>('cmp-seek').max = String(engine.duration);
    renderCards();
    renderSectors();
    renderLegend();
    if (has && visible) {
      ensureMap(); pushMap();
      applyInitialView();
    }
    pushGraph();
    updateFrame();
  }

  // 地図の初期の倍率: 0 = 走行ライン全体が入る倍率。数値のときは、同じ中心のまま、その倍率にする。
  // サーキット登録画面の地図の倍率(登録した表示位置)は使わない(別々に管理する)
  let applyingView = false;
  function applyInitialView() {
    if (!map) return;
    const z = prefs.initial('zoom');
    const ctl = ref()?.log.circuit?.control;
    const atControl = prefs.startPos === 'control' && !!ctl;     // 初期位置: コントロールラインの中心
    applyingView = true;
    try {
      map.fit();
      if (z !== 0 || atControl) {
        const base = map.getView();
        const zoom = z === 0 ? base.zoom : z;
        if (ctl && atControl) map.setView((ctl.a.lat + ctl.b.lat) / 2, (ctl.a.lon + ctl.b.lon) / 2, zoom);
        else map.setView(base.lat, base.lon, zoom);
      }
    } finally { applyingView = false; }
  }

  function ensureMap() {
    if (map) return;
    map = deps.mapFactory($('cmp-map'));
    map.onZoomChange((z) => {                                  // 利用者が変えた倍率を、前回の状態として覚える
      if (applyingView) return;
      const lo = ZOOM_CHOICES[0], hi = ZOOM_CHOICES[ZOOM_CHOICES.length - 1];
      prefs.saveLast('zoom', Math.min(hi, Math.max(lo, Math.round(z))));
    });
    map.onUserDrag(() => setFollow('fixed'));   // 地図を手で動かしたら追従をやめる
  }

  function pushMap() {
    if (!map) return;
    map.setTracks(shown().map((c) => ({
      slot: c.slot, color: cssColor(c.slot),
      points: Array.from(c.series.t, (_, i) => [c.series.lat[i], c.series.lon[i]] as [number, number]),
      heat: mapMode === 'speed' ? c.speed : mapMode === 'accel' ? c.accel : undefined,
    })));
    const circuit = ref()?.log.circuit;
    map.setLines(circuit ? [
      { label: '計測ライン', line: circuit.control, kind: 'control' as const },
      ...circuit.sectors.map((line, i) => ({ label: `S${i + 1}`, line, kind: 'sector' as const })),
    ] : []);
  }

  function pushGraph(keepView = false) {
    const r = ref();
    // 時間軸: 全車一致のときは各車の線を横にずらして、そろえたセクターの位置が縦に並ぶようにする
    graph.setData(
      cars.map((c) => ({
        slot: c.slot, y: c.series.speed,
        x: xKind === 'time' ? Float64Array.from(c.series.t, (t) => t - offOf(c)) : c.track.dist,
      })),
      xKind,
      r ? r.lap.sectorTimes.flatMap((t, i) => t === null ? [] : [{
        label: `S${i + 1}`, x: xKind === 'time' ? t - offOf(r) : sampleSeries(r.track, t).dist,
      }]) : [],
      keepView,
    );
    graph.setMuted(hidden);
  }

  /** 凡例: 速度は範囲の数値つき、加減速は「減速 ⇔ 加速」。全車共通の色であることも分かるように */
  function renderLegend() {
    const lg = $('cmp-legend');
    lg.hidden = mapMode === 'line';
    if (mapMode === 'line') return;
    const speed = mapMode === 'speed';
    $('cmp-leg-bar').className = `legend-bar ${speed ? 'speed' : 'accel'}`;
    $('cmp-leg-lo').textContent = speed ? `低速 ${range.lo}` : '減速';
    $('cmp-leg-hi').textContent = speed ? `${range.hi} km/h 高速` : '加速';
    lg.setAttribute('aria-label', speed ? `速度の色分け(全車共通): ${range.lo} から ${range.hi} km/h` : '加速と減速の色分け(全車共通)');
  }

  function syncLabelBtn() {
    const b = $<HTMLButtonElement>('cmp-carlabel');
    b.textContent = `ラベル: ${LABEL_TEXT[labelMode]}`;
    b.setAttribute('aria-pressed', String(labelMode !== 'off'));
    b.classList.toggle('on', labelMode !== 'off');
  }

  function setMapMode(m: MapMode) {
    mapMode = m;
    prefs.saveLast('mapMode', m);
    setPressed('[data-act="mapmode"]', (b) => b.dataset.mode === m);
    renderLegend();
    pushMap();
  }

  function setFollow(f: Follow) {
    follow = f;
    prefs.saveLast('follow', f);
    followSlot = null; ease = null;
    syncFollowButtons();
    updateFrame();
  }
  function syncFollowButtons() {
    root.querySelectorAll<HTMLButtonElement>('[data-act="follow"]').forEach((b) => {
      const f = b.dataset.follow!;
      const isSlot = (SLOTS as string[]).includes(f);
      b.disabled = isSlot && !cars.some((c) => c.slot === f);
      const on = f === follow;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // ---------- 右パネル ----------
  function renderCards() {
    root.querySelector('#cmp-cards')!.innerHTML = SLOTS.map((s) => {
      const c = cars.find((x) => x.slot === s);
      const k = s.toLowerCase();
      if (!c) return `<div class="card slot-${k} off"><span class="chip s${k}">${s}</span><div class="mut">未割り当て</div></div>`;
      const run = `Run ${c.log.no}`;
      const alias = session.slotAliasOf(session.activeIndex, s);
      return `<button type="button" class="card slot-${k}" data-act="toggle-car" data-slot="${s}" aria-pressed="true"
          title="押すと地図上の表示 / 非表示を切り替えます" aria-label="${s} ${alias ? esc(alias) + ' ' : ''}${run} LAP ${c.lap.number} を地図に表示">
        <span class="chip s${k}" aria-hidden="true">${s}</span><span class="card-body">
        <span class="c1">${alias ? `${esc(alias)} <small class="card-run">${run}</small>` : run}<span class="tag-hidden" hidden> ・ 非表示</span></span>
        <span class="c2 num">LAP ${c.lap.number}: ${formatLapTime(c.lap.duration)}</span>
        <span class="c3 num"><span data-live="speed-${k}">-</span><span class="c3-gap"${xKind === 'dist' ? ' hidden' : ''}> / <span data-live="gap-${k}">-</span></span></span></span></button>`;
    }).join('');
  }

  function syncCards() {
    root.querySelectorAll<HTMLElement>('[data-act="toggle-car"]').forEach((b) => {
      const off = hidden.has(b.dataset.slot as Slot);
      b.classList.toggle('muted', off);
      b.setAttribute('aria-pressed', String(!off));
      b.querySelector<HTMLElement>('.tag-hidden')!.hidden = !off;
    });
  }

  function toggleCar(slot: Slot) {
    if (hidden.has(slot)) hidden.delete(slot); else hidden.add(slot);
    syncCards();
    pushMap();
    graph.setMuted(hidden);
    followSlot = null; ease = null;
    updateFrame();
  }

  function renderSectors() {
    const n = ref()?.log.circuit?.sectors.length ?? 0;
    $('cmp-edit-circuit').hidden = !(ref()?.log.circuit && deps.onEditCircuit);
    $('cmp-sync').hidden = n === 0;
    if (n === 0) {
      $('cmp-sectors').innerHTML = '<div class="sub no-sector">セクター設定無し</div>';
      renderSyncStatus();
      return;
    }
    $('cmp-sectors').innerHTML = Array.from({ length: n }, (_, i) => {
      const any = cars.some((c) => c.lap.sectorTimes[i] != null);
      return `<button class="btn sec" data-act="sector" data-k="${i}" ${any ? '' : 'disabled title="このラップは通過していません"'}
        aria-pressed="${activeSector === i}" aria-label="セクター S${i + 1} へ移動">S${i + 1}</button>`;
    }).join('');
    syncModeUi();
    renderSyncStatus();
  }

  /** ボタンの動作の切り替え表示と、その説明 */
  function syncModeUi() {
    setPressed('[data-act="syncmode"]', (b) => b.dataset.mode === syncMode);
  }

  function renderSyncStatus() {
    const box = $('cmp-sync-status');
    box.hidden = !anchor && !syncMsg;
    $('cmp-sync-text').textContent = anchor ? `S${anchor.k + 1} で全車一致中` : syncMsg;
    $<HTMLButtonElement>('cmp-sync-release').disabled = activeSector === null;
    root.querySelectorAll<HTMLElement>('[data-act="sector"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(activeSector === Number(b.dataset.k))));
  }

  // ---------- セクターボタン ----------
  /**
   * 全車一致: 各車の時間をずらして、全車が同時にセクターを通るようにそろえ、その瞬間から表示する。
   *   いちばん遅く通る車(時刻 T)に合わせ、他の車は「その分あとからスタートした」ものとして扱う(ずれ ≤ 0)。
   * 先頭車両: ずれは作らず、先頭の車がセクターを通った時刻へ移動する。
   * どちらも、再生中なら再生のまま、一時停止中なら一時停止のまま。
   */
  function pressSector(k: number) {
    const has = cars.filter((c) => c.lap.sectorTimes[k] != null);
    if (!has.length) return;
    const tOf = (c: Car) => c.lap.sectorTimes[k] as number;
    activeSector = k;
    if (xKind === 'dist') {                 // 距離ベース: 基準の車がセクターを通る位置へ移る(全車がその場所に並ぶ)
      const rr = ref();
      if (!rr || rr.lap.sectorTimes[k] == null) return;
      off = new Map(); anchor = null;
      syncMsg = `S${k + 1}: 基準の車が通過する位置へ移動しました`;
      engine.setDuration(totalDuration());
      pushGraph(true);
      engine.seek(rr.lap.sectorTimes[k] as number);
      graph.centerOnCursor();
      $<HTMLInputElement>('cmp-seek').max = String(engine.duration);
      renderSyncStatus();
      return;
    }
    if (syncMode === 'leader') {
      const pool = has.filter((c) => !hidden.has(c.slot));
      const lead = (pool.length ? pool : has).reduce((a, b) => (tOf(b) < tOf(a) ? b : a));
      off = new Map(); anchor = null;
      syncMsg = `S${k + 1}: ${lead.slot} が先頭で通過した時点へ移動しました`;
      engine.setDuration(totalDuration());
      pushGraph(true);
      engine.seek(tOf(lead));
    } else {
      const T = Math.max(...has.map(tOf));
      off = new Map(cars.map((c) => [c.slot, c.lap.sectorTimes[k] != null ? tOf(c) - T : 0]));
      anchor = {
        k,
        t: new Map(has.map((c) => [c.slot, tOf(c)])),
        d: new Map(has.map((c) => [c.slot, sampleSeries(c.series, tOf(c)).dist])),
      };
      syncMsg = '';
      engine.setDuration(totalDuration());
      pushGraph(true);
      engine.seek(T);
    }
    graph.centerOnCursor();                 // ズームの倍率は保ち、再生位置が見える位置へ
    $<HTMLInputElement>('cmp-seek').max = String(engine.duration);
    renderSyncStatus();
  }

  /**
   * 速度グラフの横軸(距離 / 時間)を切り替える。距離のときは、地図の再生も距離ベースになる。
   * 全車一致のずれは、切り替えで解除する(基準の車の位置は保つ)。
   */
  function setXKind(k: XKind) {
    const r = ref();
    const keep = r ? localOf(r, engine.t) : 0;
    xKind = k;
    prefs.saveLast('xKind', xKind);
    setPressed('[data-act="xkind"]', (b) => b.dataset.kind === xKind);
    off = new Map(); anchor = null; syncMsg = ''; activeSector = null;
    engine.setDuration(totalDuration());
    pushGraph();
    renderSyncStatus();
    engine.seek(keep);
    updateFrame();
  }

  /** 全車一致を解除して、各車を通常(ラップ開始をそろえた状態)に戻す。基準の車の位置は保つ。 */
  function releaseSync() {
    const r = ref();
    const keep = r ? localOf(r, engine.t) : 0;
    off = new Map(); anchor = null; syncMsg = ''; activeSector = null;
    engine.setDuration(totalDuration());
    pushGraph(true);
    engine.seek(keep);
    graph.centerOnCursor();
    $<HTMLInputElement>('cmp-seek').max = String(engine.duration);
    renderSyncStatus();
  }

  // ---------- 1コマごとの更新 ----------
  const fmtPos = (t: number) => `${formatLapTime(t)} / ${formatLapTime(engine.duration)}`;
  const setLive = (key: string, text: string) => {
    root.querySelectorAll(`[data-live="${key}"]`).forEach((e) => { e.textContent = text; });
  };

  function syncPlayButton() {
    if (lastPlaying === engine.playing) return;
    lastPlaying = engine.playing;
    // 再生中は「一時停止」、止まっているときは「再生」のトグル
    const b = $('cmp-pp');
    b.innerHTML = icon(engine.playing ? ICONS.pause : ICONS.play);
    b.dataset.state = engine.playing ? 'playing' : 'paused';
    b.setAttribute('aria-label', engine.playing ? '一時停止' : '再生');
    b.title = engine.playing ? '一時停止 [Space]' : '再生 [Space]';
  }

  function updateFrame() {
    const tau = engine.t;
    const r = ref();
    $('cmp-time').textContent = fmtPos(tau);
    const seek = $<HTMLInputElement>('cmp-seek');
    seek.max = String(engine.duration);
    seek.value = String(tau);
    seek.setAttribute('aria-valuetext', fmtPos(tau));
    syncPlayButton();
    // コマ送りは一時停止中のみ
    $<HTMLButtonElement>('cmp-fb').disabled = engine.playing;
    $<HTMLButtonElement>('cmp-ff').disabled = engine.playing;
    if (!r) { graph.setCursor(null, []); map?.setCars([]); return; }

    // 時間ベース: 全車が同じ経過時間の位置。距離ベース(速度グラフが「距離」): 基準の車と同じ距離の位置(その場所での走行ラインと速度を比べる)。
    // 距離ベースの距離は、物差しの走行ラインに投影したもの(コース上の同じ断面にいれば同じ距離)
    const refSample = sampleSeries(sv(r), localOf(r, tau));
    const samples = cars.map((c) => ({
      c, s: xKind === 'dist' && c !== r ? sampleSeries(c.track, timeAtDistance(c.track, refSample.dist)) : c === r ? refSample : sampleSeries(c.series, localOf(c, tau)),
    }));
    const refDist = samples[0].s.dist;
    const onMap = samples.filter(({ c }) => !hidden.has(c.slot));
    followCamera(onMap);
    graph.setCursor(
      xKind === 'time' ? tau : refDist,
      samples.map(({ c, s }) => ({ slot: c.slot, x: xKind === 'time' ? localOf(c, tau) - offOf(c) : s.dist, y: s.speed })),
    );
    // 時間差: 基準の車が今いる位置に、その車が着くまでの時間の差。全車一致のときは、そろえたセクターからの進みで比べる
    // (セクターでは必ず 0 になる。距離の誤差が、セクターからの短い区間にしか溜まらない)
    const anchorOf = (c: Car) => ({ t: anchor?.t.get(c.slot) ?? 0, d: anchor?.d.get(c.slot) ?? 0 });
    const ra = anchorOf(r), refLocal = localOf(r, tau);
    const gapText = new Map<Slot, string>();
    for (const { c, s } of samples) {
      const k = c.slot.toLowerCase();
      setLive(`speed-${k}`, `${Math.round(s.speed)}km/h`);
      if (xKind === 'dist') continue;                       // 距離ベースでは、タイム差は出さない(速度だけ)
      if (c === r) setLive(`gap-${k}`, '基準');
      else {
        const ca = anchorOf(c);
        const reach = timeAtDistance(c.series, ca.d + (refDist - ra.d));
        const gap = Math.round(((reach - ca.t) - (refLocal - ra.t)) * 100) / 100;     // 0.01 秒に丸めてから符号を決める(-0.00 を出さない)
        const g = `${gap < 0 ? '-' : '+'}${Math.abs(gap).toFixed(2)}s`;
        setLive(`gap-${k}`, g);
        gapText.set(c.slot, g);
      }
    }
    root.querySelectorAll<HTMLElement>('.c3-gap').forEach((e) => { e.hidden = xKind === 'dist'; });
    // 地図の車(引き出し線の先に「速度kph/タイム差」。基準の車は速度だけ)
    map?.setCars(onMap.map(({ c, s }) => ({
      slot: c.slot, lat: s.lat, lon: s.lon, heading: s.heading,
      label: labelMode === 'speed' ? `${Math.round(s.speed)}kph${gapText.has(c.slot) && xKind !== 'dist' ? `/${gapText.get(c.slot)}` : ''}`
        : labelMode === 'name' ? session.cardName(c.slot) : undefined,
    })));
  }

  type Sample = { c: Car; s: { lat: number; lon: number; dist: number } };

  /**
   * 追従の対象: 先頭 = 表示中の車のうち、今いちばん長く走っている車(同じなら若い枠)。
   * 横軸「距離」では全車が同じ距離にいるので、先頭は決めず、表示中のいちばん若い枠(ふつうは基準車)を追う
   */
  function followTarget(samples: Sample[]) {
    if (follow === 'fixed' || !samples.length) return null;
    if (follow === 'leader') return xKind === 'dist' ? samples[0] : samples.reduce((a, b) => (b.s.dist > a.s.dist ? b : a));
    return samples.find((x) => x.c.slot === follow) ?? null;
  }

  function followCamera(samples: Sample[]) {
    const tgt = followTarget(samples);
    if (!tgt || !map) { followSlot = null; ease = null; return; }
    let c = { lat: tgt.s.lat, lon: tgt.s.lon };
    // 再生中に先頭が入れ替わったら、中心が飛ばないよう 0.4 秒かけて移る
    if (followSlot && followSlot !== tgt.c.slot && engine.playing && camera) {
      ease = { from: camera, start: performance.now() };
    }
    followSlot = tgt.c.slot;
    if (ease) {
      const f = (performance.now() - ease.start) / EASE_MS;
      if (f >= 1) ease = null;
      else {
        const k = f * f * (3 - 2 * f);
        c = { lat: ease.from.lat + (c.lat - ease.from.lat) * k, lon: ease.from.lon + (c.lon - ease.from.lon) * k };
      }
    }
    camera = c;
    map.setCenter(c.lat, c.lon);
  }

  // ---------- 再生ループ ----------
  function loop(now: number) {
    raf = 0;
    if (!engine.playing) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    engine.tick(dt);
    if (engine.playing && !raf) raf = requestAnimationFrame(loop);
  }
  engine.subscribe(() => {
    updateFrame();
    if (engine.playing && !raf && typeof requestAnimationFrame === 'function') {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  });

  // ---------- 操作 ----------
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'to-start': engine.seek(0); break;
      case 'toggle': engine.toggle(); break;
      case 'frame-back': if (!engine.playing) engine.step(-1); break;
      case 'frame-fwd': if (!engine.playing) engine.step(1); break;
      case 'rate':
        engine.setRate(Number(d.rate));
        prefs.saveLast('rate', Number(d.rate));
        setPressed('[data-act="rate"]', (b) => b === el);
        break;
      case 'xkind': setXKind(d.kind as XKind); break;
      case 'zoom-in': graph.zoomIn(); break;
      case 'zoom-out': graph.zoomOut(); break;
      case 'zoom-reset': graph.resetZoom(); break;
      case 'toggle-car': toggleCar(d.slot as Slot); break;
      case 'sector': pressSector(Number(d.k)); break;
      case 'syncmode':
        syncMode = d.mode as SyncMode;
        prefs.saveLast('sync', syncMode);
        syncModeUi();
        if (activeSector !== null) pressSector(activeSector);      // 選んでいるセクターを、新しい動作で開始したものとして表示を計算し直す
        break;
      case 'sync-release': releaseSync(); break;
      case 'mapmode': setMapMode(d.mode as MapMode); break;
      case 'carlabel':
        labelMode = labelMode === 'off' ? 'speed' : labelMode === 'speed' ? 'name' : 'off';       // 非表示 → 速度・差 → カード名 → 非表示
        prefs.saveLast('labels', labelMode);
        syncLabelBtn();
        updateFrame();
        break;
      case 'follow': setFollow(d.follow as Follow); break;
      case 'back': deps.onBack(); break;
      case 'edit-circuit': { const c = ref()?.log.circuit; if (c) deps.onEditCircuit?.(c.id); break; }
    }
  });
  $('cmp-seek').addEventListener('input', (e) => engine.seek(Number((e.target as HTMLInputElement).value)));

  /**
   * キーボード操作は再生系だけ:
   *   Space = 再生 / 一時停止、← → = 1コマ(0.1秒・一時停止中のみ)、Shift+← → = 1秒
   * どこにフォーカスがあっても同じ動きにする(直前に押したボタンが Space で再び押されないように、
   * Space は既定の動作を止める)。境界の線・ルーラーは、それ自身の矢印キー操作を優先する。
   */
  const isTextField = (t: HTMLElement | null) =>
    !!t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'));
  const ownsArrows = (t: HTMLElement | null) => {
    const role = t?.getAttribute?.('role');
    return role === 'separator' || role === 'scrollbar';
  };
  const onKey = (e: KeyboardEvent) => {
    if (!visible || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (isTextField(t) || document.querySelector('.modal')) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) engine.toggle();
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !ownsArrows(t)) {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) engine.skip(dir, 1);          // 1秒(再生中でも)
      else if (!engine.playing) engine.step(dir);    // 1コマ(一時停止中のみ)
    }
  };
  // Space で押されたボタンが、キーを離したときに反応しないようにする(ブラウザによって離したときに動くため)
  const onKeyUp = (e: KeyboardEvent) => {
    if (visible && e.key === ' ' && !isTextField(e.target as HTMLElement | null)) e.preventDefault();
  };

  if (typeof ResizeObserver === 'function') {
    let pending = 0;
    new ResizeObserver(() => {
      if (!visible || pending) return;
      pending = requestAnimationFrame(() => { pending = 0; map?.invalidate(); });
    }).observe($('cmp-map'));
    new ResizeObserver(() => { if (visible) { relayout(); graph.resize(); } }).observe(cmpEl);
    new ResizeObserver(() => { if (visible) { applyLayout(); graphSplit.refresh(); } }).observe($('cmp-upper-in'));
  }

  deps.theme?.subscribe(() => { if (visible) pushMap(); });
  renderSetSelect();
  const aliasSigOf = () => SLOTS.map((s) => session.slotAliasOf(session.activeIndex, s)).join('|');
  session.subscribe(() => {
    renderSetSelect();
    if (visible && signature() !== sig) { sig = signature(); aliasSig = aliasSigOf(); rebuild(); return; }
    if (visible && aliasSigOf() !== aliasSig) {     // カード名だけが変わったときは、表示のまま名前だけ更新する(表示していないときは、開いたときに反映する)
      aliasSig = aliasSigOf();
      renderCards(); syncCards(); updateFrame();
    }
  });

  setPressed('[data-act="mapmode"]', (b) => b.dataset.mode === mapMode);
  setPressed('[data-act="xkind"]', (b) => b.dataset.kind === xKind);
  engine.setRate(prefs.initial('rate'));
  setPressed('[data-act="rate"]', (b) => Number(b.dataset.rate) === engine.rate);
  graph.setYRange(prefs.yMin, prefs.yMax);
  syncFollowButtons();
  syncLabelBtn();
  renderLegend();
  syncModeUi();

  function applyPref(key: PrefKey | 'yRange' | 'startPos' | 'autoLoad') {
    if (key === 'yRange') { graph.setYRange(prefs.yMin, prefs.yMax); return; }
    if (key === 'startPos') { if (visible && cars.length) applyInitialView(); return; }
    if (key === 'autoLoad') return;
    if (prefs.get(key).remember) return;                       // 「記憶する」の項目は、前回の状態のまま
    const v = prefs.initial(key);
    switch (key) {
      case 'mapMode': setMapMode(v as MapMode); break;
      case 'labels': labelMode = v as LabelV; prefs.saveLast('labels', labelMode); syncLabelBtn(); if (visible) updateFrame(); break;
      case 'xKind': setXKind(v as XKind); break;
      case 'rate': engine.setRate(v as number); prefs.saveLast('rate', v as number); setPressed('[data-act="rate"]', (b) => Number(b.dataset.rate) === v); break;
      case 'follow': setFollow(cars.some((c) => c.slot === v) || v === 'fixed' || v === 'leader' ? (v as Follow) : 'fixed'); break;
      case 'sync': syncMode = v as SyncMode; prefs.saveLast('sync', syncMode); syncModeUi(); if (activeSector !== null) pressSector(activeSector); break;
      case 'zoom': if (visible && cars.length) applyInitialView(); break;
      default: break;
    }
  }

  return {
    engine,
    applyPref,
    show() {
      visible = true;
      document.addEventListener('keydown', onKey);
      document.addEventListener('keyup', onKeyUp);
      relayout();
      const now = signature();
      if (now !== sig) { sig = now; rebuild(); }
      else {
        if (aliasSigOf() !== aliasSig) { aliasSig = aliasSigOf(); renderCards(); syncCards(); }   // 別の画面で付けたカード名を反映する
        if (cars.length) { ensureMap(); pushMap(); updateFrame(); }
      }
      if (cars.length) map?.invalidate();
      graph.resize();
    },
    hide() {
      visible = false;
      engine.pause();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
    },
  };
}
