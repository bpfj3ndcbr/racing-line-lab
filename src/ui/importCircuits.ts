import { escapeHtml as esc } from '../core';
import type { Session } from '../store/session';
import { duplicateNameAlert, promptDialog } from './dialog';
import { hasExt, wrongExtMessage } from './fileKind';
import { type CircuitTab, type ImportActions, type ImportPart, SEC_HINT } from './importParts';

/** 「サーキット」の節の並び(案件 25 で「登録済みサーキット」を先頭に) */
const TAB_ORDER = ['list', 'reg', 'map'] as const;

/** 「サーキット」の節: 登録済みの一覧(編集・名前の変更・再読み込み・削除)、ファイルによる登録、地図による登録 */
export const CIRCUITS_HTML = `
      <details class="sec" id="sec-circuit">
        <summary class="sec-h"><span class="chev" aria-hidden="true"></span><h2 id="h-circuit">サーキット</h2><span id="circuit-badge" class="badge"></span><span class="grow"></span>${SEC_HINT}</summary>
        <div class="sec-body">
          <div class="ctabs">
            <div class="tablist" role="tablist" aria-label="サーキットの管理">
              <button class="tab" role="tab" id="tab-list" aria-controls="panel-list" aria-selected="true" data-act="ctab" data-tab="list">登録済みサーキット</button>
              <button class="tab" role="tab" id="tab-reg" aria-controls="panel-reg" aria-selected="false" tabindex="-1" data-act="ctab" data-tab="reg">ファイルによる登録</button>
              <button class="tab" role="tab" id="tab-map" aria-controls="panel-map" aria-selected="false" tabindex="-1" data-act="ctab" data-tab="map">地図による登録</button>
            </div>
            <div class="tab-body" role="tabpanel" id="panel-reg" aria-labelledby="tab-reg" hidden>
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
            <div class="tab-body" role="tabpanel" id="panel-list" aria-labelledby="tab-list">
              <div id="circuit-list"></div>
              <div id="list-msg" class="msg" role="status"></div>
            </div>
          </div>
        </div>
      </details>`;

export interface CircuitsPart extends ImportPart {
  /** タブを tab にする(開いて見せるのは openSection) */
  setTab(tab: CircuitTab): void;
  /** 「サーキット」の節を、タブ tab で開いて見せる */
  openSection(tab: CircuitTab): void;
  /** change を受ける(ファイルの欄・再読み込みのファイル) */
  onChange(t: HTMLElement): Promise<void>;
  /** タブ(role="tab")の上のキー操作(←→ / Home / End) */
  onTabKey(e: KeyboardEvent): void;
}

