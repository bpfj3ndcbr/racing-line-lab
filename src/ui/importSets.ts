import {
  SLOTS, type Lap, type Slot, bestPerColumn, formatLapTime, isBest, sectorSplits, escapeHtml as esc, fmtMinSec, endFromStep, endSteps, stepFromEnd
} from '../core';
import { ALIAS_MAX, SET_COUNT, type LoadedLog, type Session, type WorkSet, bestDuration } from '../store/session';
import { type ImportActions, type ImportPart, SEC_HINT, dateOf } from './importParts';
import { candidateLabel } from './loadDialog';
import { SHOWN_MARK } from './marks';
import { createScrollCatch } from './scrollCatch';

/**
 * 比較セット 1〜5 の枠: 見出し(表示中の印・別名・要約)、使用するサーキット、走行ログの追加、ラップの一覧(割り当て・終端の調整)。
 * 並べ方はタブ(初期)/ 一覧(案件 27)。
 */

const NEW_CIRCUIT = '__new-circuit__';
const fmtDelta = (d: number) => (d < 60 ? `+${d.toFixed(1)}` : `+${formatLapTime(d)}`);
/** 1 周分だけのログ(輪)の始点と終点をつないで作ったラップか(closeLoop / detectLaps) */
const joined = (l: LoadedLog, lap: Lap) => !!l.log.loop && lap.endIndex >= l.log.loop.n - 1;
/** 「終端の調整」を出すラップ: ベストのこの倍率を超える長さ(調整前)のもの */
const ADJUST_RATIO = 1.6;
/** ラップ一覧でグレーにするラップ: ベストのこの倍率を超えるもの(割り当ては可能) */
const SLOW_RATIO = 1.2;
const endLabel = (lap: Lap) => `終端: ${fmtMinSec(lap.duration)}${lap.complete ? '' : '(参考値)'}`;
const JOINED_TITLE = 'ファイルの計測線とアプリの計測線が異なるため、計測線付近のデータを調整して、1 周分のラップにしています';
/** 比較セットの並べ方(案件 27) */
type SetsView = 'tabs' | 'list';

/** 比較セット i+1 の枠。「表示中」の印か「表示中にする」、使用するサーキット、ログの追加、ラップの一覧 */
function setHtml(i: number): string {
  return `
      <details class="sec set-sec" id="sec-set-${i}" data-set="${i}"${i === 0 ? ' open' : ''}>
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2>比較セット${i + 1}</h2><span class="badge set-badge"></span>
          <span class="set-shown" data-set="${i}"></span><span class="set-alias" data-set="${i}"></span><span class="set-sum" data-set="${i}"></span><span class="grow"></span>${SEC_HINT}</summary>
        <div class="sec-body">
          <div class="set-tools"><div class="toolbar set-circuit"></div><div class="toolbar set-bar"></div></div>
          <div class="set-hint" hidden></div>
          <div class="files"></div>
          <div class="foot"></div>
        </div>
      </details>`;
}

/** 比較セットのまとまり(見出しと、並べ方の切り替え、タブ、比較セット 1〜5) */
export const SETS_HTML = `
      <section class="sets-group" id="sets-group" aria-labelledby="h-sets">
        <div class="sets-group-h"><h2 id="h-sets">比較セット</h2><span class="sets-group-sub"></span><span class="grow"></span>
          <span class="seg tiny sets-view" role="group" aria-label="比較セットの並べ方">
            <button data-act="sets-view" data-view="tabs" title="比較セットをタブで切り替えて、1 つずつ表示します">タブ</button><button data-act="sets-view" data-view="list" title="比較セットを縦に並べ、見出しを押して開閉します">一覧</button></span></div>
        <div class="sets-tabs" role="tablist" aria-label="比較セット" hidden></div>
        ${Array.from({ length: SET_COUNT }, (_, i) => setHtml(i)).join('')}
      </section>`;

