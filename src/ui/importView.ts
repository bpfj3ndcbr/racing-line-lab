import {
  SLOTS, type Lap, type Slot, bestPerColumn, LINE_DIGITS, formatCln, formatJst, formatLapTime, formatSci, isBest, nameExists, sectorSplits,
} from '../core';
import { ALIAS_MAX, SET_COUNT, SLOT_ALIAS_MAX, type LoadedLog, type Session, type WorkSet, bestDuration } from '../store/session';
import { mountCircuitEditor, type CircuitEditor } from './circuitEditor';
import { candidateLabel, loadDialog, planLoad } from './loadDialog';
import { mountCorrectView, type CorrectView } from './correctView';
import { alertDialog, promptDialog } from './dialog';
import type { MapFactory } from './mapTypes';
import type { ThemeController } from './theme';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const NEW_CIRCUIT = '__new-circuit__';
const fmtDelta = (d: number) => (d < 60 ? `+${d.toFixed(1)}` : `+${formatLapTime(d)}`);
/** 1 周分だけのログ(輪)の始点と終点をつないで作ったラップか(closeLoop / detectLaps) */
const joined = (l: LoadedLog, lap: Lap) => !!l.log.loop && lap.endIndex >= l.log.loop.n - 1;
/** 「終端の調整」を出すラップ: ベストのこの倍率を超える長さ(調整前)のもの */
const ADJUST_RATIO = 1.6;
/** 秒 → "3:10" */
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const endLabel = (lap: Lap) => `終端: ${mmss(lap.duration)}${lap.complete ? '' : '(参考値)'}`;
/**
 * 「終端の調整」のスライドバーの段階(1〜)と、終端(ラップ開始からの秒)の対応。
 * 上限が 10 分以下なら、端から端まで 10 秒刻み。10 分を超える長いラップでは、左半分(30 段階)を 0〜5 分の 10 秒刻み、
 * 右半分(30 段階)を 5 分〜上限に割り当てる(最初の数分を切り出しやすくするため)。右端は上限
 */
const FINE_SEC = 300;
const HALF_STEPS = 30;
const isLong = (max: number) => max > 2 * FINE_SEC;
export function endSteps(max: number): number { return isLong(max) ? 2 * HALF_STEPS : Math.max(1, Math.ceil(max / 10)); }
export function endFromStep(k: number, max: number): number {
  const n = endSteps(max);
  if (k >= n) return max;
  if (!isLong(max) || k <= HALF_STEPS) return 10 * Math.max(1, k);
  return FINE_SEC + Math.round(((max - FINE_SEC) * (k - HALF_STEPS)) / HALF_STEPS / 10) * 10;
}
export function stepFromEnd(sec: number, max: number): number {
  const n = endSteps(max);
  if (sec >= max - 0.5) return n;
  if (!isLong(max) || sec <= FINE_SEC) return Math.min(n - 1, Math.max(1, Math.round(sec / 10)));
  return Math.min(n - 1, Math.max(HALF_STEPS + 1, HALF_STEPS + Math.round(((sec - FINE_SEC) / (max - FINE_SEC)) * HALF_STEPS)));
}
const JOINED_TITLE = 'ファイルの計測線とアプリの計測線が異なるため、計測線付近のデータを調整して、1 周分のラップにしています';
const dateOf = (l: LoadedLog) => (l.log.startEpochMs ? formatJst(l.log.startEpochMs) : '日時不明');

/** 読み込み画面。session の状態を描画し、操作を session に渡す。 */
export interface ImportViewOpts {
  onCompare?: () => void;
  /** 位置補正・サーキット登録の大きな画面を開いた/閉じたとき(編集中はタブ移動を止めるため) */
  onWorkChange?: () => void;
  /** 位置補正・サーキットの大きな画面に使う地図 */
  mapFactory?: MapFactory;
  theme?: ThemeController;
  /** サーキット登録画面を開いたときの地図の倍率(0 = 既定のまま)。設定の「倍率」 */
  zoom?: () => number;
}

/** 比較セット i+1 の枠。表示セットを選ぶラジオボタン、使用するサーキット、ログの追加、ラップの一覧 */
function setHtml(i: number): string {
  const hint = '<span class="sec-hint"><span class="h-open">クリックで閉じる</span><span class="h-closed">クリックで開く</span></span>';
  return `
      <details class="sec set-sec" id="sec-set-${i}" data-set="${i}"${i === 0 ? ' open' : ''}>
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2>比較セット${i + 1}</h2><span class="badge set-badge"></span>
          <label class="set-radio"><input type="radio" name="active-set" data-active-set="${i}"> 表示セット</label><span class="set-alias" data-set="${i}"></span><span class="grow"></span>${hint}</summary>
        <div class="sec-body">
          <div class="set-tools"><div class="toolbar set-circuit"></div><div class="toolbar set-bar"></div></div>
          <div class="set-hint" hidden></div>
          <div class="set-drop"></div>
          <div class="files"></div>
          <div class="foot"></div>
        </div>
      </details>`;
}

