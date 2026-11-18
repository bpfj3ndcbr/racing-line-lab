import {
  SPLIT_GAP_SEC, type KeepRange, type TrackLog, type TrimCut, canSplitRange, initialRanges, moveRange, rangeBounds, rangeNames,
  addRange, gapAround, includeGap, newRangeAt, rangesToCuts, splitBounds, splitRange,
} from '../core';
import { customDialog } from './dialog';
import type { MapFactory, MapTrack, TrackMap } from './mapTypes';

/**
 * 走行ログの取り込み範囲(案件 59)。走行ログを読み込むたびに、ファイルごとに出す。
 * - 止まっている時間が長い区間を除いた残りを、取り込む範囲(範囲1・範囲2…)として出す(初めはどれもチェックあり)。
 *   同じファイルを前に読み込んでいれば、そのときの範囲を出す。停止が無ければ、ログ全体の 1 つ
 * - 地図: 取り込む部分を青、取り込まない部分を灰色、選んでいる範囲を赤、分ける位置の印(間に入る 1 分)をオレンジで描く。
 *   選んでいる範囲の線は、縮小しても 2px より細くしない。つまみをドラッグしているあいだも、80ms に 1 回描き直す
 * - 全体のグラフ: ログ全体の速度。取り込まない区間は灰色。押すとその範囲を選ぶ。
 *   「＋」「−」で 2 倍ずつ拡大・縮小できる(表示の幅は 10 分まで)。拡大したら、横にスクロールして動かす。
 *   拡大は、印(分ける・足す位置)か、選んだ範囲(選んでいなければ範囲1)の中央を真ん中にする。
 *   選んだ範囲の両端にもつまみを出し、大まかに動かせる(ドラッグ・← → で 10 秒、Shift で 1 分)
 * - 選んだ範囲の「取り込み開始」「取り込み終了」の付近を、それぞれ拡大したグラフで出す(表示の幅 EDGE_WIN_SEC)。
 *   範囲が短く(JOIN_SEC 以下)、両端が 1 つの表示に収まるときは、間を省かずに 1 つのグラフ(取り込む範囲)で出す。
 *   ドラッグで縮めて、省いている間の側の枠まで来たとき、JOIN_SEC 以下で、つまみをマウスの位置に置いても
 *   もう一方の端が収まるなら、離さなくても 1 つのグラフに切り替える(つまみはマウスの位置に出す)。
 *   つまみのドラッグ・← →(Shift で 10 秒)で動かす。枠の外までドラッグすると表示もついて動き、離すとつまみを中央に表示し直す。
 *   表示がついて動くのは、つまみの動かせる範囲(隣の範囲との間など)の外が 1 分見えるところまで。
 *   隣の範囲の端は薄いつまみで出し、押すとその範囲を選ぶ
 * - 範囲を分ける: グラフ(全体・拡大)の範囲の中を押すと、そこに分ける位置の印を出し、「範囲を分ける」が押せるようになる。
 *   押すと、印を中央に 1 分の取り込まない区間を入れて 2 つにする。分けて足した範囲は「×」で消せる。
 *   範囲の外(灰色の所)を押すと、そこに足す範囲の印を出し、同じボタンが「範囲を追加」になる(長さ 2 分の範囲を足す)。
 * - 範囲の外(取り込まない区間)を押すと、その区間を選んだ表示にし、「取り込み範囲にする」が押せるようになる。
 *   押すと、その区間を取り込む範囲にする(前後の範囲とは 1 つにつなぐ)
 * - どの範囲も「×」で消せる(範囲の外になり、そこに新しく範囲を足せる)
 *   拡大のグラフでつまみを動かすのは、つまみの近く(マウスは 16px、指は 24px)を押したときだけ
 * 決まりごと(動かせる範囲・分割)は src/core/trim.ts。
 */

/** 拡大のグラフの表示の幅(秒) */
export const EDGE_WIN_SEC = 360;
/** 範囲の長さがこれ以下なら、両端を 1 つの拡大のグラフで出す(前後に 1 分ずつ余白が残る長さ) */
export const JOIN_SEC = EDGE_WIN_SEC - 120;
/** 枠の外までドラッグして表示がついて動くとき、つまみの動かせる範囲の外を見せる長さ(それより先へは表示を進めない) */
const FOLLOW_MARGIN_SEC = 60;

export type TrimResult = { kind: 'ok'; cuts: TrimCut[] } | { kind: 'skip' } | { kind: 'abort' };
export interface TrimDialogDeps {
  mapFactory?: MapFactory;
  /** 何本目か(1 から)と、全部の本数。「1 / 2」と出す */
  step?: number;
  total?: number;
  /** 前に読み込んだときの、取り込まない区間(あれば、停止の候補の代わりに使う) */
  saved?: readonly TrimCut[];
}

type Edge = 'from' | 'to';
const EDGES: Edge[] = ['from', 'to'];
/** つまみを置くグラフ: 全体('all')か、拡大('from' / 'to'。両端を 1 つで出すときは 'from' に両方) */
type Pane = 'all' | Edge;
const W = 1000;                                       // グラフの横の座標の幅(viewBox)
const H = 60;

