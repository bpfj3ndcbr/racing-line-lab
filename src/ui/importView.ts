import { nameExists } from '../core';
import type { Session } from '../store/session';
import { mountCircuitEditor, type CircuitEditor } from './circuitEditor';
import { loadDialog, planLoad } from './loadDialog';
import { mountCorrectView, type CorrectView } from './correctView';
import { alertDialog, customDialog } from './dialog';
import { hasExt } from './fileKind';
import { CIRCUITS_HTML, createCircuits } from './importCircuits';
import { createGuide } from './importGuide';
import { OFFSETS_HTML, createOffsets } from './importOffsets';
import type { ImportActions, ImportPart } from './importParts';
import { SETS_HTML, createSets } from './importSets';
import { createSlots } from './importSlots';
import type { MapFactory } from './mapTypes';
import type { ThemeController } from './theme';

/**
 * 「データ管理」の画面。画面の骨組みと、走行ログの追加・読み込みの確認・大きな画面(位置補正・サーキットの登録 / 編集)の開け閉めを受け持つ。
 * 中身は役割ごとの部品に分けてある(案件 40): A〜D のカード(importSlots)・はじめかた(importGuide)・サーキット(importCircuits)・
 * 補正データ(importOffsets)・比較セット(importSets)。描画のときは各部品の render を順に呼び、クリックは各部品の handle に順に渡す。
 */

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

/** app.ts から使う、データ管理画面の操作 */
export interface ImportApi {
  closeWork(): void;
  editCircuit(id: string): void;
  isEditing(): boolean;
  /** ほかのタブから「データ管理」に移ったとき: 比較セットをすべて閉じる(案件 26) */
  closeSets(): void;
  /** 位置補正の画面で、補正量を動かしたまま保存していないか(ほかの画面へ移る前に確かめる) */
  needsLeaveConfirm(): boolean;
  /** 位置補正の画面の保存していない補正量を、破棄して移ってよいか確かめる */
  confirmLeave(): Promise<boolean>;
  /** Android の共有の画面から受け取ったファイル(案件 45): 追加する比較セットを選んでから、いつもの追加と同じ流れで読み込む */
  addShared(files: File[]): Promise<void>;
}