export function mountImportView(root: HTMLElement, session: Session, opts: ImportViewOpts = {}): { closeWork(): void; editCircuit(id: string): void; isEditing(): boolean; openActiveSet(): void } {
  const hint = '<span class="sec-hint"><span class="h-open">クリックで閉じる</span><span class="h-closed">クリックで開く</span></span>';
  root.innerHTML = `
    <div id="slots" class="slots" aria-label="A〜D の割り当て"></div>
    <div id="guide" class="guide-wrap"></div>
    <div id="work" class="work" hidden></div>
    <div class="body" id="import-body">
      <details class="sec" id="sec-circuit">
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2 id="h-circuit">サーキット</h2><span id="circuit-badge" class="badge"></span><span class="grow"></span>${hint}</summary>
        <div class="sec-body">
          <div class="ctabs">
            <div class="tablist" role="tablist" aria-label="サーキットの管理">
              <button class="tab" role="tab" id="tab-reg" aria-controls="panel-reg" aria-selected="true" data-act="ctab" data-tab="reg">ファイルによる登録</button>
              <button class="tab" role="tab" id="tab-map" aria-controls="panel-map" aria-selected="false" tabindex="-1" data-act="ctab" data-tab="map">地図による登録</button>
              <button class="tab" role="tab" id="tab-list" aria-controls="panel-list" aria-selected="false" tabindex="-1" data-act="ctab" data-tab="list">登録済みサーキット</button>
            </div>
            <div class="tab-body" role="tabpanel" id="panel-reg" aria-labelledby="tab-reg">
              <div class="circ-form">
                <label class="frow"><span>名前</span><input id="c-name" type="text" placeholder="例: オートポリス"></label>
                <label class="frow"><span>コントロールライン(.cln)</span><input id="c-cln" type="file" accept=".cln"></label>
                <label class="frow"><span>セクター(.sci)</span><input id="c-sci" type="file" accept=".sci"></label>
                <div class="frow"><span></span><div class="btn-row"><button class="btn" data-act="register">登録</button></div></div>
              </div>
              <div id="c-msg" class="msg" role="status"></div>
            </div>
            <div class="tab-body" role="tabpanel" id="panel-map" aria-labelledby="tab-map" hidden>
              <p class="sub">大きな画面で、航空写真の地図を見ながら計測ラインとセクターのラインを引いて登録します。.cln / .sci ファイルの読み込み・書き出しもできます。</p>
              <p class="sub">走行ログに走行データを登録した後に、走行ログ画面の「使用するサーキット」で「走行ログ位置のサーキットを新規に登録する」を選択すると、付近のサーキットが自動で表示され登録が簡単です。</p>
              <div class="btn-row"><button class="btn" data-act="open-circuit-editor" title="大きな画面で、地図を見ながら登録します">地図を開いて登録…</button></div>
            </div>
            <div class="tab-body" role="tabpanel" id="panel-list" aria-labelledby="tab-list" hidden>
              <div id="circuit-list"></div>
              <div id="list-msg" class="msg" role="status"></div>
            </div>
          </div>
        </div>
      </details>

      <details class="sec" id="sec-offsets">
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2>走行ライン補正データ管理</h2><span id="offsets-badge" class="badge"></span><span class="grow"></span>${hint}</summary>
        <div class="sec-body">
          <div class="sub offsets-note">
            <p>各走行ログのファイル別に走行ラインを補正したデータを保持しています。</p>
            <p>その補正データの書き出し、読み込みを行います。</p>
            <p>補正済みのファイルは次回から自動で補正が適用されます(どの比較セットでも同じファイルは同じ補正値です)。</p>
          </div>
          <div id="log-bar" class="toolbar"></div>
        </div>
      </details>

      <div class="sets-head">
        <div id="msg" class="msg" role="status"></div>
      </div>
      ${Array.from({ length: SET_COUNT }, (_, i) => setHtml(i)).join('')}
    </div>
    <input id="vbo-input" type="file" multiple accept=".vbo" hidden>
    <input id="reload-input" type="file" hidden>
    <input id="offsets-input" type="file" accept=".json,application/json" hidden>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const slotsEl = $('slots'), logBar = $('log-bar');
  const msgEl = $('msg'), listEl = $('circuit-list');
  const setEls = Array.from({ length: SET_COUNT }, (_, i) => root.querySelector<HTMLDetailsElement>(`#sec-set-${i}`)!);
  let addTarget = 0;                       // 「走行ログを追加」を押したセット
  const openedBefore = Array.from({ length: SET_COUNT }, () => false);
  const vboInput = $<HTMLInputElement>('vbo-input');
  const reloadInput = $<HTMLInputElement>('reload-input');
  const offsetsInput = $<HTMLInputElement>('offsets-input');
  const listMsg = $('list-msg');
  let ctab: 'reg' | 'map' | 'list' = 'reg';
  let reloadTarget: { id: string; kind: 'control' | 'sectors' } | null = null;

  // ---------- 描画 ----------
  // ---------- セットの別名(見出しの「表示セット」の右) ----------
  let aliasEditing: number | null = null;
  const aliasShown = new Map<number, string>();     // 見出しを作り直すのは、状態が変わったときだけ(入力中の文字を消さないため)
  function renderAlias(i: number) {
    const host = setEls[i].querySelector<HTMLElement>('.set-alias')!;
    const alias = session.aliasOf(i);
    const editing = aliasEditing === i;
    const key = `${editing ? 'e' : 'v'}|${alias}`;
    if (aliasShown.get(i) === key) return;
    aliasShown.set(i, key);
    if (editing) {
      host.innerHTML = `<input type="text" class="alias-input" maxlength="${ALIAS_MAX}" value="${esc(alias)}" placeholder="別名(${ALIAS_MAX}文字まで)" aria-label="比較セット${i + 1}の別名" data-set="${i}">
        <button class="btn xs pri" data-act="alias-ok" data-set="${i}">確定</button>`;
      const inp = host.querySelector<HTMLInputElement>('input')!;
      inp.focus(); inp.select();
    } else {
      host.innerHTML = alias
        ? `<span class="alias-name">別名: <b>${esc(alias)}</b></span><button class="btn xs" data-act="alias-edit" data-set="${i}">編集</button>`
        : `<button class="btn xs" data-act="alias-edit" data-set="${i}">別名を編集</button>`;
    }
  }
  function commitAlias(i: number) {
    const inp = setEls[i].querySelector<HTMLInputElement>('.alias-input');
    if (inp) session.setAlias(i, inp.value);
    aliasEditing = null;
    aliasShown.delete(i);
    renderAlias(i);
  }

  // ---------- カード名(A〜D の別名。上部のカードで編集する) ----------
  let slotEditing: Slot | null = null;
  function commitSlotAlias() {
    const inp = slotsEl.querySelector<HTMLInputElement>('.slot-alias-input');
    const s = slotEditing;
    slotEditing = null;
    if (inp && s) session.setSlotAlias(session.activeIndex, s, inp.value);   // 変わらなくても再描画される
    renderSlots();
  }

  /** サーキットの登録・編集中(保存していないラインがあるので、画面を移れない) */
  const editingCircuit = () => work === 'circuit';
  function renderSlots() {
    const draft = slotsEl.querySelector<HTMLInputElement>('.slot-alias-input');    // 入力中の文字は、再描画しても消さない
    const draftText = draft?.value;
    const cards = SLOTS.map((s) => {
      const r = session.resolveRef(session.assignment[s]);
      const alias = session.slotAliasOf(session.activeIndex, s);
      const editing = slotEditing === s && !!r;
      let body: string;
      if (editing) {
        body = `<div class="slot-edit"><input type="text" class="alias-input slot-alias-input" maxlength="${SLOT_ALIAS_MAX}" value="${esc(alias)}" placeholder="カード名(${SLOT_ALIAS_MAX}文字まで)" aria-label="${s} のカード名" data-slot="${s}">
          <button class="btn xs pri" data-act="slot-alias-ok" data-slot="${s}">確定</button></div>`;
      } else if (r) {
        body = `<div class="st">${alias ? `${esc(alias)} <span class="sub">Run ${r.log.no}</span>` : `Run ${r.log.no}`}</div>
           <div class="sub num">LAP ${r.lap.number}: ${formatLapTime(r.lap.duration)} ・ ${dateOf(r.log).split(' ')[0]}</div>`;
      } else body = '<div class="mut">未割り当て</div>';
      const pen = r && !editing ? `<button class="btn xs slot-pen" data-act="slot-alias-edit" data-slot="${s}" aria-label="${s} のカード名を編集" title="カード名を編集">✎</button>` : '';
      return `<div class="slot slot-${s.toLowerCase()}"><span class="chip s${s.toLowerCase()}">${s}</span><div class="slot-main">${body}</div>${pen}</div>`;
    }).join('') + `<button class="btn pri" data-act="goto-compare" data-fk="goto-compare"${editingCircuit() ? ' disabled title="サーキットの登録・編集中です。登録かキャンセルをしてください"' : SLOTS.some((s) => session.assignment[s]) ? '' : ' disabled title="A〜D にラップを割り当ててください"'}>比較画面へ ▶</button>`;
    slotsEl.innerHTML = `<div class="slots-title">表示中: <b>${esc(session.setName(session.activeIndex))}</b>${session.aliasOf(session.activeIndex) ? ` <span class="sub">(${session.setLabel(session.activeIndex)})</span>` : ''}</div><div class="slots-row">${cards}</div>`;
    const inp = slotsEl.querySelector<HTMLInputElement>('.slot-alias-input');
    if (inp && draftText !== undefined && draft) { inp.value = draftText; inp.focus(); inp.setSelectionRange(draftText.length, draftText.length); }
  }

  function renderBadges() {
    $('circuit-badge').textContent = session.circuits.length ? `登録 ${session.circuits.length} 件` : '未登録';
  }

  /** 全体の操作(位置補正データはファイル単位で、全部のセットに効く) */
  function renderGlobalBar() {
    logBar.innerHTML = `
      <button class="btn" data-act="export-offsets" data-fk="export-offsets" title="位置補正の値をファイル(JSON)に保存します">補正データを書き出す</button>
      <button class="btn" data-act="import-offsets" data-fk="import-offsets" title="書き出した位置補正のファイル(JSON)を読み込みます">補正データを読み込む</button>`;
    const n = session.offsetCount();
    $('offsets-badge').textContent = n ? `補正済み ${n} ファイル` : '補正なし';
  }

  /** 比較セット i+1 の、サーキット・操作ボタン・凡例 */
  /** ラップが出たのに割り当てが無い(自動割り当ての案内を出す) */
  function needsAssign(w: WorkSet): boolean {
    return w.logs.some((l) => l.circuit && l.laps.length) && !SLOTS.some((s) => w.assignment[s]);
  }
  function renderSetBars(i: number, w: WorkSet) {
    const el = setEls[i];
    const freeSlot = SLOTS.find((s) => !w.assignment[s]);
    const opts = ['<option value="">自動判定(コントロールライン通過で判定)</option>']
      .concat(session.circuits.map((c) =>
        `<option value="${esc(c.id)}"${c.id === w.selectedCircuitId ? ' selected' : ''}>${esc(c.name)}</option>`))
      .concat([`<option value="${NEW_CIRCUIT}"${w.logs.length ? '' : ' disabled'}>＋ 走行ログ位置のサーキットを新規に登録する</option>`]);
    el.querySelector('.set-circuit')!.innerHTML = `
      <label class="sel">使用するサーキット <select class="circuit-select" data-set="${i}" data-fk="s${i}-circuit-select">${opts.join('')}</select></label>`;

    const m = w.sectorMode;
    const segBtn = (mode: string, label: string) =>
      `<button data-act="sector-mode" data-set="${i}" data-mode="${mode}" data-fk="s${i}-mode-${mode}" aria-pressed="${m === mode}" class="${m === mode ? 'on' : ''}">${label}</button>`;
    el.querySelector('.set-bar')!.innerHTML = `
      <button class="btn" data-act="add" data-set="${i}" data-fk="s${i}-add">＋ 走行ログを追加</button>
      <button class="btn" data-act="sectors" data-set="${i}" data-fk="s${i}-sectors" aria-pressed="${w.showSectors}">セクタータイムを${w.showSectors ? '隠す' : '表示'}</button>
      ${w.showSectors ? `<span class="seg" role="group" aria-label="セクタータイムの種類">${segBtn('split', '区間タイム')}${segBtn('cumulative', '通過時刻')}</span>` : ''}
      ${needsAssign(w) ? `<button class="btn pri" data-act="auto-assign" data-set="${i}" data-fk="s${i}-auto">速いものから ${freeSlot} に自動で割り当て</button>` : ''}`;

    el.querySelector('.foot')!.innerHTML = `<span>グレーの行はベストの120%超(割り当ては可能です)</span>
      ${w.showSectors ? '<span class="legend"><i class="bsec-dot"></i>紫の数字はそのデータ内での各セクター最速(グレーの行は除く)</span>' : ''}
      <span>ラップ番号は計測ラインの最初の通過から数えます(RaceChrono の番号と異なる場合があります)</span><span>割り当て済みのボタンを押し直すと解除します</span>`;
  }

  function renderCircuits() {
    listEl.innerHTML = session.circuits.length
      ? `<ul class="clist">${session.circuits.map((c) => `
        <li class="citem">
          <div class="cinfo"><b>${esc(c.name)}</b><span class="sub">セクター ${c.sectors.length} 本</span></div>
          <div class="cact">
            <button class="btn sm" data-act="edit-circuit" data-id="${esc(c.id)}" data-fk="edt-${esc(c.id)}" title="大きな画面で、地図を見ながら編集します">編集(地図)…</button>
            <button class="btn sm" data-act="rename-circuit" data-id="${esc(c.id)}" data-fk="ren-${esc(c.id)}">名前を変更</button>
            <button class="btn sm" data-act="reload-control" data-id="${esc(c.id)}" data-fk="rlc-${esc(c.id)}">コントロールラインの再読み込み</button>
            <button class="btn sm" data-act="reload-sectors" data-id="${esc(c.id)}" data-fk="rls-${esc(c.id)}">セクターの再読み込み</button>
            <button class="btn sm" data-act="del-circuit" data-id="${esc(c.id)}" data-fk="del-${esc(c.id)}">削除</button>
          </div></li>`).join('')}</ul>`
      : '<div class="empty">登録済みのサーキットはありません。「ファイルによる登録」「地図による登録」タブから登録してください。</div>';
  }

  function applyTabs() {
    for (const t of ['reg', 'map', 'list'] as const) {
      const sel = t === ctab;
      const tab = $('tab-' + t);
      tab.setAttribute('aria-selected', String(sel));
      tab.tabIndex = sel ? 0 : -1;
      $('panel-' + t).hidden = !sel;
    }
  }

  /** ラップ一覧の注記の欄: 参考値・輪の注記と、「終端の調整」(セクタータイムを隠しているときだけ操作できる) */
  function noteOf(l: LoadedLog, lap: Lap, i: number, best: number, showSec: boolean): string {
    const end = session.lapEnd(l.id, lap.number);
    const text = end === null && !lap.complete ? '終端未通過のため参考値' : joined(l, lap) ? '計測線付近の修正あり' : '';
    const can = end !== null || !lap.complete || (!Number.isNaN(best) && lap.baseDuration > best * ADJUST_RATIO);
    if (!can) return text;
    if (showSec) return end === null ? text : esc(endLabel(lap));
    const fk = `s${i}-end-${esc(l.id)}-${lap.number}`;
    const data = `data-set="${i}" data-log="${esc(l.id)}" data-lap="${lap.number}"`;
    const box = `<label class="lap-end-chk"><input type="checkbox" data-act="lap-end" ${data} data-fk="${fk}-c"${end !== null ? ' checked' : ''}>終端の調整</label>`;
    if (end === null) return `<span class="lap-end">${text ? `<span>${text}</span>` : ''}${box}</span>`;
    // 右端は上限(完了ラップなら本来の終点)
    const max = lap.maxDuration;
    return `<span class="lap-end">${box}<input type="range" class="lap-end-range" ${data} data-fk="${fk}-r" min="1" max="${endSteps(max)}" step="1"
      value="${stepFromEnd(lap.duration, max)}" data-max="${max}" aria-valuetext="${esc(endLabel(lap))}"
      aria-label="Run ${l.no} LAP${lap.number} の終端"><span class="num lap-end-val">${esc(endLabel(lap))}</span></span>`;
  }

  function renderFile(l: LoadedLog, i: number, w: WorkSet): string {
    const ns = l.circuit?.sectors.length ?? 0;
    const showSec = w.showSectors && ns > 0;
    const cols = `90px 110px 110px ${showSec ? `repeat(${ns},76px) ` : ''}minmax(160px,1fr) 200px`;
    const best = bestDuration(l);
    const { key, dir } = w.sort;
    const laps = [...l.laps].sort((a, b) =>
      (key === 'lap' ? a.number - b.number : a.duration - b.duration || a.number - b.number) * dir);

    // セクター: 表示する値と、その列の最速(グレーの行は対象外)
    const values = new Map(l.laps.map((lap) => [lap.number, w.sectorMode === 'split' ? sectorSplits(lap) : lap.sectorTimes]));
    const bestCols = bestPerColumn(
      l.laps.map((lap) => values.get(lap.number)!),
      l.laps.map((lap) => lap.duration <= best * 1.2),
    );

    const offTag = l.offset.east !== 0 || l.offset.north !== 0 ? `東 ${l.offset.east.toFixed(2)} m / 北 ${l.offset.north.toFixed(2)} m` : '';
    const circuitTag = l.circuit
      ? `<span class="tag ok">${esc(l.circuit.name)}${l.auto ? '(自動判定)' : ''}</span>`
      : l.outside ? `<span class="tag ng">${esc(l.outside.name)} を通らない</span>` : '<span class="tag ng">サーキット未判定</span>';
    const arrow = (k: string) => (key === k ? (dir === 1 ? '▲' : '▼') : '');
    const sortAttr = (k: string) => (key === k ? (dir === 1 ? 'ascending' : 'descending') : 'none');

    let rows: string;
    const cand = !l.circuit && !l.outside ? session.candidateFor(l) : null;
    if (l.outside) {
      rows = `<div class="empty">このログは、この比較セットのサーキット(${esc(l.outside.name)})の計測ラインを通らないため、ラップがありません。
        ほかのサーキットのログは、別の比較セットに入れてください(「使用するサーキット」でサーキットを切り替えることもできます)。</div>`;
    } else if (!l.circuit) {
      rows = `<div class="empty">このログが通るサーキットが見つかりません。サーキットを登録するか、上の「使用するサーキット」で指定してください。
        <div class="btn-row">
          ${cand ? `<button class="btn sm pri" data-act="circ-cand" data-set="${i}" data-log="${esc(l.id)}" data-fk="s${i}-cc-${esc(l.id)}" title="${esc(candidateLabel(cand.candidate))}">ログの計測ラインで登録…</button>` : ''}
          <button class="btn sm${cand ? '' : ' pri'}" data-act="circ-map" data-set="${i}" data-log="${esc(l.id)}" data-fk="s${i}-cm-${esc(l.id)}">地図で登録…</button>
          <button class="btn sm" data-act="circ-file" data-fk="s${i}-cf-${esc(l.id)}">.cln / .sci ファイルで登録…</button>
          ${session.circuits.length ? `<button class="btn sm" data-act="circ-pick" data-set="${i}" data-fk="s${i}-cp-${esc(l.id)}">登録済みから選ぶ</button>` : ''}
        </div></div>`;
    } else if (!laps.length) {
      rows = '<div class="empty">ラップを検出できませんでした(コントロールラインを通過していません)。</div>';
    } else {
      const head = l.hasHead
        ? `<div class="row ex head" style="grid-template-columns:${cols}"><div class="num">—</div><div></div><div></div>${showSec ? '<div></div>'.repeat(ns) : ''}<div class="sub">始点が無いので非表示</div><div></div></div>`
        : '';
      rows = head + laps.map((lap) => {
        const d = lap.duration - best;
        const assigned = SLOTS.some((s) => w.assignment[s]?.logId === l.id && w.assignment[s]?.lap === lap.number);
        const ex = lap.duration > best * 1.2;
        const secCells = showSec
          ? values.get(lap.number)!.map((t, k) =>
              `<div class="num${!ex && isBest(t, bestCols[k]) ? ' bsec' : ''}">${t === null ? '-' : formatLapTime(t)}</div>`).join('')
          : '';
        const btns = SLOTS.map((s) => {
          const on = w.assignment[s]?.logId === l.id && w.assignment[s]?.lap === lap.number;
          return `<button class="${on ? 'on ' : ''}${s.toLowerCase()}" data-act="assign" data-set="${i}" data-slot="${s}" data-log="${esc(l.id)}" data-lap="${lap.number}"
            data-fk="s${i}-a-${esc(l.id)}-${lap.number}-${s}" aria-pressed="${on}" aria-label="Run ${l.no} LAP${lap.number} を ${s} に${on ? 'の割り当てを解除' : '割り当て'}">${s}</button>`;
        }).join('');
        return `<div class="row${ex ? ' ex' : ''}${assigned ? ' as' : ''}" style="grid-template-columns:${cols}">
          <div class="num">${lap.number}</div>
          <div class="num${d === 0 ? ' best' : ''}">${formatLapTime(lap.duration)}</div>
          <div class="num${d === 0 ? ' best' : ''}">${d === 0 ? 'ベスト' : fmtDelta(d)}</div>
          ${secCells}
          <div class="sub lap-note"${joined(l, lap) ? ` title="${JOINED_TITLE}"` : ''}>${noteOf(l, lap, i, best, showSec)}</div>
          <div class="pk">${btns}</div></div>`;
      }).join('');
    }

    const secHead = showSec ? Array.from({ length: ns }, (_, i) => `<div>S${i + 1}</div>`).join('') : '';
    return `<section class="file" data-id="${esc(l.id)}">
      <div class="fh">
        <div class="fno">Run ${l.no}</div>
        <div class="fn">${esc(l.log.fileName)} : ${dateOf(l)}</div>
        <span class="sub">${Number.isNaN(best) ? '' : 'ベスト ' + formatLapTime(best)}</span>
        ${circuitTag}
        <button class="btn sm" data-act="correct" data-set="${i}" data-log="${esc(l.id)}" data-fk="s${i}-cor-${esc(l.id)}"${offTag ? ` title="現在の補正: ${esc(offTag)}"` : ''}>位置補正${offTag ? '(済)' : ''}</button>
        <button class="btn sm" data-act="remove" data-set="${i}" data-log="${esc(l.id)}" data-fk="s${i}-rm-${esc(l.id)}">削除</button>
      </div>
      <div class="scroll" tabindex="0" role="region" aria-label="Run ${l.no} のラップ一覧(横にスクロールできます)">
        <div class="tbl">
          <div class="row hd" style="grid-template-columns:${cols}">
            <div><button class="hbtn" data-act="sort" data-set="${i}" data-key="lap" data-fk="s${i}-sort-lap" aria-sort="${sortAttr('lap')}">ラップ ${arrow('lap')}</button></div>
            <div><button class="hbtn" data-act="sort" data-set="${i}" data-key="time" data-fk="s${i}-sort-time" aria-sort="${sortAttr('time')}">タイム ${arrow('time')}</button></div>
            <div>Delta</div>${secHead}<div></div><div>割り当て</div>
          </div>${rows}
        </div>
      </div></section>`;
  }

  /** 追加のドロップ枠と、割り当ての案内(セットごと) */
  function renderSetExtras(i: number, w: WorkSet) {
    const el = setEls[i];
    el.querySelector('.set-drop')!.innerHTML = w.logs.length
      ? `<div class="dropbox compact" data-act="drop-pick" data-set="${i}" tabindex="0" role="button" data-fk="s${i}-drop">ここに .vbo ファイルをドラッグ&ドロップして追加(またはクリックして選択)</div>`
      : `<div class="dropbox" data-act="drop-pick" data-set="${i}" tabindex="0" role="button" data-fk="s${i}-drop">
          <b>ここに .vbo ファイルをドラッグ&ドロップ</b><small>またはクリックしてファイルを選択(複数まとめて選べます)</small></div>`;
    const hint = el.querySelector<HTMLElement>('.set-hint')!;
    const ready = needsAssign(w);
    hint.hidden = !ready;
    hint.textContent = ready ? '比べたいラップを A〜D に割り当ててください(下の表の A〜D ボタン、または上の青いボタンで自動割り当て)。' : '';
  }

  // ---------- はじめかた(表示セットの状態で、次の操作を案内する) ----------
  function guideStep(w: WorkSet): number {
    if (!w.logs.length) return 0;
    if (SLOTS.some((s) => w.assignment[s])) return 3;
    if (w.logs.some((l) => !l.circuit && !l.outside)) return 1;            // サーキットを通らないログ(ラップ無し)は対象外
    return 2;
  }
  function renderGuide() {
    const el = $('guide');
    if (session.guideClosed) {
      el.innerHTML = '<button class="linkbtn" data-act="guide-open" data-fk="guide-open">はじめかた ▸</button>';
      return;
    }
    const w = session.active;
    const cur = guideStep(w);
    const firstWithLaps = w.logs.find((l) => l.circuit && l.laps.length);
    const free = SLOTS.find((s) => !w.assignment[s]);
    const candLog = w.logs.find((l) => !l.circuit && !l.outside && session.candidateFor(l));
    const pri = (act: string) => act === 'guide-add' || act === 'guide-cand' || (act === 'guide-map' && !candLog) || act === 'guide-auto' || act === 'guide-compare';
    const btn = (act: string, label: string, extra = '') => `<button class="btn sm${pri(act) ? ' pri' : ''}" data-act="${act}" data-fk="${act}"${extra}>${label}</button>`;
    const steps = [
      { t: 'ログを追加', d: 'RaceChrono などの .vbo ファイルを、比較セットの枠のドロップ欄にドラッグ&ドロップします。',
        b: btn('guide-add', '走行ログ(.vbo)を追加…') },
      { t: 'サーキットを用意', d: '計測ライン(ゴールライン)を決めて、サーキットを登録します(1 回だけ)。走行ログに計測ラインの情報があれば、それを使えます。無ければ地図の上で引くか、.cln / .sci ファイルで登録します。',
        b: (candLog ? btn('guide-cand', 'ログの計測ラインで登録…') : '') + btn('guide-map', '地図で登録…') + btn('guide-file', '.cln / .sci ファイルで登録…')
          + (session.circuits.length ? btn('guide-pick', '登録済みから選ぶ') : '') },
      { t: 'ラップを割り当て', d: '比べたいラップを A〜D に割り当てます(最大 4 つ)。速いものから自動で入れるか、自分で選ぶかを選べます。',
        b: firstWithLaps ? (free ? btn('guide-auto', `速いものから ${free} に自動で割り当て`) : '') + btn('guide-manual', '手動で割り当て') : '' },
      { t: '比較する', d: '「比較画面へ」を押して、走行ラインを見比べます。',
        b: btn('guide-compare', '比較画面へ ▶') },
    ];
    el.innerHTML = `<section class="guide" aria-label="はじめかた">
      <div class="gh"><b>はじめかた</b><span class="sub">表示セット(${esc(session.setName(session.activeIndex))})の状態に合わせて、次の操作を案内します</span>
        <button class="linkbtn" data-act="guide-close" data-fk="guide-close">閉じる ×</button></div>
      <div class="gsteps">${steps.map((s, k) => `
        <div class="gstep${k < cur ? ' done' : k === cur ? ' cur' : ''}">
          <div class="gn" aria-hidden="true">${k < cur ? '✓' : k + 1}</div>
          <div><h4>${s.t}${k === cur ? '<span class="gtag">いまここ</span>' : ''}</h4><p>${s.d}</p>${k === cur ? s.b : ''}</div>
        </div>`).join('')}</div></section>`;
  }

  function render() {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    // 再描画で横スクロール位置が戻らないよう、ファイルごとに退避する
    const scrolls = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('.file').forEach((f) => {
      scrolls.set(`${f.closest<HTMLElement>('.set-sec')!.dataset.set}:${f.dataset.id}`, f.querySelector<HTMLElement>('.scroll')?.scrollLeft ?? 0);
    });

    renderSlots();
    renderGuide();
    renderBadges();
    renderGlobalBar();
    renderCircuits();
    msgEl.textContent = session.loading || session.message;
    session.sets.forEach((w, i) => {
      const el = setEls[i];
      renderSetBars(i, w);
      renderAlias(i);
      el.querySelector('.set-badge')!.textContent = `${w.logs.length} 本`;
      const radio = el.querySelector<HTMLInputElement>('[data-active-set]')!;
      radio.checked = i === session.activeIndex;
      radio.disabled = w.logs.length === 0;
      radio.title = w.logs.length === 0 ? '走行ログを追加すると選べます' : '';
      el.classList.toggle('set-active', i === session.activeIndex);
      // 最初のログが入ったセットは、開いて見せる
      if (w.logs.length && !openedBefore[i]) el.open = true;
      openedBefore[i] = w.logs.length > 0;
      renderSetExtras(i, w);
      el.querySelector('.files')!.innerHTML = w.logs.map((l) => renderFile(l, i, w)).join('');
      el.querySelectorAll<HTMLElement>('.file').forEach((f) => {
        const sc = f.querySelector<HTMLElement>('.scroll');
        if (sc) sc.scrollLeft = scrolls.get(`${i}:${f.dataset.id}`) ?? 0;
      });
    });
    if (focusKey) {
      const el = Array.from(root.querySelectorAll<HTMLElement>('[data-fk]')).find((e) => e.dataset.fk === focusKey);
      el?.focus({ preventScroll: true });
    }
  }

  // ---------- 操作 ----------
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'slot-alias-edit': slotEditing = d.slot as Slot; renderSlots(); slotsEl.querySelector<HTMLInputElement>('.slot-alias-input')?.select(); break;
      case 'slot-alias-ok': commitSlotAlias(); break;
      case 'alias-edit': aliasEditing = Number(d.set ?? 0); aliasShown.delete(aliasEditing); renderAlias(aliasEditing); break;
      case 'alias-ok': commitAlias(Number(d.set ?? 0)); break;
      case 'add': addTarget = Number(d.set ?? 0); vboInput.click(); break;
      case 'sectors': session.toggleSectors(Number(d.set ?? 0)); break;
      case 'sector-mode': session.setSectorMode(d.mode as 'split' | 'cumulative', Number(d.set ?? 0)); break;
      case 'sort': session.toggleSort(d.key as 'lap' | 'time', Number(d.set ?? 0)); break;
      case 'assign': session.toggleAssignment(d.slot as Slot, { logId: d.log!, lap: Number(d.lap) }, Number(d.set ?? 0)); break;
      case 'remove': session.removeLog(d.log!, Number(d.set ?? 0)); break;
      case 'correct': openWork('correct', d.log!, Number(d.set ?? 0)); break;
      case 'edit-circuit': openWork('circuit', d.id!); break;
      case 'open-circuit-editor': openWork('circuit', null); break;
      case 'export-offsets': exportOffsets(); break;
      case 'import-offsets': offsetsInput.click(); break;
      case 'del-circuit': session.deleteCircuit(d.id!); listMsg.textContent = ''; break;
      case 'ctab': ctab = d.tab as 'reg' | 'map' | 'list'; applyTabs(); break;
      case 'rename-circuit': void renameFlow(d.id!); break;
      case 'reload-control':
      case 'reload-sectors':
        reloadTarget = { id: d.id!, kind: d.act === 'reload-control' ? 'control' : 'sectors' };
        reloadInput.accept = reloadTarget.kind === 'control' ? '.cln' : '.sci';
        reloadInput.click();
        break;
      case 'register': void registerCircuit(); break;
      case 'goto-compare': opts.onCompare?.(); break;
      case 'drop-pick': addTarget = Number(d.set ?? 0); vboInput.click(); break;
      case 'auto-assign': autoAssign(Number(d.set ?? 0)); break;
      case 'circ-map': openMapRegister(Number(d.set ?? 0), d.log); break;
      case 'circ-cand': void openLoadCheck(Number(d.set ?? 0), d.log!); break;
      case 'guide-cand': { const l = session.active.logs.find((x) => !x.circuit && !x.outside && session.candidateFor(x)); if (l) void openLoadCheck(session.activeIndex, l.id); break; }
      case 'circ-file': openCircuitSection('reg'); break;
      case 'circ-pick': focusCircuitSelect(Number(d.set ?? 0)); break;
      case 'guide-close': session.setGuideClosed(true); break;
      case 'guide-open': session.setGuideClosed(false); break;
      case 'guide-add': addTarget = session.activeIndex; vboInput.click(); break;
      case 'guide-map': openMapRegister(session.activeIndex); break;
      case 'guide-file': openCircuitSection('reg'); break;
      case 'guide-pick': focusCircuitSelect(session.activeIndex); break;
      case 'guide-auto': autoAssign(session.activeIndex); break;
      case 'guide-manual': scrollToSet(session.activeIndex); break;
      case 'guide-compare': opts.onCompare?.(); break;
    }
  });

  /** ドロップ枠の Enter / Space は、クリックと同じ */
  // 別名の入力: Enter で確定、Esc でやめる。見出し(summary)の開閉には伝えない
  root.addEventListener('keydown', (e) => {
    const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.alias-input');
    if (!inp) return;
    e.stopPropagation();
    if (inp.classList.contains('slot-alias-input')) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitSlotAlias(); }
      else if (e.key === 'Escape') { e.preventDefault(); slotEditing = null; renderSlots(); }
      return;
    }
    const i = Number(inp.dataset.set);
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitAlias(i); }
    else if (e.key === 'Escape') { e.preventDefault(); aliasEditing = null; aliasShown.delete(i); renderAlias(i); }
  });
  root.addEventListener('keyup', (e) => { if ((e.target as HTMLElement).closest('.alias-input')) e.stopPropagation(); });
  root.addEventListener('click', (e) => {         // 見出しの別名の操作では、折りたたみを開閉しない
    if ((e.target as HTMLElement).closest('.set-alias')) e.preventDefault();
  });
  root.addEventListener('keydown', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>('.dropbox');
    if (box && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); box.click(); }
  });

  // ---------- .vbo のドラッグ&ドロップ(開いているセットの追加の枠に、正確に落としたときだけ追加する) ----------
  const boxOf = (e: Event) => (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.dropbox') ?? null;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  root.addEventListener('dragover', (e) => {
    const box = boxOf(e);
    if (!box || !hasFiles(e)) return;
    e.preventDefault();
    box.classList.add('over');
  });
  root.addEventListener('dragleave', (e) => { boxOf(e)?.classList.remove('over'); });
  root.addEventListener('drop', async (e) => {
    const box = boxOf(e);
    if (!box) return;
    e.preventDefault();
    box.classList.remove('over');
    const files = Array.from(e.dataTransfer?.files ?? []);
    await addFiles(files, Number(box.dataset.set ?? 0));
  });

  /** .vbo だけを選んで、そのセットに追加する(2 つ以上なら、ベストラップを空き枠に順に割り当てる) */
  async function addFiles(files: File[], set: number) {
    const vbo = files.filter((f) => /\.vbo$/i.test(f.name));
    const skipped = files.length - vbo.length;
    const before = new Set((session.sets[set]?.logs ?? []).map((l) => l.id));
    if (vbo.length) await session.addVboFiles(vbo.map((file) => ({ file, path: window.rllNative?.getPathForFile(file) || undefined })), set);
    if (skipped) session.say(`${skipped} 件は .vbo ではないため追加しませんでした。`);
    const added = (session.sets[set]?.logs ?? []).filter((l) => !before.has(l.id)).map((l) => l.id);
    if (added.length) await checkLoaded(set, added, before.size === 0);
  }

  // ---------- 読み込みの確認(案件 3) ----------
  /** 確認ダイアログから開いた登録画面: 登録したら、そのサーキットを比較セットのサーキットにする */
  let pending: { set: number; circuits: number } | null = null;
  async function checkLoaded(set: number, ids: string[], wasEmpty: boolean, prefer?: string) {
    const plan = planLoad(session, set, ids, wasEmpty);
    if (!plan) return;
    if (prefer && plan.options.some((o) => o.key === prefer)) plan.initial = prefer;
    const { option: o, name, control, sectors } = await loadDialog(plan, { mapFactory: opts.mapFactory, nameTaken: (n) => nameExists(session.circuits, n) });
    if (o.kind === 'circuit') { session.setCircuit(o.circuit.id, set); scrollToSet(set); }
    if (o.kind === 'cand') {
      // ファイルの計測ラインとセクターは、そのまま(ダイアログで直したなら、直した線で)登録して、ラップの割り当てに進む
      const c = o.candidate;
      const r = session.registerCircuit(name, formatCln([control ?? c.control], LINE_DIGITS), formatSci(sectors ?? c.sectors, 1, LINE_DIGITS));   // 表示位置は決めない(走行ラインに合わせて表示)
      if (!r.ok) { session.say(r.message); return; }
      session.message = r.message;
      session.setCircuit(session.circuits[session.circuits.length - 1].id, set);
      scrollToSet(set);
    }
    if (o.kind === 'map') { pending = { set, circuits: session.circuits.length }; openMapRegister(set, o.log.id); }
  }
  /** ログの枠・はじめかたの「ログの計測ラインで登録…」: そのセットのログで確認ダイアログを開く(そのログの候補を選んだ状態) */
  async function openLoadCheck(set: number, logId: string) {
    const w = session.sets[set];
    const l = w?.logs.find((x) => x.id === logId);
    if (!w || !l) return;
    const ref = session.candidateFor(l);
    await checkLoaded(set, w.logs.map((x) => x.id), !session.setCircuitOf(set), ref ? `cand:${ref.from.id}` : undefined);
  }
  /** 登録画面を閉じたとき: 確認ダイアログから開いて登録したなら、そのサーキットを比較セットのサーキットにする */
  function afterRegister() {
    const p = pending;
    pending = null;
    if (p && session.circuits.length > p.circuits) session.setCircuit(session.circuits[session.circuits.length - 1].id, p.set);
  }

  /** 比較セットが、スクロールする領域の一番上に来るようにする(上の固定部分の下) */
  function scrollToSet(set: number) {
    const sec = setEls[set];
    if (!sec) return;
    sec.open = true;
    sec.scrollIntoView?.({ block: 'start' });
  }
  /** 速いものから自動で割り当てて、そのセットが見えるようにする */
  function autoAssign(set: number) {
    session.autoAssignFastest(set);
    scrollToSet(set);
  }
  function openCircuitSection(tab: 'reg' | 'map' | 'list') {
    ctab = tab; applyTabs();
    const sec = $<HTMLDetailsElement>('sec-circuit');
    sec.open = true;
    sec.scrollIntoView?.({ block: 'start' });
  }
  function focusCircuitSelect(set: number) {
    const sec = setEls[set];
    sec.open = true;
    const sel = sec.querySelector<HTMLSelectElement>('.circuit-select');
    sel?.scrollIntoView?.({ block: 'center' });
    sel?.focus();
  }
  function openMapRegister(set: number, logId?: string) {
    const pos = session.logCenter(set, logId);
    if (!pos) return;
    ctab = 'map'; applyTabs();
    openWork('circuit', null, undefined, pos);
  }

  // 「終端の調整」のスライドバー: 動かしている間は値の表示だけを変える(一覧を作り直すと、つかめなくなるため)。手を離したら change で反映
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.classList.contains('lap-end-range')) return;
    const val = t.parentElement?.querySelector('.lap-end-val');
    if (val) val.textContent = `終端: ${mmss(endFromStep(Number(t.value), Number(t.dataset.max)))}`;
  });

  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('circuit-select')) {
      const sel = t as HTMLSelectElement, i = Number(t.dataset.set);
      if (sel.value === NEW_CIRCUIT) {
        sel.value = session.sets[i].selectedCircuitId ?? '';        // 選択は変えず、地図で登録する画面を開く
        openMapRegister(i);
      } else session.setCircuit(sel.value || null, i);
    }
    if (t.dataset.activeSet !== undefined && (t as HTMLInputElement).checked) session.setActive(Number(t.dataset.activeSet));
    if (t.dataset.act === 'lap-end') {                    // 「終端の調整」のチェック: 入れたときは今の終端のまま、スライドバーを出す
      const id = t.dataset.log!, n = Number(t.dataset.lap);
      const lap = session.sets[Number(t.dataset.set)]?.logs.find((x) => x.id === id)?.laps.find((x) => x.number === n);
      if (lap) session.setLapEnd(id, n, (t as HTMLInputElement).checked ? (lap.complete ? lap.maxDuration : lap.duration) : null);
    }
    if (t.classList.contains('lap-end-range')) {
      session.setLapEnd(t.dataset.log!, Number(t.dataset.lap), endFromStep(Number((t as HTMLInputElement).value), Number(t.dataset.max)));
    }
    if (t.id === 'reload-input') {
      const f = reloadInput.files?.[0];
      const target = reloadTarget;
      reloadInput.value = '';
      if (f && target) {
        const text = await f.text();
        const r = target.kind === 'control' ? session.reloadControl(target.id, text) : session.reloadSectors(target.id, text);
        listMsg.textContent = r.message;
      }
    }
    if (t.id === 'offsets-input') {
      const f = offsetsInput.files?.[0];
      offsetsInput.value = '';
      if (f) session.importOffsets(await f.text());
    }
    if (t.id === 'vbo-input') {
      const files = Array.from(vboInput.files ?? []);
      const target = addTarget;
      await addFiles(files, target);
      vboInput.value = '';
    }
  });

  /** 位置補正データを JSON ファイルとして保存する(ブラウザのダウンロード) */
  function exportOffsets() {
    const blob = new Blob([session.exportOffsets()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'position-offsets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function renameFlow(id: string) {
    const c = session.circuits.find((x) => x.id === id);
    if (!c) return;
    let value = c.name;
    for (;;) {
      const v = await promptDialog({ title: 'サーキット名の変更', label: '新しい名前', value, ok: '変更' });
      if (v === null) return;
      const r = session.renameCircuit(id, v);
      if (r.ok) { listMsg.textContent = r.message; return; }
      if (r.reason !== 'duplicate') { listMsg.textContent = r.message; return; }
      await alertDialog({ title: '既に名前が存在します', detail: `「${v}」は登録済みです。別の名前にしてください。` });
      value = v;
    }
  }

  // タブのキーボード操作(←→ / Home / End)
  root.addEventListener('keydown', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab) return;
    const order: ('reg' | 'map' | 'list')[] = ['reg', 'map', 'list'];
    let i = order.indexOf(ctab);
    if (e.key === 'ArrowRight') i = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + order.length) % order.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = order.length - 1;
    else return;
    e.preventDefault();
    ctab = order[i];
    applyTabs();
    $('tab-' + ctab).focus();
  });

  async function registerCircuit() {
    const cln = $<HTMLInputElement>('c-cln').files?.[0];
    const sci = $<HTMLInputElement>('c-sci').files?.[0];
    const nameInput = $<HTMLInputElement>('c-name');
    const out = $('c-msg');
    if (!cln) { out.textContent = '.cln ファイルを選んでください。'; return; }
    const name = nameInput.value || cln.name.replace(/\.cln$/i, '').replace(/^cl_/i, '');
    const r = session.registerCircuit(name, await cln.text(), sci ? await sci.text() : '');
    if (!r.ok && r.reason === 'duplicate') {
      out.textContent = '';
      await alertDialog({ title: '既に名前が存在します', detail: `「${name.trim()}」は登録済みです。別の名前にしてください。` });
      nameInput.focus();
      return;
    }
    out.textContent = r.message;
    if (r.ok) { nameInput.value = ''; $<HTMLInputElement>('c-cln').value = ''; $<HTMLInputElement>('c-sci').value = ''; }
  }

  // ---------- 大きな画面(位置補正・サーキットの登録/編集)は、4 つのカードの下に出す ----------
  const workEl = $('work'), bodyEl = $('import-body');
  let work: 'correct' | 'circuit' | null = null;
  let correct: CorrectView | null = null;
  let editor: CircuitEditor | null = null;

  let backToCompare = false;                  // 比較画面から開いたサーキット編集は、終わったら比較に戻る
  function closeWork() {
    backToCompare = false;
    if (!work) return;
    work = null;
    root.classList.remove('view-ce');
    correct?.hide(); editor?.hide();
    renderSlots(); opts.onWorkChange?.();
    workEl.hidden = true;
    bodyEl.hidden = false;
    $('guide').hidden = false;
  }
  function openWork(kind: 'correct' | 'circuit', id: string | null, set?: number, near?: { lat: number; lon: number }, nudgeSector = false) {
    if (!opts.mapFactory) return;
    if (!correct) {
      const host = (cls: string) => { const d = document.createElement('div'); d.className = cls; d.hidden = true; workEl.appendChild(d); return d; };
      const cEl = host('work-correct'), eEl = host('work-circuit');
      correct = mountCorrectView(cEl, session, { mapFactory: opts.mapFactory, theme: opts.theme, onDone: closeWork });
      editor = mountCircuitEditor(eEl, session, {
        mapFactory: opts.mapFactory, theme: opts.theme, zoom: opts.zoom,
        onDone: () => { const back = backToCompare; closeWork(); if (back) opts.onCompare?.(); else afterRegister(); },
      });
    }
    work = kind;
    root.classList.toggle('view-ce', kind === 'circuit');                 // 登録・編集の画面では A〜D のカードを隠す
    root.style.setProperty('--slots-h', kind === 'circuit' ? '0px' : `${slotsEl.offsetHeight || 92}px`);
    bodyEl.hidden = true;
    $('guide').hidden = true;
    workEl.hidden = false;
    workEl.querySelector<HTMLElement>('.work-correct')!.hidden = kind !== 'correct';
    workEl.querySelector<HTMLElement>('.work-circuit')!.hidden = kind !== 'circuit';
    if (kind === 'correct') { editor?.hide(); correct.show(id ?? '', set); } else { correct.hide(); editor!.show(id, near, nudgeSector); }
    renderSlots(); opts.onWorkChange?.();
  }

  session.subscribe(render);
  applyTabs();
  render();
  return {
    closeWork,
    isEditing: editingCircuit,
    /** 「データ管理」タブに移ったとき: 表示セットの比較セットだけを開き、ほかは閉じる(何も無ければ比較セット1) */
    openActiveSet() { setEls.forEach((el, i) => { el.open = i === session.activeIndex; }); },
    /** 比較画面から: サーキットを編集する(終わったら比較に戻る) */
    editCircuit(id: string) { openWork('circuit', id, undefined, undefined, true); backToCompare = work === 'circuit'; },
  };
}