/** root は「データ管理」の画面全体(この節と、再読み込みのファイルの欄 #reload-input を含む) */
export function createCircuits(root: HTMLElement, session: Session, actions: ImportActions): CircuitsPart {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const listEl = $('circuit-list'), listMsg = $('list-msg');
  const reloadInput = $<HTMLInputElement>('reload-input');
  let ctab: CircuitTab = 'list';               // 開いたときは「登録済みサーキット」(案件 25)
  let reloadTarget: { id: string; kind: 'control' | 'sectors' } | null = null;

  function applyTabs() {
    for (const t of TAB_ORDER) {
      const sel = t === ctab;
      const tab = $('tab-' + t);
      tab.setAttribute('aria-selected', String(sel));
      tab.tabIndex = sel ? 0 : -1;
      $('panel-' + t).hidden = !sel;
    }
  }

  function render() {
    $('circuit-badge').textContent = session.circuits.length ? `登録 ${session.circuits.length} 件` : '未登録';
    listEl.innerHTML = session.circuits.length
      ? `<ul class="clist">${session.circuits.map((c) => `
        <li class="citem">
          <div class="cinfo"><b>${esc(c.name)}</b><span class="sub">セクター ${c.sectors.length} 本</span></div>
          <div class="cact">
            <button class="btn sm" data-act="edit-circuit" data-id="${esc(c.id)}" data-fk="edt-${esc(c.id)}" title="大きな画面で、地図を見ながら編集します">編集(地図)…</button>
            <button class="btn sm" data-act="rename-circuit" data-id="${esc(c.id)}" data-fk="ren-${esc(c.id)}">名前を変更</button>
            <button class="btn sm" data-act="reload-control" data-id="${esc(c.id)}" data-fk="rlc-${esc(c.id)}">コントロールライン<wbr>の再読み込み</button>
            <button class="btn sm" data-act="reload-sectors" data-id="${esc(c.id)}" data-fk="rls-${esc(c.id)}">セクター<wbr>の再読み込み</button>
            <button class="btn sm" data-act="del-circuit" data-id="${esc(c.id)}" data-fk="del-${esc(c.id)}">削除</button>
          </div></li>`).join('')}</ul>`
      : '<div class="empty">登録済みのサーキットはありません。「ファイルによる登録」「地図による登録」タブから登録してください。</div>';
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
      await duplicateNameAlert(v);
      value = v;
    }
  }

  /** ファイルによる登録 */
  async function registerFromFiles() {
    const cln = $<HTMLInputElement>('c-cln').files?.[0];
    const sci = $<HTMLInputElement>('c-sci').files?.[0];
    const nameInput = $<HTMLInputElement>('c-name');
    const out = $('c-msg');
    if (!cln) { out.textContent = '.cln ファイルを選んでください。'; return; }
    const name = nameInput.value || cln.name.replace(/\.cln$/i, '').replace(/^cl_/i, '');
    const r = session.registerCircuit(name, await cln.text(), sci ? await sci.text() : '');
    if (!r.ok && r.reason === 'duplicate') {
      out.textContent = '';
      await duplicateNameAlert(name.trim());
      nameInput.focus();
      return;
    }
    out.textContent = r.message;
    if (r.ok) { nameInput.value = ''; $<HTMLInputElement>('c-cln').value = ''; $<HTMLInputElement>('c-sci').value = ''; }
  }

  applyTabs();
  return {
    render,
    setTab(tab) { ctab = tab; applyTabs(); },
    openSection(tab) {
      ctab = tab; applyTabs();
      const sec = $<HTMLDetailsElement>('sec-circuit');
      sec.open = true;
      sec.scrollIntoView?.({ block: 'start' });
    },
    handle(act, d) {
      switch (act) {
        case 'edit-circuit': actions.openWork('circuit', d.id!); return true;
        case 'open-circuit-editor': actions.openWork('circuit', null); return true;
        case 'del-circuit': session.deleteCircuit(d.id!); listMsg.textContent = ''; return true;
        case 'ctab': ctab = d.tab as CircuitTab; applyTabs(); return true;
        case 'rename-circuit': void renameFlow(d.id!); return true;
        case 'reload-control':
        case 'reload-sectors':
          reloadTarget = { id: d.id!, kind: act === 'reload-control' ? 'control' : 'sectors' };
          reloadInput.accept = reloadTarget.kind === 'control' ? '.cln' : '.sci';
          reloadInput.click();
          return true;
        case 'register': void registerFromFiles(); return true;
        default: return false;
      }
    },
    async onChange(t) {
      // コントロールライン・セクターの欄: 種類の違うファイルは、選んだ時点で外す(案件 29)
      if (t.id === 'c-cln' || t.id === 'c-sci') {
        const f = (t as HTMLInputElement).files?.[0];
        const ext = t.id === 'c-cln' ? '.cln' : '.sci';
        if (f && !hasExt(f.name, ext)) { (t as HTMLInputElement).value = ''; $('c-msg').textContent = wrongExtMessage(f.name, ext); }
        else if (f) $('c-msg').textContent = '';
      }
      if (t.id === 'reload-input') {
        const f = reloadInput.files?.[0];
        const target = reloadTarget;
        reloadInput.value = '';
        const ext = target?.kind === 'control' ? '.cln' : '.sci';
        if (f && target && !hasExt(f.name, ext)) listMsg.textContent = wrongExtMessage(f.name, ext);
        else if (f && target) {
          const text = await f.text();
          const r = target.kind === 'control' ? session.reloadControl(target.id, text) : session.reloadSectors(target.id, text);
          listMsg.textContent = r.message;
        }
      }
    },
    onTabKey(e) {
      const order = TAB_ORDER;
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
    },
  };
}