export function mountImportView(root: HTMLElement, session: Session, opts: ImportViewOpts = {}): ImportApi {
  root.innerHTML = `
    <div id="slots" class="slots" aria-label="A〜D の割り当て"></div>
    <div id="guide" class="guide-wrap"></div>
    <div id="work" class="work" hidden></div>
    <div class="body" id="import-body">${CIRCUITS_HTML}
${OFFSETS_HTML}

      <div class="sets-head">
        <div id="msg" class="msg" role="status"></div>
      </div>${SETS_HTML}
    </div>
    <input id="vbo-input" type="file" multiple accept=".vbo" hidden>
    <input id="reload-input" type="file" hidden>
    <input id="offsets-input" type="file" accept=".json,application/json" hidden>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const slotsEl = $('slots'), msgEl = $('msg');
  const vboInput = $<HTMLInputElement>('vbo-input');
  let addTarget = 0;                       // 「走行ログを追加」を押したセット

  // ---------- 部品 ----------
  const actions: ImportActions = {
    addLogs(set) { addTarget = set; vboInput.click(); },
    openWork: (kind, id, set) => openWork(kind, id, set),
    openMapRegister: (set, logId) => openMapRegister(set, logId),
    openLoadCheck: (set, logId) => { void openLoadCheck(set, logId); },
    openCircuitSection: (tab) => circuits.openSection(tab),
    focusCircuitSelect: (set) => sets.focusCircuitSelect(set),
    scrollToSet: (set) => sets.scrollToSet(set),
    autoAssign(set) { session.autoAssignFastest(set); sets.scrollToSet(set); },
    toCompare: () => opts.onCompare?.(),
  };
  /** サーキットの登録・編集中(保存していないラインがあるので、画面を移れない) */
  const editingCircuit = () => work === 'circuit';
  const slots = createSlots(slotsEl, session, { actions, editingCircuit });
  const guide = createGuide($('guide'), session, actions);
  const circuits = createCircuits(root, session, actions);
  const offsets = createOffsets(root, session);
  const sets = createSets(root, session, actions);
  const parts: ImportPart[] = [slots, guide, circuits, offsets, sets];

  function render() {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    slots.render();
    guide.render();
    circuits.render();
    offsets.render();
    msgEl.textContent = session.loading || session.message;
    sets.render();
    if (focusKey) {
      const el = Array.from(root.querySelectorAll<HTMLElement>('[data-fk]')).find((e) => e.dataset.fk === focusKey);
      el?.focus({ preventScroll: true });
    }
  }

  // ---------- 操作 ----------
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act ?? '';
    for (const p of parts) if (p.handle(act, el.dataset)) return;
  });

  // 別名の入力: Enter で確定、Esc でやめる。見出し(summary)の開閉には伝えない
  root.addEventListener('keydown', (e) => {
    const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.alias-input');
    if (!inp) return;
    e.stopPropagation();
    if (inp.classList.contains('slot-alias-input')) slots.onAliasKey(e);
    else sets.onAliasKey(e, inp);
  });
  root.addEventListener('keyup', (e) => { if ((e.target as HTMLElement).closest('.alias-input')) e.stopPropagation(); });
  root.addEventListener('click', (e) => sets.onClickGuard(e));   // 見出しの別名の操作・タブのときの見出しでは、折りたたみを開閉しない
  // ドロップ枠の Enter / Space は、クリックと同じ
  root.addEventListener('keydown', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>('.dropbox');
    if (box && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); box.click(); }
  });
  // タブのキーボード操作(←→ / Home / End)
  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('[role="tab"]')) circuits.onTabKey(e);
  });
  root.addEventListener('input', (e) => sets.onInput(e.target as HTMLElement));
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLElement;
    sets.onChange(t);
    await circuits.onChange(t);
    await offsets.onChange(t);
    if (t.id === 'vbo-input') {
      const files = Array.from(vboInput.files ?? []);
      const target = addTarget;
      await addFiles(files, target);
      vboInput.value = '';
    }
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
    const vbo = files.filter((f) => hasExt(f.name, '.vbo'));
    const skipped = files.filter((f) => !hasExt(f.name, '.vbo'));
    // .vbo 以外は、確認の画面で知らせる(スマホの幅では、上の案内欄が画面の外にあって見えないため。案件 29)
    if (skipped.length) {
      const names = skipped.slice(0, 5).map((f) => `「${f.name}」`).join('、') + (skipped.length > 5 ? ` ほか ${skipped.length - 5} 件` : '');
      await alertDialog({ title: '読み込めるのは .vbo ファイルだけです', detail: `${names}は追加しませんでした。` });
    }
    const before = new Set((session.sets[set]?.logs ?? []).map((l) => l.id));
    if (vbo.length) await session.addVboFiles(vbo.map((file) => ({ file, path: window.rllNative?.getPathForFile(file) || undefined })), set);
    if (skipped.length) session.say(`${skipped.length} 件は .vbo ではないため追加しませんでした。`);
    const added = (session.sets[set]?.logs ?? []).filter((l) => !before.has(l.id)).map((l) => l.id);
    if (added.length) await checkLoaded(set, added, before.size === 0, undefined, true);
  }

  // ---------- 共有の画面から受け取る(案件 45) ----------
  async function addShared(files: File[]) {
    // .vbo が 1 つも無ければ、セットは聞かずに、いつもの「読み込めるのは .vbo ファイルだけです」を出す
    if (!files.some((f) => hasExt(f.name, '.vbo'))) { await addFiles(files, session.activeIndex); return; }
    const set = await chooseShareSet(files.filter((f) => hasExt(f.name, '.vbo')).length);
    if (set === null) { session.say('共有された走行ログは追加しませんでした。'); return; }
    sets.scrollToSet(set);
    await addFiles(files, set);
  }

  /** 追加する比較セットを選ぶ。初めは表示中(無ければ表示予定)の比較セットを選んでいる。キャンセル・Esc は null */
  function chooseShareSet(n: number): Promise<number | null> {
    return customDialog<number | null>((box, close) => {
      const h = document.createElement('h3');
      h.id = 'share-set-t';
      h.textContent = '追加する比較セットを選んでください';
      const p = document.createElement('p');
      p.textContent = `共有された走行ログ(${n} 件)を追加します。`;
      box.setAttribute('aria-labelledby', h.id);
      const list = document.createElement('div');
      list.className = 'share-sets';
      let first: HTMLButtonElement | null = null;
      session.sets.forEach((w, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (i === session.activeIndex ? ' pri' : '');
        b.dataset.shareSet = String(i);
        const name = document.createElement('span');
        name.textContent = session.setName(i);
        // 別名があるときは、元の名前(比較セット1 など)も添える
        if (session.aliasOf(i)) {
          const label = document.createElement('span');
          label.className = 'sub';
          label.textContent = ` (${session.setLabel(i)})`;
          name.appendChild(label);
        }
        const cnt = document.createElement('span');
        cnt.className = 'share-count';
        cnt.textContent = w.logs.length ? `走行ログ ${w.logs.length} 件` : '空き';
        b.append(name, cnt);
        b.addEventListener('click', () => close(i));
        list.appendChild(b);
        if (i === session.activeIndex) first = b;
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn';
      cancel.textContent = 'キャンセル';
      cancel.dataset.dialog = 'cancel';
      cancel.addEventListener('click', () => close(null));
      const row = document.createElement('div');
      row.className = 'modal-actions';
      row.appendChild(cancel);
      box.append(h, p, list, row);
      return first ?? cancel;
    }, null);
  }

  // ---------- 読み込みの確認(案件 3) ----------
  /** 確認ダイアログから開いた登録画面: 登録したら、そのサーキットを比較セットのサーキットにする */
  let pending: { set: number; circuits: number } | null = null;
  /** fresh = 読み込んだ直後(「読み込みを取り消す」を出す) */
  async function checkLoaded(set: number, ids: string[], wasEmpty: boolean, prefer?: string, fresh = false) {
    const plan = planLoad(session, set, ids, wasEmpty);
    if (!plan) return;
    if (prefer && plan.options.some((o) => o.key === prefer)) plan.initial = prefer;
    const { option: o, name, control, sectors, undo } = await loadDialog(plan, { mapFactory: opts.mapFactory, nameTaken: (n) => nameExists(session.circuits, n), canUndo: fresh });
    if (undo) {
      // 読み込みを取り消す: いま読み込んだログだけを外す(一緒に割り当てたラップも解除される。前からのログはそのまま)
      for (const id of ids) session.removeLog(id, set);
      session.say(`読み込みを取り消しました(${ids.length} 件)。`);
      return;
    }
    if (o.kind === 'circuit') { session.setCircuit(o.circuit.id, set); sets.scrollToSet(set); }
    if (o.kind === 'cand') {
      // ファイルの計測ラインとセクターは、そのまま(ダイアログで直したなら、直した線で)登録して、ラップの割り当てに進む
      const c = o.candidate;
      const r = session.registerCircuitLines(name, control ?? c.control, sectors ?? c.sectors, { announce: true });   // 表示位置は決めない(走行ラインに合わせて表示)
      if (!r.ok) { session.say(r.message); return; }
      session.setCircuit(session.circuits[session.circuits.length - 1].id, set);
      sets.scrollToSet(set);
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

  function openMapRegister(set: number, logId?: string) {
    const pos = session.logCenter(set, logId);
    if (!pos) return;
    circuits.setTab('map');
    openWork('circuit', null, undefined, pos);
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
    slots.render(); opts.onWorkChange?.();
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
    slots.render(); opts.onWorkChange?.();
  }

  session.subscribe(render);
  render();
  return {
    closeWork,
    isEditing: editingCircuit,
    needsLeaveConfirm: () => work === 'correct' && !!correct?.isDirty(),
    confirmLeave: () => (work === 'correct' && correct ? correct.confirmLeave() : Promise.resolve(true)),
    closeSets: () => sets.closeSets(),
    addShared,
    /** 比較画面から: サーキットを編集する(終わったら比較に戻る) */
    editCircuit(id: string) { openWork('circuit', id, undefined, undefined, true); backToCompare = work === 'circuit'; },
  };
}
