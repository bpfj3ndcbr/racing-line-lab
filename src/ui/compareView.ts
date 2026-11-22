import {
  type HeatRun as CoreRun, type Lap, type LapSeries, type MiniSplit, PlaybackEngine, SLOTS, type Slot,
  MINI_COUNT, accelSeries, isInPassOrder, alignedSeries, buildLapSeries, miniIndexAt, miniSpeeds, miniTone, pickRuler, segmentRange, formatLapTime, heatColor, heatRuns, sampleSeries, sampleSeriesSmooth, speedColor, speedRange, speedRuns, timeAtDistance, escapeHtml as esc
} from '../core';
import type { LoadedLog, RefLap, Session } from '../store/session';
import { alertDialog } from './dialog';
import { INFO_ICON } from './icons';
import { Prefs, RATE_CHOICES, ZOOM_CHOICES, type FollowV as Follow, type LabelV, type MapModeV as MapMode, type PrefKey, type SyncV as SyncMode } from '../store/prefs';
import { SpeedGraph, ZOOM_MAX, type XKind } from './speedGraph';
import { ScrubVelocity } from '../core/scrub';
import { clamp, makeSplitter } from './splitter';
import { isTypingTarget, modalOpen } from './nudge';
import type { HeatRun, MapFactory, TrackMap } from './mapTypes';
import type { ThemeController } from './theme';
import { SHOWN_MARK } from './marks';
import { nearAnyRect } from './mapPointer';
import { installLongPressScroll } from './longPressScroll';
import { installScrollGrip } from './scrollGrip';

/**
 * series: ラップの時系列(距離は速度の積み上げ)。
 * track: 距離を、物差しの車の走行ラインに投影した距離に置き換えたもの。横軸「距離」で使う(コース上の同じ位置が同じ距離になる)
 */
interface Car { slot: Slot; log: LoadedLog; lap: Lap; series: LapSeries; track: LapSeries; accel: HeatRun[]; speed: HeatRun[] }

export interface CompareDeps {
  mapFactory: MapFactory;
  theme?: ThemeController;
  /** 割り当てが無いときの「データ管理画面へ」 */
  onBack: () => void;
  /** スマホの横向きのときに、上部バーに出す「表示中」と比較セットの選択の置き場(案件 46。出すかどうかは CSS で決める) */
  topSlot?: HTMLElement;
}
export interface CompareView {
  show(): void; hide(): void; readonly engine: PlaybackEngine;
  /** 設定タブで初期値が変わったとき、その項目を比較画面にも反映する(「記憶する」項目は何もしない) */
  applyPref(key: PrefKey | 'yRange' | 'startPos' | 'autoLoad' | 'smooth' | 'longPress'): void;
}

const RATES = RATE_CHOICES;
const LABEL_TEXT: Record<LabelV, string> = { off: 'なし', speed: '速度・差', name: 'カード名' };

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
// 地図の上のメニューの項目のアイコン(線画。A〜D の丸と同じ幅にして、文字の頭をそろえる。案件 41)
const MENU_ICONS = {
  pin: '<path d="M8 14.5s-4.5-4.2-4.5-7.7A4.5 4.5 0 0 1 12.5 6.8c0 3.5-4.5 7.7-4.5 7.7z"/><circle cx="8" cy="6.8" r="1.6"/>',
  flag: '<path d="M3.5 14.5V2"/><path d="M3.5 2.5h8l-1.8 3 1.8 3h-8"/>',
};
/** 札の「中心へ」の頭に付ける、中心を示すアイコン(案件 77) */
const CENTER_ICON = '<svg class="tool-ico" width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/><path d="M8 0v3M8 13v3M0 8h3M13 8h3"/></svg>';
const menuIcon = (p: string) =>
  `<span class="ov-ico" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>`;
const icon = (p: string) =>
  `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${p}</svg>`;

// 画面の分割(サイズの上限・下限など)
const LAYOUT_VERSION = 1;
interface Layout { v: number; sideW: number; graphH: number }
const DEFAULT_LAYOUT: Layout = { v: LAYOUT_VERSION, sideW: 300, graphH: 300 };
/** 右パネルの幅の範囲(最小 220px はこれ以上狭められない) */
const SIDE_MIN = 220, SIDE_MAX = 560, MAP_MIN_W = 240;
/** スマホの横画面(style.css の横向きの @media と同じ条件) */
const PHONE_LANDSCAPE = '(orientation:landscape) and (max-height:500px)';
/** 地図を動かしたあと、前回の表示位置として覚えるまでの待ち(動き続けている間は覚えない) */
const VIEW_SAVE_MS = 400;
/** 速度グラフの高さの下限(これより低いと文字が読めない)、境界線の太さ、上の部分の高さが測れないときの値 */
const GRAPH_MIN_H = 170, SPLITTER_H = 6, UPPER_FALLBACK_H = 400;
const EASE_MS = 400;
/** セクターを通ったときの、ボタンの点滅の長さ(CSS の .btn.sec.pass のアニメーションと合わせる) */
const PASS_FLASH_MS = 1900;