export interface SetsPart extends ImportPart {
  /** 比較セット set を開いて、スクロールする領域の一番上に来るようにする(上の固定部分の下) */
  scrollToSet(set: number): void;
  /** 比較セット set を開いて、「使用するサーキット」を選べるようにする */
  focusCircuitSelect(set: number): void;
  /** すべて閉じる(一覧はすべて閉じ、タブは表示セットを出す。案件 26) */
  closeSets(): void;
  /** 比較セットの別名の入力欄でのキー操作(Enter で確定、Esc でやめる) */
  onAliasKey(e: KeyboardEvent, inp: HTMLInputElement): void;
  /** クリックの既定の動作を止めるか(見出しの別名の操作・タブのときの見出しで、折りたたみを開閉しない) */
  onClickGuard(e: MouseEvent): void;
  /** input を受ける(終端の調整のスライドバーを動かしている間) */
  onInput(t: HTMLElement): void;
  /** change を受ける(使用するサーキット・終端の調整) */
  onChange(t: HTMLElement): void;
}

/** root は「データ管理」の画面全体(SETS_HTML を含む) */
export function createSets(root: HTMLElement, session: Session, actions: ImportActions): SetsPart {
  const groupEl = root.querySelector<HTMLElement>('#sets-group')!, tabsEl = groupEl.querySelector<HTMLElement>('.sets-tabs')!;
  const setEls = Array.from({ length: SET_COUNT }, (_, i) => root.querySelector<HTMLDetailsElement>(`#sec-set-${i}`)!);
  const openedBefore = Array.from({ length: SET_COUNT }, () => false);

  // ---------- セットの別名(見出しの「表示中」の印の右) ----------
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
  /** 見出しの要約(案件 27): サーキット名と A〜D の割り当て。走行ログが無ければ「—」 */
  function renderSum(i: number, w: WorkSet) {
    const host = setEls[i].querySelector<HTMLElement>('.set-sum')!;
    if (!w.logs.length) { host.innerHTML = '<span class="sum-muted">—</span>'; return; }
    const c = session.setCircuitOf(i);
    const assigned = SLOTS.filter((s) => w.assignment[s]);
    host.innerHTML = `<span class="sum-circ${c ? '' : ' sum-muted'}">${c ? esc(c.name) : 'サーキット未判定'}</span>` + (assigned.length
      ? `<span class="sum-slots">${assigned.map((s) => `<i class="s${s.toLowerCase()}">${s}</i>`).join('')}割り当て ${assigned.length}</span>`
      : '<span class="sum-muted">割り当てなし</span>');
  }

  /** ラップが出たのに割り当てが無い(自動割り当ての案内を出す) */
  function needsAssign(w: WorkSet): boolean {
    return w.logs.some((l) => l.circuit && l.laps.length) && !SLOTS.some((s) => w.assignment[s]);
  }
  /** 比較セット i+1 の、サーキット・操作ボタン・凡例 */
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

    el.querySelector('.foot')!.innerHTML = `<span>グレーの行はベストの${Math.round(SLOW_RATIO * 100)}%超(割り当ては可能です)</span>
      ${w.showSectors ? '<span class="legend"><i class="bsec-dot"></i>紫の数字はそのデータ内での各セクター最速(グレーの行は除く)</span>' : ''}
      <span>ラップ番号は計測ラインの最初の通過から数えます(RaceChrono の番号と異なる場合があります)</span><span>割り当て済みのボタンを押し直すと解除します</span>`;
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
    // スマホの幅では、ラップ・タイム・割り当て(A〜D)を先に並べる(CSS の order で並べ替え、列の幅はこちら。案件 1)
    const colsM = `66px 72px 168px 90px ${showSec ? `repeat(${ns},70px) ` : ''}minmax(140px,1fr)`;
    const grid = `--cols:${cols};--cols-m:${colsM}`;
    const best = bestDuration(l);
    const { key, dir } = w.sort;
    const laps = [...l.laps].sort((a, b) =>
      (key === 'lap' ? a.number - b.number : a.duration - b.duration || a.number - b.number) * dir);

    // セクター: 表示する値と、その列の最速(グレーの行は対象外)
    const values = new Map(l.laps.map((lap) => [lap.number, w.sectorMode === 'split' ? sectorSplits(lap) : lap.sectorTimes]));
    const bestCols = bestPerColumn(
      l.laps.map((lap) => values.get(lap.number)!),
      l.laps.map((lap) => lap.duration <= best * SLOW_RATIO),
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
        ? `<div class="row ex head" style="${grid}"><div class="num">—</div><div></div><div></div>${showSec ? '<div></div>'.repeat(ns) : ''}<div class="sub">始点が無いので非表示</div><div></div></div>`
        : '';
      // 取り込み範囲で切った所をまたぐので出さなかったラップ: 番号の順のときだけ、その位置に灰色の行で出す
      // (続いた番号は 1 行にまとめる)
      // タイム・Delta・(セクター)・説明の欄を 1 つにつないで、左寄せで書く(スマホの並びでも、番号のすぐ右から)
      const skipRow = (from: number, to: number) => `<div class="row ex skip" style="${grid}"><div class="num">${from === to ? from : `${from}〜${to}`}</div><div class="sub" style="grid-column:span ${3 + (showSec ? ns : 0)}">${from === to ? `LAP ${from} は取り込み範囲外` : `LAP ${from} から ${to} までは取り込み範囲外`}</div><div></div></div>`;
      const groups: [number, number][] = [];
      for (const n of [...l.cutLaps].sort((a, b) => a - b)) {
        const g = groups[groups.length - 1];
        if (g && g[1] === n - 1) g[1] = n; else groups.push([n, n]);
      }
      const byLap = key === 'lap' && groups.length > 0;
      /** ラップ番号 n の行の前に入れる「取り込み範囲外」の行(昇順なら n より小さく、まだ出していないもの) */
      let gi = dir === 1 ? 0 : groups.length - 1;
      const skipsBefore = (n: number) => {
        let out = '';
        if (!byLap) return out;
        if (dir === 1) while (gi < groups.length && groups[gi][1] < n) { out += skipRow(...groups[gi]); gi++; }
        else while (gi >= 0 && groups[gi][0] > n) { out += skipRow(...groups[gi]); gi--; }
        return out;
      };
      rows = head + laps.map((lap) => skipsBefore(lap.number) + ((): string => {
        const d = lap.duration - best;
        const assigned = SLOTS.some((s) => w.assignment[s]?.logId === l.id && w.assignment[s]?.lap === lap.number);
        const ex = lap.duration > best * SLOW_RATIO;
        const secCells = showSec
          ? values.get(lap.number)!.map((t, k) =>
              `<div class="num${!ex && isBest(t, bestCols[k]) ? ' bsec' : ''}">${t === null ? '-' : formatLapTime(t)}</div>`).join('')
          : '';
        const btns = SLOTS.map((s) => {
          const on = w.assignment[s]?.logId === l.id && w.assignment[s]?.lap === lap.number;
          return `<button class="${on ? 'on ' : ''}${s.toLowerCase()}" data-act="assign" data-set="${i}" data-slot="${s}" data-log="${esc(l.id)}" data-lap="${lap.number}"
            data-fk="s${i}-a-${esc(l.id)}-${lap.number}-${s}" aria-pressed="${on}" aria-label="Run ${l.no} LAP${lap.number} を ${s} に${on ? 'の割り当てを解除' : '割り当て'}">${s}</button>`;
        }).join('');
        return `<div class="row${ex ? ' ex' : ''}${assigned ? ' as' : ''}" style="${grid}">
          <div class="num">${lap.number}</div>
          <div class="num${d === 0 ? ' best' : ''}">${formatLapTime(lap.duration)}</div>
          <div class="num${d === 0 ? ' best' : ''}">${d === 0 ? 'ベスト' : fmtDelta(d)}</div>
          ${secCells}
          <div class="sub lap-note"${joined(l, lap) ? ` title="${JOINED_TITLE}"` : ''}>${noteOf(l, lap, i, best, showSec)}</div>
          <div class="pk">${btns}</div></div>`;
      })()).join('') + skipsBefore(dir === 1 ? Infinity : -Infinity);
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
          <div class="row hd" style="${grid}">
            <div><button class="hbtn" data-act="sort" data-set="${i}" data-key="lap" data-fk="s${i}-sort-lap" aria-sort="${sortAttr('lap')}">ラップ ${arrow('lap')}</button></div>
            <div><button class="hbtn" data-act="sort" data-set="${i}" data-key="time" data-fk="s${i}-sort-time" aria-sort="${sortAttr('time')}">タイム ${arrow('time')}</button></div>
            <div>Delta</div>${secHead}<div></div><div>割り当て</div>
          </div>${rows}
        </div>
      </div></section>`;
  }

  /** 割り当ての案内(セットごと) */
  function renderSetExtras(i: number, w: WorkSet) {
    const el = setEls[i];
    const hint = el.querySelector<HTMLElement>('.set-hint')!;
    const ready = needsAssign(w);
    hint.hidden = !ready;
    hint.textContent = ready ? '比べたいラップを A〜D に割り当ててください(下の表の A〜D ボタン、または上の青いボタンで自動割り当て)。' : '';
  }

  // ---------- 比較セットの並べ方(案件 27): タブ(初期)/ 一覧。選んだ並べ方は保存する(ui.setsView) ----------
  let setsView: SetsView = session.getSetting<string>('setsView', 'tabs') === 'list' ? 'list' : 'tabs';
  let tabSet = session.activeIndex;        // タブで中身を出している比較セット
  /** 一覧のときの開閉。タブにしている間も覚えておき、一覧に戻したら元に戻す */
  const listOpen = setEls.map((el) => el.open);
  const asTabs = () => setsView === 'tabs';
  setEls.forEach((el, i) => el.addEventListener('toggle', () => { if (!asTabs()) listOpen[i] = el.open; }));
  function setView(v: SetsView) {
    if (v === setsView) return;
    setsView = v;
    releaseHeight();
    session.setSetting('setsView', v);
    if (v === 'list') setEls.forEach((el, i) => { el.open = listOpen[i]; });
    renderSetTabs();
  }
  /** 比較セットを開く(タブでは、一覧に戻したときに開いているようにしておく) */
  function openSet(i: number) { if (asTabs()) listOpen[i] = true; else setEls[i].open = true; }
  function renderSetTabs() {
    groupEl.classList.toggle('as-tabs', asTabs());
    tabsEl.hidden = !asTabs();
    groupEl.querySelector('.sets-group-sub')!.textContent = asTabs()
      ? 'タブで比較セットを切り替えます。「表示中」の比較セットが「比較」タブに出ます'
      : '見出しを押すと開きます。「表示中」の比較セットが「比較」タブに出ます';
    root.querySelectorAll<HTMLElement>('[data-act="sets-view"]').forEach((b) => {
      const on = b.dataset.view === setsView;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    setEls.forEach((el, i) => el.classList.toggle('tab-on', asTabs() && i === tabSet));
    if (!asTabs()) return;
    setEls[tabSet].open = true;
    tabsEl.innerHTML = session.sets.map((w, i) => {
      const n = w.logs.length, on = i === tabSet, shown = i === session.shownIndex, alias = session.aliasOf(i);
      // 別名があればタブには別名だけを出す(比較セットの番号は、マウスを乗せたときの説明に)
      return `<button type="button" role="tab" class="set-tab${on ? ' on' : ''}" aria-selected="${on}" data-act="set-tab" data-set="${i}"` +
        ` title="${session.setLabel(i)}${shown ? '(表示セット)' : ''}">${shown ? SHOWN_MARK : ''}${esc(alias || session.setLabel(i))}` +
        `<span class="badge set-badge${n ? ' has-logs' : ''}">${n} 本</span></button>`;
    }).join('');
    syncTabsHeight();
  }
  /** 固定するタブの高さを CSS に渡す(「表示中にする」「別名」の行を、タブの真下に固定するため。案件 63) */
  function syncTabsHeight() { groupEl.style.setProperty('--sets-tabs-h', `${tabsEl.getBoundingClientRect().height}px`); }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncTabsHeight).observe(tabsEl);
  function showTab(set: number) { tabSet = set; renderSetTabs(); }
  /** 画面をスクロールしている要素(PC は「データ管理」の画面そのもの、スマホはページ全体) */
  function scroller() {
    const ov = typeof getComputedStyle === 'function' ? getComputedStyle(root).overflowY : '';
    return ov === 'auto' || ov === 'scroll'
      ? { get: () => root.scrollTop, top: () => root.getBoundingClientRect().top, set: (y: number) => { root.scrollTop = y; } }
      : { get: () => window.scrollY, top: () => 0, set: (y: number) => { window.scrollTo(0, y); } };
  }
  /**
   * 比較セットのタブを切り替えるときの、スクロール位置の扱い(案件 74 のあと)。
   * スクロールは 1 つだが、次の 2 つに分けて考える。
   *  - 全体: 比較セットのタブが上に固定されるところまで(これより上のスクロール)。タブを切り替えても変えない。
   *  - タブの中: 固定されたタブの下の、中身のスクロール。比較セットごとに覚えて、戻ったときに元の位置へ戻す。
   * 空の比較セットは、タブの中を上から出す(全体は変えない)。
   */
  const innerOf: (number | undefined)[] = Array.from({ length: SET_COUNT }, () => undefined);
  /** 切り替える前の高さを保つ。中身の短い(空の)比較セットに切り替えても、ページが縮んでスクロール位置が引き戻されない(下に余白が出る) */
  function pinHeight() { const h = groupEl.offsetHeight; if (h > 0) groupEl.style.minHeight = `${h}px`; }
  function releaseHeight() { groupEl.style.minHeight = ''; }
  /**
   * 比較セットのタブが上に固定されるスクロール量。これより上が「全体」、これより下が「タブの中」。
   * タブは、比較セットの見出し(「タブで比較セットを切り替えます…」の行)の下にあるので、その高さも足す
   */
  function pinScroll(sc: ReturnType<typeof scroller>, y: number) {
    const stack = parseFloat(root.style.getPropertyValue('--imp-stack')) || 0;          // 上に固定しているもの(カード・簡易のはじめかた)の高さ
    const head = groupEl.querySelector<HTMLElement>('.sets-group-h')?.offsetHeight ?? 0;
    return groupEl.getBoundingClientRect().top - sc.top() + y - stack + groupEl.clientTop + head;
  }
  function switchTab(next: number) {
    const sc = scroller();
    const y = sc.get();
    const pin = pinScroll(sc, y);
    const outer = Math.min(y, pin), inner = Math.max(0, y - pin);
    if (session.sets[tabSet]?.logs.length) innerOf[tabSet] = inner;
    pinHeight();
    showTab(next);
    const nextInner = session.sets[next]?.logs.length ? (innerOf[next] ?? inner) : 0;     // 初めて開くタブは、今の位置のまま
    sc.set(outer + nextInner);
    catcher.sync();
  }

  // ---------- 比較セットの中の、スクロールの引っかかり(1 か所) ----------
  /**
   * 引っかける位置のスクロール量: 比較セットの中身の枠(「使用するサーキット」「走行ログを追加」のボタンなどが入った枠)の上端の線が、
   * 固定している行(タブ・「表示中にする」の行)のすぐ下に来るところ。比較セットをタブにして、その節を出しているときだけ(それ以外は null)。
   * 上に固定しているもの(A〜D のカードと、簡易のはじめかた)の高さは、「そのスクロール量のときの」高さで数える。
   * 勢いよく越えたとき、簡易のはじめかたが出る前の高さで数えると、あとで出たときに位置がずれて、止めた位置から動いてしまう。
   */
  function catchPin(): number | null {
    if (!asTabs() || groupEl.offsetHeight === 0 || groupEl.classList.contains('top-off')) return null;
    const sec = setEls[tabSet];
    const frame = sec?.querySelector<HTMLElement>(':scope>.sec-body');            // 中身の枠
    const head = sec?.querySelector<HTMLElement>(':scope>.sec-h');
    if (!frame || !head) return null;
    const sc = scroller(), y = sc.get();
    const base = frame.getBoundingClientRect().top - sc.top() + y - (tabsEl.getBoundingClientRect().height + head.offsetHeight);   // 固定しているカードの高さを除いた位置
    const slotsH = root.querySelector<HTMLElement>('#slots')?.offsetHeight ?? 0;
    const guide = root.querySelector<HTMLElement>('#guide');
    const miniH = (root.querySelector<HTMLElement>('#guide-mini')?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
    const guideShown = !session.guideClosed && !!guide && !guide.hidden && guide.offsetHeight > 0 && slotsH > 0;
    const withMini = base - (slotsH + miniH);
    // その位置では、はじめかたがカードの下に隠れて、簡易のはじめかたが出ているか
    const guideBottom = guideShown ? guide!.getBoundingClientRect().bottom - sc.top() + y : 0;
    return guideShown && miniH > 0 && guideBottom - withMini <= slotsH + 1 ? withMini : base - slotsH;
  }
  const catcher = createScrollCatch({
    getY: () => scroller().get(), setY: (y) => scroller().set(y), pin: catchPin,
    onHold: (held) => root.classList.toggle('scroll-held', held),      // 止めている間は、画面の操作を受け付けない(CSS)
  });
  root.addEventListener('scroll', () => catcher.onScroll(), { passive: true });   // PC: この画面の中をスクロールする
  window.addEventListener('scroll', () => { if (root.isConnected) catcher.onScroll(); }, { passive: true });   // スマホ: ページ全体をスクロールする(画面を作り直したあとの古い部品は、動かさない)
  // 人の操作によるスクロールだけを止める(スクロールして見せる・タブの切り替えなど、プログラムの動きは止めない)
  const input = (ms: number) => () => catcher.noteInput(ms);
  root.addEventListener('wheel', (e) => {
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * (root.clientHeight || 800) : e.deltaY;
    catcher.noteWheel(dy);
  }, { passive: true });
  root.addEventListener('touchstart', input(Infinity), { passive: true });         // 指で触れている間
  root.addEventListener('touchmove', input(Infinity), { passive: true });
  root.addEventListener('touchend', input(1500), { passive: true });              // 指を離したあとの慣性
  root.addEventListener('touchcancel', input(1500), { passive: true });
  root.addEventListener('keydown', (e) => { if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) catcher.noteInput(400); });

  function scrollToSet(set: number) {
    const sec = setEls[set];
    if (!sec) return;
    if (asTabs()) { listOpen[set] = true; showTab(set); } else sec.open = true;
    sec.scrollIntoView?.({ block: 'start' });
  }
  function focusCircuitSelect(set: number) {
    const sec = setEls[set];
    if (asTabs()) { listOpen[set] = true; showTab(set); } else sec.open = true;
    const sel = sec.querySelector<HTMLSelectElement>('.circuit-select');
    sel?.scrollIntoView?.({ block: 'center' });
    sel?.focus();
  }

  function render() {
    // 再描画で横スクロール位置が戻らないよう、ファイルごとに退避する
    const scrolls = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('.file').forEach((f) => {
      scrolls.set(`${f.closest<HTMLElement>('.set-sec')!.dataset.set}:${f.dataset.id}`, f.querySelector<HTMLElement>('.scroll')?.scrollLeft ?? 0);
    });
    session.sets.forEach((w, i) => {
      const el = setEls[i];
      renderSetBars(i, w);
      renderAlias(i);
      renderSum(i, w);
      const badge = el.querySelector<HTMLElement>('.set-badge')!;
      badge.textContent = `${w.logs.length} 本`;
      badge.classList.toggle('has-logs', w.logs.length > 0);           // 走行ログの入った比較セットは、閉じていても分かるように緑(案件 26)
      // 表示セット(比較画面に出す比較セット)は「表示中」の印、ほかは「表示中にする」ボタン(案件 27。走行ログが無い比較セットは選べない)
      const shownHost = el.querySelector<HTMLElement>('.set-shown')!;
      // 表示中にできるのは、A〜D に割り当てがある比較セットだけ(案件 28)
      const shownKey = i === session.shownIndex ? 'on' : session.canShow(i) ? 'can' : 'empty';
      if (shownHost.dataset.k !== shownKey) {
        shownHost.dataset.k = shownKey;
        shownHost.innerHTML = shownKey === 'on' ? SHOWN_MARK
          : `<button type="button" class="btn xs" data-act="set-active" data-set="${i}"${shownKey === 'empty' ? ' disabled title="ラップを A〜D に割り当てると選べます"' : ' title="この比較セットを比較画面に出します"'}>表示中にする</button>`;
      }
      el.classList.toggle('set-active', i === session.shownIndex);
      // 最初のログが入ったセットは、開いて見せる
      if (w.logs.length && !openedBefore[i]) openSet(i);
      openedBefore[i] = w.logs.length > 0;
      renderSetExtras(i, w);
      el.querySelector('.files')!.innerHTML = w.logs.map((l) => renderFile(l, i, w)).join('');
      el.querySelectorAll<HTMLElement>('.file').forEach((f) => {
        const sc = f.querySelector<HTMLElement>('.scroll');
        if (sc) sc.scrollLeft = scrolls.get(`${i}:${f.dataset.id}`) ?? 0;
      });
    });
    renderSetTabs();
  }

  return {
    render,
    scrollToSet,
    focusCircuitSelect,
    closeSets() {
      releaseHeight();
      listOpen.fill(false);
      if (asTabs()) showTab(session.activeIndex); else setEls.forEach((el) => { el.open = false; });
    },
    handle(act, d) {
      const set = Number(d.set ?? 0);
      switch (act) {
        case 'alias-edit': aliasEditing = set; aliasShown.delete(set); renderAlias(set); return true;
        case 'alias-ok': commitAlias(set); return true;
        case 'add': case 'drop-pick': actions.addLogs(set); return true;
        case 'sectors': session.toggleSectors(set); return true;
        case 'sector-mode': session.setSectorMode(d.mode as 'split' | 'cumulative', set); return true;
        case 'sort': session.toggleSort(d.key as 'lap' | 'time', set); return true;
        case 'assign': session.toggleAssignment(d.slot as Slot, { logId: d.log!, lap: Number(d.lap) }, set); return true;
        case 'remove': session.removeLog(d.log!, set); return true;
        case 'correct': actions.openWork('correct', d.log!, set); return true;
        case 'sets-view': setView(d.view as SetsView); return true;
        case 'set-tab': switchTab(Number(d.set)); return true;
        case 'set-active': if (session.canShow(Number(d.set))) session.setActive(Number(d.set)); return true;
        case 'auto-assign': actions.autoAssign(set); return true;
        case 'circ-map': actions.openMapRegister(set, d.log); return true;
        case 'circ-cand': actions.openLoadCheck(set, d.log!); return true;
        case 'circ-file': actions.openCircuitSection('reg'); return true;
        case 'circ-pick': focusCircuitSelect(set); return true;
        default: return false;
      }
    },
    onAliasKey(e, inp) {
      const i = Number(inp.dataset.set);
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitAlias(i); }
      else if (e.key === 'Escape') { e.preventDefault(); aliasEditing = null; aliasShown.delete(i); renderAlias(i); }
    },
    onClickGuard(e) {
      if ((e.target as HTMLElement).closest('.set-alias')) e.preventDefault();
      if (asTabs() && (e.target as HTMLElement).closest('.set-sec > summary') && !(e.target as HTMLElement).closest('input,button')) e.preventDefault();   // タブでは閉じない
    },
    // 「終端の調整」のスライドバー: 動かしている間は値の表示だけを変える(一覧を作り直すと、つかめなくなるため)。手を離したら change で反映
    onInput(t) {
      if (!t.classList.contains('lap-end-range')) return;
      const val = t.parentElement?.querySelector('.lap-end-val');
      if (val) val.textContent = `終端: ${fmtMinSec(endFromStep(Number((t as HTMLInputElement).value), Number(t.dataset.max)))}`;
    },
    onChange(t) {
      if (t.classList.contains('circuit-select')) {
        const sel = t as HTMLSelectElement, i = Number(t.dataset.set);
        if (sel.value === NEW_CIRCUIT) {
          sel.value = session.sets[i].selectedCircuitId ?? '';        // 選択は変えず、地図で登録する画面を開く
          actions.openMapRegister(i);
        } else session.setCircuit(sel.value || null, i);
      }
      if (t.dataset.act === 'lap-end') {                    // 「終端の調整」のチェック: 入れたときは今の終端のまま、スライドバーを出す
        const id = t.dataset.log!, n = Number(t.dataset.lap);
        const lap = session.sets[Number(t.dataset.set)]?.logs.find((x) => x.id === id)?.laps.find((x) => x.number === n);
        if (lap) session.setLapEnd(id, n, (t as HTMLInputElement).checked ? (lap.complete ? lap.maxDuration : lap.duration) : null);
      }
      if (t.classList.contains('lap-end-range')) {
        session.setLapEnd(t.dataset.log!, Number(t.dataset.lap), endFromStep(Number((t as HTMLInputElement).value), Number(t.dataset.max)));
      }
    },
  };
}