const cssv = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** 長さの表示(「2 時間 12 分」「11 分」「45 秒」) */
export function trimDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s >= 3600) return `${Math.floor(s / 3600)} 時間 ${Math.round((s % 3600) / 60)} 分`;
  if (s >= 60) return `${Math.round(s / 60)} 分`;
  return `${s} 秒`;
}

export function trimDialog(log: TrackLog, deps: TrimDialogDeps = {}, host: HTMLElement = document.body): Promise<TrimResult> {
  const n = log.t.length, T = log.t[n - 1];
  let items: KeepRange[] = initialRanges(log, deps.saved ?? []);
  let sel = 0;
  /** 初めから停止で分かれていたか(説明の文を変える) */
  const hadStops = items.length > 1 || items[0].from > 0 || items[0].to < T;
  const wins: Record<Edge, [number, number]> = { from: [0, 0], to: [0, 0] };
  /**
   * ドラッグ中のつまみ(どのグラフの、どちらの端か)。rel があるときは、指の動いた分だけ動かす
   * (ドラッグの途中で 1 つのグラフに切り替えたあと。表示の範囲が変わっても、つまみが指の位置へ飛ばないように)
   */
  let dragging: { pane: Pane; e: Edge; rel?: { x: number; sec: number } } | null = null;
  /** 両端を 1 つの拡大のグラフで出しているか、と、出しているグラフ(初めは左。ドラッグの途中で切り替えたときは、そのグラフ) */
  let joined = false;
  let joinedPane: Edge = 'from';
  /** 全体のグラフでつまみをドラッグしたか(3px 以上動かしたら。動かさずに離したときは、押した所の click として扱う) */
  let ovDragged = false;
  let ovDownX = 0;
  /** 全体のグラフの倍率(1 = ログ全体)。最大は、表示の幅が 10 分を下回らない 2 のべき乗 */
  let ovZoom = 1;
  const ovMax = (() => { let z = 1; while (z * 2 <= T / 600) z *= 2; return z; })();
  /**
   * 印(秒)。選んだ範囲の中なら分ける位置、範囲の外(markAdd)なら範囲を足す位置。null = まだ決めていない
   */
  let mark: number | null = null;
  let markAdd = false;
  /** 選んだ取り込まない区間(その中の 1 点の秒で覚え、表示のたびに区間を求める)。null = 選んでいない */
  let gapAt: number | null = null;
  const gapSel = () => (gapAt === null ? null : gapAround(items, gapAt, T));
  let map: TrackMap | null = null;
  let vmax = 0;
  for (let i = 0; i < n; i++) if (log.speed[i] > vmax) vmax = log.speed[i];
  vmax = Math.max(vmax, 60);

  /** 時刻の表示: 日時が分かれば日本時間の時:分:秒、分からなければ先頭からの経過 */
  const clock = (sec: number) => {
    if (log.startEpochMs === null) {
      const s = Math.round(sec);
      return `+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    return new Date(log.startEpochMs + sec * 1000 + 9 * 3600 * 1000).toISOString().slice(11, 19);
  };
  const startText = () => {
    if (log.startEpochMs === null) return '';
    const d = new Date(log.startEpochMs + 9 * 3600 * 1000).toISOString();
    return `${d.slice(0, 10).replace(/-/g, '/')} ${d.slice(11, 16)} から `;
  };
  /** 時刻 sec 以上の最初のサンプル */
  const idxAt = (sec: number) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (log.t[m] < sec) lo = m + 1; else hi = m; } return lo; };

  let closed = false;
  return customDialog<TrimResult>((box, close) => {
    box.classList.add('wide', 'tr');
    const step = deps.total && deps.total > 1 ? `<span class="tr-step">${deps.step ?? 1} / ${deps.total}</span>` : '';
    box.innerHTML = `<div class="tr-h"><h3 id="tr-t">走行ログの取り込み範囲</h3>${step}</div>
      <div class="tr-body">
      <div class="tr-file"></div>
      <p class="tr-desc"></p>
      <div class="tr-main">
        ${deps.mapFactory ? '<div class="tr-map"><div class="map"></div></div>' : ''}
        <div class="tr-list" aria-label="取り込む範囲"></div>
        <div class="tr-work"><div class="tr-tl"><div class="tr-cap"><span class="tr-ovl">全体(速度)<span class="tr-ovz"><button type="button" class="btn sm tr-z" data-trim="zout" aria-label="全体のグラフを縮小" title="縮小">−</button><span class="tr-zl"></span><button type="button" class="btn sm tr-z" data-trim="zin" aria-label="全体のグラフを拡大" title="拡大(拡大したら、横にスクロールできます)">＋</button></span></span><span class="tr-sum" role="status"></span></div><div class="tr-g tr-all"><div class="tr-all-in"></div></div></div>
        <div class="tr-det">
          <div class="tr-cap"><span class="tr-det-cap"></span><span class="tr-det-r"><button type="button" class="btn sm tr-add" data-trim="include" title="選んだ取り込まない区間を、取り込む範囲にします(前後の範囲とは 1 つにつなぎます)">取り込み範囲にする</button><button type="button" class="btn sm tr-add" data-trim="split" title="グラフで押した位置に 1 分の取り込まない区間を入れて、2 つに分けます">範囲を分ける</button></span></div>
          <div class="tr-hint" role="status"></div>
          <div class="tr-edges">${EDGES.map((e) => `<div class="tr-edge" data-edge="${e}"><div class="tr-cap"><span><span class="tr-e-l"></span> <b class="tr-e-t"></b></span><span>表示の幅 ${EDGE_WIN_SEC / 60} 分</span></div><div class="tr-g tr-zoom"></div></div>`).join('')}</div>
        </div></div>
      </div>
      </div>
      <div class="modal-actions tr-actions"><button type="button" class="btn" data-trim="abort">全ての読み込みを止める</button><button type="button" class="btn" data-trim="skip">このファイルの読み込みを止める</button><span class="sp"></span><button type="button" class="btn pri" data-trim="next">次へ</button></div>`;
    box.setAttribute('aria-labelledby', 'tr-t');
    box.querySelector('.tr-file')!.textContent = `${log.fileName}(${startText()}${trimDuration(T)})`;
    box.querySelector('.tr-desc')!.textContent = `${hadStops ? '止まっている時間が長い区間を除いて、取り込む範囲を決めました。' : '止まっている時間が長い区間はありませんでした。'}チェックした範囲を取り込みます(範囲の外は保存もされません)。グラフのつまみで範囲を直せます。`;
    const $ = <E extends HTMLElement>(s: string) => box.querySelector<E>(s)!;
    const edgeEl = (e: Edge) => $(`.tr-edge[data-edge="${e}"]`);

    /**
     * グラフの SVG: 時刻 a〜b の速度と、取り込まない区間(灰色)。overview のときは、範囲ごとの押せる帯も重ねる
     * (選んだ範囲は枠付き)
     */
    const graph = (a: number, b: number, overview: boolean) => {
      // 全体のグラフは、拡大した倍率だけ座標の幅も広げる(1 単位が拡大しても 1px 前後のまま。
      // 細い帯の最小の幅や、座標の丸めが、拡大で何十 px にも広がらないように)
      const GW = overview ? W * ovZoom : W;
      const x = (sec: number) => ((sec - a) / (b - a)) * GW;
      const rect = (c: TrimCut, cls: string, attr = '') => {
        let x0 = Math.max(0, x(c.from)), x1 = Math.min(GW, x(c.to));
        if (x1 <= 0 || x0 >= GW) return '';
        // 細すぎる帯は見えるように幅を広げる(本当の位置を中心に)
        const min = overview ? 2 : 0.5;
        if (x1 - x0 < min) { const m = (x0 + x1) / 2; x0 = m - min / 2; x1 = m + min / 2; }
        return `<rect class="${cls}"${attr} x="${x0.toFixed(1)}" y="0" width="${(x1 - x0).toFixed(1)}" height="${H}"/>`;
      };
      let bands = rangesToCuts(items, T).map((c) => rect(c, 'tr-band on')).join('');
      const gap = gapSel();
      if (overview) bands += items.map((c, i) => rect(c, `tr-band keep${i === sel && !gap ? ' sel' : ''}`, ` data-i="${i}"`)).join('');
      if (gap) bands += rect(gap, 'tr-band gap');       // 選んだ取り込まない区間(枠だけ。押すのは下の帯)
      // 全体のグラフは、拡大したぶん細かく描く
      const i0 = idxAt(a), i1 = Math.min(n - 1, idxAt(b) + 1), stepN = Math.max(1, Math.floor((i1 - i0) / (overview ? Math.min(24000, 1500 * ovZoom) : 1500)));
      const pts: string[] = [];
      for (let i = i0; i <= i1; i += stepN) pts.push(`${x(log.t[i]).toFixed(1)},${(H - 2 - (log.speed[i] / vmax) * (H - 6)).toFixed(1)}`);
      const shown = overview ? T / ovZoom : b - a;     // 見えている幅(秒)
      const tick = shown > 4 * 3600 ? 3600 : shown > 2400 ? 600 : 60;
      let ticks = '';
      for (let s = Math.ceil(a / tick) * tick; s < b; s += tick) if (s > a) ticks += `M${x(s).toFixed(1)} ${H}V${H - 5}`;
      return `<svg viewBox="0 0 ${GW} ${H}" preserveAspectRatio="none" aria-hidden="true">${bands}<polyline class="tr-line" points="${pts.join(' ')}"/>${ticks ? `<path class="tr-tick" d="${ticks}"/>` : ''}</svg>`;
    };

    const LABEL: Record<Edge, string> = { from: '取り込み開始', to: '取り込み終了' };
    const centerWin = (e: Edge) => {
      const c = items[sel], h = joined ? (c.from + c.to) / 2 : c[e];
      const a = Math.max(0, Math.min(Math.max(0, T - EDGE_WIN_SEC), h - EDGE_WIN_SEC / 2));
      wins[e] = [a, Math.min(T, a + EDGE_WIN_SEC)];
    };
    /** 選んだ範囲のつまみ(フォーカスでき、← → で動かせる) */
    const knob = (pane: Pane, e: Edge, left: string) => {
      const label = pane === 'all' ? `${LABEL[e]}(全体)` : LABEL[e];
      return `<span class="tr-knob" data-pane="${pane}" data-k="${e}" style="left:${left}%" tabindex="0" role="slider" aria-label="${label}" aria-valuetext="${clock(items[sel][e])}" title="ドラッグ・← → で動かせます"></span>`;
    };
    /** 分ける位置の印(時刻 a〜b のグラフの上。間に入る 1 分の幅で出す) */
    const markEl = (a: number, b: number) => {
      if (mark === null) return '';
      // 分けるときは間に入る 1 分、足すときは足す範囲の幅で出す
      const add = markAdd ? newRangeAt(items, mark, T) : null;
      const [m0, m1] = add ? [add.from, add.to] : [mark - SPLIT_GAP_SEC / 2, mark + SPLIT_GAP_SEC / 2];
      if (m1 < a || m0 > b) return '';
      const pct = (sec: number) => ((Math.max(a, Math.min(b, sec)) - a) / (b - a)) * 100;
      const l = pct(m0), r = pct(m1);
      return `<span class="tr-mark${markAdd ? ' add' : ''}" style="left:${l.toFixed(2)}%;width:${(r - l).toFixed(2)}%" title="${markAdd ? '追加する位置' : '分ける位置'} ${clock(mark)}"></span>`;
    };
    /** 分ける位置の印を置く(選んだ範囲の、分けられるところに収める。分けられない範囲なら置かない) */
    const setMark = (sec: number) => {
      markAdd = false;
      gapAt = null;
      if (sel < 0) { mark = null; return; }
      const [lo, hi] = splitBounds(items[sel]);
      mark = lo <= hi ? Math.round(Math.min(hi, Math.max(lo, sec))) : null;
    };
    /** 範囲を足す位置の印を置く(範囲の外で、足せるところだけ) */
    /** 押した所の取り込まない区間を選び、足す位置の印も置く(足せないほど狭ければ、区間を選ぶだけ) */
    const selectGap = (sec: number) => {
      gapAt = gapAround(items, sec, T) ? sec : null;
      setAddMark(sec);
    };
    const setAddMark = (sec: number) => {
      const s = Math.round(sec);
      if (newRangeAt(items, s, T)) { mark = s; markAdd = true; } else { mark = null; markAdd = false; }
    };
    /** グラフ(拡大は wins、全体は 0〜T)の上に出す、選んだ範囲の端 */
    const paneEdges = (pane: Pane): Edge[] => {
      if (sel < 0) return [];
      if (pane === 'all' || (joined && pane === joinedPane)) return EDGES;
      return joined ? [] : [pane];
    };
    const paneWin = (pane: Pane): [number, number] => (pane === 'all' ? [0, T] : wins[pane]);

    function renderList() {
      const names = rangeNames(items);
      const list = $('.tr-list');
      list.innerHTML = items.map((c, i) => `<div class="tr-row${i === sel ? ' sel' : ''}${c.on ? '' : ' off'}" data-row="${i}">
        <input type="checkbox" data-check="${i}" ${c.on ? 'checked' : ''} aria-label="${names[i]}を取り込む">
        <b>${names[i]}${c.added ? '<span class="tr-added">(追加)</span>' : ''}</b><span class="tr-range">${clock(c.from)}〜${clock(c.to)}(${trimDuration(c.to - c.from)})</span>
        <button type="button" class="btn tr-del" data-del="${i}" aria-label="${names[i]}を消す" title="範囲を消します(取り込みません。消したところには、新しく範囲を足せます)">×</button></div>`).join('')
        || '<p class="tr-none">取り込む範囲がありません。グラフの灰色の所を押すと、範囲を足せます。</p>';
      list.querySelector('.tr-row.sel')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    function renderEdges() {
      // 「範囲を分ける」は、印が範囲の外(足す位置)のときは「範囲を追加」になる
      const btn = $<HTMLButtonElement>('[data-trim="split"]');
      btn.disabled = mark === null;
      btn.textContent = markAdd ? '範囲を追加' : '範囲を分ける';
      btn.title = markAdd ? 'グラフで押した位置に、2 分の範囲を足します' : 'グラフで押した位置に 1 分の取り込まない区間を入れて、2 つに分けます';
      $('.tr-hint').textContent = mark !== null ? `${markAdd ? '追加する位置' : '分ける位置'} ${clock(mark)}`
        : sel >= 0 && canSplitRange(items[sel]) ? 'グラフを押すと、分ける位置(灰色の所なら足す位置)を決められます' : 'グラフの灰色の所を押すと、範囲を足せます';
      const gap = gapSel();
      $<HTMLButtonElement>('[data-trim="include"]').disabled = !gap;
      $('.tr-edges').hidden = sel < 0;
      const names = rangeNames(items);
      $('.tr-det-cap').textContent = gap ? `取り込まない区間(${trimDuration(gap.to - gap.from)})`
        : sel < 0 ? '範囲を選んでいません' : `${names[sel]}(${trimDuration(items[sel].to - items[sel].from)})`;
      if (sel < 0) return;
      const c = items[sel];
      // 両端が 1 つの表示に収まる短い範囲は、間を省かずに 1 つのグラフで出す
      // (拡大のグラフをドラッグしているあいだは決め直さない。離したときに決め直す)
      if (!dragging || dragging.pane === 'all') {
        joined = c.to - c.from <= JOIN_SEC;
        if (!joined) joinedPane = 'from';
      }
      for (const e of EDGES) {
        const el = edgeEl(e);
        const ks = paneEdges(e);
        const g = el.querySelector<HTMLElement>('.tr-zoom')!;
        el.hidden = !ks.length;
        if (el.hidden) { g.innerHTML = ''; continue; }  // 隠したグラフに、前のつまみを残さない
        if (dragging?.pane !== e) centerWin(e);
        const [a, b] = wins[e];
        el.querySelector('.tr-e-l')!.textContent = joined ? '取り込む範囲' : LABEL[e];
        el.querySelector('.tr-e-t')!.textContent = joined ? `${clock(c.from)}〜${clock(c.to)}` : clock(c[e]);
        const pct = (sec: number) => (((sec - a) / (b - a)) * 100).toFixed(2);
        // 隣の範囲の端(押すとその範囲を選ぶ)
        const subs = items.flatMap((o, i) => (i === sel ? [] : EDGES.filter((oe) => o[oe] > a && o[oe] < b)
          .map((oe) => `<span class="tr-knob sub" data-pick="${i}" style="left:${pct(o[oe])}%" title="${names[i]}を選ぶ"></span>`))).join('');
        g.innerHTML = graph(a, b, false) + markEl(a, b) + subs + ks.map((k) => knob(e, k, pct(c[k]))).join('');
      }
    }

    function renderMap() {
      if (!map) return;
      const stepN = Math.max(1, Math.floor(n / 20000));
      const cuts = rangesToCuts(items, T);
      const cut = (sec: number) => cuts.some((c) => sec >= c.from && sec <= c.to);
      const keep: [number, number][][] = [], gone: [number, number][][] = [];
      let cur: [number, number][] | null = null, curCut: boolean | null = null;
      for (let i = 0; i < n; i += stepN) {
        const k = cut(log.t[i]);
        if (k !== curCut) { cur = []; (k ? gone : keep).push(cur); curCut = k; }
        cur!.push([log.lat[i], log.lon[i]]);
      }
      /** 時刻 a〜b の線 */
      const part = (a: number, b: number) => {
        const p: [number, number][] = [];
        for (let i = idxAt(a); i < n && log.t[i] <= b; i += Math.max(1, Math.floor(stepN / 2))) p.push([log.lat[i], log.lon[i]]);
        return p.length > 1 ? [p] : [];
      };
      // 選んでいる範囲は赤、分ける位置の印(間に入る 1 分)はオレンジで重ねる
      const selPart = sel >= 0 ? part(items[sel].from, items[sel].to) : [];
      const splitPart = mark !== null && !markAdd ? part(mark - SPLIT_GAP_SEC / 2, mark + SPLIT_GAP_SEC / 2) : [];
      const tracks: MapTrack[] = [
        ...gone.filter((p) => p.length > 1).map((points): MapTrack => ({ slot: 'A', points, color: cssv('--muted', '#888') })),
        ...keep.filter((p) => p.length > 1).map((points): MapTrack => ({ slot: 'B', points, color: cssv('--b', '#1f6fd1') })),
        ...selPart.map((points): MapTrack => ({ slot: 'C', points, color: cssv('--a', '#d63a3a'), minWidth: 2 })),   // 選んでいる範囲は太く
        ...splitPart.map((points): MapTrack => ({ slot: 'D', points, color: cssv('--d', '#f2b705') })),
      ];
      map.setTracks(tracks);
    }

    function render(withMap = true) {
      renderList();
      const cutSec = rangesToCuts(items, T).reduce((s, c) => s + (c.to - c.from), 0);
      const none = !items.some((c) => c.on);
      $('.tr-sum').textContent = none ? '取り込む範囲がありません' : `取り込むのは ${trimDuration(T - cutSec)}(元の ${Math.round(((T - cutSec) / T) * 100)}%)`;
      $<HTMLButtonElement>('[data-trim="next"]').disabled = none;     // どれもチェックしていなければ進めない
      const inn = $('.tr-all-in');
      inn.style.width = `${ovZoom * 100}%`;
      $('.tr-all').classList.toggle('zoomed', ovZoom > 1);
      $('.tr-zl').textContent = ovZoom === 1 ? '全体' : `×${ovZoom}`;
      $<HTMLButtonElement>('[data-trim="zin"]').disabled = ovZoom >= ovMax;
      $<HTMLButtonElement>('[data-trim="zout"]').disabled = ovZoom <= 1;
      inn.innerHTML = graph(0, T, true) + markEl(0, T) + paneEdges('all').map((k) => knob('all', k, ((items[sel][k] / T) * 100).toFixed(2))).join('');
      renderEdges();
      if (withMap) renderMap(); else scheduleMap();
    }
    /** ドラッグ中などは、地図をまとめて描き直す(80ms に 1 回まで。つまみの動きに地図の色分けもついていく) */
    let mapTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleMap() {
      if (!map || mapTimer) return;
      mapTimer = setTimeout(() => { mapTimer = null; if (!closed) renderMap(); }, 80);
    }

    /** 全体のグラフの、画面の x の時刻(拡大していると、内側の要素は表示より広い)。大きさが分からなければ null */
    const ovSecAt = (clientX: number) => {
      const r = $('.tr-all-in').getBoundingClientRect();
      return r.width > 0 ? ((clientX - r.left) / r.width) * T : null;
    };
    /**
     * 全体のグラフの倍率を変える。拡大は、印があれば印、なければ選んだ範囲(選んでいなければ範囲1)の中央を真ん中にする。
     * 縮小は、見えている中央を保つ
     */
    const setOvZoom = (z: number) => {
      const g = $('.tr-all'), cw = g.clientWidth;
      const c = items[sel] ?? items[0];
      const focus = mark ?? (c ? (c.from + c.to) / 2 : null);
      const center = z > ovZoom && focus !== null ? focus : cw > 0 ? ((g.scrollLeft + cw / 2) / (cw * ovZoom)) * T : T / 2;
      ovZoom = Math.max(1, Math.min(ovMax, z));
      render(false);
      if (cw > 0) g.scrollLeft = (center / T) * cw * ovZoom - cw / 2;
    };
    /** 拡大した全体のグラフで、範囲が見えていなければ、その始まりが見えるようにスクロールする */
    const revealOv = (c: TrimCut) => {
      const g = $('.tr-all'), cw = g.clientWidth;
      if (ovZoom === 1 || cw <= 0) return;
      const x = (sec: number) => (sec / T) * cw * ovZoom;
      if (x(c.to) < g.scrollLeft || x(c.from) > g.scrollLeft + cw) g.scrollLeft = x(c.from) - cw / 4;
    };
    const select = (i: number) => { if (i >= 0 && i < items.length) { sel = i; joinedPane = 'from'; mark = null; markAdd = false; gapAt = null; render(); revealOv(items[i]); } };
    const move = (e: Edge, sec: number) => {
      items = moveRange(items, sel, e, Math.round(sec), T);
      if (mark !== null) { if (markAdd) setAddMark(mark); else setMark(mark); }   // 範囲が変わったら、印も置けるところに収める
    };

    // 一覧: 行を押すと選ぶ。チェックで取り込む / 取り込まないを切り替える。「×」で分けて足した範囲を消す
    box.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const del = t.closest<HTMLElement>('[data-del]');
      if (del) {
        const i = Number(del.dataset.del);
        items = items.filter((_, k) => k !== i);
        joinedPane = 'from';
        mark = null;
        markAdd = false;
        gapAt = null;
        sel = items.length ? Math.min(Math.max(0, i - 1), items.length - 1) : -1;
        render();
        return;
      }
      const check = t.closest<HTMLInputElement>('[data-check]');
      if (check) { const i = Number(check.dataset.check); items = items.map((c, k) => (k === i ? { ...c, on: check.checked } : c)); sel = i; render(); return; }
      const row = t.closest<HTMLElement>('[data-row]');
      if (row) { select(Number(row.dataset.row)); return; }
      const band = t.closest<SVGElement>('.tr-all [data-i]');
      if (band) {
        // 全体のグラフで範囲を押すと、その範囲を選び、押した位置に分ける位置の印を置く
        if (!ovDragged) {
          const i = Number(band.dataset.i);
          if (i !== sel) { sel = i; joinedPane = 'from'; }
          setMark(ovSecAt(ev.clientX) ?? (items[sel].from + items[sel].to) / 2);
          render();
        }
        ovDragged = false;
        return;
      }
      // 全体のグラフで範囲の外(灰色の所)を押すと、その区間を選び、範囲を足す位置の印を置く。
      // つまみを動かさずに離したときも、押した所が範囲の外なら同じ(狭い区間はつまみに重なるため)
      if (t.closest('.tr-all')) {
        if (!ovDragged) {
          const sec = ovSecAt(ev.clientX);
          if (sec !== null && gapAround(items, sec, T)) { selectGap(sec); render(); }
        }
        ovDragged = false;
        return;
      }
      const act = t.closest<HTMLElement>('[data-trim]')?.dataset.trim;
      if (act === 'zin' || act === 'zout') { setOvZoom(act === 'zin' ? ovZoom * 2 : ovZoom / 2); return; }
      if (act === 'split' && mark !== null && markAdd) {
        const r = addRange(items, mark, T);
        if (r.index >= 0) { items = r.ranges; sel = r.index; }
        joinedPane = 'from'; mark = null; markAdd = false; gapAt = null; render();
        return;
      }
      if (act === 'include' && gapAt !== null) {
        const r = includeGap(items, gapAt, T);
        if (r.index >= 0) { items = r.ranges; sel = r.index; }
        joinedPane = 'from'; mark = null; markAdd = false; gapAt = null; render();
        return;
      }
      if (act === 'split') { if (sel >= 0 && mark !== null) { items = splitRange(items, sel, mark); sel += 1; joinedPane = 'from'; mark = null; gapAt = null; render(); } return; }
      if (act === 'next') { if (items.some((c) => c.on)) close({ kind: 'ok', cuts: rangesToCuts(items, T) }); return; }
      if (act === 'skip') close({ kind: 'skip' });
      if (act === 'abort') close({ kind: 'abort' });
    });

    // つまみのドラッグ(拡大のグラフ・全体のグラフ)
    const PANES: Pane[] = ['all', 'from', 'to'];
    const paneG = (pane: Pane) => (pane === 'all' ? $('.tr-all') : edgeEl(pane).querySelector<HTMLElement>('.tr-zoom')!);
    for (const pane of PANES) {
      const g = paneG(pane);
      // 時刻と画面の位置の対応は、全体のグラフでは内側の要素(拡大したときは表示より広い)で取る
      const mapRect = () => (pane === 'all' ? $('.tr-all-in') : g).getBoundingClientRect();
      const secAt = (clientX: number) => {
        const r = mapRect(), [a, b] = paneWin(pane);
        return r.width > 0 ? a + ((clientX - r.left) / r.width) * (b - a) : a;
      };
      /** 押した位置に近いつまみ。つまみの近く(マウスは全体のグラフで 12px・拡大のグラフで 16px、指は 24px)を押したときだけ */
      const nearest = (ev: PointerEvent): Edge | null => {
        const ks = paneEdges(pane);
        const own = (ev.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as Edge | undefined;
        if (own && ks.includes(own)) return own;
        if (!ks.length) return null;
        const r = mapRect(), [a, b] = paneWin(pane);
        const px = (sec: number) => r.left + ((sec - a) / (b - a)) * r.width;
        const best = ks.reduce((p, k) => (Math.abs(px(items[sel][k]) - ev.clientX) < Math.abs(px(items[sel][p]) - ev.clientX) ? k : p));
        const tol = ev.pointerType === 'touch' ? 24 : pane === 'all' ? 12 : 16;
        if (!(r.width > 0 && Math.abs(px(items[sel][best]) - ev.clientX) <= tol)) return null;
        return best;
      };
      g.addEventListener('pointerdown', (ev) => {
        const pick = (ev.target as HTMLElement).closest<HTMLElement>('[data-pick]');
        if (pick) { select(Number(pick.dataset.pick)); return; }
        if (pane === 'all') { ovDragged = false; ovDownX = ev.clientX; }
        if (sel < 0) return;
        const e = nearest(ev);
        if (!e) {
          // つまみから離れたところ。全体のグラフは click で(範囲を選び、印を置く)。
          // 拡大のグラフは、選んだ範囲の中なら分ける位置、範囲の外なら足す位置の印を置く
          if (pane !== 'all') {
            const sec = secAt(ev.clientX), c = items[sel];
            if (sec >= c.from && sec <= c.to) { setMark(sec); render(); }
            else if (!items.some((o) => sec >= o.from && sec <= o.to)) { selectGap(sec); render(); }
          }
          return;
        }
        dragging = { pane, e };
        try { g.setPointerCapture?.(ev.pointerId); } catch { /* 本物でないポインター(試験の操作など)では取れない */ }
        if (pane !== 'all') { move(e, secAt(ev.clientX)); render(false); }
      });
      g.addEventListener('pointermove', (ev) => {
        if (dragging?.pane !== pane) return;
        const r = g.getBoundingClientRect();
        if (r.width <= 0) return;
        const e = dragging.e;
        if (pane === 'all') {
          if (!ovDragged && Math.abs(ev.clientX - ovDownX) < 3) return;   // 押しただけ(click)は動かさない
          ovDragged = true;
          move(e, secAt(Math.min(r.right, Math.max(r.left, ev.clientX))));
          render(false);
          return;
        }
        if (dragging.rel) {
          // 1 つのグラフに切り替えたあと: 指の動いた分だけ動かす
          const [a, b] = wins[pane];
          move(e, dragging.rel.sec + ((ev.clientX - dragging.rel.x) / r.width) * (b - a));
        } else {
          // 枠の外までドラッグしたら、表示もついて動く(画面の幅を超えて動かせる)
          const [a, b] = wins[pane];
          const over = ev.clientX > r.right ? ev.clientX - r.right : ev.clientX < r.left ? ev.clientX - r.left : 0;
          if (over) {
            // 動かせる範囲(隣の範囲・30 秒の決まり)の外は FOLLOW_MARGIN_SEC だけ見せ、それより先へは表示を進めない
            // (隣の区間まで流れていくと、何を動かしているか分からなくなるため)
            const [lo, hi] = rangeBounds(items, sel, e, T);
            const d = (over / r.width) * EDGE_WIN_SEC;
            let na = a + d;
            if (d < 0) na = Math.max(na, Math.min(a, lo - FOLLOW_MARGIN_SEC));
            else na = Math.min(na, Math.max(a, hi + FOLLOW_MARGIN_SEC - (b - a)));
            na = Math.max(0, Math.min(Math.max(0, T - EDGE_WIN_SEC), na));
            wins[pane] = [na, Math.min(T, na + (b - a))];
          }
          move(e, secAt(Math.min(r.right, Math.max(r.left, ev.clientX))));
          // 省いている間の側(左のグラフは右、右のグラフは左)の枠まで来て、両端が 1 つの表示に収まる長さになったら、
          // 離さなくても 1 つのグラフに切り替える
          const c = items[sel], len = c.to - c.from, m = 0.03;
          const inward = (e === 'from' && over > 0) || (e === 'to' && over < 0);
          /** 1 つのグラフ(拡大のグラフの欄の幅いっぱい)で、マウスの位置 x につまみを置いたとき、もう一方の端も収まるか */
          const fits = (rr: DOMRect, x: number) => {
            if (rr.width <= 0) return true;
            const f = (x - rr.left) / rr.width;
            return e === 'from' ? f >= m && f + len / EDGE_WIN_SEC <= 1 - m : f <= 1 - m && f - len / EDGE_WIN_SEC >= m;
          };
          if (!joined && inward && len <= JOIN_SEC && fits($('.tr-edges').getBoundingClientRect(), ev.clientX)) {
            joined = true;
            joinedPane = pane;
            render(false);                               // 1 つのグラフにしてから(幅が変わる)、表示の範囲を決める
            // マウスの位置につまみが来るように表示の範囲を決める(マウスの方は動かせないため。もう一方の端も収まる範囲で)
            const r2 = g.getBoundingClientRect(), h = c[e];
            let f = r2.width > 0 ? (ev.clientX - r2.left) / r2.width : 0.5;
            f = e === 'from' ? Math.min(Math.max(f, m), 1 - m - len / EDGE_WIN_SEC) : Math.max(Math.min(f, 1 - m), m + len / EDGE_WIN_SEC);
            const na = Math.max(0, Math.min(Math.max(0, T - EDGE_WIN_SEC), h - f * EDGE_WIN_SEC));
            wins[pane] = [na, Math.min(T, na + EDGE_WIN_SEC)];
            dragging.rel = { x: ev.clientX, sec: h };
          }
        }
        // つまみがそれ以上動けない(隣の端・30 秒の決まり)ときは、表示だけ先へ行かないようにする
        const [a, b] = wins[pane], h = items[sel][e];
        if (h < a || h > b) {
          const na = Math.max(0, Math.min(Math.max(0, T - (b - a)), h < a ? h - FOLLOW_MARGIN_SEC : h + FOLLOW_MARGIN_SEC - (b - a)));
          wins[pane] = [na, Math.min(T, na + (b - a))];
        }
        render(false);
      });
      const end = (ev: PointerEvent) => {
        if (dragging?.pane !== pane) return;
        dragging = null;
        // 全体のグラフで、つまみを動かさずに離したとき: 押した所が範囲の外なら、その区間を選ぶ
        // (描き直しでつまみが入れ替わり、click が届かないため、ここで扱う)
        if (pane === 'all' && !ovDragged && ev.type === 'pointerup') {
          const sec = ovSecAt(ev.clientX);
          if (sec !== null && gapAround(items, sec, T)) selectGap(sec);
        }
        render();
      };
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
    }
    // つまみの ← →: 拡大のグラフは 1 秒(Shift で 10 秒)、全体のグラフは 10 秒(Shift で 1 分)
    box.addEventListener('keydown', (ev) => {
      const k = (ev.target as HTMLElement).closest?.<HTMLElement>('[data-k]');
      if (!k || sel < 0 || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
      ev.preventDefault();
      const e = k.dataset.k as Edge, pane = k.dataset.pane as Pane;
      const d = pane === 'all' ? (ev.shiftKey ? 60 : 10) : (ev.shiftKey ? 10 : 1);
      move(e, items[sel][e] + (ev.key === 'ArrowRight' ? 1 : -1) * d);
      render();
      // 描き直したつまみにフォーカスを戻す(両端を 1 つで出すかどうかが変わったときは、出ている方)
      (box.querySelector<HTMLElement>(`[data-pane="${pane}"][data-k="${e}"]`)
        ?? box.querySelector<HTMLElement>(`.tr-zoom [data-k="${e}"]`))?.focus();
    });

    render(false);
    // 地図は、ダイアログが画面に入ってから作る(大きさが決まってから。読み込みの確認と同じ)
    if (deps.mapFactory) {
      const factory = deps.mapFactory;
      setTimeout(() => {
        if (closed) return;
        map = factory($('.tr-map .map'));
        renderMap();
        map.invalidate();
        map.fit();
      }, 0);
    }
    return $<HTMLButtonElement>('[data-trim="next"]');
  }, { kind: 'skip' }, host).finally(() => { closed = true; map?.destroy(); map = null; });
}