/** 比較画面: 地図 + 速度グラフ + 再生。 */
export function mountCompareView(root: HTMLElement, session: Session, deps: CompareDeps): CompareView {
  root.innerHTML = `
    <div class="cmp">
      <div class="cmp-main" id="cmp-main">
        <div class="cmp-left">
          <div class="cmp-map">
            <div class="map" id="cmp-map"></div>
            <div class="map-ov tl ov-menu map-tools" id="cmp-menu">
              <div class="tool tg-pos">
                <button type="button" class="tool-btn" id="cmp-tool-pos" data-act="menu-sub" data-sub="pos" aria-haspopup="menu" aria-expanded="false" aria-controls="cmp-sub-pos" title="追従設定"><span data-now="pos"></span></button>
                <div class="ov-list tool-pop" id="cmp-sub-pos" role="menu" aria-label="追従設定" hidden>
                  <button type="button" role="menuitemradio" data-act="follow" data-follow="fixed" aria-checked="true" class="on">${menuIcon(MENU_ICONS.pin)}固定</button>
                  <button type="button" role="menuitemradio" data-act="follow" data-follow="leader" aria-checked="false">${menuIcon(MENU_ICONS.flag)}先頭追従</button>
                  ${SLOTS.map((s) => `<button type="button" role="menuitemradio" data-act="follow" data-follow="${s}" aria-checked="false"><span class="chip s${s.toLowerCase()}" aria-hidden="true">${s}</span>${s} を追従</button>`).join('')}
                </div>
              </div>
              <div class="tool tg-line">
                <button type="button" class="tool-btn" id="cmp-tool-line" data-act="menu-sub" data-sub="line" aria-haspopup="menu" aria-expanded="false" aria-controls="cmp-sub-line" title="ライン表示"><span data-now="line"></span></button>
                <div class="ov-list tool-pop" id="cmp-sub-line" role="menu" aria-label="ライン表示" hidden>
                  <button type="button" role="menuitemradio" data-act="mapmode" data-mode="line" aria-checked="true" class="on">走行ライン</button>
                  <button type="button" role="menuitemradio" data-act="mapmode" data-mode="speed" aria-checked="false" title="速度で色分け(全車共通の色)">速度</button>
                  <button type="button" role="menuitemradio" data-act="mapmode" data-mode="accel" aria-checked="false" title="加速・減速で色分け(全車共通の色)">加減速</button>
                  <button type="button" role="menuitemradio" data-act="mapmode" data-mode="none" aria-checked="false" title="走行ラインを描かない">なし</button>
                </div>
              </div>
              <div class="tool tg-label">
                <button type="button" class="tool-btn" id="cmp-tool-label" data-act="menu-sub" data-sub="label" aria-haspopup="menu" aria-expanded="false" aria-controls="cmp-sub-label" title="ラベル"><span data-now="label"></span></button>
                <div class="ov-list tool-pop" id="cmp-sub-label" role="menu" aria-label="ラベル" hidden>
                  ${(['speed', 'name', 'off'] as const).map((v) => `<button type="button" role="menuitemradio" data-act="carlabel" data-label="${v}" aria-checked="${v === 'off'}"${v === 'off' ? ' class="on"' : ''} title="車から引き出す線(ラベル)">${LABEL_TEXT[v]}</button>`).join('')}
                </div>
              </div>
            </div>
            <div class="map-ov map-secs" id="cmp-map-secs" aria-label="セクター(地図の上)"></div>
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
            <div class="scroll-grip" id="cmp-grip" role="presentation" aria-label="画面のスクロール(押さえたまま上下に動かす)" title="押さえたまま上下に動かすと、画面がスクロールします"><i class="up"></i><i class="dn"></i></div>
            <span class="num cmp-time" id="cmp-time">0:00.0 / 0:00.0</span>
            <input id="cmp-seek" class="cmp-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="再生位置(秒)">
          </div>
        </div>
        <div class="splitter v" id="cmp-sp-v" role="separator" aria-orientation="vertical" tabindex="0"
          aria-label="地図と右パネルの境界(ドラッグで幅を変更)"
          title="ドラッグで幅を変更 / ダブルクリックで元に戻す"></div>
        <aside class="cmp-side" id="cmp-side" aria-label="走行データ" data-tab="graph">
          <div class="side-tabs" id="cmp-side-tabs" role="tablist" aria-label="右の列の表示(横向きのスマホのとき)">
            <button type="button" role="tab" data-act="side-tab" data-tab="sectors" aria-selected="false">セクター</button>
            <button type="button" role="tab" data-act="side-tab" data-tab="graph" aria-selected="true" class="on">グラフ</button>
          </div>
          <div class="side-upper" id="cmp-upper">
            <div class="side-upper-in" id="cmp-upper-in">
              <label class="sel cmp-set" id="cmp-set-wrap">${SHOWN_MARK}<select id="cmp-set" class="cmp-set-sel" data-fk="cmp-set" aria-label="表示中の比較セット"></select></label>
              <div id="cmp-base-info" class="base-info" aria-label="比較基準の車"></div>
              <div id="cmp-cards" class="cmp-cards"></div>
              <div class="sec-block" id="cmp-sec-block">
                <div class="h sec-h-row" id="cmp-sec-h"><span>セクター</span></div>
                <div id="cmp-sync" class="sync-grp">
                  <span class="sync-part"><span class="seg sm" role="group" aria-label="セクターボタンの動作">
                    <button data-act="syncmode" data-mode="leader" aria-pressed="false">先頭車両</button>
                    <button data-act="syncmode" data-mode="all" aria-pressed="true" class="on">全車一致</button>
                    <button id="cmp-sync-release" data-act="sync-release" disabled title="選んでいるセクターを解除して、通常の表示に戻します(自動もオフにします)">解除</button>
                  </span></span>
                  <span class="sync-part"><span class="seg sm" role="group" aria-label="セクター通過時の自動合わせ">
                    <button data-act="autosync" aria-pressed="false">自動</button>
                  </span></span>
                  <span class="sync-part swap-part" data-no-top><button type="button" class="btn xs" data-act="swap-graph" aria-pressed="false"
                    title="セクターの表とグラフの上下を入れ替えます" aria-label="セクターの表とグラフの上下を入れ替え">入替</button></span>
                </div>
                <div id="cmp-sync-tags" class="sync-grp sync-tags" aria-label="セクターの操作(スマホの縦画面・横画面)">
                  <div class="tg-grps">
                  <div class="tg-grp tg-grp-sec">
                    <div class="tg-title">セクター</div>
                    <div class="tg-row">
                      <div class="tool tg-sync">
                        <button type="button" class="tool-btn" id="cmp-tool-sync" data-act="menu-sub" data-sub="sync" aria-haspopup="menu" aria-expanded="false" aria-controls="cmp-sub-sync" title="セクターボタンの動作"><span data-now="sync"></span></button>
                        <div class="ov-list tool-pop" id="cmp-sub-sync" role="menu" aria-label="セクターボタンの動作" hidden>
                          <button type="button" role="menuitemradio" data-act="syncmode" data-mode="leader" aria-checked="false">先頭車両</button>
                          <button type="button" role="menuitemradio" data-act="syncmode" data-mode="all" aria-checked="true" class="on">全車一致</button>
                          <button type="button" data-act="sync-release" disabled title="選んでいるセクターを解除して、通常の表示に戻します(自動もオフにします)">解除</button>
                          <div class="menu-note" id="cmp-sync-note" hidden>先頭車両・全車一致は、横軸が「時間」のときだけ選べます(今は「距離」)</div>
                        </div>
                      </div>
                      <div class="tool tg-auto"><button type="button" class="tool-btn" data-act="autosync" aria-pressed="false" title="セクター通過時の自動合わせ">自動</button></div>
                      <div class="tool tg-swap"><button type="button" class="tool-btn" data-act="swap-graph" aria-pressed="false" title="セクターの表とグラフの上下を入れ替えます">入替</button></div>
                    </div>
                  </div>
                  <div class="tg-grp tg-grp-seg">
                    <div class="tg-title">セグメント</div>
                    <div class="tg-row">
                      <div class="tool tg-base">
                        <button type="button" class="tool-btn" id="cmp-tool-base" data-act="menu-sub" data-sub="base" aria-haspopup="menu" aria-expanded="false" aria-controls="cmp-sub-base" title="ミニセクターの比較基準"><span data-now="base"></span></button>
                        <div class="ov-list tool-pop" id="cmp-sub-base" role="menu" aria-label="ミニセクターの比較基準" hidden>
                        </div>
                      </div>
                      <div class="tool tg-split"><button type="button" class="tool-btn" data-act="minisplit" title="ミニセクターの区切り方">距離分割</button></div>
                    </div>
                  </div>
                  </div>
                  <p class="mini-note"><button type="button" class="mini-info" data-act="mini-info" aria-haspopup="dialog" aria-label="ミニセクターの誤差について" title="ミニセクターの誤差について">${INFO_ICON}</button><span>ミニセクターの誤差について</span></p>
                </div>
                <div id="cmp-sectors" class="secs"></div>
                <div id="cmp-sync-status" class="sub sync-status" role="status" hidden>
                  <span id="cmp-sync-text"></span>
                  <span id="cmp-sec-warn" class="sec-warn" hidden>セクターの順番が通った順ではありません。サーキットの編集で「セクター整列」をしてください</span>
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
  // スマホの縦画面: セクターの表とグラフの上下(入れ替えボタン。CSS が data-first を見て並べる)。新しいキー compare.sectorsFirst に覚える
  let sectorsFirst = session.getSetting<boolean>('compare.sectorsFirst', true) !== false;   // 初めは、セクターのエリアが上
  // ミニセクター表の比較基準(案件 85): 'fastest' = 割り当てた車のうち最速 / 'card:A' = そのカード / 'ref:<id>' = 基準設定の走行。比較セットごとに、セッションが覚える(session.active.miniBase)
  // ミニセクターの区切り方(案件 91): 'dist' = 距離分割(初期値)/ 'time' = 時間分割。新しいキー compare.miniSplit に覚える(全体で 1 つ)
  let miniSplit: MiniSplit = session.getSetting<string>('compare.miniSplit', 'dist') === 'time' ? 'time' : 'dist';
  let activeSector: number | null = null;      // 選んでいるセクター(どちらの動作でも)
  // セクター通過時の自動合わせ(案件 58): オンのとき、再生で基準の車がセクターを通ると、そのセクターのボタンを押したのと同じにする
  let autoSync = false;
  /** 先頭車両の動作で手前に戻った基準の車が、同じセクターをもう一度通るときは合わせない(戻り続けないように) */
  let autoSkip: number | null = null;
  let map: TrackMap | null = null;
  let visible = false;
  let raf = 0;
  let last = 0;
  let lastPlaying: boolean | null = null;
  // 追従カメラ(先頭車両が入れ替わったときだけ、短く滑らかに移動する)
  let followSlot: Slot | null = null;
  let camera: { lat: number; lon: number } | null = null;
  let ease: { from: { lat: number; lon: number }; start: number } | null = null;
  /**
   * 追従中に、利用者が地図を動かした分(地図の中心 - 追従の中心。緯度・経度の差。案件 77)。
   * 追従は止めず、中心を「追従の中心 + この差」に合わせ続ける。無いとき null。保存しない。
   * ドラッグの途中(慣性で止まるまで)は、地図を戻さない
   */
  let panOffset: { lat: number; lon: number } | null = null;
  let userDragging = false;

  const ref = () => cars[0];
  const offOf = (c: Car) => off.get(c.slot) ?? 0;
  /** 横軸に合わせた時系列: 距離のときは、物差しに投影した距離のもの */
  const sv = (c: Car) => (xKind === 'dist' ? c.track : c.series);
  /** 再生時刻 tau のときの、その車のラップ内の時刻(範囲の外は端に張り付く) */
  const localOf = (c: Car, tau: number) => Math.min(Math.max(tau + offOf(c), 0), c.series.duration);
  /** 全体の長さ: 最後の車が走り終えるまで */
  const totalDuration = () => xKind === 'dist' && ref()
    ? Math.max(0, ref().series.duration - offOf(ref()))      // 距離ベース: 基準の車が走り終えるまで(他の車は、基準の車と同じ距離の位置に出る)
    : Math.max(0, ...cars.map((c) => c.series.duration - offOf(c)));
  const shown = () => cars.filter((c) => !hidden.has(c.slot));
  const cssColor = (slot: Slot) =>
    getComputedStyle(document.documentElement).getPropertyValue('--' + slot.toLowerCase()).trim() || '#888';
  /** 比較画面と、上部バーの置き場(スマホの横向き。案件 46)の両方から探す */
  const findAll = (sel: string): HTMLElement[] => [
    ...root.querySelectorAll<HTMLElement>(sel),
    ...(deps.topSlot ? deps.topSlot.querySelectorAll<HTMLElement>(sel) : []),
  ];
  /** セクターボタンの動作の切り替え(右の列と上部バー)を、セクターが無いときは隠す */
  const setSyncHidden = (h: boolean) => findAll('.sync-grp').forEach((g) => {
    const grps = g.querySelector<HTMLElement>('.tg-grps');       // 札の欄(案件 91)は、中の札の組だけ隠す(下の注記は、セクターが無くても表に付く)
    if (grps) grps.hidden = h; else g.hidden = h;
  });
  /** 入れ替えボタンの状態と、右の列の並び(data-first。スマホの縦画面で CSS が使う) */
  function syncSwap() {
    $('cmp-side').dataset.first = sectorsFirst ? 'sectors' : 'graph';
    findAll('[data-act="swap-graph"]').forEach((b) => { b.classList.toggle('on', sectorsFirst); b.setAttribute('aria-pressed', String(sectorsFirst)); });
  }
  /** ミニセクターの区切り方の札(案件 91): 今の名前を出す。押すと、距離分割 / 時間分割を切り替える */
  const SPLIT_NAME: Record<MiniSplit, string> = { dist: '距離分割', time: '時間分割' };
  const SPLIT_TEXT: Record<MiniSplit, string> = {
    dist: 'ミニセクターの区切り方: 距離分割(各区間を、走った距離で 5 等分)。押すと時間分割にします',
    time: 'ミニセクターの区切り方: 時間分割(各区間を、かかった時間で 5 等分)。押すと距離分割にします',
  };
  function syncSplitUi() {
    findAll('[data-act="minisplit"]').forEach((b) => {
      b.textContent = SPLIT_NAME[miniSplit];
      b.title = SPLIT_TEXT[miniSplit];
      b.setAttribute('aria-label', SPLIT_TEXT[miniSplit]);
    });
  }
  function setMiniSplit(v: MiniSplit) {
    if (v === miniSplit) return;
    miniSplit = v;
    session.setSetting('compare.miniSplit', v);
    syncSplitUi();
    renderMini();                                                // 区間の速さと色分けを計算し直す(通過済みの表示は、次のコマで描き直す)
    updateFrame();
  }
  const setPressed = (sel: string, match: (b: HTMLElement) => boolean) =>
    findAll(sel).forEach((b) => {
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

  /**
   * スマホの横画面(案件 89): カードの 2 列が文字を省略せずに収まる、右の列の幅。横軸が「時間」のカードは
   * 「146km/h / +5.92s」のように長くなるので、列が足りないときは、保存した幅より広げる(地図が狭くなる)。それ以外の画面は 0
   */
  let sideNeed = 0;
  function sideNeedW(): number {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia(PHONE_LANDSCAPE).matches) return 0;
    const c = $('cmp-cards'), grid = c.style.gridTemplateColumns, width = c.style.width;
    c.style.gridTemplateColumns = 'repeat(2,max-content)'; c.style.width = 'max-content';   // 文字なりの幅を測る
    const n = c.offsetWidth, cards = Array.from(c.children) as HTMLElement[];
    const widest = Math.max(0, ...cards.map((e) => e.offsetWidth));
    const around = n - (cards[0]?.offsetWidth ?? 0) - (cards[1]?.offsetWidth ?? 0);   // 2 列のすきまと左右の余白
    c.style.gridTemplateColumns = grid; c.style.width = width;
    const cardsNeed = n ? Math.ceil(widest * 2 + around) + 2 : 0;   // 実際の 2 列は同じ幅(いちばん広いカードに合わせる)。+ 境界線の分
    // 札の「セクター」「セグメント」の 2 組が 1 段に収まる幅(案件 91)。左右の余白 16px と境界線の分を足す
    // 「セクター」タブを開いていないときは、札が表示されず測れないので、写しを画面の外に置いて測る
    const g = root.querySelector<HTMLElement>('.tg-grps');
    let tagsNeed = 0;
    if (g && !g.hidden) {
      const holder = document.createElement('div');
      holder.className = 'sync-tags';
      holder.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;display:block';
      const probe = g.cloneNode(true) as HTMLElement;
      probe.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
      probe.style.cssText = 'flex-wrap:nowrap;width:max-content';
      holder.appendChild(probe);
      $('cmp-side').appendChild(holder);
      tagsNeed = probe.offsetWidth ? probe.offsetWidth + 16 + 2 : 0;
      holder.remove();
    }
    return Math.max(cardsNeed, tagsNeed);
  }
  /** 札(セクター・セグメントの 2 組)の文字が変わったら、右の列の幅を測り直す(スマホの横画面で、札が 2 段にならないように。案件 91) */
  let tagsSig = '';
  function fitSide() {
    const g = root.querySelector<HTMLElement>('.tg-grps');
    const sig = g ? g.textContent + (g.hidden ? '|h' : '') : '';
    if (sig === tagsSig) return;
    tagsSig = sig;
    applyLayout();
  }
  let sideNow = layout.sideW;                           // 画面に出している右の列の幅(カードのために広げた分を含む)
  function applyLayout() {
    layout.sideW = clamp(layout.sideW, SIDE_MIN, sideMax());
    sideNeed = sideNeedW();
    sideNow = clamp(Math.max(layout.sideW, sideNeed), SIDE_MIN, sideMax());
    cmpEl.style.setProperty('--side-w', `${sideNow}px`);
    cmpEl.style.setProperty('--graph-h', `${graphNow()}px`);
    setSyncHidden((ref()?.log.circuit?.sectors.length ?? 0) === 0);
    $('cmp-sync-status').hidden = !anchor && !syncMsg;
    $('cmp-sp-g').hidden = cars.length === 0;
  }
  const saveLayout = () => session.setSetting('compare.layout', { ...layout });
  const sideSplit = makeSplitter({
    el: $('cmp-sp-v'), axis: 'x', dir: -1, initial: DEFAULT_LAYOUT.sideW,
    get: () => sideNow,
    set: (v) => { layout.sideW = v; applyLayout(); },
    min: () => Math.min(Math.max(SIDE_MIN, sideNeed), sideMax()), max: sideMax,
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

  installScrollGrip(root.querySelector<HTMLElement>('#cmp-grip')!);   // スマホの縦画面: つまみを押さえたまま上下に動かすと、画面をスクロールする(案件 79)
  installLongPressScroll(root, () => prefs.longPress);   // 長押ししてから縦になぞると、画面をスクロールする(地図・グラフの上でも。案件 44。設定でオフにできる。案件 92)
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
  syncSwap();

  // ---------- データ ----------
  /** 上部バーに出すセクター動作のボタン(右の列の同じものから、上部バーに要らないもの(入替・比較基準)を除く) */
  function syncForTop(): string {
    const c = $('cmp-sync').cloneNode(true) as HTMLElement;
    c.querySelectorAll('[data-no-top]').forEach((e) => e.remove());
    return c.innerHTML.replace(/ id="[^"]*"/g, '');
  }
  // 比較セットの選択は、右の列と、上部バーの置き場(スマホの横向きで使う。案件 46)の 2 か所に同じものを出す
  if (deps.topSlot) {
    deps.topSlot.innerHTML = `<label class="sel cmp-set">${SHOWN_MARK}<select id="cmp-set-top" class="cmp-set-sel" aria-label="表示中の比較セット"></select></label>`
      // 上部バーでは、セクターの操作と分かるよう、上に小さく「セクター動作」と書いて線でまとめる(案件 58)
      + `<div class="sync-grp" hidden><span class="sync-cap" aria-hidden="true">セクター動作</span><span class="sync-row">${syncForTop()}</span></div>`;
    // 上部バーのボタンは、右の列の同じボタンを押したことにする(動作は 1 か所で扱う)
    deps.topSlot.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const d = el?.dataset;
      if (d?.act === 'syncmode') root.querySelector<HTMLElement>(`#cmp-sync [data-act="syncmode"][data-mode="${d.mode}"]`)?.click();
      else if (d?.act === 'sync-release') $('cmp-sync-release').click();
      else if (d?.act === 'autosync') root.querySelector<HTMLElement>('#cmp-sync [data-act="autosync"]')?.click();
    });
  }
  const setSelects = (): HTMLSelectElement[] => [
    root.querySelector<HTMLSelectElement>('#cmp-set')!,
    ...(deps.topSlot ? [deps.topSlot.querySelector<HTMLSelectElement>('#cmp-set-top')!] : []),
  ];
  function renderSetSelect() {
    const html = session.sets.map((w, i) =>
      `<option value="${i}"${session.canShow(i) ? '' : ' disabled'}${i === session.activeIndex ? ' selected' : ''}>${esc(`${session.setName(i)}(${w.logs.length}本)`)}</option>`).join('');
    for (const sel of setSelects()) sel.innerHTML = html;
  }
  for (const sel of setSelects()) sel.addEventListener('change', (e) => session.setActive(Number((e.target as HTMLSelectElement).value)));

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
    off = new Map(); anchor = null; syncMsg = ''; activeSector = null; autoSkip = null;
    const has = cars.length > 0;
    $('cmp-main').hidden = !has;
    $('cmp-empty').hidden = has;
    applyLayout();
    // 割り当てが無くなった枠への追従は、固定に戻す
    if (follow !== 'fixed' && follow !== 'leader' && !cars.some((c) => c.slot === follow)) { follow = 'fixed'; panOffset = null; }
    syncFollowButtons();
    engine.setDuration(totalDuration());
    engine.seek(0);
    $<HTMLInputElement>('cmp-seek').max = String(engine.duration);
    pbSig = pbSigOf();
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
  let viewTimer: ReturnType<typeof setTimeout> | null = null;
  /** 利用者が地図を動かした・拡大縮小したか(プログラムが合わせた位置は、前回の表示位置として覚えない) */
  let viewTouched = false;
  /** 前回の表示位置を覚えるときの、サーキットの印(サーキットが無いログは空) */
  const circuitKey = () => ref()?.log.circuit?.id ?? '';
  function applyInitialView() {
    if (!map) return;
    const z = prefs.initial('zoom');
    viewTouched = false;
    panOffset = null;                                           // 地図を合わせ直すので、動かした分は消す(案件 77)
    const ctl = ref()?.log.circuit?.control;
    const atControl = prefs.startPos === 'control' && !!ctl;     // 初期位置: コントロールラインの中心
    // 初期位置が「現在の表示位置」: 前回見ていた位置と倍率(同じサーキットのときだけ。無ければ、地図の中心と同じ)
    const last = prefs.startPos === 'view' ? prefs.lastView() : null;
    const lastHere = last && last.circuit === circuitKey() ? last : null;
    applyingView = true;
    try {
      map.fit();
      if (lastHere) { map.setView(lastHere.lat, lastHere.lon, lastHere.zoom); return; }
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
      viewTouched = true;
      const lo = ZOOM_CHOICES[0], hi = ZOOM_CHOICES[ZOOM_CHOICES.length - 1];
      prefs.saveLast('zoom', Math.min(hi, Math.max(lo, Math.round(z))));
    });
    // 地図を手で動かしても追従は続ける(案件 77)。動かした分を覚えて、「追従の中心 + その分」に合わせ続ける。
    // ドラッグの途中は、追従が地図を戻さない。慣性が止まったときに、地図の中心から差を求める
    map.onUserDrag(() => { viewTouched = true; userDragging = true; });
    map.onUserDragEnd(() => {
      userDragging = false;
      if (!map || follow === 'fixed' || !camera) return;
      const v = map.getView();
      const d = { lat: v.lat - camera.lat, lon: v.lon - camera.lon };
      panOffset = Math.abs(d.lat) < 1e-9 && Math.abs(d.lon) < 1e-9 ? null : d;
      syncMenuButtons();
    });
    map.onViewChange(() => {                                   // 見ている位置と倍率を、前回の位置として覚える(動きが止まってから 1 回)
      if (applyingView) return;
      if (viewTimer) clearTimeout(viewTimer);
      viewTimer = setTimeout(() => {
        viewTimer = null;
        if (!map || !visible || !viewTouched) return;
        const v = map.getView();
        prefs.saveLastView({ circuit: circuitKey(), lat: v.lat, lon: v.lon, zoom: v.zoom });
      }, VIEW_SAVE_MS);
    });
    watchMapTap($('cmp-map'));
  }

  /**
   * 指で地図を軽くたたく(タップ)と、再生と一時停止を切り替える(案件 1)。マウスのクリックでは切り替えない。
   * 動かした(ドラッグ)・2 本の指(ピンチで拡大・縮小)・長押し・地図の上のボタンや拡大縮小のボタンは、タップとみなさない。
   * ボタンからわずかに外れた所(BTN_MARGIN 以内)も、押し損ねとみなして切り替えない(案件 43)
   */
  function watchMapTap(el: HTMLElement) {
    const TAP_MS = 350, TAP_PX = 10, BTN_MARGIN = 24;
    /** 周りを「触っても切り替えない」範囲にする、地図の上のボタンなど(拡大・縮小と出典、表示位置・表示のメニュー、セクターボタン、凡例) */
    const NEAR = '.leaflet-control, .map-ov button, .map-legend';
    const nearButton = (x: number, y: number) => {
      const box = el.closest('.cmp-map') ?? el;
      const rects = Array.from(box.querySelectorAll(NEAR), (b) => b.getBoundingClientRect());
      return nearAnyRect(x, y, rects, BTN_MARGIN);
    };
    const down = new Map<number, { x: number; y: number; t: number }>();
    let multi = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (down.size > 1) multi = true;
    });
    const end = (e: PointerEvent, cancel: boolean) => {
      const d = down.get(e.pointerId);
      if (!d) return;
      down.delete(e.pointerId);
      const wasMulti = multi;
      if (down.size === 0) multi = false;
      if (cancel || wasMulti) return;
      if (e.pointerId === menuClosingTap) { menuClosingTap = null; return; }      // 表示位置のメニューを閉じるためのタップ(案件 41)
      if (performance.now() - d.t > TAP_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX) return;
      if ((e.target as HTMLElement | null)?.closest?.('.leaflet-control, .leaflet-marker-icon, button, a')) return;
      if (nearButton(d.x, d.y)) return;                                         // ボタンの押し損ね(案件 43)
      engine.toggle();
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }

  function pushMap() {
    if (!map) return;
    // 「なし」のときは、走行ラインを 1 本も描かない(計測ラインと車の位置はそのまま)
    map.setTracks(mapMode === 'none' ? [] : shown().map((c) => ({
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
    const heat = mapMode === 'speed' || mapMode === 'accel';
    lg.hidden = !heat;
    // 凡例は地図の左下の細い帯(案件 42)。出ている間は、地図の拡大・縮小のボタンをその上へ上げる
    root.querySelector('.cmp-map')!.classList.toggle('has-legend', heat);
    if (!heat) return;
    const speed = mapMode === 'speed';
    $('cmp-leg-bar').className = `legend-bar ${speed ? 'speed' : 'accel'}`;
    // 狭い幅では「低速」「高速」(さらに狭ければ km/h も)を隠し、出典の表示に重ならないようにする(CSS)
    $('cmp-leg-lo').innerHTML = speed ? `<span class="lg-word">低速 </span>${range.lo}` : '減速';
    $('cmp-leg-hi').innerHTML = speed ? `${range.hi}<span class="lg-unit"> km/h</span><span class="lg-word"> 高速</span>` : '加速';
    lg.setAttribute('aria-label', speed ? `速度の色分け(全車共通): ${range.lo} から ${range.hi} km/h` : '加速と減速の色分け(全車共通)');
  }

  function syncLabelBtn() {
    setChecked('[data-act="carlabel"]', (b) => b.dataset.label === labelMode);
    syncMenuButtons();
  }
  /** メニューの選択肢の、選んでいる表示(✓ と色)をそろえる */
  const setChecked = (sel: string, match: (b: HTMLElement) => boolean) =>
    root.querySelectorAll<HTMLElement>(sel).forEach((b) => {
      const on = match(b);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });

  function setMapMode(m: MapMode) {
    mapMode = m;
    prefs.saveLast('mapMode', m);
    setChecked('[data-act="mapmode"]', (b) => b.dataset.mode === m);
    syncMenuButtons();
    renderLegend();
    pushMap();
  }

  function setFollow(f: Follow) {
    follow = f;
    prefs.saveLast('follow', f);
    followSlot = null; ease = null; panOffset = null;
    syncFollowButtons();
    renderMini();                                                 // 色分けの基準の車が変わる(案件 6)
    updateFrame();
  }
  function syncFollowButtons() {
    root.querySelectorAll<HTMLButtonElement>('[data-act="follow"]').forEach((b) => {
      const f = b.dataset.follow!;
      const isSlot = (SLOTS as string[]).includes(f);
      b.disabled = isSlot && !cars.some((c) => c.slot === f);
      const on = f === follow;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    syncMenuButtons();
    syncAutoUi();                                    // 「自動」の基準の車は、表示位置の選択で決まる
  }

  // ---------- 地図の上の 3 つの札(案件 73): 左上に丸いボタンを並べる。押すと、その項目の選択肢が出る。
  // 札には今の設定の名前を白抜き文字で出す(横長のカプセル)。選ぶと、その項目の選択肢は閉じる。外を押す・Esc・もう一度押しても閉じる
  type SubKey = 'pos' | 'line' | 'label' | 'sync' | 'base';       // 'sync'・'base' は、スマホの縦画面のセクターの操作(案件 6)
  const SUBS: SubKey[] = ['pos', 'line', 'label', 'sync', 'base'];
  const toolBtn = (k: SubKey) => $<HTMLButtonElement>(`cmp-tool-${k}`);
  const toolPop = (k: SubKey) => $(`cmp-sub-${k}`);
  let openSub: SubKey | null = null;
  const LINE_NAME: Record<MapMode, string> = { line: '走行ライン', speed: '速度', accel: '加減速', none: 'なし' };
  /** 札の文字(今の設定の名前)と、その説明(札の title) */
  function badgeOf(k: SubKey): { html: string; text: string } {
    if (k === 'pos') {
      // 追従中に地図を動かしたあとは、札が「中心へ」になる。押すと、追従の中心に戻す(案件 77)
      if (panOffset && follow !== 'fixed') return { html: `${CENTER_ICON}中心へ`, text: '追従の中心に戻す' };
      if (follow === 'fixed') return { html: '固定', text: '追従設定: 固定' };
      if (follow === 'leader') return { html: '先頭追従', text: '追従設定: 先頭追従' };
      return { html: `${follow} を追従`, text: `追従設定: ${follow} を追従` };
    }
    // 札は横幅を取らないように、走行ラインだけ「ライン」と出す(説明の title は「走行ライン」のまま)
    if (k === 'line') return { html: mapMode === 'line' ? 'ライン' : LINE_NAME[mapMode], text: `ライン表示: ${LINE_NAME[mapMode]}` };
    if (k === 'sync') {
      // 横軸が「距離」: 先頭車両・全車一致は効かない(基準の車が通る位置へ移るだけ)。「時間」: 選んだセクターか「自動」があるときだけ動作を選べる(案件 6)
      const mode = syncMode === 'all' ? '全車一致' : '先頭車両';
      if (xKind === 'dist') return { html: '基準車の位置', text: '横軸が「距離」のときは、基準の車が通る位置へ移動します(先頭車両・全車一致は「時間」のときだけ)' };
      if (activeSector !== null) return { html: `S${activeSector + 1} ${mode}`, text: `S${activeSector + 1} を${mode}で合わせています` };
      if (autoSync) return { html: `自動 ${mode}`, text: `セクターを通ったとき、${mode}で自動で合わせます` };
      return { html: '合わせなし', text: 'セクターを選ぶか「自動」をオンにすると、先頭車両・全車一致を選べます' };
    }
    if (k === 'base') { const t = baseLabel(); return { html: `基準: ${esc(t)}`, text: `ミニセクターの比較基準: ${t}` }; }
    return { html: LABEL_TEXT[labelMode], text: `ラベル: ${LABEL_TEXT[labelMode]}` };
  }
  function syncMenuButtons() {
    for (const k of SUBS) {
      const b = badgeOf(k);
      const host = root.querySelector<HTMLElement>(`[data-now="${k}"]`);
      if (host) host.innerHTML = b.html;
      toolBtn(k).title = b.text;
      toolBtn(k).setAttribute('aria-label', b.text);
    }
    fitSide();
    // セクター合わせの札: 動作を選べるのは、「時間」で、セクターを選んでいるか「自動」がオンのとき。解除はセクターを選んでいるか「自動」がオンのとき。
    // 中身が全部使えないときは、札も押せない
    const releasable = activeSector !== null || autoSync;
    const modesOn = xKind !== 'dist' && releasable;
    const tb = toolBtn('sync');
    tb.disabled = !modesOn && !releasable && xKind !== 'dist';                       // 距離のときは、開いて理由を見られるようにする
    $('cmp-sync-note').hidden = xKind !== 'dist';
    tb.classList.toggle('muted', !modesOn);
    tb.classList.toggle('on', activeSector !== null && xKind !== 'dist');
    root.querySelectorAll<HTMLButtonElement>('#cmp-sub-sync [data-act="syncmode"]').forEach((b) => { b.disabled = !modesOn; });
    if (tb.disabled && openSub === 'sync') setSub(null);
  }
  /** 札を開く・閉じる。一度に開くのは 1 つ(null で全部閉じる) */
  let menuScrollLock: (() => void) | null = null;
  function setSub(k: SubKey | null) {
    const was = openSub;
    openSub = k;
    for (const s of SUBS) {
      toolPop(s).hidden = s !== k;
      toolBtn(s).setAttribute('aria-expanded', String(s === k));
    }
    // スマホ横画面(案件 88): 札のメニューは右の列のスクロールの中に開く。メニューの上端を領域の上端に合わせ、それより上(ミニセクター表など)へはスクロールさせない
    menuScrollLock?.(); menuScrollLock = null;
    if (k === 'sync' || k === 'base') {
      const pop = toolPop(k), box = pop.closest<HTMLElement>('.sec-block');
      if (box && getComputedStyle(box).overflowY === 'auto') {
        pop.scrollIntoView?.({ block: 'start' });
        const min = box.scrollTop;
        const hold = () => { if (box.scrollTop < min) box.scrollTop = min; };
        box.addEventListener('scroll', hold);
        menuScrollLock = () => box.removeEventListener('scroll', hold);
      }
    }
    if (k && !was) document.addEventListener('pointerdown', onOutside, true);
    if (!k && was) document.removeEventListener('pointerdown', onOutside, true);
  }
  /** 札の外を押したら閉じる */
  let menuClosingTap: number | null = null;
  const onOutside = (e: PointerEvent) => {
    if (openSub && ((e.target as HTMLElement | null)?.closest?.('.ov-menu') === $('cmp-menu') || (e.target as HTMLElement | null)?.closest?.('.sync-tags'))) return;
    menuClosingTap = e.pointerType === 'mouse' ? null : e.pointerId;
    setSub(null);
  };

  // ---------- 右パネル ----------
  function renderCards() {
    root.querySelector('#cmp-cards')!.innerHTML = SLOTS.map((s) => {
      const c = cars.find((x) => x.slot === s);
      const k = s.toLowerCase();
      if (!c) return `<div class="card slot-${k} off"><span class="chip s${k}">${s}</span><div class="mut">未割り当て</div></div>`;
      const run = esc(session.runLabel(c.log));
      const alias = session.slotAliasOf(session.activeIndex, s);
      return `<button type="button" class="card slot-${k}" data-act="toggle-car" data-slot="${s}" aria-pressed="true"
          title="押すと地図上の表示 / 非表示を切り替えます" aria-label="${s} ${alias ? esc(alias) + ' ' : ''}${run} LAP ${c.lap.number} を地図に表示">
        <span class="chip s${k}" aria-hidden="true">${s}</span><span class="card-body">
        <span class="c1">${alias ? `${esc(alias)} <small class="card-run ${session.runAliasOf(c.log.id) ? 'ra' : 'rn'}">${run}</small>` : run}<span class="tag-hidden" hidden> ・ 非表示</span></span>
        <span class="c2 num"><span class="lapno">LAP ${c.lap.number}: </span>${formatLapTime(c.lap.duration)}</span>
        <span class="c3 num"><span data-live="speed-${k}">-</span><span class="c3-gap"${xKind === 'dist' ? ' hidden' : ''}> / <span data-live="gap-${k}">-</span></span></span></span></button>`;
    }).join('');
    applyLayout();                                        // カードの文字が変わったので、右の列の幅を測り直す(案件 89)
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
    renderMini();
    updateFrame();
  }

  /** 地図の上の線のうち、今の走行位置の区間(基準の車が通ったセクターの数)。値が変わったときだけ DOM に書く(案件 82) */
  let segOn: 'start' | 'end' | number = -1;
  function paintSegs() {
    const r = ref();
    const n = r?.log.circuit?.sectors.length ?? 0;
    if (!r || !n) { segOn = -1; return; }
    const t = localOf(r, engine.t);
    let at = 0;                                                  // 通ったセクターの数 = 区間の番号
    for (let k = 0; k < n; k++) {
      const s = r.lap.sectorTimes[k];
      if (s != null && t >= s) at++;
    }
    // 今の位置は、1 か所だけ光らせる: スタート地点(まだ走っていない)・エンド地点(到着した)の縦線、または走っている区間の横線
    const where: 'start' | 'end' | number = t >= r.series.duration - 1e-3 ? 'end' : t <= 1e-3 ? 'start' : at;
    if (where === segOn) return;
    segOn = where;
    const track = $('cmp-map-secs');
    track.querySelectorAll<HTMLElement>('.sec-seg').forEach((el) =>
      el.classList.toggle('on', Number(el.dataset.seg) === where));
    const [start, end] = Array.from(track.querySelectorAll<HTMLElement>('.sec-tick'));   // DOM の順: スタート → エンド
    start?.classList.toggle('on', where === 'start');
    end?.classList.toggle('on', where === 'end');
  }

  // ---------- ミニセクター表(案件 6): 行 = 車、列 = セクター。1 セクターは距離で 5 等分した区間 ----------
  // 列は区間(ラインが n 本なら n+1 個。ラインが無ければ 1 周全体の 1 個)。S1 = スタート〜最初のライン(案件 84)
  interface MiniData { key: string; speeds: (number | null)[][]; ranges: ({ a: number; b: number } | null)[] }
  /** ラップごとの、セクター別・区間別の平均速度。ラップが作り直されるまで使い回す(再生中は計算しない) */
  const miniCache = new WeakMap<Lap, MiniData>();
  function miniDataOf(lap: Lap, series: LapSeries, n: number): MiniData {
    // 同じラップでも、セクターの通過時刻やラップの長さが変わったら計算し直す(キーで見分ける)
    const key = `${n}|${miniSplit}|${lap.duration}|${lap.sectorTimes.join(',')}`;
    let d = miniCache.get(lap);
    if (!d || d.key !== key) {
      const ranges = Array.from({ length: n + 1 }, (_, j) => segmentRange(lap, j, n));
      d = { key, ranges, speeds: ranges.map((r) => (r ? miniSpeeds(series, r.a, r.b, MINI_COUNT, miniSplit) : Array<number | null>(MINI_COUNT).fill(null))) };
      miniCache.set(lap, d);
    }
    return d;
  }
  /** 自己ベスト: 同じ走行データのラップのうち、LAP の別名が「PB」のもの */
  const pbLapOf = (c: Car): Lap | null =>
    c.log.laps.find((l) => session.lapAliasOf(c.log.id, l.number).trim().toUpperCase() === 'PB') ?? null;
  const lapSeries = new WeakMap<Lap, LapSeries>();
  /** あるラップの、ミニセクターのデータ(車に割り当てているラップはその時系列を、そうでなければ作って使い回す) */
  function lapDataOf(log: LoadedLog, lap: Lap, n: number): MiniData {
    const own = cars.find((x) => x.lap === lap);
    if (own) return miniDataOf(lap, own.series, n);
    let s = lapSeries.get(lap);
    if (!s) { s = buildLapSeries(log.log, lap, log.offset); lapSeries.set(lap, s); }
    return miniDataOf(lap, s, n);
  }
  function pbDataOf(c: Car, n: number): MiniData | null {
    const lap = pbLapOf(c);
    return lap ? lapDataOf(c.log, lap, n) : null;
  }
  /** スマホの縦画面で、カードの上に出す 1 段: 比較基準のラップの「Run X(別名)・LAP X(別名)・タイム」(CSS で、縦画面だけ出す) */
  function renderBaseInfo() {
    const box = $('cmp-base-info');
    let html = '', title = '';
    const one = (log: LoadedLog, lap: Lap, who: string, slot?: Slot) => {
      const run = session.runLabel(log);
      const lapName = session.lapAliasOf(log.id, lap.number).trim() || `LAP ${lap.number}`;
      const time = formatLapTime(lap.duration);
      title = `${who}: ${slot ? slot + ' ' : ''}${run} ${lapName} ${time}`;
      const icon = slot ? `<span class="chip s${slot.toLowerCase()} bi-icon" aria-hidden="true">${slot}</span>` : '';       // 基準がカードのときは、そのカードのアイコン(A〜D)
      return `<span class="bi-chip">基準</span>${icon}<span class="bi-run">${esc(run)}</span><span class="bi-lap">${esc(lapName)}</span><span class="bi-time num">${time}</span>`;
    };
    const sel = baseSel();
    if (sel.kind === 'ref') {
      const time = formatLapTime(sel.lap.duration);
      const same = cars.find((c) => c.lap === sel.lap);              // 基準の走行と同じラップを割り当てたカードがあれば、そのアイコンも出す
      const icon = same ? `<span class="chip s${same.slot.toLowerCase()} bi-icon" aria-hidden="true">${same.slot}</span>` : '';
      title = `比較基準(${baseLabel()}${same ? ' = ' + same.slot : ''}): ${time}`;
      const no = session.refsOfByTime(circuitKey()).findIndex((r) => r.id === sel.ref.id) + 1;      // データ管理の基準LAP設定の「基準 N」と同じ番号(案件 86)
      html = `<span class="bi-chip">基準${no || ''}</span>${icon}<span class="bi-run">${esc(baseLabel())}</span><span class="bi-time num">${time}</span>`;
    } else { const c = baseCar(); if (c) html = one(c.log, c.lap, `比較基準(${baseLabel()})`, c.slot); }
    if (box.dataset.k === html + title) return;                  // 変わっていなければ書かない
    box.dataset.k = html + title;
    box.innerHTML = html;
    box.title = title;
  }
  function pbSigOf(): string { return cars.map((c) => `${c.slot}:${pbLapOf(c)?.number ?? '-'}`).join('|'); }
  let pbSig = '';
  /** 比較基準の選択(案件 85)。選んだカードが無い・基準の走行が使えないときは、割当最速として扱う */
  type BaseSel = { kind: 'fastest' } | { kind: 'card'; slot: Slot } | { kind: 'ref'; ref: RefLap; log: LoadedLog; lap: Lap };
  function baseSel(): BaseSel {
    const v = session.active.miniBase;
    if (v.startsWith('card:')) { const slot = v.slice(5) as Slot; if (cars.some((c) => c.slot === slot)) return { kind: 'card', slot }; }
    if (v.startsWith('ref:')) {
      const r = session.refsOf(circuitKey()).find((x) => x.id === v.slice(4));
      const x = r ? session.resolveRefLap(r) : null;
      if (r && x) return { kind: 'ref', ref: r, log: x.log, lap: x.lap };
    }
    return { kind: 'fastest' };
  }
  /** 比較基準の車(基準設定の走行を選んでいるときは null)。割当最速は、割り当てた車のうち最速のラップ */
  function baseCar(): Car | null {
    const sel = baseSel();
    if (sel.kind === 'ref') return null;
    if (sel.kind === 'card') return cars.find((c) => c.slot === sel.slot) ?? null;
    const pool = cars.some((c) => c.lap.complete) ? cars.filter((c) => c.lap.complete) : cars;
    return pool.reduce<Car | null>((b, c) => (!b || c.lap.duration < b.lap.duration ? c : b), null);
  }
  /** 札と一覧に出す、比較基準の名前 */
  function baseLabel(): string {
    const sel = baseSel();
    if (sel.kind === 'ref') return session.refLabel(sel.ref);
    if (sel.kind === 'card') return session.cardName(sel.slot);
    return '割当最速';
  }
  /** 比較基準の選択肢(札のメニュー): 割当最速・基準設定の走行(そのサーキット分)・割り当てているカード */
  function renderBaseMenu() {
    const sel = baseSel();
    const cur = sel.kind === 'card' ? `card:${sel.slot}` : sel.kind === 'ref' ? `ref:${sel.ref.id}` : 'fastest';
    const item = (key: string, text: string, title: string) =>
      `<button type="button" role="menuitemradio" data-act="minibase" data-key="${esc(key)}" aria-checked="${key === cur}"${key === cur ? ' class="on"' : ''} title="${esc(title)}">${esc(text)}</button>`;
    const refs = session.refsOfByTime(circuitKey());
    const parts = ['<div class="menu-note">自動</div>', item('fastest', '割当最速', '割り当てた車のうち、最速のラップの区間と比べます')];
    if (refs.length) {
      parts.push('<div class="menu-note">基準設定</div>');
      for (const r of refs) {
        const x = session.resolveRefLap(r);
        parts.push(item(`ref:${r.id}`, `${session.refLabel(r)}${x ? '  ' + formatLapTime(x.lap.duration) : ''}`, '基準設定で登録した走行の区間と、全ての車が比べます'));
      }
    }
    if (cars.length) {
      parts.push('<div class="menu-note">カード</div>');
      for (const c of cars) parts.push(item(`card:${c.slot}`, `${session.cardName(c.slot)}  ${formatLapTime(c.lap.duration)}`, `カード ${c.slot} の区間と、ほかの車が比べます(${c.slot} の行は青)`));
    }
    $('cmp-sub-base').innerHTML = parts.join('');
  }
  const sectorBtn = (i: number) => {
    const any = cars.some((c) => c.lap.sectorTimes[i] != null);
    return `<button class="btn sec" data-act="sector" data-k="${i}" ${any ? '' : 'disabled title="このラップは通過していません"'}
      aria-pressed="${activeSector === i}" aria-label="セクター S${i + 1} へ移動">S${i + 1}</button>`;
  };
  /** 右の列の「セクター」欄: 見出しのボタン(S1〜)と、車ごとの区間の色。基準の車の行は、自己ベストとの比較だけ */
  function renderMini() {
    if (!ref()) { $('cmp-sectors').innerHTML = ''; return; }
    const n = ref()?.log.circuit?.sectors.length ?? 0;
    const cols = n + 1;                                          // 区間の数
    renderBaseMenu();
    const sel = baseSel();
    const base = baseCar();
    const refD = sel.kind === 'ref' ? lapDataOf(sel.log, sel.lap, n) : null;
    const bd = base ? miniDataOf(base.lap, base.series, n) : null;
    // 見出しは押せないラベル(移動は、地図の上のライン(S1〜Sn)のボタンで行う)
    const headOf = (j: number) => {
      const name = n === 0 ? '全周' : `S${j + 1}`;
      const from = j === 0 ? 'スタート' : `ライン ${j}`, to = j === n ? 'エンド' : `ライン ${j + 1}`;
      return `<span class="mini-head" title="${name}: ${from}〜${to}">${name}</span>`;
    };
    const head = '<span class="mini-corner"></span>' + Array.from({ length: cols }, (_, j) => headOf(j)).join('');
    // 行は A〜D の 4 つ(未割り当ては空の行)。スマホの縦画面では、左のカードと行がそろう(CSS)
    const rows = SLOTS.map((slot) => {
      const c = cars.find((x) => x.slot === slot);
      if (!c) return `<span class="mini-name empty"></span>${'<span class="mini-cell empty"></span>'.repeat(cols)}`;
      const d = miniDataOf(c.lap, c.series, n);
      // 基準の車(の行は比べず、青)と、自己ベスト(別名「PB」)。基準設定の走行は、全ての車が比べる(同じラップを割り当てた車は、基準の車と同じ青)
      const isBase = c === base || (sel.kind === 'ref' && sel.lap === c.lap);
      const ref = isBase ? null : sel.kind === 'ref' ? refD : bd;
      const pb = pbDataOf(c, n);
      const rivalAt = (me: Car, k: number, j: number): number | null => {
        let m: number | null = null;
        for (const o of cars) {
          if (o === me) continue;
          const v = miniDataOf(o.lap, o.series, n).speeds[k]?.[j] ?? null;
          if (v !== null && (m === null || v > m)) m = v;
        }
        return m;
      };
      const off = hidden.has(c.slot) ? ' off' : '';
      const cells = Array.from({ length: cols }, (_, k) => {
        const segs = Array.from({ length: MINI_COUNT }, (_, j) =>
          `<i class="mini-seg t-${segTone(d.speeds[k][j], ref?.speeds[k]?.[j] ?? null, pb?.speeds[k]?.[j] ?? null, isBase, rivalAt(c, k, j))}" data-v="${d.speeds[k][j] === null ? '' : d.speeds[k][j]!.toFixed(1)}"></i>`).join('');
        return `<span class="mini-cell${off}" data-slot="${c.slot}" data-sk="${k}"${d.ranges[k] ? '' : ' data-none'}>${segs}</span>`;
      }).join('');
      return `<span class="mini-name${isBase ? ' is-base' : ''}${off}" style="color:${cssColor(c.slot)}"${isBase ? ' title="色分けの基準"' : ''}>${c.slot}</span>${cells}`;
    }).join('');
    renderBaseInfo();
    syncMenuButtons();
    // 末尾のステージ: 表の上を全部おおう透明な面(横向きのスマホのセクタータブで、ドラッグして再生位置を動かす。案件 90)
    $('cmp-sectors').innerHTML = `<div class="mini-tbl" style="--n:${cols}">${head}${rows}<span class="mini-stage" aria-hidden="true"></span></div>`;
    miniDone.clear();
  }
  /** 色分け。基準の車の行は、速度があるのに色が付かない区間(比べる相手が無い)を青にする */
  const segTone = (v: number | null, ref: number | null, pb: number | null, isBase: boolean, rival: number | null) => {
    const t = miniTone(v, ref, pb);
    if (t !== 'none' || !isBase || v === null) return t;
    return rival !== null && rival > v ? 'baseslow' : 'base';       // 基準の行: ほかのカードに速い区間があればオレンジ、無ければ青
  };
  /** 車ごとの、セクター別の通過済みの区間の数(「2,0,5」)。変わったときだけ DOM に書く。通過前は薄く、通過後は濃く(CSS の .done) */
  const miniDone = new Map<Slot, string>();
  function paintMini(pos: { c: Car; t: number }[]) {
    if (!ref()) return;
    const n = ref()?.log.circuit?.sectors.length ?? 0;
    for (const { c, t } of pos) {
      const d = miniDataOf(c.lap, c.series, n);
      const counts = d.ranges.map((r) => !r || t <= r.a ? 0 : t >= r.b ? MINI_COUNT : Math.max(0, miniIndexAt(c.series, r.a, r.b, t, MINI_COUNT, miniSplit)));
      const key = counts.join(',');
      if (miniDone.get(c.slot) === key) continue;
      miniDone.set(c.slot, key);
      counts.forEach((m, k) => {
        const segs = root.querySelector(`#cmp-sectors .mini-cell[data-slot="${c.slot}"][data-sk="${k}"]`)?.children;
        if (segs) for (let j = 0; j < segs.length; j++) segs[j].classList.toggle('done', j < m);
      });
    }
  }

  function renderSectors() {
    const n = ref()?.log.circuit?.sectors.length ?? 0;
    setSyncHidden(n === 0);
    renderMini();                                                // セクター設定が無いときも、1 周全体の 1 列を出す(案件 84)
    if (n === 0) {
      $('cmp-map-secs').innerHTML = '';
      renderSyncStatus();
      return;
    }
    // 地図の上: スタート・エンドの縦線と、ボタンの間の線(今の走行位置の区間だけ薄く。案件 82)
    // 並び: スタート | 区間0 | S1 | 区間1 | S2 … | Sn | 区間n | エンド
    const seg = (j: number) => `<span class="sec-seg" data-seg="${j}" aria-hidden="true"></span>`;
    const tick = '<span class="sec-tick" aria-hidden="true"></span>';
    const mapBtns = Array.from({ length: n }, (_, i) => seg(i) + sectorBtn(i)).join('');
    $('cmp-map-secs').innerHTML = tick + mapBtns + seg(n) + tick;   // スマホの幅では、地図の上にも出す(よく使うため。案件 1)
    segOn = -1;
    paintSegs();
    syncModeUi();
    renderSyncStatus();
  }

  // ---------- ミニセクター表の上のドラッグ(案件 90・横向きのスマホのセクタータブ) ----------
  // 指の速さで再生の進み方を決める(固定の速さ。core/scrub.ts)。ドラッグ中は再生を止め、指を離したとき、もとが再生中なら、もとの速さで続ける。
  // タップでは動かない(3px を超えて動いたら、ドラッグとみなす)
  let scrub: { id: number; vel: ScrubVelocity; wasPlaying: boolean; moving: boolean; raf: number } | null = null;
  function scrubFrame() {
    if (!scrub) return;
    const dt = scrub.vel.advance(performance.now());
    if (dt !== 0) engine.seek(engine.t + dt);                    // seek は 0 〜 ラップの長さに収める
    scrub.raf = requestAnimationFrame(scrubFrame);
  }
  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.mini-stage');
    if (!el || scrub || engine.duration <= 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    const vel = new ScrubVelocity(engine.duration, el.getBoundingClientRect().width);   // 速さの決め方は core/scrub.ts(遅いところは固定、速いところは表の幅 = コース全体)
    vel.press(e.clientX, performance.now());
    scrub = { id: e.pointerId, vel, wasPlaying: engine.playing, moving: false, raf: 0 };
  });
  root.addEventListener('pointermove', (e) => {
    const s = scrub;
    if (!s || e.pointerId !== s.id) return;
    s.vel.move(e.clientX, performance.now());
    if (s.moving || !s.vel.isDrag(e.clientX)) return;
    s.moving = true;
    s.vel.begin(performance.now());                              // 最初の一瞬は、速く動かしても、ゆっくりだけ進める(乱雑に触っても一気に進まない)
    if (engine.playing) engine.pause();                          // ドラッグ中は、指の動きで再生位置を動かす
    if (typeof requestAnimationFrame === 'function') s.raf = requestAnimationFrame(scrubFrame);
  });
  const endScrub = (e: PointerEvent) => {
    const s = scrub;
    if (!s || e.pointerId !== s.id) return;
    scrub = null;
    if (s.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(s.raf);
    if (s.moving && s.wasPlaying && engine.t < engine.duration - 1e-9) engine.play();   // もとが再生中なら、もとの速さで続ける
  };
  root.addEventListener('pointerup', endScrub);
  root.addEventListener('pointercancel', endScrub);

  /** ボタンの動作の切り替え表示と、その説明 */
  function syncModeUi() {
    setPressed('[data-act="syncmode"]', (b) => b.dataset.mode === syncMode);
    syncAutoUi();
  }

  // ---------- セクター通過時の自動合わせ(案件 58) ----------
  /** 自動で合わせる基準の車: 「表示位置」で選んでいる車。固定・先頭追従のときは null(先頭の車) */
  const autoSlot = (): Slot | null =>
    follow !== 'fixed' && follow !== 'leader' && cars.some((c) => c.slot === follow) ? follow : null;
  const autoWho = () => autoSlot() ?? '先頭の車';
  const autoHow = () => (syncMode === 'all' ? '全車一致' : '先頭車両');
  /** 「自動」ボタン: オンのときは基準の車を添える(「自動 A」「自動 先頭」) */
  function syncAutoUi() {
    const text = autoSync ? `自動 ${autoSlot() ?? '先頭'}` : '自動';
    const tip = `${autoWho()} がセクターを通過したとき、自動で${autoHow()}に合わせます`;
    findAll('[data-act="autosync"]').forEach((b) => {
      if (b.textContent !== text) b.textContent = text;
      b.title = tip;
      b.classList.toggle('on', autoSync);
      b.setAttribute('aria-pressed', String(autoSync));
    });
    fitSide();                                                   // 「自動 先頭」のように文字が長くなる
  }
  function setAutoSync(on: boolean) {
    autoSync = on; autoSkip = null;
    syncAutoUi();
    if (!anchor && (on || activeSector === null)) syncMsg = on ? `自動: ${autoWho()} がセクターを通過したとき、${autoHow()}で合わせます` : '';
    renderSyncStatus();
  }
  /**
   * 再生で進んだ間(tau0 → tau1)に、基準の車が通ったセクター(いくつもあれば最初のもの)。無ければ null。
   * 基準の車が先頭(固定・先頭追従)のときは、そのセクターを最初に通った車。距離ベースでは基準車(全車が同じ距離にいる)
   */
  function crossedSector(tau0: number, tau1: number): number | null {
    const n = ref()?.log.circuit?.sectors.length ?? 0;
    if (!n || tau1 <= tau0) return null;
    const slot = autoSlot();
    const lead = xKind !== 'dist' && !slot;
    const who = xKind === 'dist' ? [ref()] : slot ? cars.filter((c) => c.slot === slot) : (shown().length ? shown() : cars);
    const passed = (c: Car, k: number, tau: number) => {
      const s = c.lap.sectorTimes[k];
      return s != null && localOf(c, tau) >= s;
    };
    let best: { k: number; at: number } | null = null;
    for (let k = 0; k < n; k++) {
      if (lead && who.some((c) => passed(c, k, tau0))) continue;     // ほかの車が先に通っている(先頭の通過ではない)
      for (const c of who) {
        if (passed(c, k, tau0) || !passed(c, k, tau1)) continue;
        const at = (c.lap.sectorTimes[k] as number) - offOf(c);
        if (!best || at < best.at) best = { k, at };
      }
    }
    return best?.k ?? null;
  }
  /** セクターを通ったとき、そのセクターのボタンを点滅させる(案件 78)。再生中に基準の車が通ったときだけ。「自動」のオン・オフに関わらない */
  const passTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
  function flashSector(k: number) {
    findAll(`[data-act="sector"][data-k="${k}"]`).forEach((b) => {
      const prev = passTimers.get(b);
      if (prev) clearTimeout(prev);
      b.classList.remove('pass');
      void b.offsetWidth;                                         // 続けて通ったときも、アニメーションを最初からやり直す
      b.classList.add('pass');
      passTimers.set(b, setTimeout(() => { b.classList.remove('pass'); passTimers.delete(b); }, PASS_FLASH_MS));
    });
  }
  /** 再生で進んだ間(tau0 → tau1)の通過を調べる: ボタンを点滅させ、「自動」がオンなら、そのセクターで合わせる */
  function sectorPass(tau0: number, tau1: number) {
    const k = crossedSector(tau0, tau1);
    if (k === null) return;
    flashSector(k);
    if (!autoSync) return;
    if (autoSkip === k) { autoSkip = null; return; }
    pressSector(k, true);
    const c = xKind === 'dist' ? null : cars.find((x) => x.slot === autoSlot());
    const s = c?.lap.sectorTimes[k];
    if (c && s != null && localOf(c, engine.t) < s) autoSkip = k;
  }

  function renderSyncStatus() {
    const box = $('cmp-sync-status');
    // 通った順になっていないセクターのあるラップ(保存より前に作ったサーキットなど)は、注意を出す(案件 83)
    const warn = cars.some((c) => !isInPassOrder(c.lap.sectorTimes));
    $('cmp-sec-warn').hidden = !warn;
    box.hidden = !anchor && !syncMsg && !warn;
    $('cmp-sync-text').textContent = anchor ? `S${anchor.k + 1} で全車一致中${autoSync ? '(自動)' : ''}` : syncMsg;
    findAll('[data-act="sync-release"]').forEach((b) => { (b as HTMLButtonElement).disabled = activeSector === null && !autoSync; });   // 解除は、セクターを選んでいるか、「自動」がオンのとき
    root.querySelectorAll<HTMLElement>('[data-act="sector"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(activeSector === Number(b.dataset.k))));
    syncMenuButtons();                                              // セクター合わせの札の表示と、有効・無効
  }

  // ---------- セクターボタン ----------
  /**
   * 全車一致: 各車の時間をずらして、全車が同時にセクターを通るようにそろえ、その瞬間から表示する。
   *   いちばん遅く通る車(時刻 T)に合わせ、他の車は「その分あとからスタートした」ものとして扱う(ずれ ≤ 0)。
   * 先頭車両: ずれは作らず、先頭の車がセクターを通った時刻へ移動する。
   * どちらも、再生中なら再生のまま、一時停止中なら一時停止のまま。
   * auto: セクター通過時の自動合わせで呼んだとき(知らせる文に「(自動)」を添える)
   */
  function pressSector(k: number, auto = false) {
    const has = cars.filter((c) => c.lap.sectorTimes[k] != null);
    if (!has.length) return;
    const tOf = (c: Car) => c.lap.sectorTimes[k] as number;
    const by = auto ? '(自動)' : '';
    if (!auto) autoSkip = null;
    activeSector = k;
    if (xKind === 'dist') {                 // 距離ベース: 基準の車がセクターを通る位置へ移る(全車がその場所に並ぶ)
      const rr = ref();
      if (!rr || rr.lap.sectorTimes[k] == null) return;
      off = new Map(); anchor = null;
      syncMsg = `S${k + 1}: 基準の車が通過する位置へ移動しました${by}`;
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
      syncMsg = `S${k + 1}: ${lead.slot} が先頭で通過した時点へ移動しました${by}`;
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
  /** 値が変わったときだけ書く(再生中は毎コマ呼ばれる。同じ値でも、書くとブラウザが描き直すことがある。案件 36) */
  const setText = (e: Element, text: string) => { if (e.textContent !== text) e.textContent = text; };
  const setLive = (key: string, text: string) => {
    root.querySelectorAll(`[data-live="${key}"]`).forEach((e) => setText(e, text));
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
    const pos = fmtPos(tau);
    setText($('cmp-time'), pos);
    const seek = $<HTMLInputElement>('cmp-seek');
    const max = String(engine.duration);
    if (seek.max !== max) seek.max = max;
    seek.value = String(tau);
    if (seek.getAttribute('aria-valuetext') !== pos) seek.setAttribute('aria-valuetext', pos);
    syncPlayButton();
    // コマ送りは一時停止中のみ
    for (const id of ['cmp-fb', 'cmp-ff']) {
      const b = $<HTMLButtonElement>(id);
      if (b.disabled !== engine.playing) b.disabled = engine.playing;
    }
    if (!r) { graph.setCursor(null, []); map?.setCars([]); return; }
    paintSegs();                                                  // 地図の上の線: 今の走行位置の区間(案件 82)

    // 時間ベース: 全車が同じ経過時間の位置。距離ベース(速度グラフが「距離」): 基準の車と同じ距離の位置(その場所での走行ラインと速度を比べる)。
    // 距離ベースの距離は、物差しの走行ラインに投影したもの(コース上の同じ断面にいれば同じ距離)
    const refSample = sampleSeries(sv(r), localOf(r, tau));
    const at = (c: Car) => xKind === 'dist' && c !== r ? { ser: c.track, t: timeAtDistance(c.track, refSample.dist) }
      : c === r ? { ser: sv(r), t: localOf(r, tau) } : { ser: c.series, t: localOf(c, tau) };
    const samples = cars.map((c) => {
      const a = at(c);
      return { c, s: c === r ? refSample : sampleSeries(a.ser, a.t), a };
    });
    // 「走行アニメをなめらかにする」: 地図の車の位置・向き(と追従)だけ。速度・距離・タイム差は元の値のまま
    const smooth = prefs.smooth;
    const shown = smooth ? samples.map((x) => ({ ...x, s: { ...x.s, ...sampleSeriesSmooth(x.a.ser, x.a.t, undefined), speed: x.s.speed, dist: x.s.dist } })) : samples;
    const refDist = samples[0].s.dist;
    const onMap = shown.filter(({ c }) => !hidden.has(c.slot));
    followCamera(onMap);
    paintMini(samples.map(({ c, a }) => ({ c, t: a.t })));     // ミニセクター表: 今走っている区間(案件 6)
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
    let gapChanged = false;
    root.querySelectorAll<HTMLElement>('.c3-gap').forEach((e) => { if (e.hidden !== (xKind === 'dist')) { e.hidden = xKind === 'dist'; gapChanged = true; } });
    if (gapChanged) applyLayout();                        // 横軸を切り替えると、カードの文字の長さが変わる(案件 89)
    // 地図の車(引き出し線の先に「速度kph/タイム差」。基準の車は速度だけ)
    map?.setCars(onMap.map(({ c, s }) => ({
      slot: c.slot, lat: s.lat, lon: s.lon, heading: s.heading,
      label: labelMode === 'speed' ? `${Math.round(s.speed)}kph${gapText.has(c.slot) && xKind !== 'dist' ? `/${gapText.get(c.slot)}` : ''}`
        : labelMode === 'name' ? session.cardName(c.slot) : undefined,
    })));
  }

  type Sample = { c: Car; s: { lat: number; lon: number; dist: number }; a?: { ser: Parameters<typeof sampleSeriesSmooth>[0]; t: number } };

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
    // 追従の中心は、「走行アニメをなめらかにする」がオフでも、なめらかにした位置にする(車の表示は元の位置のまま。
    // 中心が追従車の細かな揺れを拾うと、追従車以外の車が、その揺れの分だけ揺れて見えるため。案件 69)
    const at = !prefs.smooth && tgt.a ? sampleSeriesSmooth(tgt.a.ser, tgt.a.t) : tgt.s;
    let c = { lat: at.lat, lon: at.lon };
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
    if (userDragging) return;                       // 利用者がドラッグしている間は、地図を戻さない(案件 77)
    map.setCenter(c.lat + (panOffset?.lat ?? 0), c.lon + (panOffset?.lon ?? 0));
  }

  // ---------- 再生ループ ----------
  function loop(now: number) {
    raf = 0;
    if (!engine.playing) return;
    const dt = Math.min(Math.max(now - last, 0) / 1000, 0.1);
    last = now;
    // 次のコマを、tick の前に予約する。tick の通知(下の subscribe)で再生の開始と見なされて
    // last が今の時刻に書き換わると、描画にかかった時間の分だけ再生の時計が遅れるため。
    raf = requestAnimationFrame(loop);
    const tau0 = engine.t;
    engine.tick(dt);
    sectorPass(tau0, engine.t);                       // 通過の点滅と自動合わせは再生で進んだときだけ(シークやセクターボタンでは動かない)
  }
  engine.subscribe(() => {
    updateFrame();
    if (engine.playing && !raf && typeof requestAnimationFrame === 'function') {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  });

  // ---------- 横向きのスマホ: 右の列は、カードの下に「セクター」「グラフ」のタブ(案件 63。タブが出るのは横向きのときだけ) ----------
  function setSideTab(t: 'sectors' | 'graph') {
    $('cmp-side').dataset.tab = t;
    root.querySelectorAll<HTMLElement>('#cmp-side-tabs [data-tab]').forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    });
    if (t === 'graph') graph.resize();         // 隠していた間に大きさが変わっていても、描き直す
  }

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
      case 'side-tab': setSideTab(d.tab === 'sectors' ? 'sectors' : 'graph'); break;
      case 'zoom-in': graph.zoomIn(); break;
      case 'zoom-out': graph.zoomOut(); break;
      case 'zoom-reset': graph.resetZoom(); break;
      case 'toggle-car': toggleCar(d.slot as Slot); break;
      case 'sector': pressSector(Number(d.k)); break;
      case 'minibase':
        setSub(null);
        session.setMiniBase(d.key ?? 'fastest');                 // 購読が、表の作り直しと札の更新をする
        break;
      case 'mini-info':
        void alertDialog({ title: 'ミニセクターの誤差について', detail: 'ミニセクターはGPSの位置・距離からセクター間を5分割して求めているため誤差があります。走り方やGPSの誤差で「距離分割」「時間分割」それぞれ違いが出ます。ラップを比べる目安としてご覧ください。', ok: '閉じる' });
        break;
      case 'minisplit': setMiniSplit(miniSplit === 'dist' ? 'time' : 'dist'); break;
      case 'swap-graph': sectorsFirst = !sectorsFirst; session.setSetting('compare.sectorsFirst', sectorsFirst); syncSwap(); break;
      case 'syncmode':
        syncMode = d.mode as SyncMode;
        prefs.saveLast('sync', syncMode);
        syncModeUi();
        syncMenuButtons(); setSub(null);
        if (activeSector !== null) pressSector(activeSector);      // 選んでいるセクターを、新しい動作で開始したものとして表示を計算し直す
        break;
      case 'sync-release': releaseSync(); setAutoSync(false); setSub(null); break;     // 解除すると、自動もオフ
      case 'autosync': setAutoSync(!autoSync); break;
      case 'menu-sub':
        if (d.sub === 'pos' && panOffset && follow !== 'fixed') {      // 地図を動かしたあと: 追従の中心に戻す(案件 77)
          panOffset = null;
          setSub(null);
          syncMenuButtons();
          updateFrame();
          break;
        }
        setSub(openSub === d.sub ? null : d.sub as SubKey);
        break;
      case 'mapmode': setMapMode(d.mode as MapMode); setSub(null); break;     // 選んだあとは 3 項目の表示に戻る(メニューは開いたまま)
      case 'carlabel':
        labelMode = d.label as LabelV;
        prefs.saveLast('labels', labelMode);
        syncLabelBtn();
        updateFrame();
        setSub(null);
        break;
      case 'follow': setFollow(d.follow as Follow); setSub(null); break;
      case 'back': deps.onBack(); break;
    }
  });
  $('cmp-seek').addEventListener('input', (e) => engine.seek(Number((e.target as HTMLInputElement).value)));

  /**
   * キーボード操作は再生系だけ:
   *   Space = 再生 / 一時停止、← → = 1コマ(0.1秒・一時停止中のみ)、Shift+← → = 1秒
   * どこにフォーカスがあっても同じ動きにする(直前に押したボタンが Space で再び押されないように、
   * Space は既定の動作を止める)。境界の線・ルーラーは、それ自身の矢印キー操作を優先する。
   */
  const isTextField = (t: EventTarget | null) => isTypingTarget(t, true);      // スライダーの上でも、Space・矢印は再生の操作
  const ownsArrows = (t: HTMLElement | null) => {
    const role = t?.getAttribute?.('role');
    return role === 'separator' || role === 'scrollbar';
  };
  const onKey = (e: KeyboardEvent) => {
    if (!visible || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (isTextField(t) || modalOpen()) return;
    if (e.key === 'Escape' && openSub) { e.preventDefault(); const b = toolBtn(openSub); setSub(null); b.focus(); return; }
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
  const aliasSigOf = () => SLOTS.map((s) => {
    const a = session.assignment[s];
    return session.slotAliasOf(session.activeIndex, s) + '~' + (a ? session.runAliasOf(a.logId) : '');
  }).join('|');
  const baseSigOf = () => session.active.miniBase + '|' + session.refsOf(circuitKey()).map((r) => `${r.id}:${r.name}:${r.lap}`).join(',');
  let baseSig = baseSigOf();
  session.subscribe(() => {
    renderSetSelect();
    if (visible && signature() !== sig) { sig = signature(); aliasSig = aliasSigOf(); rebuild(); return; }
    if (visible && aliasSigOf() !== aliasSig) {     // カード名だけが変わったときは、表示のまま名前だけ更新する(表示していないときは、開いたときに反映する)
      aliasSig = aliasSigOf();
      renderCards(); syncCards(); updateFrame();
    }
    if (visible && baseSigOf() !== baseSig) {       // 比較基準を選び直した・基準設定が変わった(案件 85)
      baseSig = baseSigOf();
      renderMini(); updateFrame();
    }
    if (visible && ref()) renderBaseInfo();     // Run・LAP の別名の変化を反映する
    if (visible && pbSigOf() !== pbSig) {          // 別のラップに「PB」の別名が付いた・外れた(案件 6)
      pbSig = pbSigOf();
      renderMini(); updateFrame();
    }
  });

  setChecked('[data-act="mapmode"]', (b) => b.dataset.mode === mapMode);
  setPressed('[data-act="xkind"]', (b) => b.dataset.kind === xKind);
  syncSplitUi();
  engine.setRate(prefs.initial('rate'));
  setPressed('[data-act="rate"]', (b) => Number(b.dataset.rate) === engine.rate);
  graph.setYRange(prefs.yMin, prefs.yMax);
  syncFollowButtons();
  syncLabelBtn();
  renderLegend();
  syncModeUi();

  function applyPref(key: PrefKey | 'yRange' | 'startPos' | 'autoLoad' | 'smooth' | 'longPress') {
    if (key === 'yRange') { graph.setYRange(prefs.yMin, prefs.yMax); return; }
    if (key === 'startPos') { if (visible && cars.length) applyInitialView(); return; }
    if (key === 'autoLoad' || key === 'longPress') return;   // 長押しは、判定のたびに設定を読む(案件 92)
    if (key === 'smooth') { if (visible) updateFrame(); return; }
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
        if (baseSigOf() !== baseSig) { baseSig = baseSigOf(); renderMini(); }                         // 別の画面で設定した基準(基準設定・カードの選び直し)を反映する
        if (cars.length) { ensureMap(); pushMap(); updateFrame(); }
      }
      if (cars.length) map?.invalidate();
      graph.resize();
    },
    hide() {
      visible = false;
      setSub(null);
      engine.pause();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
    },
  };
}
